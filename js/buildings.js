'use strict';
// Building definitions, placement rules, construction, per-building production.

// art: atlas entry; pair=true means [orange,blue] faction variants exist in the tileset.
// art: null means the sprite is not an atlas lookup — it is baked at load time by
//      `bakeBuildings` (js/assets.js), which keys its output off this table's `key`,
//      or (walls, gates, bridges) drawn per tile from `Assets.rampart`/the bridge
//      decks rather than stamped as one sprite at all.
// flat: the building's art lies on the ground (crop fields), so it is painted with the
//      terrain rather than in the depth-sorted pass (js/ui.js).
// size: tiles per side (art is scaled up for larger buildings).
// How far (in tiles, each direction — a 51×51 square) a Lumber Camp's workers
// will range to find a tree to chop. `findWorkTile` below is the one search;
// estimateIncome and the gatherers both go through it (see BUGS #6, fixed).
const LUMBER_RADIUS = 25;
// How far a Quarry's stonecutters and a Gold Mine's diggers will walk from the
// building to find the rock face or cave mouth they work. Unlike forest, neither
// is consumed — the tile is a workplace, not a stock.
const QUARRY_RADIUS = 4;
const MINE_RADIUS = 3;
// `slots` are worker slots, and every filled one is now a civilian standing on
// the map (js/civilians.js). `builders: true` marks slots whose citizens become
// builders — they haul materials to construction sites instead of gathering.
const BUILDING_TYPES = {
  townhall: {
    key: 'townhall', name: 'Town Hall', art: null, size: 2,
    cost: {}, hp: 900, buildTime: 0, slots: 2, builders: true, solid: true,
    storage: { food: 300, wood: 300, stone: 300, gold: 1e9 },
    desc: 'Heart of your nation. Stores resources, and quarters two builders. Lose it and your nation falls.',
  },
  storehouse: {
    key: 'storehouse', name: 'Storehouse', art: null, size: 1,
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
    key: 'farm', name: 'Farm', art: null, flat: true, size: 2,
    cost: { wood: 15 }, hp: 120, buildTime: 6, slots: 3,
    produces: 'food', rate: 0.5,
    desc: 'Workers grow food on crop fields. +50% next to water.',
    placeReq: (map, x, y) => true,
  },
  lumber: {
    key: 'lumber', name: 'Lumber Camp', art: null, size: 1,
    cost: { wood: 20 }, hp: 150, buildTime: 6, slots: 3,
    produces: 'wood', rate: 0.4,
    desc: 'Workers chop adjacent trees for wood. Needs trees nearby.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_TREE, 2) > 0,
    reqText: 'must be within 2 tiles of trees',
  },
  quarry: {
    key: 'quarry', name: 'Quarry', art: null, size: 1,
    cost: { wood: 25 }, hp: 150, buildTime: 8, slots: 3,
    produces: 'stone', rate: 0.3,
    desc: 'Workers cut stone from adjacent rock. Needs rocks nearby.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_ROCK, 2) > 0,
    reqText: 'must be within 2 tiles of rocks',
  },
  mine: {
    key: 'mine', name: 'Gold Mine', art: null, size: 1,
    cost: { wood: 30 }, hp: 150, buildTime: 10, slots: 3,
    produces: 'gold', rate: 0.25,
    desc: 'Workers dig gold from a cave. Must be next to a cave tile.',
    placeReq: (map, x, y) => map.countAdjacent(x, y, T_CAVE, 1) > 0,
    reqText: 'must be adjacent to a cave',
  },
  builderhouse: {
    key: 'builderhouse', name: 'Builder House', art: null, size: 1,
    cost: { wood: 30 }, hp: 160, buildTime: 8, slots: 3, builders: true,
    desc: 'Quarters three builders. Nothing gets built without them: they carry 15 materials at a time from your stores to each site.',
  },
  market: {
    key: 'market', name: 'Market', art: AT.MARKET, pair: true, size: 1,
    cost: { wood: 30, stone: 10 }, hp: 150, buildTime: 8, slots: 2,
    produces: 'gold', rate: 0.15, happyAura: 8,
    desc: 'Trade hub: workers earn gold, enables trade routes, +happiness nearby.',
  },
  church: {
    key: 'church', name: 'Church', art: null, size: 2,
    cost: { wood: 20, stone: 40 }, hp: 250, buildTime: 12, slots: 0, happyAura: 14,
    desc: '+happiness for citizens. A content nation grows.',
  },
  well: {
    key: 'well', name: 'Well', art: null, size: 1,
    cost: { stone: 15 }, hp: 80, buildTime: 4, slots: 0, happyAura: 4,
    desc: 'Fresh water: small happiness boost, +25% to adjacent farms.',
  },
  castle: {
    key: 'castle', name: 'Castle', art: null, size: 2,
    cost: { wood: 40, stone: 60 }, hp: 600, buildTime: 16, slots: 0, solid: true,
    desc: 'Trains your army and envoys. Upgrade to a Grand Castle — a monument to your prosperity.',
  },
  wall: {
    key: 'wall', name: 'Wall', art: null, size: 1,
    cost: { stone: 5 }, hp: 300, buildTime: 2, slots: 0, solid: true, line: true,
    desc: 'Stone wall. Segments join up into a solid barrier. Keeps enemies out.',
  },
  gate: {
    key: 'gate', name: 'Gate', art: null, size: 1,
    cost: { stone: 15 }, hp: 250, buildTime: 3, slots: 0, line: true,
    desc: 'A wall your own people (and allies) can pass through. Joins onto walls.',
  },
  bridge: {
    key: 'bridge', name: 'Bridge', art: null, size: 1,
    cost: { wood: 20 }, hp: 120, buildTime: 5, slots: 0, line: true,
    desc: 'Cross rivers and lakes. Drag to lay a span; press R (or the rotate button) to turn it.',
    waterOnly: true,
    reqText: "must be open water, and can't touch a bridge running the other way",
  },
};

