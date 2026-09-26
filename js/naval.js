'use strict';
// The sea. Docks, ships, and getting an army across water.
//
// A world of continents is unplayable without this: with one nation per
// landmass, an army that cannot embark is an army that can never meet another
// nation. So the minimum viable navy is here — a Dock to build hulls at, a
// Transport that carries troops, a Galley to fight over the crossing, and an AI
// that will mount an amphibious invasion when the enemy is across water.
//
// It is deliberately shallow next to the land game: no blockades, no naval
// supply, no boarding actions. Ships path over water with the same A* the army
// uses (`findPath(..., 'sea')`), fight with the same combat code, and die the
// same way — which is what makes the whole layer this small.
//
// This file loads AFTER units.js and buildings.js and extends both of their
// tables, so nothing here can be referenced at their load time.

// How many land units a Transport holds. Big enough that two or three hulls
// carry a real invasion, small enough that a fleet is a visible commitment.
const TRANSPORT_CAPACITY = 6;
// How close a land unit has to be to a hull to step aboard, and how far a
// landing party is willing to be flung when it disembarks.
const BOARD_RANGE = 1.8;
const LANDING_SPREAD = 4;

const SHIP_TYPES = {
  transport: {
    key: 'transport', name: 'Transport', naval: true, capacity: TRANSPORT_CAPACITY,
    cost: { wood: 60, gold: 20 }, hp: 130, dmg: 0, dmgType: 'melee', range: 0.9,
    speed: 2.9, cooldown: 1, trainTime: 14, scale: 1.15,
    desc: `Carries up to ${TRANSPORT_CAPACITY} troops across water. Unarmed — send a Galley with it.`,
  },
  galley: {
    key: 'galley', name: 'War Galley', naval: true, capacity: 0,
    cost: { wood: 70, gold: 40 }, hp: 160, dmg: 11, dmgType: 'pierce', range: 4.0,
    speed: 3.3, cooldown: 1.4, trainTime: 16, projectile: 'arrow', scale: 1.1,
    desc: 'Fighting ship. Escorts transports and rakes anything that comes near the shore.',
  },
};
// Merchant ships are not built: a sea trade route puts them in the water and
// they sail its lane back and forth (js/diplomacy.js). Unarmed; a war galley
// can sink them, which is how a war strangles overseas trade.
SHIP_TYPES.merchant = {
  key: 'merchant', name: 'Merchant Ship', naval: true, capacity: 0, noTrain: true,
  cost: {}, hp: 90, dmg: 0, dmgType: 'melee', range: 0.9,
  speed: 2.6, cooldown: 1, trainTime: 0, scale: 1.1,
  desc: 'Carries goods between two nations with a trade pact across the sea.',
};
for (const k in SHIP_TYPES) {
  const t = SHIP_TYPES[k];
  t.carry = 0; t.tier = 1;
  UNIT_TYPES[k] = t;
}
// Ships are built at a Dock, never at a Castle, so they get their own menu
// rather than an entry in TRAIN_MENU.
const NAVY_MENU = ['transport', 'galley'];

BUILDING_TYPES.dock = {
  key: 'dock', name: 'Dock', art: null, size: 2,
  cost: { wood: 70, stone: 20 }, hp: 260, buildTime: 14, slots: 0,
  desc: 'Shipyard on the shore. Builds Transports and War Galleys, and is where your troops board them.',
  placeReq: (map, x, y) => dockHasWater(map, x, y),
  reqText: 'must be built on the shore, with open water alongside',
};
BUILD_MENU.push('dock');

// A dock needs open water against its 2x2 footprint — not just anywhere nearby,
// or you get shipyards two tiles inland with no way for a hull to reach them.
function dockHasWater(map, x, y) {
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      const inside = dx >= 0 && dx < 2 && dy >= 0 && dy < 2;
      if (inside) continue;
      if (map.navigable(x + dx, y + dy)) return true;
    }
  }
  return false;
}

// ---------- unit-side helpers ----------

function isNaval(u) { return !!(u && u.type && u.type.naval); }

