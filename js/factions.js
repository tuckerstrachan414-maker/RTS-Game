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
    this.kingAlive = null;            // null = never had one; true/false once trained
    this.castleTier = 1;              // rises with CASTLE_UPGRADES, gating troop unlocks
    this.aiT = Math.random() * 2;
    this.ai = null;                   // goal-brain state, lazily built by initFactionAI (js/ai.js)
  }

  townhall() { return this.buildings.find(b => b.type.key === 'townhall' && b.hp > 0); }
  armyUnits() { return this.units.filter(u => u.alive && !u.type.envoy && !u.mission); }
  strength() {
    let s = 0;
    for (const u of this.armyUnits()) s += u.type.dmg * 2 + u.hp * 0.1;
    return s;
  }

  spawnPointNear(b) {
    const map = game.map;
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = b.x + dx, y = b.y + dy;
          if (map.passable(x, y, this.id)) return [x, y];
        }
    }
    return [b.x, b.y];
  }

  trainUnit(typeKey) {
    const castle = this.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0);
    if (!castle) return 'Needs a Castle';
    const type = UNIT_TYPES[typeKey];
    if (type.tier > this.castleTier) return `Locked — requires the ${CASTLE_UPGRADES[type.tier].name} castle upgrade`;
    if (type.unique && (this.kingAlive || this.units.some(u => u.alive && u.type.key === 'king') || castle.trainQueue.some(q => q.unitKey === 'king'))) return 'Only one King';
    if (this.nation.pop <= this.nation.workersAssigned() + 1) return 'No free citizens';
    if (!this.nation.canAfford(type.cost)) return 'Not enough resources';
    this.nation.pay(type.cost);
    this.nation.pop--;   // a citizen becomes a soldier
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

const AI_PERSONALITIES = [
  null,                                          // player slot
  { aggression: 0.8, mercantile: 0.3, label: 'warlike' },     // Crimson
  { aggression: 0.25, mercantile: 0.9, label: 'mercantile' }, // Violeta
  { aggression: 0.4, mercantile: 0.5, label: 'cautious' },    // Aurelia
];