const BUILD_MENU = ['house', 'farm', 'lumber', 'quarry', 'mine', 'storehouse', 'builderhouse', 'market', 'church', 'well', 'castle', 'wall', 'gate', 'bridge'];

// Grand Castle: a prestige monument, not a win condition — the game does not end.
// Any nation (player or AI) can raise one once it clears the gate below.
// Requirements checked at start: 50 pop, 70% happiness.
const GRAND_CASTLE_COST = { gold: 300, wood: 200, stone: 200 };

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
    this.workers = 0;              // slots the owner wants filled; civilians follow it
    this.progress = this.type.buildTime === 0 ? 1 : 0;   // construction 0..1
    // Construction site ledger, set by startConstruction: what the site still
    // wants, what has physically been carried here, and what is on a builder's
    // back on its way here. Null once the building is finished.
    this.site = null;
    this.orient = 1;               // bridges: 1 horizontal, 2 vertical
    // Actual delivered throughput, written by gatherers as they bank a load
    // (js/civilians.js) and read by estimateIncome — with hauling, a building's
    // real output depends on how far its workers walk, which no formula here knows.
    this.yieldRate = null;         // measured resource/second, or null until sampled
    this.lastDeliver = -1e9;
    this.yieldTotal = 0;           // lifetime banked by this building's workers
    this.yieldT0 = null; this.yieldBase = 0;   // open sampling window
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

