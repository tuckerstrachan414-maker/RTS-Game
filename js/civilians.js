'use strict';
// Civilians: the people of a nation, as bodies on the map rather than a number.
//
// Three rules hold this together:
//   1. Every citizen in `nation.pop` is exactly one civilian unit. Growth at dawn
//      puts new people outside the Town Hall; starvation, conscription and an
//      enemy blade take them away again.
//   2. `building.workers` stays the source of truth for who works where — the
//      panel's +/− buttons and the AI's staffing pass both still just set that
//      number, and `reconcileJobs` moves bodies to match it.
//   3. Nothing enters a store, and no building rises, without somebody carrying
//      it there. Production and construction are journeys now, not formulas.

const CIV_GATHER_LOAD = 5;    // resources a gatherer brings back per trip
const CIV_BUILD_LOAD = 15;    // materials a builder carries to a site per trip
// The round trip a gathering rate is balanced around: roughly 8 tiles out and 8
// back at a worker's pace. `gatherWorkTime` solves for the time at the face that
// makes a full cycle deliver the building's old per-worker rate over this walk,
// so a camp with a Storehouse at a normal distance earns what it always did —
// while one built out in the wilds earns less, and one with a Storehouse next
// door earns more. That trade is the point of the whole system.
const CIV_TRIP_BUDGET = 8;
// Least fraction of the old flat cycle a worker must spend actually working, so
// that even a perfect haul cannot make a building produce without limit.
const CIV_WORK_FLOOR = 0.35;
// How much nearer an urgent site pretends to be when builders are choosing.
// A multiplier rather than a hard override: an urgent site three times as far
// away wins, one twenty times as far still does not, so marking something
// urgent moves it up the queue instead of stopping every other build.
const URGENT_SITE_BIAS = 0.2;

const MAX_BUILDERS_PER_SITE = 3;
const CIV_FLEE_RADIUS = 5;    // hostile soldiers this close send civilians running
const CIV_RECONCILE = 0.5;    // seconds between population/job reconciliation passes
const CIV_WANDER_R = 5;       // how far an unemployed citizen strolls from a building

// Civilians keep their nation's colours — knowing whose lumberjacks those are
// matters — but are drawn smaller than soldiers (`scale`) so a crowd of workers
// never reads as an army.
UNIT_TYPES.worker = {
  key: 'worker', name: 'Worker', spriteKey: 'civTownsfolk', civilian: true, scale: 0.85,
  cost: {}, hp: 30, dmg: 0, dmgType: 'melee', range: 0.9, speed: 2.0, cooldown: 1,
  trainTime: 0, carry: CIV_GATHER_LOAD, tier: 1,
  desc: 'A citizen at work. Gathers from the land and hauls it to your nearest store.',
};
UNIT_TYPES.builder = {
  key: 'builder', name: 'Builder', spriteKey: 'civBuilder', civilian: true, scale: 0.85,
  cost: {}, hp: 35, dmg: 0, dmgType: 'melee', range: 0.9, speed: 2.1, cooldown: 1,
  trainTime: 0, carry: CIV_BUILD_LOAD, tier: 1,
  desc: 'Carries 15 materials at a time from your stores to a construction site, then raises it.',
};

// Which sheet a citizen is drawn on. The unit type only knows worker/builder,
// but there are five sets of townsfolk art and a trade is the most legible
// thing about a civilian at 16 pixels — so the sprite follows the job rather
// than the type, and a nation's economy can be read off the map without
// clicking anything. Unemployed citizens carry no tool at all, which is the
// point: a town full of empty hands is a town with work going undone.
const CIV_SPRITES = {
  farm: 'civFarmer', well: 'civFarmer',
  lumber: 'civWoodcutter',
  quarry: 'civMiner', mine: 'civMiner',
  market: 'civTownsfolk',
};