function aiTick(f, dt) {
  f.aiT -= dt;
  if (f.aiT > 0) return;
  f.aiT = 2 + Math.random();
  if (!f.ai) initFactionAI(f);
  const n = f.nation;
  const prof = DOCTRINES[f.ai.doctrine];

  // 0. strategy layer: doctrine re-evaluation, grudge decay (js/ai.js)
  aiStrategy(f);

  // 1. keep workers assigned: farms staffed first when food is short
  const foodRate = estimateFoodRate(f);
  const staffOrder = foodRate < 0
    ? [...f.buildings].sort((a, b) => (b.type.key === 'farm' ? 1 : 0) - (a.type.key === 'farm' ? 1 : 0))
    : f.buildings;
  for (const b of staffOrder) {
    if (!b.done || !b.type.slots) continue;
    while (b.workers < b.type.slots && n.idleWorkers() > 0) b.workers++;
  }
  // starving with everyone employed: pull a worker off a non-farm to the fields
  if (foodRate < 0 && n.idleWorkers() === 0) {
    const donor = f.buildings.find(b => b.workers > 0 && b.type.key !== 'farm');
    const field = f.buildings.find(b => b.done && b.type.key === 'farm' && b.workers < b.type.slots);
    if (donor && field) { donor.workers--; field.workers++; }
  }

  // 2. build: deficit-scored wishes from the doctrine (js/ai.js); try the top
  // few so an unbuildable first choice doesn't stall growth
  const counts = {};
  for (const b of f.buildings) counts[b.type.key] = (counts[b.type.key] || 0) + 1;
  for (const wish of aiBuildWishes(f, counts)) {
    if (!n.canAfford(BUILDING_TYPES[wish].cost)) continue;
    const spot = findBuildSpot(f, wish, f.ai.expansionSite);
    if (spot) {
      n.pay(BUILDING_TYPES[wish].cost);
      placeBuilding(game, wish, spot[0], spot[1], f.id);
      break;
    }
  }

  // 3. market trading: sell gluts, buy shortfalls — creates real price movement
  if (game.market && f.buildings.some(b => b.type.key === 'market' && b.done)) {
    for (const r of ['wood', 'stone']) {
      if (n.total(r) > n.pop * 1.5 + 90) game.market.sell(n, r, 15);
    }
    if (n.total('food') > n.pop * 4 + 120) game.market.sell(n, 'food', 15);
    if (n.total('gold') > 160) {
      for (const r of ['food', 'wood', 'stone']) {
        const need = r === 'food' ? n.pop * 2 : 35;
        if (n.total(r) < need) game.market.buy(n, r, 15);
      }
    }
  }

  // 4. military: army sized by the doctrine's ambition, not a fixed cap
  const castle = f.buildings.find(b => b.type.key === 'castle' && b.done);
  const enemies = game.factions.filter(o => !o.eliminated && game.diplomacy.status(f.id, o.id) === 'war');
  if (castle && castle.trainQueue.length < 2) {
    const armySize = f.armyUnits().length;
    const threat = maxThreatAgainst(f);
    // invest in castle upgrades to unlock stronger troops
    if (!castle.upgrading && CASTLE_UPGRADES[f.castleTier + 1]
        && (threat > 25 || prof.upgradesEagerly || n.pop > 22)
        && n.canAfford(CASTLE_UPGRADES[f.castleTier + 1].cost)) {
      f.startCastleUpgrade();
    }
    const wantArmy = Math.min(prof.armyMax,
      Math.round((prof.armyBase + threat * 0.12 + n.pop * prof.armyPerPop) * game.diff.armyMul));
    if (armySize < wantArmy && n.total('food') > 60) {
      const pool = ['sword', 'spear', 'archer', 'sword', 'shield', 'crossbow', 'halberd', 'cavalier']
        .filter(k => UNIT_TYPES[k].tier <= f.castleTier);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      f.trainUnit(pick);
    } else {
      // diplomats keep an envoy ready; raiders keep a stable of bandits
      if (prof.trainsPrince && !f.units.some(u => u.alive && u.type.envoy)
          && !castle.trainQueue.some(q => q.unitKey === 'prince') && n.total('gold') > 60) {
        f.trainUnit('prince');
      }
      const banditWant = prof.bandits || (enemies.length && f.personality.aggression >= 0.4 ? 2 : 0);
      if (banditWant && n.total('food') > 40) {
        const bandits = f.units.filter(u => u.alive && u.type.robber).length;
        if (bandits < banditWant && Math.random() < 0.5) f.trainUnit('bandit');
      }
    }
  }
  if (prof.pursuesGrand) aiPursueGrand(f);

  // 5. raiders: send bandits to rob the richest enemy storehouse
  if (enemies.length) {
    for (const bnd of f.units) {
      if (bnd.alive && bnd.type.robber && !bnd.mission && bnd.carryTotal() === 0) {
        const tgt = richestEnemyStorage(enemies);
        if (tgt) bnd.orderRob(tgt);
      }
    }
  }

  // 6. war behavior: staged attack waves planned by the doctrine (js/ai.js)
  if (enemies.length) {
    aiWarTick(f, enemies);
  } else if (f.ai.wave) {
    aiDisbandWave(f);
  } else {
    // peacetime: rally army near townhall
    const th = f.townhall();
    if (th) {
      for (const u of f.armyUnits()) {
        if (!u.target && u.path.length === 0 && Math.hypot(u.x - th.cx, u.y - th.cy) > 8) {
          u.orderMove(Math.floor(th.cx) + (Math.random() * 6 - 3 | 0), Math.floor(th.cy) + (Math.random() * 6 - 3 | 0));
        }
      }
    }
  }
}

function estimateFoodRate(f) {
  let rate = -f.nation.pop * EAT_RATE;
  for (const b of f.buildings) {
    if (b.done && b.type.key === 'farm') rate += b.type.rate * b.workers;
  }
  return rate;
}

function richestEnemyStorage(enemies) {
  let best = null, bv = 15;
  for (const o of enemies) {
    for (const b of o.buildings) {
      if (!b.done || b.hp <= 0 || !b.type.storage) continue;
      const v = b.store.food + b.store.wood + b.store.stone + b.store.gold;
      if (v > bv) { bv = v; best = b; }
    }
  }
  return best;
}

function maxThreatAgainst(f) {
  let worst = 0;
  for (const o of game.factions) {
    if (o.id === f.id || o.eliminated) continue;
    const st = game.diplomacy.status(f.id, o.id);
    if (st === 'war') worst = Math.max(worst, o.strength() * 1.5);
    else if (st === 'neutral') worst = Math.max(worst, o.strength() * 0.5);
  }
  return worst;
}

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
        const a = Math.random() * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
        if (canPlace(game.map, typeKey, x, y, f.id)) return [x, y];
      }
    }
  }
  return null;
}
