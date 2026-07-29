'use strict';
// Faction state and AI controller (economy, military, diplomacy impulses).

class Faction {
  constructor(id, isPlayer, personality) {
    this.id = id;
    this.isPlayer = isPlayer;
    this.color = FACTION_COLORS[id];
    this.name = FACTION_COLORS[id].name;
    this.personality = personality;   // {aggression 0..1, mercantile 0..1}
    this.nation = new Nation(id);
    this.buildings = [];
    this.units = [];
    this.eliminated = false;
    this.conqueredBy = null;          // faction that felled our Town Hall; inherits what's left
    this.kingAlive = null;            // null = never had one; true/false once trained
    this.castleTier = 1;              // rises with CASTLE_UPGRADES, gating troop unlocks
    this.aiT = id * (AI_TICK_PERIOD / 4);   // fixed phase: nations never tick together
    this.ai = null;                   // ambition state, lazily built by initFactionAI (js/ai.js)
    this.brain = null;                // perception + utility + trade + combat managers
  }

  townhall() { return this.buildings.find(b => b.type.key === 'townhall' && b.hp > 0); }
  // Civilians are the nation, not its army: they never count toward strength,
  // never join a wave, and are never what a rival is measuring when it decides
  // whether it can take you (js/ai-perception.js).
  armyUnits() { return this.units.filter(u => u.alive && !u.type.envoy && !u.mission && !u.type.civilian); }
  civilians() { return this.units.filter(u => u.alive && u.type.civilian); }
  strength() {
    let s = 0;
    for (const u of this.armyUnits()) s += u.type.dmg * 2 + u.hp * 0.1;
    return s;
  }

  // Forest and rock are walkable now, so "passable" alone would happily muster a
  // new recruit inside a thicket. Sweep for open ground first and only fall back
  // to rough ground if the town is truly hemmed in.
  spawnPointNear(b) {
    const map = game.map;
    let rough = null;
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = b.x + dx, y = b.y + dy;
          if (!map.passable(x, y, this.id)) continue;
          if (map.moveCost(x, y) === 1) return [x, y];
          if (!rough) rough = [x, y];
        }
    }
    return rough || [b.x, b.y];
  }

  trainUnit(typeKey) {
    const castle = this.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0);
    if (!castle) return 'Needs a Castle';
    const type = UNIT_TYPES[typeKey];
    if (type.tier > this.castleTier) return `Locked — requires the ${CASTLE_UPGRADES[type.tier].name} castle upgrade`;
    if (type.unique && (this.kingAlive || this.units.some(u => u.alive && u.type.key === 'king') || castle.trainQueue.some(q => q.unitKey === 'king'))) return 'Only one King';
    // Dev mode's resource top-off (Game.devTopOff) already makes canAfford pass
    // in practice, but population is never topped off — training would still
    // eat into it and eventually hit "No free citizens" without this bypass.
    const dev = this.isPlayer && game.devMode;
    if (!dev) {
      if (this.nation.pop <= this.nation.workersAssigned() + 1) return 'No free citizens';
      if (!this.nation.canAfford(type.cost)) return 'Not enough resources';
      this.nation.pay(type.cost);
      this.nation.pop--;   // a citizen becomes a soldier
    }
    castle.trainQueue.push({ unitKey: typeKey, t: 0 });
    return null;
  }

  startCastleUpgrade() {
    const castle = this.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0);
    if (!castle) return 'Needs a Castle';
    const up = CASTLE_UPGRADES[this.castleTier + 1];
    if (!up) return 'The Castle is fully upgraded';
    if (castle.upgrading) return 'An upgrade is already underway';
    if (!this.nation.canAfford(up.cost)) return 'Not enough resources';
    this.nation.pay(up.cost);
    castle.upgrading = { tier: this.castleTier + 1, t: 0 };
    return null;
  }

  tickTraining(dt) {
    for (const b of this.buildings) {
      if (b.type.key !== 'castle' || !b.done) continue;
      if (b.grandProgress > 0 && !b.grand) {
        b.grandProgress += dt;
        if (b.grandProgress >= 30) { b.grand = true; if (this.isPlayer) game.log('The Grand Castle is complete!', 'good'); }
      }
      if (b.upgrading) {
        b.upgrading.t += dt;
        const up = CASTLE_UPGRADES[b.upgrading.tier];
        if (b.upgrading.t >= up.time) {
          this.castleTier = Math.max(this.castleTier, b.upgrading.tier);
          b.upgrading = null;
          if (this.isPlayer) game.log(`${up.name} complete — new troops unlocked at the Castle!`, 'good');
        }
      }
      if (b.trainQueue.length === 0) continue;
      const q = b.trainQueue[0];
      q.t += dt;
      if (q.t >= UNIT_TYPES[q.unitKey].trainTime) {
        b.trainQueue.shift();
        const [sx, sy] = this.spawnPointNear(b);
        const u = new Unit(q.unitKey, this.id, sx, sy);
        this.units.push(u);
        if (q.unitKey === 'king') this.kingAlive = true;
        if (b.rally) u.orderMove(b.rally[0], b.rally[1]);
      }
    }
  }
}

