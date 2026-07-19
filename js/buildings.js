'use strict';
// Building definitions, placement rules, construction, per-building production.

// art: atlas entry; pair=true means [orange,blue] faction variants exist in the tileset.
// size: tiles per side (art is scaled up for larger buildings).
const BUILDING_TYPES = {
  townhall: {
    key: 'townhall', name: 'Town Hall', art: AT.TOWNHALL, pair: true, size: 2,
    cost: {}, hp: 900, buildTime: 0, slots: 0,
    storage: { food: 300, wood: 300, stone: 300, gold: 1e9 },
    desc: 'Heart of your nation. Stores resources. Lose it and your nation falls.',
  },
  storehouse: {
    key: 'storehouse', name: 'Storehouse', art: AT.LUMBER, size: 1,
    cost: { wood: 40, stone: 20 }, hp: 400, buildTime: 10, slots: 0,
    storage: { food: 500, wood: 500, stone: 500, gold: 1e9 },
    desc: 'Holds a large stockpile of goods. Enemies can rob it or raze it for loot — guard it well.',
  },
  house: {
    key: 'house', name: 'House', art: AT.HOUSE, pair: true, size: 1,
    cost: { wood: 20 }, hp: 180, buildTime: 6, slots: 0, housing: 6,
    desc: '+6 housing. Citizens need roofs over their heads.',
  },
  farm: {
    key: 'farm', name: 'Farm', art: null, size: 2,
    cost: { wood: 15 }, hp: 120, buildTime: 6, slots: 3,
    produces: 'food', rate: 0.5,
    desc: 'Workers grow food on crop fields. +50% next to water.',
    placeReq: (map, x, y) => true,
  },
  lumber: {
    key: 'lumber', name: 'Lumber Camp', art: AT.LUMBER, size: 1,
    cost: { wood: 20 }, hp: 150, buildTime: 6, slots: 3,
    produces: 'wood', rate: 0.4,
    desc: 'Workers chop adjacent trees for wood. Needs trees nearby.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_TREE, 2) > 0,
    reqText: 'must be within 2 tiles of trees',
  },
  quarry: {
    key: 'quarry', name: 'Quarry', art: AT.QUARRY, size: 1,
    cost: { wood: 25 }, hp: 150, buildTime: 8, slots: 3,
    produces: 'stone', rate: 0.3,
    desc: 'Workers cut stone from adjacent rock. Needs rocks nearby.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_ROCK, 2) > 0,
    reqText: 'must be within 2 tiles of rocks',
  },
  mine: {
    key: 'mine', name: 'Gold Mine', art: AT.MINE, size: 1,
    cost: { wood: 30 }, hp: 150, buildTime: 10, slots: 3,
    produces: 'gold', rate: 0.25,
    desc: 'Workers dig gold from a cave. Must be next to a cave tile.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_CAVE, 1) > 0,
    reqText: 'must be adjacent to a cave',
  },
  market: {
    key: 'market', name: 'Market', art: AT.MARKET, pair: true, size: 1,
    cost: { wood: 30, stone: 10 }, hp: 150, buildTime: 8, slots: 2,
    produces: 'gold', rate: 0.15, happyAura: 8,
    desc: 'Trade hub: workers earn gold, enables trade routes, +happiness nearby.',
  },
  church: {
    key: 'church', name: 'Church', art: AT.CHURCH, size: 2,
    cost: { wood: 20, stone: 40 }, hp: 250, buildTime: 12, slots: 0, happyAura: 14,
    desc: '+happiness for citizens. A content nation grows.',
  },
  well: {
    key: 'well', name: 'Well', art: AT.WELL, size: 1,
    cost: { stone: 15 }, hp: 80, buildTime: 4, slots: 0, happyAura: 4,
    desc: 'Fresh water: small happiness boost, +25% to adjacent farms.',
  },
  castle: {
    key: 'castle', name: 'Castle', art: AT.CASTLE, size: 2,
    cost: { wood: 40, stone: 60 }, hp: 600, buildTime: 16, slots: 0,
    desc: 'Trains your army and envoys. Upgrade to Grand Castle for prosperity victory.',
  },
  wall: {
    key: 'wall', name: 'Wall', art: AT.WALL, size: 1,
    cost: { stone: 5 }, hp: 300, buildTime: 2, slots: 0,
    desc: 'Stone wall. Keeps enemies out.',
  },
  gate: {
    key: 'gate', name: 'Gate', art: AT.GATE, size: 1,
    cost: { stone: 15 }, hp: 250, buildTime: 3, slots: 0,
    desc: 'A wall your own people (and allies) can pass through.',
  },
  bridge: {
    key: 'bridge', name: 'Bridge', art: AT.BRIDGE_H, size: 1,
    cost: { wood: 20 }, hp: 120, buildTime: 5, slots: 0,
    desc: 'Cross rivers and lakes.',
    waterOnly: true,
  },
};

