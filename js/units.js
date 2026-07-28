'use strict';
// Unit definitions, movement (A*), real-time combat, projectiles.

// Nine units, three tiers, three damage types (melee | pierce | magic). The
// roster is deliberately small: every entry answers a different question on the
// battlefield, and none of them is a strictly better version of another.
//   Tier 1 — sword (line), spear (anti-cavalry), archer (ranged), bandit
//            (raider), prince (envoy)
//   Tier 2 — halberd (tank), cavalier (shock)
//   Tier 3 — mage (splash), king (unique, aura)
const UNIT_TYPES = {
  sword:    { key: 'sword',    name: 'Swordsman',  cost: { food: 20, gold: 5 },  hp: 60,  dmg: 7,  dmgType: 'melee',  range: 0.9, speed: 2.2, cooldown: 1.0, trainTime: 6,  desc: 'Reliable line infantry.' },
  spear:    { key: 'spear',    name: 'Spearman',   cost: { food: 20, gold: 5 },  hp: 55,  dmg: 6,  dmgType: 'melee',  range: 1.1, speed: 2.2, cooldown: 1.0, trainTime: 6,  bonusVs: ['cavalier'], bonusMul: 2.2, desc: 'Cheap and deadly against cavalry.' },
  halberd:  { key: 'halberd',  name: 'Halberdier', cost: { food: 30, gold: 15 }, hp: 80,  dmg: 11, dmgType: 'melee',  range: 1.1, speed: 2.0, cooldown: 1.1, trainTime: 9,  armor: 2, desc: 'Elite heavy infantry. Armoured — shrugs off blades and arrows.' },
  archer:   { key: 'archer',   name: 'Archer',     cost: { food: 20, gold: 10 }, hp: 40,  dmg: 6,  dmgType: 'pierce', range: 4.2, speed: 2.2, cooldown: 1.3, trainTime: 7,  projectile: 'arrow', desc: 'Ranged support. Fragile up close.' },
  mage:     { key: 'mage',     name: 'Mage',       cost: { food: 20, gold: 30 }, hp: 35,  dmg: 9,  dmgType: 'magic',  range: 3.8, speed: 2.0, cooldown: 1.6, trainTime: 10, projectile: 'fireball', splash: 1.0, desc: 'Fireballs. Splash damage, and magic ignores armour.' },
  cavalier: { key: 'cavalier', name: 'Cavalier',   cost: { food: 40, gold: 30 }, hp: 100, dmg: 12, dmgType: 'melee',  range: 0.9, speed: 3.2, cooldown: 1.1, trainTime: 12, desc: 'Heavy shock cavalry. Fast, but Spearmen gut it.' },
  king:     { key: 'king',     name: 'King',       cost: { food: 100, gold: 100 }, hp: 200, dmg: 14, dmgType: 'melee', range: 1.0, speed: 2.4, cooldown: 1.0, trainTime: 20, aura: 1.15, auraR: 4, unique: true, desc: 'One per nation. Nearby troops fight harder. If he falls, morale suffers.' },
  prince:   { key: 'prince',   name: 'Prince (Envoy)', cost: { food: 20, gold: 20 }, hp: 50, dmg: 4, dmgType: 'melee', range: 0.9, speed: 2.8, cooldown: 1.2, trainTime: 8, envoy: true, desc: 'Diplomat. Carries proposals to other nations.' },
  bandit:   { key: 'bandit',   name: 'Bandit',     spriteKey: 'horseman', cost: { food: 15, gold: 15 }, hp: 45, dmg: 5, dmgType: 'melee', range: 0.9, speed: 3.4, cooldown: 1.1, trainTime: 7, robber: true, desc: 'Fast raider, and the only troop that can carry plunder. Send onto an enemy Storehouse to rob it and flee home with the loot.' },
};