// orient (bridges only): 1 = horizontal, 2 = vertical — checked against
// neighboring bridge tiles below so two spans can never physically join.
function canPlace(map, typeKey, x, y, factionId, orient = 1) {
  const type = BUILDING_TYPES[typeKey];
  for (let dy = 0; dy < type.size; dy++) {
    for (let dx = 0; dx < type.size; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!map.inBounds(tx, ty)) return false;
      const i = map.idx(tx, ty);
      if (map.buildingAt[i]) return false;
      const t = map.terrain[i];
      // A bridge tile that is only *planned* still occupies the water: map.bridge
      // is not stamped until the deck is finished, so occupancy and the
      // perpendicular test below both go through map.bridgeAt, which is set the
      // moment the site is laid out.
      if (type.waterOnly) { if (t !== T_WATER || map.bridge[i] || map.bridgeAt[i]) return false; }
      // A footprint clears whatever rough ground it sits on (see placeBuilding) —
      // forest and rock are buildable, same as they're now walkable (js/map.js).
      // Beach is buildable too, which is what lets a Dock stand on the shore.
      // Caves stay off-limits; they're a resource mouth, not ground to build on.
      else if (t !== T_GRASS && t !== T_TREE && t !== T_ROCK && t !== T_SAND) return false;
      // Bridges run straight, one axis at a time, and never meet at a junction:
      // a tile touching a perpendicular span (or ending flush against one) is refused.
      if (type.key === 'bridge') {
        for (const [ndx, ndy] of ORTH) {
          const nx = tx + ndx, ny = ty + ndy;
          if (!map.inBounds(nx, ny)) continue;
          const nb = map.bridgeAt[map.idx(nx, ny)];
          const nOrient = nb ? nb.orient : map.bridge[map.idx(nx, ny)];
          if (nOrient && nOrient !== orient) return false;
        }
      }
    }
  }
  if (type.placeReq && !type.placeReq(map, x, y)) return false;
  return true;
}

// orient (bridges only): 1 = horizontal, 2 = vertical.
// This lays the building down finished (or, for anything with a build time, at
// 0% with no site ledger). Everything the player and the AI put up goes through
// startConstruction below instead — the only direct caller left is the founding
// Town Hall, which has no build time and predates the `game` global.
function placeBuilding(game, typeKey, x, y, factionId, orient = 1) {
  const b = new Building(typeKey, factionId, x, y);
  b.orient = orient;
  for (const [tx, ty] of b.footprint()) {
    const i = game.map.idx(tx, ty);
    // map.bridge (the terrain flag that makes water walkable) waits for
    // completeBuilding; an unfinished span is a row of pilings, not a crossing.
    if (b.type.key === 'bridge') { game.map.bridgeAt[i] = b; }
    else {
      game.map.buildingAt[i] = b;
      // A footprint claims the ground outright: any tree or rock under it is
      // cleared, same as a track cut through rough terrain (GameMap.carveLine).
      const t = game.map.terrain[i];
      if (t === T_TREE || t === T_ROCK) {
        game.map.terrain[i] = T_GRASS;
        game.map.decor[i] = -1;
        game.map.treeWood[i] = 0;
      }
    }
  }
  game.factions[factionId].buildings.push(b);
  return b;
}

// ---------- construction sites ----------
// Placing a building no longer erects it. It stakes out a site: the ground is
// claimed, but not one plank of the cost has been paid. Builders (js/civilians.js)
// physically carry the materials here 15 at a time, and only once the ledger is
// full does anyone start hammering. Materials in transit are on a builder's back
// — kill the builder and they spill on the ground.
function startConstruction(game, typeKey, x, y, factionId, orient = 1) {
  const b = placeBuilding(game, typeKey, x, y, factionId, orient);
  if (b.type.buildTime > 0) {
    b.progress = 0;
    b.site = { needs: { ...(b.type.cost || {}) }, delivered: {}, inbound: {}, wait: 0 };
    for (const r of RES_KEYS) { b.site.delivered[r] = 0; b.site.inbound[r] = 0; }
  } else completeBuilding(b);
  return b;
}

