'use strict';
// Unit definitions, movement (A*), real-time combat, projectiles.

// Thirteen units across three castle tiers and four Ages, four damage types
// (melee | pierce | magic | siege). Every entry answers a different question on
// the battlefield, and none of them is a strictly better version of another.
//   Tier 1 — sword (line), spear (anti-cavalry), archer (ranged), bandit
//            (raider), prince (envoy)
//   Tier 2 — halberd (tank), cavalier (shock)
//   Tier 3 — mage (splash), king (unique, aura)
//   Researched (js/tech.js) — shield (arrow wall, Iron Working), crossbow
//            (armour-piercing, Crossbows), catapult (siege, Engineering),
//            archmage (heavy splash, Arcane Mastery)
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
  // ---- unlocked by research ----
  shield:   { key: 'shield',   name: 'Shieldman',  cost: { food: 25, gold: 12 }, hp: 95, dmg: 5, dmgType: 'melee', range: 0.9, speed: 1.9, cooldown: 1.1, trainTime: 8, armor: 3, arrowWard: 0.5, tech: 'iron', desc: 'A wall of iron and oak. Halves arrow damage and holds the line while archers work.' },
  crossbow: { key: 'crossbow', name: 'Crossbowman', cost: { food: 25, gold: 20 }, hp: 50, dmg: 11, dmgType: 'pierce', range: 4.8, speed: 2.0, cooldown: 2.0, trainTime: 9, projectile: 'arrow', pierceArmor: 3, tech: 'crossbows', desc: 'Slow to reload, but the bolt punches through armour.' },
  catapult: { key: 'catapult', name: 'Catapult',   baked: true, scale: 1.25, cost: { wood: 120, gold: 60 }, hp: 110, dmg: 34, dmgType: 'siege', range: 7.5, minRange: 2, speed: 1.2, cooldown: 4.2, trainTime: 16, projectile: 'boulder', splash: 0.9, siege: true, tech: 'engineering', desc: 'A siege engine. Smashes walls, towers and buildings from long range — but it is slow, cannot fire point-blank, and is helpless without an escort.' },
  archmage: { key: 'archmage', name: 'Archmage',   cost: { food: 30, gold: 60 }, hp: 60, dmg: 15, dmgType: 'magic', range: 4.4, speed: 2.0, cooldown: 2.0, trainTime: 14, projectile: 'fireball', splash: 1.6, tech: 'arcana', desc: 'Master of fire. Wide splash, and magic ignores armour.' },
};

// Mounted units: cavalry techs (Horseback Riding, Chivalry) apply to them, and
// their first blow after a run is a charge (see Unit.tryAttack).
for (const k of ['cavalier', 'bandit']) UNIT_TYPES[k].mounted = true;

// Damage a non-siege attacker deals to a fortification (walls, gates,
// watchtowers). Swords against stone is slow work; a catapult is how a siege
// is actually won.
const FORT_RESIST = 0.35;
// Damage a siege engine deals to anything that is not a building.
const SIEGE_VS_UNITS = 0.3;
// Hit-point and damage bonus per veterancy rank (js/units.js veterancy).
const RANK_BONUS = 0.1;

// Carry capacity: how much plunder a unit can haul. Only the Bandit can carry
// anything at all — loot is a raider's job, so spoils on the ground are worth
// nothing to an army that did not bring one along.
const UNIT_CARRY = { bandit: 45 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].carry = UNIT_CARRY[k] || 0;

// castle tier required to train each unit (1 = basic Castle; see CASTLE_UPGRADES)
const UNIT_TIERS = { halberd: 2, cavalier: 2, mage: 3, king: 3, archmage: 3 };
for (const k in UNIT_TYPES) UNIT_TYPES[k].tier = UNIT_TIERS[k] || 1;