// The domain a target lives in, for auto-acquisition. Buildings are land, even
// a Dock: a galley can shell one, but only because it is in range, not because
// it went looking for it across the map.
function targetIsNaval(t) { return t instanceof Unit && isNaval(t); }

// Ships find their way with the sea pathfinder, everyone else with the land
// one. Every repath in js/units.js goes through this so a hull can never be
// handed a route over dry land.
function unitPathTo(u, tx, ty, iter = 6000) {
  return findPath(game.map, u.tileX, u.tileY, tx, ty, u.faction, iter, isNaval(u) ? 'sea' : 'land');
}

// ---------- boarding ----------

// Order a land unit aboard a transport. It walks to the shore beside the hull
// and steps on when it gets there; if the hull sails off, the order lapses.
function orderBoard(u, ship) {
  if (isNaval(u) || u.type.civilian || !ship || !isNaval(ship) || ship.dead) return false;
  if (ship.faction !== u.faction) return false;
  if (shipLoad(ship) >= ship.type.capacity) return false;
  u.mission = { kind: 'board', ship };
  u.target = null; u.dest = null; u.path = [];
  u.aggressive = false;
  return true;
}

function shipLoad(ship) { return ship.cargo ? ship.cargo.length : 0; }

function tickBoard(u, dt) {
  const ship = u.mission.ship;
  if (!ship || ship.dead || shipLoad(ship) >= ship.type.capacity) {
    u.mission = null; u.aggressive = true; return;
  }
  if (wdist(u.x, u.y, ship.x, ship.y) <= BOARD_RANGE) return embark(u, ship);
  if (u.path.length === 0 || u.repathT <= 0) {
    // Aim at the shore beside the hull rather than the hull itself — the goal
    // tile is water, and the land pathfinder is allowed to stop adjacent to an
    // impassable goal, which is exactly the quay we want.
    u.path = unitPathTo(u, Math.floor(ship.x), Math.floor(ship.y));
    u.repathT = 1.2;
  }
  u.followPath(dt);
}

// Step aboard: the unit leaves the map entirely until it is put ashore. It
// stays in its faction's roster (so it still counts as army strength) but is
// skipped by ticking, drawing, separation and targeting — see `u.aboard`.
function embark(u, ship) {
  u.mission = null;
  u.path = []; u.dest = null; u.target = null;
  u.aboard = ship;
  u.aggressive = true;
  ship.cargo.push(u);
  // No per-soldier line: a six-man landing party would fill the whole log with
  // it. The order itself already said how many were sent aboard.
}

// Put everyone ashore around (tx, ty). Anyone with nowhere to stand stays
// aboard rather than being dropped into the sea.
function unloadShip(ship, tx, ty) {
  if (!ship.cargo || !ship.cargo.length) return 0;
  const taken = new Set();
  const landed = [];
  for (const u of ship.cargo.slice()) {
    const spot = landingSpot(ship.faction, tx, ty, taken);
    if (!spot) continue;
    taken.add(spot[1] * MAP_W + spot[0]);
    u.aboard = null;
    u.x = spot[0] + 0.5; u.y = spot[1] + 0.5;
    u.path = []; u.dest = null; u.target = null;
    ship.cargo.splice(ship.cargo.indexOf(u), 1);
    landed.push(u);
  }
  if (landed.length && ship.faction === 0) {
    game.log(`${landed.length} troops go ashore.`, 'good');
  }
  return landed.length;
}

// Nearest dry tile to the landing point that nobody has been dropped on yet.
function landingSpot(fid, tx, ty, taken) {
  for (let r = 0; r <= LANDING_SPREAD; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wrapX(tx + dx), y = ty + dy;
        if (!game.map.inBounds(x, y)) continue;
        if (taken.has(y * MAP_W + x)) continue;
        if (!game.map.passable(x, y, fid)) continue;
        if (game.map.terrain[game.map.idx(x, y)] === T_WATER) continue;
        return [x, y];
      }
    }
  }
  return null;
}