// Carry capacity: how much plunder a unit can haul. Only the Bandit can carry
// anything at all — loot is a raider's job, so spoils on the ground are worth
// nothing to an army that did not bring one along.
const UNIT_CARRY = { bandit: 45 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].carry = UNIT_CARRY[k] || 0;

// castle tier required to train each unit (1 = basic Castle; see CASTLE_UPGRADES)
const UNIT_TIERS = { halberd: 2, cavalier: 2, mage: 3, king: 3 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].tier = UNIT_TIERS[k] || 1;

const TRAIN_MENU = ['sword', 'spear', 'archer', 'bandit', 'prince', 'halberd', 'cavalier', 'mage', 'king'];

// ---------- targeting priorities ----------
// What a group goes looking for a fight with on its own. This filters
// `findEnemyNear` — i.e. *proactive* target acquisition — and nothing else, so
// a direct attack order from the player always lands whatever it was aimed at,
// and a unit that is standing idle when something shoots it still fights back
// (`takeDamage`). A unit already busy on a target is never diverted by either.
const TARGET_PRIORITIES = [
  { key: 'any',        label: 'Anything (default)', hint: 'Attack whatever comes into range.' },
  { key: 'units',      label: 'Troops only',        hint: 'Ignore buildings; only pick fights with enemy soldiers.' },
  { key: 'structures', label: 'Buildings only',     hint: 'Walk past enemy troops and put everything into razing their works.' },
  { key: 'townhall',   label: 'Town Halls',         hint: 'Go for the throat — the seat of government, and nothing else.' },
  { key: 'storehouse', label: 'Storehouses',        hint: 'Burn the stockpiles. Razing one spills its goods as loot.' },
  { key: 'farm',       label: 'Farms',              hint: 'Starve them out.' },
  { key: 'house',      label: 'Houses',             hint: 'Level the housing and choke their population growth.' },
];
const TARGET_PRIORITY_KEYS = TARGET_PRIORITIES.map(p => p.key);

// ---------- group roles ----------
// A group can be given a standing posture. `offensive` is the historical
// default behaviour spelled out: no self-directed movement at all, free to go
// anywhere it is sent. `defensive` garrisons the tile it was assigned on
// (`defensivePost`), patrols its nation's own territory around it, engages
// anything hostile that comes near the post — and, crucially, will not be
// drawn off it. `null` behaves exactly as `offensive`; it is the un-assigned
// state, kept distinct so the panel can show "no role" honestly.
const GROUP_ROLES = [
  { key: '',          label: 'None',      hint: 'No standing orders. Holds position and fights what comes to it.' },
  { key: 'offensive', label: 'Offensive', hint: 'Never moves on its own. Goes wherever you send it, however far.' },
  { key: 'defensive', label: 'Defensive', hint: 'Patrols your territory around its post and engages intruders — but never chases far.' },
];
// How far from its post a garrison will look for trouble, and follow it. Also
// the patrol radius. Roughly the reach of one town's worth of ground.
const DEFENSE_LEASH = 10;