const BUILD_MENU = ['house', 'farm', 'lumber', 'quarry', 'mine', 'storehouse', 'market', 'church', 'well', 'castle', 'wall', 'gate', 'bridge'];

// Castle upgrade tiers: each unlocks new troops at every castle of that nation.
const CASTLE_UPGRADES = {
  2: { name: 'Garrison', cost: { wood: 100, stone: 80, gold: 60 }, time: 20,
       desc: 'Unlocks Shieldman, Halberdier, Crossbowman and Horseman.' },
  3: { name: 'Royal Academy', cost: { wood: 150, stone: 150, gold: 150 }, time: 30,
       desc: 'Unlocks Mage, Archmage, Cavalier and the King.' },
};

let nextBuildingId = 1;

class Building {
  constructor(typeKey, factionId, x, y) {
    this.id = nextBuildingId++;
    this.type = BUILDING_TYPES[typeKey];
    this.faction = factionId;
    this.x = x; this.y = y;                  // top-left tile
    this.hp = this.type.hp;
    this.workers = 0;
    this.progress = this.type.buildTime === 0 ? 1 : 0;   // construction 0..1
    this.rally = null;
    this.trainQueue = [];                    // {unitKey, t}
    this.grand = false;                      // grand castle upgrade
    this.grandProgress = 0;
    this.upgrading = null;                   // {tier, t} while a castle upgrade builds
    this.store = { food: 0, wood: 0, stone: 0, gold: 0 };  // physical goods held (storage buildings)
  }
  get done() { return this.progress >= 1; }
  get cx() { return this.x + this.type.size / 2; }   // center in tile coords
  get cy() { return this.y + this.type.size / 2; }

  footprint() {
    const tiles = [];
    for (let dy = 0; dy < this.type.size; dy++)
      for (let dx = 0; dx < this.type.size; dx++)
        tiles.push([this.x + dx, this.y + dy]);
    return tiles;
  }
}

function canPlace(map, typeKey, x, y, factionId) {
  const type = BUILDING_TYPES[typeKey];
  for (let dy = 0; dy < type.size; dy++) {
    for (let dx = 0; dx < type.size; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!map.inBounds(tx, ty)) return false;
      const i = map.idx(tx, ty);
      if (map.buildingAt[i]) return false;
      const t = map.terrain[i];
      if (type.waterOnly) { if (t !== T_WATER || map.bridge[i]) return false; }
      else if (t !== T_GRASS) return false;
    }
  }
  if (type.placeReq && !type.placeReq(map, x, y)) return false;
  return true;
}

function placeBuilding(game, typeKey, x, y, factionId) {
  const b = new Building(typeKey, factionId, x, y);
  for (const [tx, ty] of b.footprint()) {
    const i = game.map.idx(tx, ty);
    if (b.type.key === 'bridge') game.map.bridge[i] = 1;
    else game.map.buildingAt[i] = b;
  }
  game.factions[factionId].buildings.push(b);
  if (b.type.key === 'bridge') b.progress = 1;  // bridges are walkable ground, not targets
  return b;
}

function removeBuilding(game, b) {
  for (const [tx, ty] of b.footprint()) {
    const i = game.map.idx(tx, ty);
    if (game.map.buildingAt[i] === b) game.map.buildingAt[i] = null;
  }
  const arr = game.factions[b.faction].buildings;
  const at = arr.indexOf(b);
  if (at >= 0) arr.splice(at, 1);
}

// Production per tick for one worked building. Returns {resource, amount} or null.
function buildingProduction(map, b, dt) {
  const type = b.type;
  if (!type.produces || !b.done || b.workers === 0) return null;
  let rate = type.rate * b.workers;
  if (type.key === 'farm') {
    let bonus = 1;
    if (map.countAdjacent(b.x, b.y, T_WATER, 2) > 0) bonus += 0.5;
    // wells boost farms
    for (const [tx, ty] of b.footprint()) {
      const around = nearBuilding(map, tx, ty, 2, 'well');
      if (around) { bonus += 0.25; break; }
    }
    rate *= bonus;
  }
  if (type.key === 'lumber') {
    // consume wood from nearby tree tiles; camp idles if forest exhausted
    let tree = null;
    outer: for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const tx = b.x + dx, ty = b.y + dy;
        if (map.t(tx, ty) === T_TREE && map.treeWood[map.idx(tx, ty)] > 0) { tree = map.idx(tx, ty); break outer; }
      }
    if (tree === null) return null;
    const amount = rate * dt;
    map.treeWood[tree] -= amount;
    if (map.treeWood[tree] <= 0) { map.terrain[tree] = T_GRASS; map.decor[tree] = -1; }
    return { resource: 'wood', amount };
  }
  return { resource: type.produces, amount: rate * dt };
}

function nearBuilding(map, x, y, radius, typeKey) {
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const b = map.inBounds(x + dx, y + dy) ? map.buildingAt[map.idx(x + dx, y + dy)] : null;
      if (b && b.type.key === typeKey && b.done) return b;
    }
  return null;
}
