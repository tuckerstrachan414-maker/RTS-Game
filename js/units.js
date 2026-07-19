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
  bandit:   { key: 'bandit',   name: 'Bandit',     spriteKey: 'horseman', cost: { food: 15, gold: 15 }, hp: 45, dmg: 5, dmgType: 'melee', range: 0.9, speed: 3.4, cooldown: 1.1, trainTime: 7, robber: true, desc: 'Fast raider. Send onto an enemy Storehouse to rob it and flee home with the loot.' },
};

// carry capacity: how much plunder a unit can haul (0 = cannot carry loot)
const UNIT_CARRY = { archer: 12, crossbow: 12, mage: 10, archmage: 10, horseman: 30, cavalier: 30, king: 0, prince: 0, bandit: 45 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].carry = UNIT_CARRY[k] !== undefined ? UNIT_CARRY[k] : 20;

// castle tier required to train each unit (1 = basic Castle; see CASTLE_UPGRADES)
const UNIT_TIERS = { shield: 2, halberd: 2, crossbow: 2, horseman: 2, mage: 3, archmage: 3, cavalier: 3, king: 3 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].tier = UNIT_TIERS[k] || 1;

const TRAIN_MENU = ['sword', 'spear', 'shield', 'halberd', 'archer', 'crossbow', 'mage', 'archmage', 'horseman', 'cavalier', 'bandit', 'prince', 'king'];

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
    this.mission = null;       // envoy/caravan/rob/haul mission data
    this.repathT = 0;
    this.carry = { food: 0, wood: 0, stone: 0, gold: 0 };  // plunder being hauled
    this.carryCap = this.type.carry || 0;
  }

  get tileX() { return Math.floor(this.x); }
  get tileY() { return Math.floor(this.y); }
  get alive() { return !this.dead; }
  carryTotal() { return this.carry.food + this.carry.wood + this.carry.stone + this.carry.gold; }

  orderMove(tx, ty) {
    this.target = null;
    this.dest = [tx, ty];
    this.path = findPath(game.map, this.tileX, this.tileY, tx, ty, this.faction);
  }

  orderAttack(target) {
    this.mission = null;
    this.target = target;
    this.dest = null;
  }

  // send a robber to steal from an enemy storage building, then flee home
  orderRob(building) {
    this.mission = { kind: 'rob', target: building };
    this.target = null; this.dest = null; this.path = [];
    this.aggressive = false;
  }

  nearestStorage() {
    let best = null, bd = Infinity;
    for (const b of game.factions[this.faction].buildings) {
      if (!b.done || b.hp <= 0 || !b.type.storage) continue;
      const d = Math.hypot(b.cx - this.x, b.cy - this.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  startHaul() {
    if (this.carryTotal() < 0.5) { this.mission = null; this.aggressive = true; return; }
    this.mission = { kind: 'haul' };
    this.target = null; this.path = [];
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

    // raid missions manage their own movement + actions
    if (this.mission) {
      if (this.mission.kind === 'rob') return this.tickRob(dt);
      if (this.mission.kind === 'haul') return this.tickHaul(dt);
      game.diplomacy.tickMission(this, dt);  // caravan / envoy
    }

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
    } else if (this.carryTotal() > 0 && !this.type.envoy) {
      this.startHaul();   // idle with plunder → carry it home
    } else {
      this.setAnim('idle');
    }
  }

  // steal goods from an enemy storage building, then haul them home
  tickRob(dt) {
    const b = this.mission.target;
    if (!b || b.hp <= 0 || !game.diplomacy.hostile(this.faction, b.faction) || this.carryTotal() >= this.carryCap - 0.01) {
      return this.startHaul();
    }
    if (this.distTo(b) <= this.type.range + 0.3) {
      this.path = [];
      this.setAnim('attack');
      let room = this.carryCap - this.carryTotal();
      const rate = 30 * dt;
      let grabbed = rate;
      for (const r of ['gold', 'stone', 'wood', 'food']) {   // grab the valuables first
        if (room <= 0 || grabbed <= 0) break;
        const take = Math.min(b.store[r], grabbed, room);
        if (take <= 0) continue;
        b.store[r] -= take; this.carry[r] += take; room -= take; grabbed -= take;
      }
      const left = b.store.food + b.store.wood + b.store.stone + b.store.gold;
      if (b.faction === 0 && this.robWarn !== true) { this.robWarn = true; game.log(`Bandits are robbing your ${b.type.name}!`, 'bad'); }
      if (room <= 0.01 || left < 0.5) this.startHaul();
    } else {
      if (this.path.length === 0 || this.repathT <= 0) {
        const [tx, ty] = targetCenter(b);
        this.path = findPath(game.map, this.tileX, this.tileY, Math.floor(tx), Math.floor(ty), this.faction);
        this.repathT = 1.2;
      }
      this.followPath(dt);
    }
  }

  // carry plunder back to a friendly storehouse and deposit it
  tickHaul(dt) {
    const home = this.nearestStorage();
    if (!home) { this.mission = null; this.aggressive = true; return; }  // nowhere to bank it
    if (this.distTo(home) <= this.type.range + 0.4) {
      const n = game.factions[this.faction].nation;
      let banked = 0;
      for (const r of RES_KEYS) {
        if (this.carry[r] > 0) { n.deposit(r, this.carry[r]); banked += this.carry[r]; this.carry[r] = 0; }
      }
      this.mission = null; this.aggressive = true; this.robWarn = false;
      if (this.faction === 0 && banked > 0.5) game.log(`Your raiders banked ${Math.round(banked)} plunder!`, 'good');
    } else {
      if (this.path.length === 0 || this.repathT <= 0) {
        const [tx, ty] = targetCenter(home);
        this.path = findPath(game.map, this.tileX, this.tileY, Math.floor(tx), Math.floor(ty), this.faction);
        this.repathT = 1.2;
      }
      this.followPath(dt);
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

// ---------- crowd separation ----------
// Living units softly push each other apart every tick so armies never stand
// inside one another. Spatial hash keeps it cheap; nudges respect terrain.
const SEP_RADIUS = 0.45;

function separateUnits(dt) {
  const cells = new Map();
  const key = (x, y) => x + y * 4096;
  const all = [];
  for (const f of game.factions) {
    for (const u of f.units) {
      if (!u.alive) continue;
      all.push(u);
      const k = key(Math.floor(u.x), Math.floor(u.y));
      let arr = cells.get(k);
      if (!arr) cells.set(k, arr = []);
      arr.push(u);
    }
  }
  const maxStep = 1.5 * dt;
  for (const u of all) {
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = cells.get(key(ux + dx, uy + dy));
        if (!arr) continue;
        for (const v of arr) {
          if (v.id <= u.id) continue;
          let ox = v.x - u.x, oy = v.y - u.y;
          let d = Math.hypot(ox, oy);
          if (d >= SEP_RADIUS) continue;
          if (d < 1e-4) {  // perfectly stacked: split along a per-unit angle
            const a = (u.id * 2.399963) % (Math.PI * 2);
            ox = Math.cos(a); oy = Math.sin(a); d = 1;
          }
          const push = Math.min(maxStep, (SEP_RADIUS - d) * 0.5);
          nudgeUnit(u, -ox / d * push, -oy / d * push);
          nudgeUnit(v, ox / d * push, oy / d * push);
        }
      }
    }
  }
}

function nudgeUnit(u, mx, my) {
  const nx = u.x + mx, ny = u.y + my;
  // allow the move onto passable ground — or any move at all if the unit is
  // somehow standing on impassable ground, so it can always escape
  if (game.map.passable(Math.floor(nx), Math.floor(ny), u.faction)
      || !game.map.passable(Math.floor(u.x), Math.floor(u.y), u.faction)) { u.x = nx; u.y = ny; }
}

// ---------- formation movement ----------
// Arrange a group into ranks facing the direction of travel: melee up front,
// ranged behind, one destination tile per unit.
function formationMove(units, tx, ty) {
  const movers = units.filter(u => u.alive && !u.mission && !u.type.envoy);
  if (movers.length === 0) return;
  if (movers.length === 1) return movers[0].orderMove(tx, ty);
  let cx = 0, cy = 0;
  for (const u of movers) { cx += u.x; cy += u.y; }
  cx /= movers.length; cy /= movers.length;
  const ang = Math.atan2(ty + 0.5 - cy, tx + 0.5 - cx);
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const cols = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(movers.length * 1.7))));
  const sorted = [...movers].sort((a, b) =>
    (a.type.range > 1.5 ? 1 : 0) - (b.type.range > 1.5 ? 1 : 0) || b.type.hp - a.type.hp);
  const taken = new Set();
  sorted.forEach((u, i) => {
    const depth = -Math.floor(i / cols);            // ranks stack behind the point
    const lateral = (i % cols) - (cols - 1) / 2;    // spread across the front
    const gx = Math.round(tx + depth * cosA - lateral * sinA);
    const gy = Math.round(ty + depth * sinA + lateral * cosA);
    const spot = freeSpotNear(gx, gy, u.faction, taken) || freeSpotNear(tx, ty, u.faction, taken);
    if (spot) { taken.add(spot[0] + spot[1] * 4096); u.orderMove(spot[0], spot[1]); }
    else u.orderMove(tx, ty);
  });
}

function freeSpotNear(x, y, fid, taken) {
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (!taken.has(nx + ny * 4096) && game.map.passable(nx, ny, fid)) return [nx, ny];
      }
    }
  }
  return null;
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