function matchesPriority(priority, t) {
  if (!priority || priority === 'any') return true;
  const isBuilding = t instanceof Building;
  if (priority === 'units') return !isBuilding;
  if (priority === 'structures') return isBuilding;
  return isBuilding && t.type.key === priority;   // a specific building type
}

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
    this.formSpeed = 0;        // >0 while marching in formation: the group's pace
    this.targetPriority = 'any';   // what this unit hunts on its own (TARGET_PRIORITIES)
    this.groupRole = null;         // null | 'offensive' | 'defensive' (GROUP_ROLES)
    this.defensivePost = null;     // [tx, ty] a defensive unit garrisons and returns to
    this.patrolT = 0;              // countdown to the next patrol leg
    // civilians only (js/civilians.js): where they work and how far through the
    // job they are. Declared here so every unit has one shape.
    this.job = null;               // {b, kind:'gather'|'build'} — follows building.workers
    this.phase = null;             // gatherer leg: 'out' | 'work' | 'home'
    this.spot = null;              // the tile being worked
    this.site = null;              // builder: the construction site it has claimed
    this.fetch = null;             // builder: the store it is walking to, and for what
    this.inbound = null;           // builder: the load a site is counting on
    this.workT = 0; this.workTotal = 0;
    this.wanderT = 0; this.scanT = 0; this.threat = null; this.stuck = 0; this.searchT = 0;
  }

  get tileX() { return Math.floor(this.x); }
  get tileY() { return Math.floor(this.y); }
  get alive() { return !this.dead; }
  carryTotal() { return this.carry.food + this.carry.wood + this.carry.stone + this.carry.gold; }

  // formSpeed caps the unit's pace for the length of this order so a formation
  // arrives together; any order that isn't a formation march clears it, which is
  // why every caller that isn't `formationMove` can ignore the argument.
  orderMove(tx, ty, formSpeed = 0) {
    this.target = null;
    this.dest = [tx, ty];
    this.formSpeed = formSpeed;
    this.path = findPath(game.map, this.tileX, this.tileY, tx, ty, this.faction);
  }

  orderAttack(target) {
    this.mission = null;
    this.target = target;
    this.dest = null;
    this.formSpeed = 0;
  }

  // send a robber to steal from an enemy storage building, then flee home
  orderRob(building) {
    this.mission = { kind: 'rob', target: building };
    this.target = null; this.dest = null; this.path = [];
    this.aggressive = false;
    this.formSpeed = 0;
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
    // Civilians have their own head entirely: they never acquire a target, never
    // take an order, and spend the whole game walking between a job and a store.
    if (this.type.civilian) return tickCivilian(this, dt);
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

    // auto-acquire enemies in range. A garrison sweeps from its post instead of
    // from itself, so its reach is fixed to the ground it is holding and does
    // not creep forward every time it takes a step toward something.
    if (!this.target && this.aggressive && !this.type.envoy && !this.mission) {
      this.target = this.garrisoned()
        ? findEnemyNear(this, DEFENSE_LEASH, this.defensivePost[0] + 0.5, this.defensivePost[1] + 0.5)
        : findEnemyNear(this, 5);
    }
    if (this.target && (targetDead(this.target) || !game.diplomacy.hostile(this.faction, targetFaction(this.target)))) {
      this.target = null;
    }
    // …and drops anything that runs beyond the leash rather than giving chase.
    // The +1 is hysteresis: without it a target hovering on the boundary gets
    // picked up and dropped on alternating ticks.
    if (this.target && this.garrisoned() && this.postDist(...targetCenter(this.target)) > DEFENSE_LEASH + 1) {
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
    } else if (this.garrisoned()) {
      this.tickPatrol(dt);
    } else {
      this.setAnim('idle');
    }
  }

  garrisoned() { return this.groupRole === 'defensive' && !!this.defensivePost && !this.mission; }

  postDist(x, y) {
    return Math.hypot(x - (this.defensivePost[0] + 0.5), y - (this.defensivePost[1] + 0.5));
  }

  // Idle garrison duty: walk back if it has drifted off its ground, otherwise
  // wander its own nation's territory around the post on a slow cycle. Both
  // legs go through orderMove, so the unit still paths and still stops to fight
  // anything the sweep above picks up.
  tickPatrol(dt) {
    this.patrolT -= dt;
    if (this.postDist(this.x, this.y) > DEFENSE_LEASH) {
      this.patrolT = 4;
      return this.orderMove(this.defensivePost[0], this.defensivePost[1]);
    }
    if (this.patrolT > 0) { this.setAnim('idle'); return; }
    this.patrolT = 5 + game.rng() * 6;
    const spot = patrolTileNear(this.faction, this.defensivePost[0] + 0.5, this.defensivePost[1] + 0.5, DEFENSE_LEASH * 0.7);
    if (spot) this.orderMove(spot[0], spot[1]);
    else this.setAnim('idle');   // post is outside our own claim: just hold it
  }

  // Assign a posture. Taking up a defensive role plants the post where the unit
  // is standing now, which is what makes "select a group, mark it Defensive"
  // read as "hold this ground".
  setGroupRole(role) {
    this.groupRole = role || null;
    if (this.groupRole === 'defensive') {
      this.defensivePost = [this.tileX, this.tileY];
      this.patrolT = game.rng() * 4;   // de-phase so a whole squad doesn't step off together
    } else {
      this.defensivePost = null;
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
    // Terrain under the unit sets the pace: roads speed it up, forest and rocky
    // ground drag it down (js/map.js moveCost) without ever blocking it. A unit
    // marching in formation walks at the group's pace instead of its own, so the
    // Cavaliers don't arrive a rank of Swordsmen ahead of the shield wall.
    const base = this.formSpeed > 0 ? Math.min(this.formSpeed, this.type.speed) : this.type.speed;
    let speed = base / game.map.moveCost(this.tileX, this.tileY);
    if (game.map.road[game.map.idx(this.tileX, this.tileY)]) speed *= 1.3;
    const step = speed * dt;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
    this.setAnim('walk');
    if (d <= step) {
      this.x = gx; this.y = gy;
      this.path.shift();
      if (this.path.length === 0) { this.dest = null; this.formSpeed = 0; this.setAnim('idle'); }
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
      // fight back if idle — civilians have no fight to give and run instead
      if (!this.target && !this.type.envoy && !this.type.civilian
          && attacker && game.diplomacy.hostile(this.faction, targetFaction(attacker))) {
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
// Arrange a group into ranks facing the direction of travel. Both the *shape*
// of those ranks and *which unit types take the front* are player settings
// (game.formations, js/main.js — set from the Formations panel and remembered
// in localStorage), so this reads them rather than hardcoding a doctrine.
//
// Both player and AI march through here, but the *preference* is the player's
// alone: an AI wave forms up on the defaults, because a toggle in the player's
// menu has no business reshaping enemy armies. The pace cap below is not a
// preference and applies to everyone.
//
// The default order is still the old melee-first, ranged-behind sort, and the
// sort stays stable so a group's internal ordering does not shuffle between
// identical orders.
const FORMATION_SHAPES = ['diamond', 'rectangle'];
const DEFAULT_FORMATION_ORDER = ['sword', 'spear', 'halberd', 'cavalier', 'king', 'archer', 'mage', 'bandit', 'prince'];

// Rank offsets in formation space: +lateral is right of the line of march,
// -depth is behind the leading point. One slot per unit, index 0 at the front.
//   rectangle — a block `cols` wide, ranks stacked behind it
//   diamond   — a point that widens to a middle rank and narrows again, so the
//               front-of-order units lead and the flanks are covered
function formationSlots(n, shape) {
  const slots = [];
  if (shape === 'diamond') {
    // A diamond W ranks wide holds exactly W² units (1+2+…+W+…+2+1), so
    // W = ceil(sqrt(n)) always has room; a group too small to fill it just
    // stops partway and marches as the leading wedge.
    const W = Math.max(1, Math.ceil(Math.sqrt(n)));
    const widths = [];
    for (let w = 1; w <= W; w++) widths.push(w);
    for (let w = W - 1; w >= 1; w--) widths.push(w);
    for (let rank = 0; rank < widths.length && slots.length < n; rank++) {
      const w = widths[rank];
      for (let i = 0; i < w && slots.length < n; i++) slots.push([-rank, i - (w - 1) / 2]);
    }
  } else {
    const cols = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n * 1.7))));
    for (let i = 0; i < n; i++) slots.push([-Math.floor(i / cols), (i % cols) - (cols - 1) / 2]);
  }
  return slots;
}