function civSpriteFor(u) {
  if (!u.job) return 'civTownsfolk';
  if (u.job.kind === 'build') return 'civBuilder';
  return CIV_SPRITES[u.job.b.type.key] || 'civTownsfolk';
}

// ---------------------------------------------------------------------------
// Population embodiment and job assignment
// ---------------------------------------------------------------------------

// Runs from Nation.tick. Keeps the crowd matching `pop`, then keeps the jobs
// matching every building's `workers`. Both are cheap enough to run twice a
// second, and doing them together means a citizen who has just been born can be
// put to work in the same pass.
function syncCivilians(f, dt) {
  f.civT = (f.civT || 0) - dt;
  if (f.civT > 0) return;
  f.civT = CIV_RECONCILE;
  const civs = f.units.filter(u => u.alive && u.type.civilian);
  const want = Math.max(0, Math.round(f.nation.pop));
  const th = f.townhall();
  while (civs.length < want && th) civs.push(spawnCivilian(f, th));
  while (civs.length > want) retireCivilian(f, civs);
  reconcileJobs(f, civs);
  sampleYields(f);
}

function spawnCivilian(f, th) {
  const [x, y] = f.spawnPointNear(th);
  const u = new Unit('worker', f.id, x, y);
  u.aggressive = false;
  u.spriteKey = 'civTownsfolk';   // no trade yet — reconcileJobs may give one this pass
  f.units.push(u);
  return u;
}

// A citizen leaving the population — starved, conscripted, or unhoused. Whatever
// they were carrying goes into the stores rather than evaporating; the least
// committed person available is the one who goes.
function retireCivilian(f, civs) {
  let pick = civs.findIndex(u => !u.job && u.carryTotal() < 0.5);
  if (pick < 0) pick = civs.findIndex(u => !u.job);
  if (pick < 0) pick = civs.length - 1;
  const u = civs[pick];
  if (!u) return;
  civs.splice(pick, 1);
  releaseBuilderLoad(u);
  const n = f.nation;
  for (const r of RES_KEYS) if (u.carry[r] > 0) { n.deposit(r, u.carry[r]); u.carry[r] = 0; }
  const at = f.units.indexOf(u);
  if (at >= 0) f.units.splice(at, 1);
}

// Called from onUnitDeath: a killed civilian is a citizen lost. The load on
// their back spills as loot through the ordinary path, and any materials they
// were carrying to a site stop counting as inbound so another builder re-fetches
// them.
function onCivilianDeath(u) {
  const f = game.factions[u.faction];
  if (!f) return;
  releaseBuilderLoad(u);
  f.nation.pop = Math.max(0, f.nation.pop - 1);
  f.nation.unassignExcess();
}

function jobBuildingOk(f, b) {
  return b && b.done && b.hp > 0 && b.faction === f.id && f.buildings.includes(b);
}

function releaseCivilian(u) {
  u.job = null; u.spriteKey = 'civTownsfolk';
  u.phase = null; u.spot = null; u.workTotal = 0;
  u.path = []; u.dest = null; u.wanderT = 0;
  u.site = null; u.fetch = null;
  releaseBuilderLoad(u);
}

// Match bodies to `b.workers` for every staffed building. Anything left over
// becomes an unemployed citizen, who wanders the town until there is work.
function reconcileJobs(f, civs) {
  const staff = new Map();
  const idle = [];
  for (const u of civs) {
    if (u.job && !jobBuildingOk(f, u.job.b)) releaseCivilian(u);
    if (!u.job) { idle.push(u); continue; }
    const arr = staff.get(u.job.b);
    if (arr) arr.push(u); else staff.set(u.job.b, [u]);
  }
  const needs = [];
  for (const b of f.buildings) {
    if (!b.type.slots) continue;
    const have = staff.get(b) || [];
    const want = (b.done && b.hp > 0) ? Math.min(b.workers, b.type.slots) : 0;
    while (have.length > want) { const u = have.pop(); releaseCivilian(u); idle.push(u); }
    for (let k = have.length; k < want; k++) needs.push(b);
  }
  for (const b of needs) {
    if (!idle.length) break;
    // nearest free citizen takes the job, so people work where they already are
    let pick = 0, best = Infinity;
    for (let i = 0; i < idle.length; i++) {
      const d = wdist(idle[i].x, idle[i].y, b.cx, b.cy);
      if (d < best) { best = d; pick = i; }
    }
    assignJob(idle.splice(pick, 1)[0], b);
  }
}

