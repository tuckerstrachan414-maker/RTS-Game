'use strict';
// Unit definitions, movement (A*), real-time combat, projectiles.

// dmgType: melee | pierce | magic. Armor types resist differently.
const UNIT_TYPES = {
  sword:    { key: 'sword',    name: 'Swordsman',  cost: { food: 20, gold: 5 },  hp: 60,  dmg: 7,  dmgType: 'melee',  range: 0.9, speed: 2.2, cooldown: 1.0, trainTime: 6,  desc: 'Reliable line infantry.' },
  spear:    { key: 'spear',    name: 'Spearman',   cost: { food: 20, gold: 5 },  hp: 55,  dmg: 6,  dmgType: 'melee',  range: 1.1, speed: 2.2, cooldown: 1.0, trainTime: 6,  bonusVs: ['horseman', 'cavalier'], bonusMul: 2.2, desc: 'Cheap and deadly against cavalry.' },
  shield:   { key: 'shield',   name: 'Shieldman',  cost: { food: 25, gold: 10 }, hp: 110, dmg: 5,  dmgType: 'melee',  range: 0.9, speed: 1.8, cooldown: 1.2, trainTime: 8,  armor: 3, desc: 'A walking wall. Soaks damage up front.' },
  halberd:  { key: 'halberd',  name: 'Halberdier', cost: { food: 30, gold: 15 }, hp: 80,  dmg: 11, dmgType: 'melee',  range: 1.1, speed: 2.0, cooldown: 1.1, trainTime: 9,  desc: 'Elite heavy infantry.' },
  archer:   { key: 'archer',   name: 'Archer',     cost: { food: 20, gold: 10 }, hp: 40,  dmg: 6,  dmgType: 'pierce', range: 4.2, speed: 2.2, cooldown: 1.3, trainTime: 7,  projectile: 'arrow', desc: 'Ranged support. Fragile up close.' },
  crossbow: { key: 'crossbow', name: 'Crossbowman', cost: { food: 25, gold: 20 }, hp: 50, dmg: 10, dmgType: 'pierce', range: 4.6, speed: 2.0, cooldown: 1.8, trainTime: 9,  projectile: 'arrow', desc: 'Slow to reload, hits like a mule.' },
  mage:     { key: 'mage',     name: 'Mage',       cost: { food: 20, gold: 30 }, hp: 35,  dmg: 9,  dmgType: 'magic',  range: 3.8, speed: 2.0, cooldown: 1.6, trainTime: 10, projectile: 'fireball', splash: 1.0, desc: 'Fireballs. Splash damage.' },
  archmage: { key: 'archmage', name: 'Archmage',   cost: { food: 30, gold: 60 }, hp: 45,  dmg: 15, dmgType: 'magic',  range: 4.4, speed: 1.9, cooldown: 2.0, trainTime: 14, projectile: 'fireball', splash: 1.4, desc: 'Devastating area magic.' },
  horseman: { key: 'horseman', name: 'Horseman',   cost: { food: 30, gold: 15 }, hp: 65,  dmg: 7,  dmgType: 'melee',  range: 0.9, speed: 3.6, cooldown: 1.0, trainTime: 8,  desc: 'Fast scout and raider.' },
  cavalier: { key: 'cavalier', name: 'Cavalier',   cost: { food: 40, gold: 30 }, hp: 100, dmg: 12, dmgType: 'melee',  range: 0.9, speed: 3.2, cooldown: 1.1, trainTime: 12, desc: 'Heavy shock cavalry.' },
  king:     { key: 'king',     name: 'King',       cost: { food: 100, gold: 100 }, hp: 200, dmg: 14, dmgType: 'melee', range: 1.0, speed: 2.4, cooldown: 1.0, trainTime: 20, aura: 1.15, auraR: 4, unique: true, desc: 'One per nation. Nearby troops fight harder. If he falls, morale suffers.' },
  prince:   { key: 'prince',   name: 'Prince (Envoy)', cost: { food: 20, gold: 20 }, hp: 50, dmg: 4, dmgType: 'melee', range: 0.9, speed: 2.8, cooldown: 1.2, trainTime: 8, envoy: true, desc: 'Diplomat. Carries proposals to other nations.' },
};

