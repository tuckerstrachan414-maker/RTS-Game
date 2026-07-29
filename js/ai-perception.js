'use strict';
// What an AI nation KNOWS, as opposed to what is true.
//
// Every rival fact the brain uses — army size, town hall location, what is in a
// storehouse — comes from this file, and this file only writes what the nation
// has actually observed: something it owns had line of sight, it traded blows,
// or an envoy/caravan made contact. Nothing here reads a rival's live totals.
//
// Deliberately still global (it is public knowledge, visible to the player too):
// war declarations and the diplomacy matrices, market prices, drawn territory
// borders, and a nation's own state. Everything else must be earned.
//
// The single most important rule below: STALE INTEL READS AS DANGEROUS. A force
// estimate loses confidence with age, and low confidence inflates the threat
// rather than shrinking it. An AI that has not looked at its neighbour in two
// minutes does not conclude the neighbour is harmless — it goes and looks.

const SIGHT_UNIT = 7;          // tiles a soldier can see
const SIGHT_BUILDING = 9;      // a settled building watches its surroundings
const SIGHT_KEEP = 12;         // town halls and castles watch further
const MEMORY_TAU = 120;        // seconds; confidence decay constant
const PARTIAL_FORCE_MUL = 1.6; // seeing part of an army implies more behind it
const FULL_FORCE_MUL = 1.15;   // sighting their capital gives a near-full count
const STALE_THREAT_BOOST = 0.6;// how much unknown inflates a threat estimate

// What a nation with no information at all should assume about a neighbour.
// Nations grow over a match, so the prior grows too. This is what stops an AI
// from concluding "they have zero army" about a rival it has never scouted —
// the bug that made every game open with an instant declaration of war.
function priorStrength() {
  return 15 + Math.min(90, game.time * 0.12);
}

// One rival, as remembered.
class EnemyRecord {
  constructor(fid) {
    this.fid = fid;
    this.buildings = new Map();   // "x,y" -> {key, x, y, seenAt, store, storeSeenAt}
    this.townhall = null;         // {x, y, seenAt}
    this.forceEst = 0;
    this.forceSeenAt = -999;
    this.contactAt = -999;        // last combat / envoy / caravan contact
    this.marketKnown = false;
    this.everSeen = false;
  }
}

class ScoutMemoryMap {
  constructor(faction) {
    this.faction = faction;
    this.records = new Map();                                 // fid -> EnemyRecord
    this.explored = new Uint8Array(MAP_W * MAP_H);            // ground we have laid eyes on
    this.exploredCount = 0;
  }

  record(fid) {
    let r = this.records.get(fid);
    if (!r) { r = new EnemyRecord(fid); this.records.set(fid, r); }
    return r;
  }

  markExplored(cx, cy, radius) {
    const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(MAP_H - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = y0; y <= y1; y++) {
      for (let xi = x0; xi <= x1; xi++) {
        if (!WORLD_WRAP && (xi < 0 || xi >= MAP_W)) continue;
        const x = wrapX(xi);
        const dx = wdx(cx, x + 0.5), dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * MAP_W + x;
        if (!this.explored[i]) { this.explored[i] = 1; this.exploredCount++; }
      }
    }
  }

  isExplored(x, y) {
    if (y < 0 || y >= MAP_H) return false;
    if (!WORLD_WRAP && (x < 0 || x >= MAP_W)) return false;
    return this.explored[y * MAP_W + wrapX(x)] === 1;
  }

  // Forget a building we remember but can now see is gone (razed or captured).
  forget(fid, x, y) {
    const rec = this.records.get(fid);
    if (rec) rec.buildings.delete(`${x},${y}`);
  }
}

class AIPerception {
  constructor(faction) {
    this.faction = faction;
    this.memory = new ScoutMemoryMap(faction);
    this.observers = [];       // reused scratch: [x, y, radius] per tick
  }

  // ---------- observation ----------

  // Rebuild the set of things this nation is currently looking through.
  gatherObservers() {
    const obs = this.observers;
    obs.length = 0;
    const f = this.faction;
    for (const u of f.units) {
      if (u.alive) obs.push([u.x, u.y, SIGHT_UNIT]);
    }
    for (const b of f.buildings) {
      if (!b.done || b.hp <= 0 || b.type.key === 'bridge') continue;
      const keep = b.type.key === 'townhall' || b.type.key === 'castle';
      obs.push([b.cx, b.cy, keep ? SIGHT_KEEP : SIGHT_BUILDING]);
    }
    return obs;
  }