// Order a transport to sail toward (tx, ty) and put its troops ashore.
//
// The point given is an OBJECTIVE, not a beach: the AI hands this an enemy
// capital, and the player will happily click the middle of a continent. So the
// berth is the nearest water to it and the landing is the shore beside that
// berth — a fleet aimed inland lands on the nearest coast and marches, which is
// what an invasion actually looks like.
function orderUnload(ship, tx, ty) {
  if (!isNaval(ship) || !shipLoad(ship)) return false;
  const berth = nearestBerth(tx, ty);
  if (!berth) return false;
  const beach = shoreBeside(berth[0], berth[1], ship.faction) || [tx, ty];
  ship.mission = { kind: 'landing', at: beach, berth };
  ship.target = null; ship.dest = null;
  ship.path = unitPathTo(ship, berth[0], berth[1], 40000);
  return true;
}

// The closest water tile to a point, searched outward. The radius is generous
// because the point is usually an inland objective rather than a harbour.
const BERTH_SEARCH = 120;
function nearestBerth(tx, ty) {
  if (game.map.navigable(tx, ty)) return [wrapX(tx), ty];
  for (let r = 1; r <= BERTH_SEARCH; r++) {
    let hit = null;
    for (let dy = -r; dy <= r; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= MAP_H) continue;
      const span = r - Math.abs(dy);
      for (const dx of (span === 0 ? [0] : [-span, span])) {
        const x = wrapX(tx + dx);
        if (game.map.navigable(x, y)) { hit = [x, y]; break; }
      }
      if (hit) break;
    }
    if (hit) return hit;
  }
  return null;
}

// Dry, walkable ground touching this water tile — where the boats actually run in.
function shoreBeside(bx, by, fid) {
  for (const [dx, dy] of ORTH) {
    const x = wrapX(bx + dx), y = by + dy;
    if (!game.map.inBounds(x, y)) continue;
    if (game.map.terrain[game.map.idx(x, y)] === T_WATER) continue;
    if (game.map.passable(x, y, fid)) return [x, y];
  }
  return null;
}

// A transport's own tick: sail, then disgorge. Everything else about a ship —
// combat, damage, death — is the ordinary unit code.
function tickLanding(ship, dt) {
  const m = ship.mission;
  const [bx, by] = m.berth;
  if (wdist(ship.x, ship.y, bx + 0.5, by + 0.5) < 1.4 || ship.path.length === 0) {
    // Close enough to run the boats in. If the shore turned out to be
    // unreachable the cargo still gets put down on whatever land is nearby,
    // because a transport that circles forever with an army inside is worse
    // than one that lands it in the wrong bay.
    unloadShip(ship, m.at[0], m.at[1]);
    ship.mission = null;
    return;
  }
  if (ship.repathT <= 0) {
    ship.path = unitPathTo(ship, bx, by, 40000);
    ship.repathT = 2;
  }
  ship.followPath(dt);
}

// Every ship a nation has afloat, cargo included.
function factionShips(f) { return f.units.filter(u => u.alive && isNaval(u) && !u.aboard); }

// ---------- training ----------
// Ships come out of a Dock, so they need their own build order rather than
// Faction.trainUnit's castle lookup. Same rules otherwise: pay for it, take a
// citizen for the crew, queue it at the building.
function trainShip(f, typeKey) {
  const dock = f.buildings.find(b => b.type.key === 'dock' && b.done && b.hp > 0);
  if (!dock) return 'Needs a Dock';
  const type = UNIT_TYPES[typeKey];
  if (!type || !type.naval) return 'Not a ship';
  const dev = f.isPlayer && game.devMode;
  if (!dev) {
    if (f.nation.pop <= f.nation.workersAssigned() + 1) return 'No free citizens to crew her';
    if (!f.nation.canAfford(type.cost)) return 'Not enough resources';
    f.nation.pay(type.cost);
    f.nation.pop--;
  }
  dock.trainQueue.push({ unitKey: typeKey, t: 0 });
  return null;
}

// Where a finished hull is put in the water: the nearest navigable tile to the
// dock. Without this a ship spawns on the quay and is instantly stuck on land.
function shipSpawnNear(b) {
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wrapX(Math.floor(b.cx) + dx), y = Math.floor(b.cy) + dy;
        if (game.map.navigable(x, y)) return [x, y];
      }
    }
  }
  return null;
}