function formationMove(units, tx, ty) {
  const movers = units.filter(u => u.alive && !u.mission && !u.type.envoy && !u.type.civilian);
  if (movers.length === 0) return;
  const cfg = (movers[0].faction === 0 && game && game.formations)
    || { shape: 'diamond', order: DEFAULT_FORMATION_ORDER };
  // The group marches at the pace of its slowest member, so it arrives as a
  // formation instead of trickling in fastest-first.
  const pace = Math.min(...movers.map(u => u.type.speed));
  if (movers.length === 1) return movers[0].orderMove(tx, ty);
  let cx = 0, cy = 0;
  for (const u of movers) { cx += u.x; cy += u.y; }
  cx /= movers.length; cy /= movers.length;
  const ang = Math.atan2(ty + 0.5 - cy, tx + 0.5 - cx);
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  // Rank by the player's order list; anything not in it falls to the back.
  const rankOf = u => {
    const i = cfg.order.indexOf(u.type.key);
    return i < 0 ? cfg.order.length : i;
  };
  const sorted = [...movers].sort((a, b) => rankOf(a) - rankOf(b));
  const slots = formationSlots(sorted.length, cfg.shape);
  const taken = new Set();
  sorted.forEach((u, i) => {
    const [depth, lateral] = slots[i];
    const gx = Math.round(tx + depth * cosA - lateral * sinA);
    const gy = Math.round(ty + depth * sinA + lateral * cosA);
    const spot = freeSpotNear(gx, gy, u.faction, taken) || freeSpotNear(tx, ty, u.faction, taken);
    if (spot) { taken.add(spot[0] + spot[1] * 4096); u.orderMove(spot[0], spot[1], pace); }
    else u.orderMove(tx, ty, pace);
  });
}