// ---------- AI ----------

// Temperaments a rival nation can be born with. Three are drawn (without
// replacement) and jittered at the start of every match, so the continent is
// not the same three opponents every game — the warlord next door in one run is
// a walled-up trader in the next. Rolled from the map seed, so ?seed=N still
// reproduces the whole setup.
//   aggression — appetite for war        mercantile — appetite for trade
//   greed      — pull toward loot/riches caution    — weight on threat & walls
//   loyalty    — how much it values pacts and alliances holding
const AI_TEMPERAMENTS = [
  { label: 'warlike',     aggression: 0.80, mercantile: 0.30, greed: 0.55, caution: 0.20, loyalty: 0.30 },
  { label: 'mercantile',  aggression: 0.25, mercantile: 0.90, greed: 0.70, caution: 0.50, loyalty: 0.55 },
  { label: 'cautious',    aggression: 0.40, mercantile: 0.50, greed: 0.40, caution: 0.85, loyalty: 0.60 },
  { label: 'opportunist', aggression: 0.60, mercantile: 0.55, greed: 0.85, caution: 0.35, loyalty: 0.25 },
  { label: 'diplomatic',  aggression: 0.30, mercantile: 0.65, greed: 0.45, caution: 0.55, loyalty: 0.90 },
  { label: 'zealous',     aggression: 0.90, mercantile: 0.15, greed: 0.35, caution: 0.15, loyalty: 0.45 },
];

const PERSONALITY_TRAITS = ['aggression', 'mercantile', 'greed', 'caution', 'loyalty'];

// Draw one temperament per AI nation and jitter it. Index 0 is the player slot.
function rollPersonalities(rng, count) {
  const pool = AI_TEMPERAMENTS.map(t => ({ ...t }));
  for (let i = pool.length - 1; i > 0; i--) {          // Fisher-Yates on the seeded rng
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = [{ aggression: 0, mercantile: 0.5, greed: 0.5, caution: 0.5, loyalty: 0.5, label: 'you' }];
  for (let i = 1; i < count; i++) {
    const base = pool[(i - 1) % pool.length];
    const p = { label: base.label };
    for (const k of PERSONALITY_TRAITS) {
      p[k] = Math.max(0, Math.min(1, base[k] + (rng() - 0.5) * 0.24));
    }
    out.push(p);
  }
  return out;
}

// The AI executor. Everything it used to do inline — staffing, building, market
// orders, army sizing, raiding, war planning — now lives behind the utility
// engine (js/ai-utility.js), which scores those options against each other
// instead of running them in a fixed order.
//
// Ticks are staggered by a fixed per-faction phase rather than a random one, so
// the nations stay evenly de-phased and a given seed replays identically.
function aiTick(f, dt) {
  f.aiT -= dt;
  if (f.aiT > 0) return;
  f.aiT = AI_TICK_PERIOD;
  if (!f.ai) initFactionAI(f);
  f.brain.utility.tick();
}

// Net food per second. Goes through estimateIncome rather than summing farm
// rates itself: a farm's real output now depends on how far its hands carry the
// harvest, and a nation that thinks it is fed when it is not will starve.
function estimateFoodRate(f) {
  return estimateIncome(f, 'food') - f.nation.pop * EAT_RATE;
}

// richestEnemyStorage and maxThreatAgainst are gone: both read every rival's
// live contents and army value. Their replacements answer from memory —
// AIPerception.richestKnownStore and aiMaxThreat (js/ai-utility.js).

// Find a valid spot for a building near an anchor (spiral search). Resource and
// storage buildings prefer the faction's expansion site when one is set, so new
// clusters actually grow; everything else stays near the townhall.
const EXPANSION_BUILDS = ['lumber', 'quarry', 'mine', 'storehouse', 'farm'];
function findBuildSpot(f, typeKey, site = null) {
  const th = f.townhall();
  if (!th) return null;
  const home = [Math.floor(th.cx), Math.floor(th.cy)];
  const anchors = site
    ? (EXPANSION_BUILDS.includes(typeKey) ? [[site.x, site.y], home] : [home, [site.x, site.y]])
    : [home];
  for (const [cx, cy] of anchors) {
    for (let r = 2; r <= 14; r++) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const a = game.rng() * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
        if (canPlace(game.map, typeKey, x, y, f.id)) return [x, y];
      }
    }
  }
  return null;
}