// ---------- the AI's navy ----------
// One job: when the nation it wants to fight is across water, get an army onto
// that shore. Everything the AI knows here it knows from its own state and from
// the map's continent labelling — no reading a rival's live units or stores.
//
// The campaign is a small state machine on `f.ai.invasion`:
//   building → waiting for a Dock
//   fleet    → waiting for enough hulls
//   loading  → army walking aboard
//   sailing  → transports crossing to the target shore
// and it dissolves the moment the war does.
// The naval brain is not on the AI's 2-second tick. Everything it does is
// either a spiral search of the coastline or a scan of the territory map, and
// neither answer changes meaningfully inside a few seconds — running them at
// full rate tripled the cost of a sim tick for the whole opening, until the
// first shipyard existed and the searches stopped.
const AI_NAVAL_PERIOD = 6;
// How long a campaign waits for a warship to escort it before sailing without
// one. Shorter than a typical war, which is the whole point.
const FLEET_PATIENCE = 90;
// How long any one stage of a campaign may sit without progressing before it is
// written off. Refreshed on every state change (see aiInvasionStep).
const INVASION_STAGE_TIME = 600;

function aiNavalTick(f, dt) {
  const ai = f.ai;
  if (!ai) return;
  ai.navalT = (ai.navalT || 0) - dt;
  if (ai.navalT > 0) return;
  ai.navalT = AI_NAVAL_PERIOD;
  aiNavalExplore(f);
  if (ai.invasion) return aiTickInvasion(f);
  // Only bother once we are at war with somebody we cannot walk to.
  const enemies = game.factions.filter(o => !o.eliminated && o.id !== f.id
    && game.diplomacy.status(f.id, o.id) === 'war');
  if (!enemies.length) return;
  const th = f.townhall();
  if (!th) return;
  const home = game.map.continentAt(Math.floor(th.cx), Math.floor(th.cy));
  for (const o of enemies) {
    const where = aiEnemyAnchor(f, o.id);
    if (!where) continue;
    const there = game.map.continentAt(where[0], where[1]);
    if (there < 0 || there === home) continue;      // we can march: not our problem
    ai.invasion = { state: 'building', targetFid: o.id, at: where,
      units: [], ships: [], deadline: game.time + INVASION_STAGE_TIME };
    return;
  }
}

// Where do we think this rival lives? Scouted memory first — that is the honest
// answer, and the only one that carries any detail. Failing that, the drawn
// territory borders, which CLAUDE.md lists as public knowledge alongside the
// diplomacy matrices: you can see from your own coast that somebody has claimed
// the land over there, even if you have never counted their soldiers.
function aiEnemyAnchor(f, fid) {
  const known = f.brain.perception.knownTownhall(fid);
  if (known) return [known.x, known.y];
  return aiTerritoryAnchor(fid);
}

// A tile in the middle-ish of a nation's drawn claim, sampled rather than
// averaged — a mean of two separated provinces lands in the sea between them.
// Cached, because the scan is the width of the world and a nation's claim does
// not move between one tick and the next — territory itself only recomputes
// every five seconds.
const AI_ANCHOR_TTL = 20;
const aiAnchorCache = new Map();

function aiTerritoryAnchor(fid) {
  const t = game.territory;
  if (!t) return null;
  const hit = aiAnchorCache.get(fid);
  if (hit && game.time - hit.t < AI_ANCHOR_TTL) return hit.at;
  let pick = null, seen = 0;
  for (let i = 0; i < t.owner.length; i += 7) {          // stride: this is a hint, not a survey
    if (t.owner[i] !== fid) continue;
    seen++;
    if (game.rng() < 1 / seen) pick = i;                 // reservoir sample, on the seeded stream
  }
  const at = pick === null ? null : [pick % MAP_W, (pick / MAP_W) | 0];
  aiAnchorCache.set(fid, { at, t: game.time });
  return at;
}