// A formation slot wants open ground: rough tiles are legal standing room, but a
// rank that forms up inside a wood arrives late and straggles. Take the nearest
// clear tile, keeping the first rough one as a fallback for forest fighting.
function freeSpotNear(x, y, fid, taken) {
  let rough = null;
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (taken.has(nx + ny * 4096) || !game.map.passable(nx, ny, fid)) continue;
        if (game.map.moveCost(nx, ny) === 1) return [nx, ny];
        if (!rough) rough = [nx, ny];
      }
    }
  }
  return rough;
}

// Proactive target acquisition, filtered by the unit's targeting priority
// (TARGET_PRIORITIES above). A priority that matches nothing in range simply
// finds nothing — that is the whole point of "Buildings only".
//
// `ox`/`oy` default to the unit's own position; a defensive garrison passes its
// post instead, so the circle it watches is anchored to the ground it holds.
function findEnemyNear(unit, radius, ox = unit.x, oy = unit.y) {
  const pr = unit.targetPriority || 'any';
  const wantsUnits = pr === 'any' || pr === 'units';
  const wantsBuildings = pr !== 'units';
  let best = null, bestD = radius;
  for (const f of game.factions) {
    if (!game.diplomacy.hostile(unit.faction, f.id)) continue;
    if (wantsUnits) {
      for (const u of f.units) {
        // Civilians are never hunted down on a unit's own initiative — an army
        // walks past the lumberjacks and goes for the soldiers. A direct attack
        // order still lands on them, and splash still catches them.
        if (!u.alive || u.type.civilian) continue;
        const d = Math.hypot(u.x - ox, u.y - oy);
        if (d < bestD) { best = u; bestD = d; }
      }
    }
    if (wantsBuildings) {
      // The 0.8 tie-break leans toward troops when both are on the table; with
      // buildings the only eligible target there is nothing to lean away from.
      const bias = pr === 'any' ? 0.8 : 1;
      for (const b of f.buildings) {
        if (b.hp <= 0 || b.type.key === 'bridge') continue;
        if (!matchesPriority(pr, b)) continue;
        const d = Math.hypot(b.cx - ox, b.cy - oy);
        if (d < bestD * bias) { best = b; bestD = d; }
      }
    }
  }
  return best;
}