  visible(x, y) {
    for (const [ox, oy, r] of this.observers) {
      const dx = x - ox, dy = y - oy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  // The sweep. Runs once per brain tick (~2s), early-exits per target, and is
  // the ONLY writer of rival knowledge.
  observe() {
    const now = game.time;
    const f = this.faction;
    const obs = this.gatherObservers();
    for (const [ox, oy, r] of obs) this.memory.markExplored(ox, oy, r);

    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) continue;
      const rec = this.memory.record(o.id);
      let seenValue = 0, sawAnything = false;

      for (const u of o.units) {
        // seeing a rival's farmhands tells you nothing about their army
        if (!u.alive || u.type.envoy || u.type.civilian) continue;
        if (!this.visible(u.x, u.y)) continue;
        seenValue += u.type.dmg * 2 + u.hp * 0.1;
        sawAnything = true;
      }

      let sawCapital = false;
      for (const b of o.buildings) {
        if (!b.done || b.hp <= 0 || b.type.key === 'bridge') continue;
        if (!this.visible(b.cx, b.cy)) continue;
        sawAnything = true;
        this.rememberBuilding(rec, b, now);
        if (b.type.key === 'townhall') sawCapital = true;
        if (b.type.key === 'market') rec.marketKnown = true;
      }

      // prune remembered buildings on ground we can currently see but that are
      // no longer there — razed, or captured by someone else
      for (const [key, mem] of [...rec.buildings]) {
        if (mem.seenAt === now) continue;
        if (!this.visible(mem.x + 0.5, mem.y + 0.5)) continue;
        const live = game.map.buildingAt[game.map.idx(mem.x, mem.y)];
        if (!live || live.faction !== o.id || live.hp <= 0) {
          rec.buildings.delete(key);
          if (rec.townhall && rec.townhall.x === mem.x && rec.townhall.y === mem.y) rec.townhall = null;
        }
      }

      if (sawAnything) {
        rec.everSeen = true;
        // Seeing their capital means seeing their muster ground: a near-complete
        // count. A border skirmish only ever establishes a floor.
        const est = sawCapital ? seenValue * FULL_FORCE_MUL : seenValue * PARTIAL_FORCE_MUL;
        rec.forceEst = sawCapital ? est : Math.max(this.decayedForce(rec), est);
        rec.forceSeenAt = now;
      }
    }
  }

  rememberBuilding(rec, b, now) {
    const key = `${b.x},${b.y}`;
    let mem = rec.buildings.get(key);
    if (!mem) {
      mem = { key: b.type.key, x: b.x, y: b.y, seenAt: now, store: null, storeSeenAt: -999 };
      rec.buildings.set(key, mem);
    }
    mem.seenAt = now;
    mem.key = b.type.key;
    if (b.type.key === 'townhall') rec.townhall = { x: b.x, y: b.y, seenAt: now };
    // Contents are only truly known from close up — standing on it, robbing it,
    // or hitting it. From a distance you can tell a granary is busy, not full.
    if (b.type.storage) {
      const close = this.observers.some(([ox, oy]) =>
        wdist(ox, oy, b.cx, b.cy) <= 2.5);
      if (close) {
        mem.store = { food: b.store.food, wood: b.store.wood, stone: b.store.stone, gold: b.store.gold };
        mem.storeSeenAt = now;
      } else if (mem.storeSeenAt < 0) {
        mem.store = null;   // seen, contents unknown — callers fall back to a prior
      }
    }
  }

  // Contact that is not line of sight: blows traded, an envoy received, a
  // caravan run. Establishes that the nation exists and is active.
  noteContact(fid, forceHint = 0) {
    const rec = this.memory.record(fid);
    rec.contactAt = game.time;
    rec.everSeen = true;
    if (forceHint > 0) {
      rec.forceEst = Math.max(this.decayedForce(rec), forceHint);
      rec.forceSeenAt = game.time;
    }
  }

  // ---------- what the brain is allowed to ask ----------

  confidence(fid) {
    const rec = this.memory.records.get(fid);
    if (!rec || !rec.everSeen) return 0;
    const age = game.time - Math.max(rec.forceSeenAt, rec.contactAt);
    return Math.exp(-Math.max(0, age) / MEMORY_TAU);
  }

  decayedForce(rec) {
    if (!rec.everSeen) return priorStrength();
    const age = Math.max(0, game.time - rec.forceSeenAt);
    const conf = Math.exp(-age / MEMORY_TAU);
    // as memory fades, the estimate slides back toward the neutral prior
    return rec.forceEst * conf + priorStrength() * (1 - conf);
  }

