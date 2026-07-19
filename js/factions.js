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
    this.aiT = Math.random() * 2;
    this.attackWave = null;           // units currently raiding
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
    if (type.unique && (this.kingAlive || this.units.some(u => u.alive && u.type.key === 'king') || castle.trainQueue.some(q => q.unitKey === 'king'))) return 'Only one King';
    if (this.nation.pop <= this.nation.workersAssigned() + 1) return 'No free citizens';
    if (!this.nation.canAfford(type.cost)) return 'Not enough resources';
    this.nation.pay(type.cost);
    this.nation.pop--;   // a citizen becomes a soldier
    castle.trainQueue.push({ unitKey: typeKey, t: 0 });
    return null;
  }

  tickTraining(dt) {
    for (const b of this.buildings) {
      if (b.type.key !== 'castle' || !b.done || b.trainQueue.length === 0) continue;
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
      // grand castle upgrade
      if (b.grandProgress > 0 && !b.grand) {
        b.grandProgress += dt;
        if (b.grandProgress >= 30) { b.grand = true; if (this.isPlayer) game.log('The Grand Castle is complete!', 'good'); }
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
  const n = f.nation;
  const map = game.map;

  // 1. keep workers assigned: prioritize farms if food low
  const foodRate = estimateFoodRate(f);
  for (const b of f.buildings) {
    if (!b.done || !b.type.slots) continue;
    const want = (b.type.key === 'farm' && foodRate < 0) ? b.type.slots : b.type.slots;
    while (b.workers < want && n.idleWorkers() > 0) b.workers++;
  }

  // 2. build order
  const counts = {};
  for (const b of f.buildings) counts[b.type.key] = (counts[b.type.key] || 0) + 1;
  const needFood = foodRate < n.pop * EAT_RATE * 0.5;
  const buildWish =
    !counts.farm ? 'farm' :
    !counts.lumber ? 'lumber' :                      // wood income before anything else
    needFood && (counts.farm || 0) < 4 ? 'farm' :
    !counts.market && f.personality.mercantile > 0.5 ? 'market' :
    n.pop >= n.housingCap() - 2 ? 'house' :
    (counts.lumber || 0) < 1 + Math.floor(n.pop / 25) ? 'lumber' :
    !counts.quarry ? 'quarry' :
    !counts.market && f.personality.mercantile > 0.4 ? 'market' :
    !counts.castle ? 'castle' :
    !counts.mine ? 'mine' :
    !counts.market ? 'market' :
    !counts.church ? 'church' :
    (counts.house || 0) < Math.ceil(n.pop / 6) ? 'house' :
    !counts.well ? 'well' :
    null;
  if (buildWish && n.canAfford(BUILDING_TYPES[buildWish].cost)) {
    const spot = findBuildSpot(f, buildWish);
    if (spot) {
      n.pay(BUILDING_TYPES[buildWish].cost);
      placeBuilding(game, buildWish, spot[0], spot[1], f.id);
    }
  }

  // 3. military: maintain an army proportional to threat + aggression
  const castle = f.buildings.find(b => b.type.key === 'castle' && b.done);
  if (castle && castle.trainQueue.length < 2) {
    const armySize = f.armyUnits().length;
    const threat = maxThreatAgainst(f);
    const wantArmy = Math.min(14, 2 + Math.floor(threat * 0.12) + Math.floor(f.personality.aggression * 6) + Math.floor(n.pop / 8));
    if (armySize < wantArmy && n.res.food > 60) {
      const pick = ['sword', 'spear', 'archer', 'sword', 'shield', 'crossbow', 'halberd', 'cavalier'][Math.floor(Math.random() * 8)];
      f.trainUnit(pick);
    }
  }

  // 4. war behavior
  const enemies = game.factions.filter(o => !o.eliminated && game.diplomacy.status(f.id, o.id) === 'war');
  if (enemies.length) {
    const army = f.armyUnits();
    if (army.length >= 6 && !f.attackWave) {
      const target = enemies.reduce((a, b) => (a.strength() < b.strength() ? a : b));
      const th = target.townhall();
      if (th) {
        f.attackWave = army.slice(0, Math.floor(army.length * 0.7));
        for (const u of f.attackWave) u.orderAttack(th);
      }
    }
    if (f.attackWave) {
      f.attackWave = f.attackWave.filter(u => u.alive);
      if (f.attackWave.length === 0) f.attackWave = null;
    }
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

// Find a valid spot for a building near the townhall (spiral search).
function findBuildSpot(f, typeKey) {
  const th = f.townhall();
  if (!th) return null;
  const cx = Math.floor(th.cx), cy = Math.floor(th.cy);
  for (let r = 2; r <= 14; r++) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (canPlace(game.map, typeKey, x, y, f.id)) return [x, y];
    }
  }
  return null;
}