// How much of resource `r` this site still needs nobody has picked up yet.
function siteOutstanding(b, r) {
  if (!b.site) return 0;
  return Math.max(0, (b.site.needs[r] || 0) - b.site.delivered[r] - b.site.inbound[r]);
}
function siteReady(b) {
  if (!b.site) return true;
  return RES_KEYS.every(r => b.site.delivered[r] >= (b.site.needs[r] || 0) - 1e-6);
}
// Everything physically standing on the site: refunded on demolish, spilled as
// loot when a half-built site is razed.
function siteMaterials(b) {
  const out = {};
  let total = 0;
  for (const r of RES_KEYS) {
    out[r] = b.site ? b.site.delivered[r] : 0;
    total += out[r];
  }
  return total > 0.5 ? out : null;
}

// Builders push progress in their own tick, so this is the one place that can
// finish a building — the per-tick economy loop no longer touches progress.
function advanceConstruction(b, amount) {
  if (b.done || !siteReady(b)) return;
  b.progress = Math.min(1, b.progress + amount);
  if (b.progress >= 1) completeBuilding(b);
}

function completeBuilding(b) {
  b.progress = 1;
  b.site = null;
  if (b.type.key === 'bridge') {
    for (const [tx, ty] of b.footprint()) game.map.bridge[game.map.idx(tx, ty)] = b.orient;
  }
  onBuildingCompleted(b);   // may spark a border dispute (js/territory.js)
}

function removeBuilding(game, b) {
  for (const [tx, ty] of b.footprint()) {
    const i = game.map.idx(tx, ty);
    if (b.type.key === 'bridge') {
      if (game.map.bridge[i]) game.map.bridge[i] = 0;
      if (game.map.bridgeAt[i] === b) game.map.bridgeAt[i] = null;
    }
    else if (game.map.buildingAt[i] === b) game.map.buildingAt[i] = null;
  }
  const arr = game.factions[b.faction].buildings;
  const at = arr.indexOf(b);
  if (at >= 0) arr.splice(at, 1);
}

// A bridge is one Building per tile, but a span reads as a single crossing:
// knock out any tile along it and the whole straight run comes down, not just
// that one square. Walked along the tile's own orientation only, since two
// spans can never physically join (see canPlace).
function collapseBridgeSpan(game, b) {
  const map = game.map;
  const orient = map.bridge[map.idx(b.x, b.y)];
  if (!orient) return;
  const [dx, dy] = orient === 1 ? [1, 0] : [0, 1];
  const span = [b];
  for (const [sx, sy] of [[dx, dy], [-dx, -dy]]) {
    let x = b.x + sx, y = b.y + sy;
    while (map.inBounds(x, y) && map.bridge[map.idx(x, y)] === orient) {
      const nb = map.bridgeAt[map.idx(x, y)];
      if (nb) span.push(nb);
      x += sx; y += sy;
    }
  }
  for (const seg of span) removeBuilding(game, seg);
  return span.length;
}

// Fraction of max HP a building is left with when it changes hands.
const CAPTURE_HP_FRACTION = 0.4;
// Fortifications are never inherited — a conqueror throws down the walls.
const CAPTURE_RAZE = ['wall', 'gate', 'townhall'];

// Hand a building to a new owner instead of razing it. Whatever is physically
// stored inside comes with it (taking an enemy's full granary is the prize),
// but the prize arrives battered and idle: no workers, no training queue, no
// half-bought upgrade, and a fraction of its HP. map.buildingAt already points
// at this object, and territory influence is recomputed from each faction's
// building list, so the captured ground flips owner on the next pass.
function captureBuilding(game, b, newFid) {
  const from = game.factions[b.faction];
  if (from) {
    const at = from.buildings.indexOf(b);
    if (at >= 0) from.buildings.splice(at, 1);
  }
  b.faction = newFid;
  b.workers = 0;
  b.trainQueue = [];
  b.upgrading = null;
  b.rally = null;
  b.hp = Math.max(1, Math.min(b.hp, Math.round(b.type.hp * CAPTURE_HP_FRACTION)));
  game.factions[newFid].buildings.push(b);
  return b;
}