// Could this nation put an army on that one's shore at all? Asked before a war
// is declared across water, so nobody starts a war they have no way to fight.
// Deliberately cheap and structural: have we a coast, have they a coast, and is
// there sea between the two — not "would we win".
function aiCanInvadeBySea(f, o) {
  const th = f.townhall();
  if (!th) return false;
  const where = aiEnemyAnchor(f, o.id);
  if (!where) return false;
  // Our own shore first: it is the cheaper of the two searches, and a landlocked
  // nation is out of the running whatever the target looks like.
  if (!f.buildings.some(b => b.type.key === 'dock') && !aiHasCoast(f)) return false;
  return !!nearestBerth(where[0], where[1]);
}

// Is there navigable water anywhere near home? A far cheaper question than
// "where exactly would the shipyard go", and the one `considerWar` actually
// needs — `aiFindDockSpot` runs a `canPlace` per candidate tile and belongs on
// the throttled path, not on the war-gating one.
function aiHasCoast(f) {
  const th = f.townhall();
  if (!th) return false;
  const cx = Math.floor(th.cx), cy = Math.floor(th.cy);
  for (let r = 3; r < 45; r += 2) {
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2;
      const x = wrapX(Math.round(cx + Math.cos(ang) * r)), y = Math.round(cy + Math.sin(ang) * r);
      if (game.map.navigable(x, y)) return true;
    }
  }
  return false;
}

// ---------- exploration ----------
// A nation on its own continent cannot scout its way to knowing anybody, and an
// AI that knows nobody never does anything. So the navy's first job is not war
// but discovery — and then keeping watch. Everything it learns it learns by
// looking — the ship observes exactly like any other unit
// (js/ai-perception.js gatherObservers; a hull's masthead sees a little
// further), so no rule about reading rival state is bent to make this work.
//
// Two jobs, in order:
//   * SURVEY. An overseas rival whose picture has gone stale (confidence under
//     SEA_SURVEY_CONF — nothing seen for about a minute and a half) or whose
//     capital we have never found gets a visit: a scout sails for the coast
//     nearest their drawn claim — the borders are public knowledge, the same
//     hint `aiEnemyAnchor` falls back to — and patrols along it. The claim is
//     re-sampled every 20 s, so successive voyages work around their coast.
//   * CHART. With nobody to survey but capitals still unfound, the old job: the
//     nearest water we have never laid eyes on, biased outward.
// Without the survey (BUGS #39) a sea scout charted open water, never saw a
// town — capitals sit inland — and every AI's confidence in every overseas
// rival stayed at zero, which `considerWar` reads as "we know nothing about
// them": on a world of continents nobody ever went to war.
const SEA_SURVEY_CONF = 0.5;
const SEA_SCOUTS_MAX = 2;          // hulls a nation keeps looking, at most
const SEA_VOYAGE_ITER = 40000;     // A* budget for a crossing, as a landing uses