const TRAIN_MENU = ['sword', 'spear', 'shield', 'halberd', 'archer', 'crossbow', 'mage', 'archmage', 'horseman', 'cavalier', 'prince', 'king'];

let nextUnitId = 1;

class Unit {
  constructor(typeKey, factionId, tx, ty) {
    this.id = nextUnitId++;
    this.type = UNIT_TYPES[typeKey];
    this.faction = factionId;
    this.x = tx + 0.5; this.y = ty + 0.5;    // position in tile units (center)
    this.hp = this.type.hp;
    this.path = [];
    this.dest = null;
    this.target = null;        // unit or building
    this.aggressive = true;    // auto-acquire targets
    this.cool = 0;
    this.anim = 'idle'; this.animT = 0;
    this.facing = 1;           // 1 right, -1 left
    this.dead = false; this.deathT = 0;
    this.mission = null;       // envoy/caravan mission data
    this.repathT = 0;
  }

  get tileX() { return Math.floor(this.x); }
  get tileY() { return Math.floor(this.y); }
  get alive() { return !this.dead; }

  orderMove(tx, ty) {
    this.target = null;
    this.dest = [tx, ty];
    this.path = findPath(game.map, this.tileX, this.tileY, tx, ty, this.faction);
  }

  orderAttack(target) {
    this.target = target;
    this.dest = null;
  }

  distTo(t) {
    const [tx, ty] = targetCenter(t);
    return Math.hypot(this.x - tx, this.y - ty) - (t instanceof Building ? t.type.size * 0.4 : 0);
  }

  tick(dt) {
    this.animT += dt;
    if (this.dead) { this.deathT += dt; return; }
    if (this.cool > 0) this.cool -= dt;
    this.repathT -= dt;

    // envoy / caravan missions manage their own destinations
    if (this.mission) game.diplomacy.tickMission(this, dt);

    // auto-acquire enemies in range
    if (!this.target && this.aggressive && !this.type.envoy && !this.mission) {
      this.target = findEnemyNear(this, 5);
    }
    if (this.target && (targetDead(this.target) || !game.diplomacy.hostile(this.faction, targetFaction(this.target)))) {
      this.target = null;
    }

    if (this.target) {
      const d = this.distTo(this.target);
      if (d <= this.type.range + 0.15) {
        this.path = [];
        this.tryAttack(dt);
      } else {
        if (this.path.length === 0 || this.repathT <= 0) {
          const [tx, ty] = targetCenter(this.target);
          this.path = findPath(game.map, this.tileX, this.tileY, Math.floor(tx), Math.floor(ty), this.faction);
          this.repathT = 1.2;
        }
        this.followPath(dt);
      }
    } else if (this.path.length > 0) {
      this.followPath(dt);
    } else {
      this.setAnim('idle');
    }
  }

  tryAttack(dt) {
    const [tx] = targetCenter(this.target);
    this.facing = tx >= this.x ? 1 : -1;
    if (this.cool <= 0) {
      this.cool = this.type.cooldown;
      this.setAnim('attack', true);
      if (this.type.projectile) {
        game.projectiles.push(new Projectile(this, this.target));
      } else {
        dealDamage(this, this.target);
      }
    } else if (this.anim !== 'attack') this.setAnim('idle');
  }

  followPath(dt) {
    if (this.path.length === 0) return;
    const [nx, ny] = this.path[0];
    const gx = nx + 0.5, gy = ny + 0.5;
    const dx = gx - this.x, dy = gy - this.y;
    const d = Math.hypot(dx, dy);
    let speed = this.type.speed;
    if (game.map.road[game.map.idx(this.tileX, this.tileY)]) speed *= 1.3;
    const step = speed * dt;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
    this.setAnim('walk');
    if (d <= step) {
      this.x = gx; this.y = gy;
      this.path.shift();
      if (this.path.length === 0) { this.dest = null; this.setAnim('idle'); }
    } else {
      this.x += dx / d * step;
      this.y += dy / d * step;
    }
  }

  setAnim(name, restart = false) {
    if (this.anim !== name || restart) { this.anim = name; this.animT = 0; }
  }

  takeDamage(amount, attacker) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      this.setAnim('death', true);
      onUnitDeath(this, attacker);
    } else {
      if (this.anim === 'idle') this.setAnim('hurt', true);
      // fight back if idle
      if (!this.target && !this.type.envoy && attacker && game.diplomacy.hostile(this.faction, targetFaction(attacker))) {
        this.target = attacker;
      }
    }
  }
}