// Everything a fallen nation leaves behind. Completed civilian buildings and
// bridges change hands; fortifications, the ruined seat of government and
// anything still under construction come down.
function annexBuildings(game, fallen, victorFid) {
  let taken = 0;
  for (const b of [...fallen.buildings]) {
    const raze = !b.done || CAPTURE_RAZE.includes(b.type.key)
      || victorFid == null || game.factions[victorFid].eliminated;
    if (raze) removeBuilding(game, b);
    else { captureBuilding(game, b, victorFid); taken++; }
  }
  return taken;
}

// Tear down a building, reclaiming 75% of its build cost (rounded up). Calling
// off a *site* is not a demolition — nothing has been built yet — so it hands
// back every material already carried there, at full value.
function demolishBuilding(game, b) {
  const refund = {};
  if (!b.done) {
    const mats = siteMaterials(b);
    for (const r of RES_KEYS) if (mats && mats[r] > 0.5) refund[r] = Math.floor(mats[r]);
    removeBuilding(game, b);
    if (b.faction >= 0) {
      const n = game.factions[b.faction].nation;
      for (const r in refund) n.res[r] += refund[r];
    }
    return refund;
  }
  for (const [r, v] of Object.entries(b.type.cost || {})) refund[r] = Math.ceil(v * 0.75);
  removeBuilding(game, b);
  if (b.faction >= 0) {
    const n = game.factions[b.faction].nation;
    for (const r in refund) n.res[r] += refund[r];
  }
  return refund;
}

// What ONE worker of this building is worth per second, standing at the face and
// working — bonuses folded in, zero if the ground has nothing left to give.
// Nothing is deposited here any more: a worker fills a 5-unit load at this rate
// and then has to walk it to a Storehouse (js/civilians.js). This is the single
// definition of production maths in the game; `estimateIncome` (js/economy.js)
// calls it rather than re-deriving it, which is what BUGS #6 was about.
// `atTile`, when given, is a workplace the caller has already located — it saves
// the Lumber Camp's emptiness check re-scanning the whole reach.
function workerYieldRate(map, b, atTile = null) {
  const type = b.type;
  if (!type.produces || !b.done) return 0;
  let rate = type.rate;
  if (type.key === 'farm') {
    let bonus = 1;
    if (map.countAdjacent(b.x, b.y, T_WATER, 2) > 0) bonus += 0.5;
    // wells boost farms
    for (const [tx, ty] of b.footprint()) {
      if (nearBuilding(map, tx, ty, 2, 'well')) { bonus += 0.25; break; }
    }
    rate *= bonus;
  }
  if (type.key === 'lumber' && !atTile && !findWorkTile(map, b)) return 0;
  return rate;
}

// The tile a worker of this building physically walks to and works at. Forest is
// consumed as it is cut, so a Lumber Camp searches its whole reach every time and
// idles when there is nothing left; rock and cave are workplaces, not stocks, and
// never run out. Farm hands work their own crop field, traders their own Market.
function findWorkTile(map, b) {
  const key = b.type.key;
  if (key === 'farm' || key === 'market') {
    const tiles = b.footprint();
    return tiles[Math.floor(tiles.length / 2)];
  }
  const [want, radius] = key === 'lumber' ? [T_TREE, LUMBER_RADIUS]
    : key === 'quarry' ? [T_ROCK, QUARRY_RADIUS]
    : key === 'mine' ? [T_CAVE, MINE_RADIUS] : [null, 0];
  if (want === null) return null;
  // nearest first, so a camp works the treeline in front of it before the far side
  let best = null, bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = wrapX(b.x + dx), ty = b.y + dy;
      if (!map.inBounds(tx, ty) || map.t(tx, ty) !== want) continue;
      if (want === T_TREE && map.treeWood[map.idx(tx, ty)] <= 0) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = [tx, ty]; }
    }
  }
  return best;
}

function nearBuilding(map, x, y, radius, typeKey) {
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const b = map.inBounds(x + dx, y + dy) ? map.buildingAt[map.idx(x + dx, y + dy)] : null;
      if (b && b.type.key === typeKey && b.done) return b;
    }
  return null;
}