function aiNavalExplore(f) {
  const ai = f.ai;
  if (ai.invasion) return;                               // the fleet has a war to fight
  const th = f.townhall();
  if (!th) return;
  const per = f.brain.perception;
  const home = game.map.continentAt(Math.floor(th.cx), Math.floor(th.cy));
  const rivals = game.factions.filter(o => !o.eliminated && o.id !== f.id);
  const overseas = o => {
    const at = aiTerritoryAnchor(o.id);
    return !!at && game.map.continentAt(at[0], at[1]) !== home;
  };
  const survey = rivals.filter(o => overseas(o)
    && (per.confidence(o.id) < SEA_SURVEY_CONF || !per.knownTownhall(o.id)));
  const uncharted = rivals.some(o => !per.knownTownhall(o.id));
  // how many hulls this wants at sea — staffWorkers keeps their crews free
  ai.seaScoutWant = survey.length || uncharted ? Math.min(SEA_SCOUTS_MAX, Math.max(1, survey.length)) : 0;
  if (!ai.seaScoutWant) return;                          // the world is charted and watched
  const docks = f.buildings.filter(b => b.type.key === 'dock' && b.done && b.hp > 0);
  if (!docks.length) {
    if (f.buildings.some(b => b.type.key === 'dock')) return;   // one is already rising
    // Not worth a shipyard until the nation is on its feet.
    if (f.nation.pop < 12 || !f.nation.canStart(BUILDING_TYPES.dock.cost)) return;
    const spot = aiFindDockSpot(f);
    if (spot) startConstruction(game, 'dock', spot[0], spot[1], f.id);
    return;
  }
  ai.seaScouts = (ai.seaScouts || []).filter(s => s.alive && !s.dead);
  while (ai.seaScouts.length < ai.seaScoutWant) {
    const free = factionShips(f).find(s => s.type.key === 'galley' && !shipLoad(s) && !ai.seaScouts.includes(s));
    if (!free) {
      if (docks[0].trainQueue.length === 0) trainShip(f, 'galley');
      break;
    }
    ai.seaScouts.push(free);
  }
  ai.seaScouts.forEach((scout, i) => {
    if (scout.path.length > 0 || scout.target) return;   // already on its way somewhere
    const o = survey.length ? survey[i % survey.length] : null;
    const goal = (o && aiSurveyPoint(f, o, scout)) || aiSeaScoutTarget(f, scout);
    if (!goal) return;
    scout.orderMove(goal[0], goal[1]);
    // a crossing can be far longer than a soldier's repath budget allows
    if (!scout.path.length) scout.path = scout.pathTo(goal[0], goal[1], SEA_VOYAGE_ITER);
  });
}

// Citizens the navy needs kept free, right now, to crew hulls it is about to
// lay down: sea scouts it is short of, and the transports and escort an
// invasion in its 'fleet' stage is waiting on. `staffWorkers`
// (js/ai-utility.js) holds these back from the trades exactly as it holds back
// army recruits. Without it a busy town put every hand to work, `trainShip`
// never found a crew, and no AI in a long soak ever launched a single hull —
// so nobody surveyed, invaded or went to war across water.
function aiNavalCrewWanted(f) {
  const ai = f.ai;
  if (!ai) return 0;
  const dock = f.buildings.find(b => b.type.key === 'dock' && b.done && b.hp > 0);
  if (!dock) return 0;
  const ships = factionShips(f);
  let want = Math.max(0, (ai.seaScoutWant || 0) - (ai.seaScouts || []).filter(s => s.alive).length);
  const inv = ai.invasion;
  if (inv && inv.state === 'fleet') {
    const army = f.armyUnits().filter(u => u.alive && !u.aboard && !isNaval(u));
    const hulls = army.length >= TRANSPORT_CAPACITY * 2 ? 2 : 1;
    want += Math.max(0, hulls - ships.filter(s => s.type.key === 'transport').length);
    if (!ships.some(s => s.type.key === 'galley')) want++;
  }
  // a hull already on the slipway took its crew when it was queued
  return Math.max(0, Math.min(3, want) - dock.trainQueue.length);
}