  // Best guess at a rival's army value, plus how much to trust it.
  estimatedStrength(fid) {
    const rec = this.memory.records.get(fid);
    if (!rec || !rec.everSeen) return { value: priorStrength(), confidence: 0 };
    return { value: this.decayedForce(rec), confidence: this.confidence(fid) };
  }

  // The number to use when the answer being wrong is expensive: attacking,
  // sizing a garrison, deciding whether you are safe. Uncertainty adds threat.
  threatStrength(fid) {
    const { value, confidence } = this.estimatedStrength(fid);
    return value * (1 + (1 - confidence) * STALE_THREAT_BOOST);
  }

  knownTownhall(fid) {
    const rec = this.memory.records.get(fid);
    return rec && rec.townhall ? rec.townhall : null;
  }

  knownBuildings(fid, typeKey = null) {
    const rec = this.memory.records.get(fid);
    if (!rec) return [];
    const out = [];
    for (const mem of rec.buildings.values()) {
      if (!typeKey || mem.key === typeKey) out.push(mem);
    }
    return out;
  }

  hasMarket(fid) {
    const rec = this.memory.records.get(fid);
    return !!(rec && rec.marketKnown);
  }

  // What a remembered store is probably worth now. Exact readings decay toward
  // a pop-scaled prior, because goods move.
  rememberedStore(fid, mem) {
    if (!mem.store) return null;
    const age = Math.max(0, game.time - mem.storeSeenAt);
    const conf = Math.exp(-age / MEMORY_TAU);
    const s = mem.store;
    return {
      food: s.food * conf, wood: s.wood * conf,
      stone: s.stone * conf, gold: s.gold * conf, confidence: conf,
    };
  }

  // Gold-weighted plunder estimate for a rival, from remembered stores only.
  estimatedLoot(fid) {
    let v = 0;
    for (const mem of this.knownBuildings(fid)) {
      const s = this.rememberedStore(fid, mem);
      if (!s) continue;
      v += s.gold * 2 + s.food + s.wood + s.stone;
    }
    return v;
  }

  // The fattest storehouse we can remember — where a raid would pay off.
  richestKnownStore(fid) {
    let best = null, bv = 15;
    for (const mem of this.knownBuildings(fid)) {
      const s = this.rememberedStore(fid, mem);
      if (!s) continue;
      const v = s.food + s.wood + s.stone + s.gold;
      if (v > bv) { bv = v; best = mem; }
    }
    return best;
  }

  // Have we seen enough of this nation lately to act on it at all?
  stale(fid, tolerance) {
    const rec = this.memory.records.get(fid);
    if (!rec || !rec.everSeen) return true;
    return game.time - Math.max(rec.forceSeenAt, rec.contactAt) > tolerance;
  }

  // ---------- own state ----------

  // A nation always knows itself exactly. Normalized here under plain macro
  // names so the decision code reads like the design doc rather than like the
  // sim's field names (nation.pop, nation.tax 0..0.4, housingCap(), ...).
  self() {
    const f = this.faction, n = f.nation;
    const foodIncome = estimateIncome(f, 'food') - n.pop * EAT_RATE;
    return {
      food: n.total('food'), wood: n.total('wood'),
      stone: n.total('stone'), gold: n.total('gold'),
      population: n.pop,
      housingCapacity: n.housingCap(),
      idleCitizens: n.idleWorkers(),
      happiness: n.happiness,
      taxRate: n.tax * 100,
      dayPhase: game.isDay ? 'Day' : 'Night',
      secondsToDawn: DAY_NIGHT_CYCLE - (game.time % DAY_NIGHT_CYCLE),
      starving: n.starving,
      warWeariness: n.warWeariness,
      strength: f.strength(),
      armySize: f.armyUnits().length,
      castleTier: f.castleTier,
      income: {
        food: foodIncome,
        wood: estimateIncome(f, 'wood'),
        stone: estimateIncome(f, 'stone'),
        gold: estimateIncome(f, 'gold') + n.pop * n.tax * 0.06,
      },
      headroom: {
        food: n.capacityFor('food') - n.total('food'),
        wood: n.capacityFor('wood') - n.total('wood'),
        stone: n.capacityFor('stone') - n.total('stone'),
        gold: Infinity,
      },
    };
  }
}

// Has this nation ever laid eyes on that one? Used to detect the cold start,
// where a nation knows nobody and exploring matters more than anything else.
function p_everSeen(f, fid) {
  const rec = f.brain.perception.memory.records.get(fid);
  return !!(rec && rec.everSeen);
}