class Projectile {
  constructor(source, target) {
    this.kind = source.type.projectile;   // arrow | fireball
    this.source = source;
    this.faction = source.faction;
    this.dmg = effectiveDamage(source, target);
    this.dmgType = source.type.dmgType;
    this.splash = source.type.splash || 0;
    this.x = source.x; this.y = source.y;
    const [tx, ty] = targetCenter(target);
    this.tx = tx; this.ty = ty;
    this.target = target;
    this.speed = this.kind === 'arrow' ? 9 : 7;
    this.done = false;
    this.impactT = -1;
  }
  tick(dt) {
    if (this.impactT >= 0) {
      this.impactT += dt;
      if (this.impactT > 0.4) this.done = true;
      return;
    }
    if (this.target && !targetDead(this.target)) {
      const [tx, ty] = targetCenter(this.target);
      this.tx = tx; this.ty = ty;
    }
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (d <= step) {
      this.x = this.tx; this.y = this.ty;
      this.impact();
    } else {
      this.x += dx / d * step; this.y += dy / d * step;
    }
  }
  impact() {
    this.impactT = 0;
    if (this.splash > 0) {
      for (const f of game.factions) {
        if (!game.diplomacy.hostile(this.faction, f.id)) continue;
        for (const u of f.units) {
          if (u.alive && Math.hypot(u.x - this.x, u.y - this.y) <= this.splash) {
            u.takeDamage(this.dmg, this.source);
          }
        }
      }
      const b = game.map.inBounds(Math.floor(this.x), Math.floor(this.y)) ? game.map.buildingAt[game.map.idx(Math.floor(this.x), Math.floor(this.y))] : null;
      if (b && game.diplomacy.hostile(this.faction, b.faction)) damageBuilding(b, this.dmg, this.source);
    } else if (this.target && !targetDead(this.target)) {
      if (this.target instanceof Building) damageBuilding(this.target, this.dmg, this.source);
      else this.target.takeDamage(this.dmg, this.source);
    }
  }
}

function targetCenter(t) {
  return t instanceof Building ? [t.cx, t.cy] : [t.x, t.y];
}
function targetDead(t) {
  return t instanceof Building ? t.hp <= 0 : t.dead;
}
function targetFaction(t) { return t.faction; }

function effectiveDamage(attacker, target) {
  let dmg = attacker.type.dmg;
  if (target instanceof Unit) {
    if (attacker.type.bonusVs && attacker.type.bonusVs.includes(target.type.key)) dmg *= attacker.type.bonusMul;
    if (target.type.armor && attacker.type.dmgType !== 'magic') dmg = Math.max(1, dmg - target.type.armor);
  }
  // king aura
  const f = game.factions[attacker.faction];
  if (f && f.kingAlive) {
    for (const u of f.units) {
      if (u.alive && u.type.key === 'king' && Math.hypot(u.x - attacker.x, u.y - attacker.y) <= u.type.auraR) {
        dmg *= u.type.aura; break;
      }
    }
  }
  // starving nations fight poorly
  if (f && f.nation.starving) dmg *= 0.7;
  return dmg;
}

function dealDamage(attacker, target) {
  const dmg = effectiveDamage(attacker, target);
  if (target instanceof Building) damageBuilding(target, dmg, attacker);
  else target.takeDamage(dmg, attacker);
}

function damageBuilding(b, dmg, attacker) {
  if (b.hp <= 0) return;
  b.hp -= dmg;
  if (b.hp <= 0) {
    onBuildingDestroyed(b, attacker);
  }
}

function findEnemyNear(unit, radius) {
  let best = null, bestD = radius;
  for (const f of game.factions) {
    if (!game.diplomacy.hostile(unit.faction, f.id)) continue;
    for (const u of f.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - unit.x, u.y - unit.y);
      if (d < bestD) { best = u; bestD = d; }
    }
    for (const b of f.buildings) {
      if (b.hp <= 0 || b.type.key === 'bridge') continue;
      const d = Math.hypot(b.cx - unit.x, b.cy - unit.y);
      if (d < bestD * 0.8) { best = b; bestD = d; }   // slight preference for units
    }
  }
  return best;
}