// Where to look at a rival's coast from. Far off, the water nearest a tile of
// their drawn claim; already there, a stretch of water along that same shore —
// water touching ground they claim — so a scout on station walks the coastline
// instead of sitting on one berth.
function aiSurveyPoint(f, o, scout) {
  const at = aiTerritoryAnchor(o.id);
  if (!at) return null;
  const berth = nearestBerth(at[0], at[1]);
  if (!berth) return null;
  if (wdist(scout.x, scout.y, berth[0] + 0.5, berth[1] + 0.5) > 14) return berth;
  const t = game.territory;
  let best = null, bd = -1;
  for (let tries = 0; tries < 80; tries++) {
    const x = wrapX(Math.floor(scout.x + (game.rng() - 0.5) * 36));
    const y = Math.floor(scout.y + (game.rng() - 0.5) * 36);
    if (!game.map.inBounds(x, y) || !game.map.navigable(x, y)) continue;
    let shore = false;
    for (const [dx, dy] of ORTH) {
      const nx = wrapX(x + dx), ny = y + dy;
      if (game.map.inBounds(nx, ny) && t.ownerAt(nx, ny) === o.id
          && game.map.terrain[game.map.idx(nx, ny)] !== T_WATER) { shore = true; break; }
    }
    if (!shore) continue;
    const d = wdist(scout.x, scout.y, x + 0.5, y + 0.5);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best || berth;
}

// The nearest stretch of water we have never laid eyes on, biased outward so the
// scout works away from home instead of circling its own harbour.
function aiSeaScoutTarget(f, scout) {
  const per = f.brain.perception;
  let best = null, bestScore = -Infinity;
  for (let tries = 0; tries < 400; tries++) {
    const x = Math.floor(game.rng() * MAP_W), y = Math.floor(game.rng() * MAP_H);
    if (!game.map.navigable(x, y)) continue;
    if (per.memory.isExplored(x, y)) continue;
    const d = wdist(scout.x, scout.y, x + 0.5, y + 0.5);
    // Close enough to reach in reasonable time, far enough to be worth going.
    const score = -Math.abs(d - Math.min(MAP_W, MAP_H) * 0.45);
    if (score > bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}

function aiTickInvasion(f) {
  const ai = f.ai, inv = ai.invasion;
  const target = game.factions[inv.targetFid];
  // A war that has ended, or an enemy that no longer exists, ends the campaign
  // outright. Running out of time does not — that is checked at the END of the
  // tick, after this stage has had its chance to advance. Checking it first
  // threw away campaigns whose last transport arrived inside the same six
  // seconds the clock ran out in, which is a maddening way to lose a fleet.
  if (!target || target.eliminated
      || game.diplomacy.status(f.id, inv.targetFid) !== 'war') {
    return aiAbortInvasion(f);
  }
  const before = inv.state;
  aiRunInvasionStage(f, inv);
  // Still in the same stage with the clock run out: this campaign is stuck.
  if (ai.invasion && ai.invasion.state === before && game.time > inv.deadline) {
    aiAbortInvasion(f);
  }
}

function aiRunInvasionStage(f, inv) {
  const ai = f.ai;
  const docks = f.buildings.filter(b => b.type.key === 'dock' && b.done && b.hp > 0);
  if (inv.state === 'building') {
    if (docks.length) { aiInvasionStep(inv, 'fleet'); return; }
    // Already building one? Leave it alone. Otherwise stake a shipyard out.
    if (f.buildings.some(b => b.type.key === 'dock')) return;
    const spot = aiFindDockSpot(f);
    if (spot && f.nation.canStart(BUILDING_TYPES.dock.cost)) {
      // Urgent: the coast is where it is, and a shipyard 20 tiles from the
      // capital loses every builder to whatever is being put up in town. The
      // campaign cannot start without it (js/civilians.js claimSite).
      startConstruction(game, 'dock', spot[0], spot[1], f.id).urgent = true;
    }
    return;
  }
  const ships = factionShips(f);
  const transports = ships.filter(s => s.type.key === 'transport');
  const army = f.armyUnits().filter(u => u.alive && !u.aboard && !isNaval(u));
  if (inv.state === 'fleet') {
    // How many hulls to wait for. Deliberately modest: a wave of six is a real
    // landing, and holding out for a bigger one loses the campaign to the peace
    // that arrives while the yard is still working. Waiting for a perfect fleet
    // was the reason invasions in a long soak got as far as this state and no
    // further — every one of them was still counting transports when its war
    // ended.
    const want = army.length >= TRANSPORT_CAPACITY * 2 ? 2 : 1;
    inv.readyAt = inv.readyAt || game.time + FLEET_PATIENCE;
    const escorted = ships.some(s => s.type.key === 'galley');
    // Sail once the transports are there and an escort has turned up — or once
    // patience runs out and there is at least one loaded hull's worth of army.
    // An unescorted landing is a risk; not landing at all is a certainty.
    if (transports.length >= want && (escorted || game.time > inv.readyAt)) {
      aiInvasionStep(inv, 'loading');
      inv.units = army.slice(0, transports.length * TRANSPORT_CAPACITY);
      inv.ships = transports.slice(0, Math.max(want, Math.min(transports.length, 3)));
      for (let i = 0; i < inv.units.length; i++) {
        orderBoard(inv.units[i], inv.ships[i % inv.ships.length]);
      }
      return;
    }
    // A hull joining the fleet is progress, so the stage clock restarts. The
    // yard is slow for reasons that have nothing to do with this campaign — a
    // nation with no spare citizens cannot crew a ship however badly it wants
    // one — and binning an invasion that is visibly still building ships just
    // makes it start the whole thing again from the shipyard.
    if (ships.length !== inv.fleetMark) {
      inv.fleetMark = ships.length;
      inv.deadline = game.time + INVASION_STAGE_TIME;
    }
    // The shipyard can be razed mid-campaign; the campaign goes back to
    // building one rather than reading the queue of a dock that is not there
    // (BUGS #48).
    if (!docks.length) { aiInvasionStep(inv, 'building'); return; }
    if (docks[0].trainQueue.length >= 2) return;
    trainShip(f, transports.length < want ? 'transport' : 'galley');
    return;
  }
  if (inv.state === 'loading') {
    inv.ships = inv.ships.filter(s => s.alive);
    if (!inv.ships.length) return aiAbortInvasion(f);
    const aboard = inv.ships.reduce((n, s) => n + shipLoad(s), 0);
    const stillComing = inv.units.filter(u => u.alive && !u.aboard
      && u.mission && u.mission.kind === 'board').length;
    // Sail when the fleet is full, or when nobody else is coming.
    if (aboard > 0 && stillComing === 0) {
      aiInvasionStep(inv, 'sailing');
      for (const s of inv.ships) if (shipLoad(s)) orderUnload(s, inv.at[0], inv.at[1]);
      // The escort goes with them.
      for (const g of factionShips(f)) {
        if (g.type.key === 'galley') g.orderMove(inv.at[0], inv.at[1]);
      }
    }
    return;
  }
  if (inv.state === 'sailing') {
    inv.ships = inv.ships.filter(s => s.alive);
    const stillLoaded = inv.ships.some(s => shipLoad(s) > 0);
    if (!stillLoaded) {
      // Ashore. Hand the landing party to the ordinary war machinery — it knows
      // how to press an attack far better than this does.
      const landed = inv.units.filter(u => u.alive && !u.aboard);
      if (landed.length >= 2) formationMove(landed, inv.at[0], inv.at[1]);
      ai.invasion = null;
    }
  }
}

// Advance the campaign, and give it a fresh deadline for doing so. The clock is
// there to bin campaigns that are stuck, not campaigns that are slow: a first
// invasion has to build a shipyard from nothing and then a fleet, which on a
// big world took longer than the flat 20 minutes and got a working landing
// binned one stage from sailing.
function aiInvasionStep(inv, state) {
  inv.state = state;
  inv.deadline = game.time + INVASION_STAGE_TIME;
}

// Is this nation in the middle of an amphibious campaign against that one?
// Read by the diplomacy layer, which otherwise cannot tell a war being slowly
// prepared from a war nobody is fighting.
function aiCampaignAgainst(f, fid) {
  return !!(f && f.ai && f.ai.invasion && f.ai.invasion.targetFid === fid);
}

function aiAbortInvasion(f) {
  const inv = f.ai.invasion;
  if (inv) {
    for (const u of inv.units) {
      if (u.alive && u.mission && u.mission.kind === 'board') { u.mission = null; u.aggressive = true; }
    }
  }
  f.ai.invasion = null;
}

// A shore near home with room for a 2x2 yard. Spirals out from the Town Hall so
// the shipyard lands on the nation's own coast rather than the far side of the
// continent.
function aiFindDockSpot(f) {
  const th = f.townhall();
  if (!th) return null;
  const cx = Math.floor(th.cx), cy = Math.floor(th.cy);
  for (let r = 3; r < 45; r++) {
    for (let a = 0; a < 40; a++) {
      const ang = a / 40 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
      if (!game.map.inBounds(x, y)) continue;
      if (canPlace(game.map, 'dock', wrapX(x), y, f.id)) return [wrapX(x), y];
    }
  }
  return null;
}