const TRAIN_MENU = ['sword', 'spear', 'archer', 'bandit', 'prince', 'shield', 'crossbow', 'halberd', 'cavalier', 'catapult', 'mage', 'archmage', 'king'];

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
    this.rank = 0;             // veterancy rank (0 recruit … 3 legend) — js/army.js
    this.xp = 0;
    this.legendName = null;
    this.morale = 100;         // 0..100; breaks into a rout below ROUT_AT
    this.routing = null;       // {until} while fleeing home
    this.lastHurtT = -99;      // healing waits for a lull
    this.chargeDist = 0;       // tiles ridden since the last blow (cavalry charge)
    // Standing orders from the player (null for the AI's units, which are
    // driven by their brain): {kind:'move'|'attackmove'|'hold'|'patrol', ...}
    this.order = null;
    this.waypoints = [];       // Shift-queued destinations, taken in order
    this.maxHp = unitMaxHp(this);
    this.hp = this.maxHp;
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
    // Naval (js/naval.js). `aboard` is the transport carrying this unit — while
    // it is set the unit is off the map entirely: not ticked, not drawn, not
    // separated, not targetable. `cargo` is the other half of that link, and is
    // only an array on a hull that can carry anyone.
    this.aboard = null;
    this.cargo = this.type.naval && this.type.capacity ? [] : null;
    this.targetPriority = 'any';   // what this unit hunts on its own (TARGET_PRIORITIES)
    this.groupRole = null;         // null | 'offensive' | 'defensive' (GROUP_ROLES)
    this.defensivePost = null;     // [tx, ty] a defensive unit garrisons and returns to
    this.patrolT = 0;              // countdown to the next patrol leg
    // civilians only (js/civilians.js): where they work and how far through the
    // job they are. Declared here so every unit has one shape.
    this.job = null;               // {b, kind:'gather'|'build'} — follows building.workers
    this.spriteKey = null;         // set from the job (`civSpriteFor`), overrides the type's
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
    this.mission = null;
    this.dest = [tx, ty];
    this.formSpeed = formSpeed;
    this.path = this.pathTo(tx, ty);
  }

  // Every repath in this class goes through here so a hull is never handed a
  // route over dry land, nor an army one over open water (js/naval.js).
  pathTo(tx, ty, iter = 6000) { return unitPathTo(this, tx, ty, iter); }

  orderAttack(target) {
    this.mission = null;
    this.target = target;
    this.dest = null;
    this.formSpeed = 0;
    this.order = null;
    this.waypoints = [];
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
      const d = wdist(this.x, this.y, b.cx, b.cy);
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
    return wdist(this.x, this.y, tx, ty) - (t instanceof Building ? t.type.size * 0.4 : 0);
  }

  tick(dt) {
    // Below decks: a unit aboard a transport is off the map until it is put
    // ashore (js/naval.js). It does not move, fight, or exist to anything else.
    if (this.aboard) return;
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
      if (this.mission.kind === 'board') return tickBoard(this, dt);
      if (this.mission.kind === 'landing') return tickLanding(this, dt);
      game.diplomacy.tickMission(this, dt);  // caravan / envoy
    }

    // a broken soldier runs for home and fights nobody (js/army.js)
    if (this.routing && !this.mission) return tickRout(this, dt);

    // auto-acquire enemies in range. A garrison sweeps from its post instead of
    // from itself, so its reach is fixed to the ground it is holding and does
    // not creep forward every time it takes a step toward something.
    //
    // A plain player move order means MOVE: the unit marches through and does
    // not stop to fight until it arrives (attack-move is how you fight your way
    // somewhere). Holding position only takes what is already within reach.
    const o = this.order;
    const marching = o && o.kind === 'move' && this.path.length > 0;
    if (!this.target && this.aggressive && !this.type.envoy && !this.mission && !marching) {
      this.target = this.garrisoned()
        ? findEnemyNear(this, DEFENSE_LEASH, this.defensivePost[0] + 0.5, this.defensivePost[1] + 0.5)
        : o && o.kind === 'hold' ? findEnemyNear(this, unitRange(this) + 0.4)
        : findEnemyNear(this, 5);
    }
    if (this.target && (targetDead(this.target) || !game.diplomacy.hostile(this.faction, targetFaction(this.target)))) {
      this.target = null;
    }
    if (this.target && o && o.kind === 'hold' && this.distTo(this.target) > unitRange(this) + 0.6) this.target = null;
    // …and drops anything that runs beyond the leash rather than giving chase.
    // The +1 is hysteresis: without it a target hovering on the boundary gets
    // picked up and dropped on alternating ticks.
    if (this.target && this.garrisoned() && this.postDist(...targetCenter(this.target)) > DEFENSE_LEASH + 1) {
      this.target = null;
    }

    if (this.target) {
      const d = this.distTo(this.target);
      if (this.type.minRange && d < this.type.minRange && !(this.target instanceof Building)) {
        // a siege engine cannot depress its arm onto a man at its wheels: back off
        this.backAway(dt, this.target);
      } else if (d <= unitRange(this) + 0.15) {
        this.path = [];
        this.tryAttack(dt);
      } else {
        if (this.path.length === 0 || this.repathT <= 0) {
          const [tx, ty] = targetCenter(this.target);
          this.path = this.pathTo(Math.floor(tx), Math.floor(ty));
          this.repathT = 1.2;
        }
        this.followPath(dt);
      }
    } else if (this.path.length > 0) {
      this.followPath(dt);
    } else if (this.carryTotal() > 0 && !this.type.envoy) {
      this.startHaul();   // idle with plunder → carry it home
    } else if (this.nextOrderLeg()) {
      // a queued waypoint, a patrol turning back, or an attack-move resuming
      // its march after a fight
    } else if (this.garrisoned()) {
      this.tickPatrol(dt);
    } else {
      this.setAnim('idle');
    }
  }

  // With nothing to fight and nowhere to walk: what do the standing orders say?
  // Returns true when it gave the unit somewhere new to go.
  nextOrderLeg() {
    if (this.waypoints.length) {
      const [x, y] = this.waypoints.shift();
      const keep = this.order;
      this.orderMove(x, y);
      this.order = keep && keep.kind === 'attackmove' ? { kind: 'attackmove', x, y } : keep;
      return true;
    }
    const o = this.order;
    if (!o) return false;
    if (o.kind === 'attackmove') {
      if (wdist(this.x, this.y, o.x + 0.5, o.y + 0.5) > 1.6 && (this.repathT <= 0 || !this.dest)) {
        this.orderMove(o.x, o.y);
        this.order = o;
        this.repathT = 1.5;
        return this.path.length > 0;
      }
      this.order = null;
      return false;
    }
    if (o.kind === 'patrol') {
      o.leg = 1 - o.leg;
      const [x, y] = o.leg ? o.b : o.a;
      this.orderMove(x, y);
      this.order = o;
      return this.path.length > 0;
    }
    if (o.kind === 'move') this.order = null;
    return false;
  }

  garrisoned() { return this.groupRole === 'defensive' && !!this.defensivePost && !this.mission; }

  // Step directly away from a threat, a tile at a time.
  backAway(dt, from) {
    if (this.path.length === 0 || this.repathT <= 0) {
      const [fx, fy] = targetCenter(from);
      const dx = wdx(fx, this.x), dy = this.y - fy;
      const d = Math.hypot(dx, dy) || 1;
      const tx = Math.floor(wrapPos(this.x + dx / d * 3)), ty = Math.floor(this.y + dy / d * 3);
      this.path = game.map.passable(tx, ty, this.faction) ? this.pathTo(tx, ty, 400) : [];
      this.repathT = 1.0;
    }
    if (this.path.length) this.followPath(dt); else this.setAnim('idle');
  }

  postDist(x, y) {
    return wdist(x, y, this.defensivePost[0] + 0.5, this.defensivePost[1] + 0.5);
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
        this.path = this.pathTo(Math.floor(tx), Math.floor(ty));
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
        this.path = this.pathTo(Math.floor(tx), Math.floor(ty));
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
        // The cavalry charge: a horseman who has ridden a few tiles into the
        // fight lands his first blow half again as hard and shakes the man he
        // hits — unless that man is holding a spear, a halberd or a shield.
        let mult = 1;
        const t = this.target;
        if (this.type.mounted && this.chargeDist >= 3 && t instanceof Unit
            && !['spear', 'halberd', 'shield'].includes(t.type.key)) {
          mult = 1.5 + (game.factions[this.faction].mods.mountedDmg > 0 ? 0.25 : 0);
          hitMorale(t, 18);
          if (typeof fxCharge === 'function') fxCharge(this, t);
        }
        this.chargeDist = 0;
        dealDamage(this, t, mult);
      }
    } else if (this.anim !== 'attack') this.setAnim('idle');
  }

  followPath(dt) {
    if (this.path.length === 0) return;
    const [nx, ny] = this.path[0];
    const gx = nx + 0.5, gy = ny + 0.5;
    // The step toward the next tile takes the short way round the world, so a
    // unit walking off the eastern edge keeps walking rather than about-facing
    // and marching the whole width of the planet back to the same tile.
    const dx = wdx(this.x, gx), dy = gy - this.y;
    const d = Math.hypot(dx, dy);
    // Terrain under the unit sets the pace: roads speed it up, forest and rocky
    // ground drag it down (js/map.js moveCost) without ever blocking it. A unit
    // marching in formation walks at the group's pace instead of its own, so the
    // Cavaliers don't arrive a rank of Swordsmen ahead of the shield wall.
    const base = this.formSpeed > 0 ? Math.min(this.formSpeed, unitSpeed(this)) : unitSpeed(this);
    let speed = base / game.map.moveCost(this.tileX, this.tileY);
    if (game.map.road[game.map.idx(this.tileX, this.tileY)]) speed *= 1.3;
    const step = speed * dt;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
    this.setAnim('walk');
    if (this.type.mounted) this.chargeDist += Math.min(step, d);
    if (d <= step) {
      this.x = gx; this.y = gy;
      this.path.shift();
      if (this.path.length === 0) { this.dest = null; this.formSpeed = 0; this.setAnim('idle'); }
    } else {
      this.x = wrapPos(this.x + dx / d * step);
      this.y += dy / d * step;
    }
  }

  setAnim(name, restart = false) {
    if (this.anim !== name || restart) { this.anim = name; this.animT = 0; }
  }

  takeDamage(amount, attacker) {
    if (this.dead) return;
    this.hp -= amount;
    this.lastHurtT = game.time;
    if (attacker && attacker instanceof Unit) gainXp(attacker, Math.min(amount, this.hp + amount) * XP_PER_DAMAGE);
    if (this.faction === 0 && attacker && attacker.faction !== 0) {
      alertPlayer(this.x, this.y, this.type.civilian ? 'Your citizens are under attack!' : this.type.naval
        ? 'Your ships are under attack!' : 'Your troops are under attack!', this.type.civilian ? 'civ' : 'army');
    }
    if (this.hp <= 0) {
      this.dead = true;
      this.setAnim('death', true);
      if (attacker && attacker instanceof Unit) gainXp(attacker, XP_PER_KILL);
      onUnitDeath(this, attacker);
    } else {
      if (this.anim === 'idle') this.setAnim('hurt', true);
      hitMorale(this, amount * 0.6);
      // fight back if idle — civilians have no fight to give and run instead;
      // a unit under a plain move order keeps moving
      const marching = this.order && this.order.kind === 'move' && this.path.length > 0;
      if (!this.target && !this.type.envoy && !this.type.civilian && !this.routing && !marching
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
    [this.x, this.y] = targetCenter(source);
    this.sx = this.x; this.sy = this.y;     // launch point, for a lobbed shot's arc
    const [tx, ty] = targetCenter(target);
    this.tx = tx; this.ty = ty;
    this.target = target;
    this.speed = this.kind === 'arrow' ? 9 : this.kind === 'boulder' ? 5.5 : 7;
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
    const dx = wdx(this.x, this.tx), dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (d <= step) {
      this.x = this.tx; this.y = this.ty;
      this.impact();
    } else {
      this.x = wrapPos(this.x + dx / d * step); this.y += dy / d * step;
    }
  }
  impact() {
    this.impactT = 0;
    if (this.splash > 0) {
      for (const f of game.factions) {
        if (!game.diplomacy.hostile(this.faction, f.id)) continue;
        for (const u of f.units) {
          if (u.alive && !u.aboard && wdist(this.x, this.y, u.x, u.y) <= this.splash) {
            u.takeDamage(this.dmgVs(u), this.source);
          }
        }
      }
      // A lobbed stone lands where it was aimed at: the building it was meant for
      // takes the full blow even when the landing point is on its edge.
      let b = game.map.inBounds(Math.floor(this.x), Math.floor(this.y)) ? game.map.buildingAt[game.map.idx(Math.floor(this.x), Math.floor(this.y))] : null;
      if (!b && this.target instanceof Building && !targetDead(this.target)) b = this.target;
      if (b && game.diplomacy.hostile(this.faction, b.faction)) damageBuilding(b, this.dmgVsBuilding(b), this.source);
    } else if (this.target && !targetDead(this.target)) {
      if (this.target instanceof Building) damageBuilding(this.target, this.dmg, this.source);
      else this.target.takeDamage(this.dmg, this.source);
    }
    if (typeof fxImpact === 'function') fxImpact(this);
  }
  // Splash is worked out per victim: armour and arrow-wards still count, and a
  // catapult stone is far deadlier to a wall than to the soldiers under it.
  dmgVs(t) { return this.source && this.source.type ? effectiveDamage(this.source, t) : this.dmg; }
  dmgVsBuilding(b) { return this.dmgVs(b); }
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
  const type = attacker.type;
  const isBld = target instanceof Building;
  const f = game.factions[attacker.faction];
  // technology
  const m = f && f.mods;
  if (m) {
    dmg *= 1 + (m.dmg[type.dmgType] || 0);
    if (type.mounted) dmg *= 1 + m.mountedDmg;
  }
  // veterancy
  if (attacker.rank) dmg *= 1 + RANK_BONUS * attacker.rank;
  if (target instanceof Unit) {
    if (type.bonusVs && type.bonusVs.includes(target.type.key)) dmg *= type.bonusMul;
    const armor = Math.max(0, (target.type.armor || 0) - (type.pierceArmor || 0));
    if (armor && type.dmgType !== 'magic' && type.dmgType !== 'siege') dmg = Math.max(1, dmg - armor);
    if (target.type.arrowWard && type.dmgType === 'pierce') dmg *= 1 - target.type.arrowWard;
    if (type.siege) dmg *= SIEGE_VS_UNITS;
  } else if (isBld) {
    if (target.type.fortification && !type.siege) dmg *= FORT_RESIST;
  }
  // king aura
  if (f && f.kingAlive && !(attacker instanceof Building)) {
    for (const u of f.units) {
      if (u.alive && u.type.key === 'king' && wdist(attacker.x, attacker.y, u.x, u.y) <= u.type.auraR) {
        dmg *= u.type.aura; break;
      }
    }
  }
  // starving nations fight poorly
  if (f && f.nation.starving) dmg *= 0.7;
  return dmg;
}

// Pace, with the cavalry and navigation techs folded in.
function unitSpeed(u) {
  let v = u.type.speed;
  const m = factionMods(u.faction);
  if (m) {
    if (u.type.mounted) v *= 1 + m.mountedSpeed;
    if (u.type.naval) v *= 1 + m.shipSpeed;
  }
  if (typeof seasonSpeedMul === 'function') v *= seasonSpeedMul(u);
  // the Great Wall: an invader marching inside its owner's borders is slowed
  if (game.territory && !u.type.naval && !u.type.civilian) {
    const own = game.territory.ownerAt(u.tileX, u.tileY);
    if (own >= 0 && own !== u.faction && game.diplomacy.hostile(own, u.faction)) {
      const om = factionMods(own);
      if (om && om.slowInvaders) v *= 1 - om.slowInvaders;
    }
  }
  return v;
}

// Reach, with Fletching's extra half-tile for bowmen.
function unitRange(u) {
  let r = u.type.range;
  const m = factionMods(u.faction);
  if (m && u.type.dmgType === 'pierce' && !(u instanceof Building)) r += m.range.pierce || 0;
  return r;
}

function dealDamage(attacker, target, mult = 1) {
  const dmg = effectiveDamage(attacker, target) * mult;
  if (target instanceof Building) damageBuilding(target, dmg, attacker);
  else target.takeDamage(dmg, attacker);
}

function damageBuilding(b, dmg, attacker) {
  if (b.hp <= 0) return;
  b.hp -= dmg;
  b.lastHurtT = game.time;
  if (attacker && attacker instanceof Unit) gainXp(attacker, dmg * XP_PER_DAMAGE * 0.3);
  if (b.faction === 0 && attacker && attacker.faction !== 0) {
    alertPlayer(b.cx, b.cy, `Your ${b.type.name} is under attack!`, 'bld');
  }
  if (b.hp <= 0) {
    if (attacker && attacker instanceof Unit) gainXp(attacker, XP_PER_RAZE);
    onBuildingDestroyed(b, attacker);
  }
}

// ---------- crowd separation ----------
// Living units softly push each other apart every tick so armies never stand
// inside one another. Spatial hash keeps it cheap; nudges respect terrain.
const SEP_RADIUS = 0.45;

function separateUnits(dt) {
  const cells = new Map();
  // Cell x is wrapped, so the columns either side of the seam are neighbours
  // for jostling purposes just like every other pair.
  const key = (x, y) => wrapX(x) + y * 4096;
  const all = [];
  for (const f of game.factions) {
    for (const u of f.units) {
      if (!u.alive || u.aboard) continue;
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
          let ox = wdx(u.x, v.x), oy = v.y - u.y;
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
  // A hull is jostled by the same rule as a soldier, just against a different
  // definition of ground: open water instead of walkable land.
  const ok = isNaval(u)
    ? (x, y) => game.map.navigable(x, y)
    : (x, y) => game.map.passable(x, y, u.faction);
  // allow the move onto passable ground — or any move at all if the unit is
  // somehow standing on impassable ground, so it can always escape
  if (ok(Math.floor(nx), Math.floor(ny)) || !ok(Math.floor(u.x), Math.floor(u.y))) {
    u.x = wrapPos(nx); u.y = ny;
  }
}

// Fold a fractional world x back into the map. Movement is the one place a
// position can walk off the edge, and on a wrapping world it should come out
// the other side rather than be clamped.
function wrapPos(x) {
  if (!WORLD_WRAP) return x;
  if (x < 0) return x + MAP_W;
  if (x >= MAP_W) return x - MAP_W;
  return x;
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
const DEFAULT_FORMATION_ORDER = ['shield', 'sword', 'spear', 'halberd', 'cavalier', 'king', 'archer', 'crossbow', 'mage', 'archmage', 'catapult', 'bandit', 'prince'];

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
  const pace = Math.min(...movers.map(u => unitSpeed(u)));
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
// Would picking this fight go anywhere? A ship and a soldier live in different
// domains and neither can walk to the other, so across the waterline they only
// take each other on when one is already within weapon reach — a galley rakes
// the shore it is passing, archers shoot at the hull off their beach, and
// neither spends the rest of the match wading toward something unreachable.
function canEngage(unit, t, d) {
  if (isNaval(unit) === targetIsNaval(t)) return true;
  return d <= unitRange(unit) + 0.5;
}

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
        if (!u.alive || u.type.civilian || u.aboard) continue;
        const d = wdist(ox, oy, u.x, u.y);
        if (d < bestD && canEngage(unit, u, d)) { best = u; bestD = d; }
      }
    }
    if (wantsBuildings) {
      // The 0.8 tie-break leans toward troops when both are on the table; with
      // buildings the only eligible target there is nothing to lean away from.
      const bias = pr === 'any' ? 0.8 : 1;
      for (const b of f.buildings) {
        if (b.hp <= 0 || b.type.key === 'bridge') continue;
        if (!matchesPriority(pr, b)) continue;
        const d = wdist(ox, oy, b.cx, b.cy);
        if (d < bestD * bias && canEngage(unit, b, d)) { best = b; bestD = d; }
      }
    }
  }
  return best;
}