function assignJob(u, b) {
  const wantType = b.type.builders ? 'builder' : 'worker';
  if (u.type.key !== wantType) retypeCivilian(u, wantType);
  u.job = { b, kind: b.type.builders ? 'build' : 'gather' };
  u.spriteKey = civSpriteFor(u);
  u.phase = 'out'; u.spot = null; u.workTotal = 0; u.workT = 0;
  u.path = []; u.dest = null; u.site = null; u.stuck = 0;
}

// A citizen changing trade, not a new person: same body, different kit and
// carrying capacity. Wounds carry across proportionally.
function retypeCivilian(u, key) {
  const frac = u.hp / u.type.hp;
  u.type = UNIT_TYPES[key];
  u.hp = Math.max(1, Math.round(u.type.hp * frac));
  u.carryCap = u.type.carry;
  u.setAnim('idle', true);
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

// Called from Unit.tick for anything with `civilian`. Civilians never acquire a
// target, never join a formation and are never given orders — they are the
// nation working, and the player influences them by deciding what gets built and
// who staffs it.
function tickCivilian(u, dt) {
  u.animT += dt;
  if (u.dead) { u.deathT += dt; return; }
  u.repathT -= dt;
  u.scanT = (u.scanT || 0) - dt;
  if (u.scanT <= 0) {
    u.scanT = 0.7 + game.rng() * 0.7;
    u.threat = civThreatNear(u);
  }
  if (u.threat) return tickFlee(u, dt);
  if (!u.job) return tickIdler(u, dt);
  if (u.job.kind === 'gather') return tickGatherer(u, dt);
  return tickBuilder(u, dt);
}

// Only worth looking when there is actually a war on — in peacetime this is the
// single most-called check in the game and there is nothing to find.
function civThreatNear(u) {
  if (!game.diplomacy.atWarAny(u.faction)) return null;
  for (const f of game.factions) {
    if (!game.diplomacy.hostile(u.faction, f.id)) continue;
    for (const e of f.units) {
      if (!e.alive || e.type.civilian || e.type.envoy) continue;
      if (wdist(u.x, u.y, e.x, e.y) <= CIV_FLEE_RADIUS) return e;
    }
  }
  return null;
}

// Run for the nearest building of our own — a civilian's instinct is to get
// behind walls, not to fight. They keep whatever they were carrying, so a raid
// that catches the harvest coming in is worth catching.
function tickFlee(u, dt) {
  if (u.path.length) return u.followPath(dt);
  const home = nearestOwnBuilding(u);
  if (!home) { u.setAnim('idle'); return; }
  if (wdist(u.x, u.y, home.cx, home.cy) < 2) { u.setAnim('idle'); return; }
  // orderMove runs A*, and a civilian whose refuge is unreachable would run one
  // every tick for as long as the raid lasts
  if (u.repathT > 0) { u.setAnim('idle'); return; }
  u.repathT = 1.5;
  u.orderMove(Math.floor(home.cx), Math.floor(home.cy));
}

function nearestOwnBuilding(u) {
  let best = null, bd = Infinity;
  for (const b of game.factions[u.faction].buildings) {
    if (b.hp <= 0 || b.type.key === 'bridge') continue;
    const d = wdist(u.x, u.y, b.cx, b.cy);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// Unemployed, and visibly so: townsfolk drift between the buildings of the
// settlement. This is what an idle population looks like, and it is the reason
// a nation with nothing for its people to do reads as one.
function tickIdler(u, dt) {
  if (u.path.length) return u.followPath(dt);
  u.wanderT = (u.wanderT || 0) - dt;
  if (u.wanderT > 0) { u.setAnim('idle'); return; }
  u.wanderT = 4 + game.rng() * 7;
  const buildings = game.factions[u.faction].buildings.filter(b => b.hp > 0 && b.type.key !== 'bridge');
  if (!buildings.length) { u.setAnim('idle'); return; }
  const anchor = buildings[Math.floor(game.rng() * buildings.length)];
  const spot = openTileNear(Math.floor(anchor.cx), Math.floor(anchor.cy), CIV_WANDER_R, u.faction);
  if (spot) u.orderMove(spot[0], spot[1]);
  else u.setAnim('idle');
}

function openTileNear(cx, cy, radius, fid) {
  for (let tries = 0; tries < 8; tries++) {
    const a = game.rng() * Math.PI * 2;
    const r = 1 + game.rng() * radius;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (game.map.passable(x, y, fid)) return [x, y];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gatherers
// ---------------------------------------------------------------------------

// Seconds at the face to fill one load, chosen so that a full cycle over the
// reference walk delivers the building's nominal per-worker rate. A farm's water
// and well bonuses land in `workerYieldRate`, so they shorten this automatically.
// `atTile` is the workplace the caller has already found, which saves
// workerYieldRate searching a Lumber Camp's whole reach a second time.
function gatherWorkTime(b, atTile) {
  const rate = workerYieldRate(game.map, b, atTile);
  if (rate <= 0) return 0;
  const cycle = CIV_GATHER_LOAD / rate;      // what one load used to take, flat
  // The floor matters as much as the subtraction. A high-yield building (a farm
  // beside water AND a well) fills a load in less than the reference walk, so the
  // subtraction alone would drive its time at the face to nothing and hand a
  // short haul an unbounded bonus — measured as 4-8x the old food stockpile
  // before this clamp existed. Holding the face time to a fraction of the cycle
  // keeps the best possible logistics worth about a third off, not everything.
  return Math.max(CIV_WORK_FLOOR * cycle, cycle - CIV_TRIP_BUDGET);
}

function tickGatherer(u, dt) {
  const b = u.job.b;
  if (u.phase === 'home') return gatherDeliver(u, dt);
  if (u.carryTotal() >= u.carryCap - 1e-6) { u.phase = 'home'; u.path = []; return; }
  if (u.phase === 'work') return gatherWork(u, dt, b);
  // 'out' — walk to the face
  if (!u.spot) {
    // Searching a Lumber Camp's whole 51x51 reach is not free, and a camp whose
    // forest is gone would search it every tick forever, so a fruitless look
    // costs the worker a couple of seconds before it looks again.
    if (u.searchT > 0) {
      u.searchT -= dt;
      u.setAnim('idle');
      if (u.carryTotal() > 0.5) { u.phase = 'home'; u.path = []; }
      return;
    }
    u.spot = findWorkTile(game.map, b);
    u.workTotal = u.spot ? gatherWorkTime(b, u.spot) : 0;
    if (!u.spot || u.workTotal <= 0) {
      // nothing left to work: idle at the building. The vacancy is the signal —
      // an exhausted Lumber Camp should look exhausted.
      u.spot = null;
      u.searchT = 2 + game.rng();
      u.setAnim('idle');
      if (u.carryTotal() > 0.5) { u.phase = 'home'; u.path = []; }
      return;
    }
  }
  const [tx, ty] = u.spot;
  if (wdist(u.x, u.y, tx + 0.5, ty + 0.5) <= 1.2) { u.phase = 'work'; u.path = []; u.workT = 0; return; }
  walkTo(u, dt, tx, ty, () => { u.spot = null; });
}

function gatherWork(u, dt, b) {
  const res = b.type.produces;
  const rate = CIV_GATHER_LOAD / Math.max(0.5, u.workTotal);
  let amount = rate * dt;
  u.setAnim('attack');
  if (b.type.key === 'lumber') {
    // wood comes out of a real tree tile, and the tile runs out
    const i = game.map.idx(u.spot[0], u.spot[1]);
    if (game.map.terrain[i] !== T_TREE || game.map.treeWood[i] <= 0) {
      u.spot = null; u.phase = u.carryTotal() > 0.5 ? 'home' : 'out';
      return;
    }
    amount = Math.min(amount, game.map.treeWood[i]);
    game.map.treeWood[i] -= amount;
    if (game.map.treeWood[i] <= 0) { game.map.terrain[i] = T_GRASS; game.map.decor[i] = -1; }
  }
  u.carry[res] = (u.carry[res] || 0) + amount;
  u.workT += dt;
  if (u.carryTotal() >= u.carryCap - 1e-6 || u.workT >= u.workTotal) {
    u.phase = 'home'; u.path = []; u.spot = null;
  }
}

function gatherDeliver(u, dt) {
  if (u.carryTotal() < 0.5) { u.phase = 'out'; u.spot = null; return; }
  const home = u.nearestStorage();
  if (!home) { u.setAnim('idle'); return; }   // nowhere to put it
  if (u.distTo(home) <= 1.0) {
    const n = game.factions[u.faction].nation;
    let banked = 0;
    for (const r of RES_KEYS) {
      if (u.carry[r] <= 0) continue;
      // deposit returns what would not fit — the worker keeps standing there
      // holding it rather than the surplus quietly evaporating
      const left = n.deposit(r, u.carry[r]);
      banked += u.carry[r] - left;
      u.carry[r] = left;
    }
    recordYield(u.job.b, banked);
    u.setAnim('idle');
    if (u.carryTotal() < 0.5) { u.phase = 'out'; u.spot = null; }
    return;
  }
  walkTo(u, dt, Math.floor(home.cx), Math.floor(home.cy));
}

// Everything this building's workers have ever banked. `sampleYields` turns it
// into a rate; this only has to be a faithful running total.
function recordYield(b, banked) {
  if (!b || banked <= 0.01) return;
  b.yieldTotal += banked;
  b.lastDeliver = game.time;
}

// Measured throughput, read by estimateIncome (js/economy.js). It has to be a
// fixed-window average — goods banked over a span of wall-clock time — and NOT
// the gap between one delivery and the next: a building's workers walk home
// together, so consecutive deliveries can land in the same tick and the implied
// rate comes out six to nine times the truth. That version shipped as far as the
// first balance run and made every camp look like a goldmine.
const YIELD_WINDOW = 25;

function sampleYields(f) {
  for (const b of f.buildings) {
    if (!b.type.produces || !b.done) continue;
    if (b.yieldT0 == null || game.time - b.yieldT0 >= YIELD_WINDOW) {
      if (b.yieldT0 != null) {
        const inst = (b.yieldTotal - b.yieldBase) / (game.time - b.yieldT0);
        b.yieldRate = b.yieldRate == null ? inst : b.yieldRate * 0.5 + inst * 0.5;
      }
      b.yieldT0 = game.time;
      b.yieldBase = b.yieldTotal;
    }
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

// `u.site` is the construction site itself — a Building whose `.site` is its
// materials ledger.
function tickBuilder(u, dt) {
  const f = game.factions[u.faction];
  if (u.site && !siteWorkable(f, u.site)) { u.site = null; u.fetch = null; }
  if (!u.site) u.site = claimSite(u, f);
  if (!u.site) {
    // no work: bank anything still on our back, then loiter like anyone else
    if (u.carryTotal() > 0.5) return builderReturnLoad(u, dt);
    return tickIdler(u, dt);
  }
  if (u.carryTotal() > 0.5) return builderDeliver(u, dt, u.site);
  if (siteReady(u.site)) return builderRaise(u, dt, u.site);
  // Everything this site still needs is already on somebody else's back: there
  // is nothing for a third pair of hands to do but wait, so go and be useful
  // somewhere else instead. (Three builders idling at one gate while a dozen
  // other sites sat untouched is exactly what this fixes.)
  if (!siteHasWork(u.site, u.faction)) {
    const held = u.site;
    u.site = null; u.fetch = null;
    const next = claimSite(u, f);
    if (!next || next === held) { u.site = held; u.setAnim('idle'); return; }
    u.site = next;
  }
  return builderFetch(u, dt, u.site);
}

// Is there anything a free builder could actually pick up for this site? A site
// whose whole shortfall is already inbound has work only for the builder walking
// it over.
function siteHasWork(sb, fid) {
  if (!sb.site) return false;
  const n = game.factions[fid].nation;
  return RES_KEYS.some(r => siteOutstanding(sb, r) > 0.01 && n.total(r) > 0.01);
}

function siteWorkable(f, b) {
  return b && !b.done && b.hp > 0 && b.faction === f.id && f.buildings.includes(b);
}

// A site nobody can stand next to cannot be built. Bridges are the case that
// matters: a span is raised from the bank outward, each finished deck tile
// making the next one reachable.
function siteReachable(b) {
  if (b.type.key !== 'bridge') return true;
  for (const [dx, dy] of ORTH) {
    if (game.map.passable(b.x + dx, b.y + dy, b.faction)) return true;
  }
  return false;
}

function claimSite(u, f) {
  const counts = new Map();
  for (const o of f.units) {
    if (o.alive && o.type.key === 'builder' && o.site) counts.set(o.site, (counts.get(o.site) || 0) + 1);
  }
  let best = null, bd = Infinity;
  for (const b of f.buildings) {
    if (!b.site || b.done || b.hp <= 0) continue;
    if (b.site.wait > game.time) continue;              // recently unreachable
    if ((counts.get(b) || 0) >= MAX_BUILDERS_PER_SITE) continue;
    if (!siteReachable(b)) continue;
    // ready sites need hands; unready ones need hands only if there is still
    // something to carry that nobody else has already picked up
    if (!siteReady(b) && !siteHasWork(b, u.faction)) continue;
    // Nearest site wins — except that a site can declare itself urgent, and an
    // urgent one is treated as if it were much closer than it is. Without this
    // a site the nation genuinely needs but happens to have staked out on the
    // far side of its territory never gets a single builder: there is always
    // something nearer to work on, so it sits at zero delivered forever. The
    // AI's invasion shipyard is the case that forced it — a Dock has to be on
    // the coast, the coast is wherever it is, and a campaign that cannot get
    // its yard built never sails.
    const d = wdist(u.x, u.y, b.cx, b.cy) * (b.urgent ? URGENT_SITE_BIAS : 1);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// Fetch a load of whatever the site is still short of, from a store that has it.
// The withdrawal happens on arrival, not on setting out, so goods only leave a
// Storehouse when somebody physically picks them up.
function builderFetch(u, dt, sb) {
  if (!u.fetch) {
    let want = null;
    for (const r of RES_KEYS) {
      if (siteOutstanding(sb, r) > 0.01 && game.factions[u.faction].nation.total(r) > 0.01) { want = r; break; }
    }
    if (!want) { u.setAnim('idle'); return; }    // the nation cannot supply it yet
    const store = nearestStoreWith(u, want);
    if (!store) { u.setAnim('idle'); return; }
    u.fetch = { r: want, store };
  }
  const { r, store } = u.fetch;
  if (store.hp <= 0 || (store.store[r] || 0) <= 0.01) { u.fetch = null; return; }
  if (u.distTo(store) <= 1.0) {
    const take = Math.min(CIV_BUILD_LOAD, siteOutstanding(sb, r), store.store[r]);
    u.fetch = null;
    if (take <= 0.01) return;
    store.store[r] -= take;
    u.carry[r] += take;
    // it is on a builder's back now: out of the store, not yet in the ledger
    sb.site.inbound[r] += take;
    u.inbound = { sb, r, amt: take };
    u.path = [];
    return;
  }
  walkTo(u, dt, Math.floor(store.cx), Math.floor(store.cy), () => { u.fetch = null; });
}

function nearestStoreWith(u, r) {
  let best = null, bd = Infinity;
  for (const b of game.factions[u.faction].buildings) {
    if (!b.done || b.hp <= 0 || !b.type.storage || (b.store[r] || 0) <= 0.01) continue;
    const d = wdist(u.x, u.y, b.cx, b.cy);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function builderDeliver(u, dt, sb) {
  if (u.distTo(sb) <= 1.0) {
    for (const r of RES_KEYS) {
      if (u.carry[r] <= 0) continue;
      sb.site.delivered[r] += u.carry[r];
      u.carry[r] = 0;
    }
    releaseBuilderLoad(u, true);
    u.path = [];
    u.setAnim('idle');
    return;
  }
  walkTo(u, dt, Math.floor(sb.cx), Math.floor(sb.cy), () => blockSite(sb));
}

function builderRaise(u, dt, sb) {
  if (u.distTo(sb) <= 1.0) {
    u.path = [];
    u.setAnim('attack');
    // Each builder on the site is worth one build-time's worth of pace, and a
    // site takes at most MAX_BUILDERS_PER_SITE of them, so a crowd finishes a
    // wall faster but never instantly.
    advanceConstruction(sb, dt / sb.type.buildTime);
    return;
  }
  walkTo(u, dt, Math.floor(sb.cx), Math.floor(sb.cy), () => blockSite(sb));
}

// Carrying materials with nowhere to put them: take them back to a store.
function builderReturnLoad(u, dt) {
  const home = u.nearestStorage();
  if (!home) { u.setAnim('idle'); return; }
  if (u.distTo(home) <= 1.0) {
    const n = game.factions[u.faction].nation;
    for (const r of RES_KEYS) {
      if (u.carry[r] > 0) { u.carry[r] = n.deposit(r, u.carry[r]); }
    }
    releaseBuilderLoad(u);
    return;
  }
  walkTo(u, dt, Math.floor(home.cx), Math.floor(home.cy));
}

// Stop counting this builder's load as on its way to the site — because it
// arrived, or because the goods were turned back, dropped or spilled with the
// builder's death. Either way the site stops expecting them.
function releaseBuilderLoad(u) {
  const rec = u.inbound;
  u.inbound = null;
  if (!rec || !rec.sb || !rec.sb.site) return;
  rec.sb.site.inbound[rec.r] = Math.max(0, rec.sb.site.inbound[rec.r] - rec.amt);
}

// A site the builders cannot reach right now: park it for a while so they go and
// do something useful instead of pacing at the edge of the water.
function blockSite(sb) {
  if (sb.site) sb.site.wait = game.time + 15;
}

// ---------------------------------------------------------------------------
// Shared movement
// ---------------------------------------------------------------------------

// Path to a tile, and call `onFail` once it is clear there is no route at all.
// Civilians repath far less eagerly than soldiers — they walk the same route all
// day, there are a great many of them, and A* is the one thing in this system
// that could actually cost something.
function walkTo(u, dt, tx, ty, onFail) {
  if (u.path.length === 0 || u.repathT <= 0) {
    u.path = findPath(game.map, u.tileX, u.tileY, tx, ty, u.faction);
    u.repathT = 3 + game.rng() * 2;
    if (u.path.length === 0) {
      u.stuck = (u.stuck || 0) + 1;
      u.setAnim('idle');
      if (u.stuck >= 3 && onFail) { u.stuck = 0; onFail(); }
      return;
    }
    u.stuck = 0;
  }
  u.followPath(dt);
}
