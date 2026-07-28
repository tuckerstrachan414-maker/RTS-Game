'use strict';
// The utility engine: the archetype parameter sets, the scoring core, marginal
// utility per resource, and the tax-vs-happiness controller.
//
// Every AI nation runs this on a staggered 2-second tick. Rather than executing
// a fixed script, it scores the handful of things it could spend its next chunk
// of resources on and does the best one — so a nation short of stone builds a
// quarry, a nation with an army half the size of its neighbour's trains
// soldiers, and neither decision is hardcoded to a step number.
//
// Mechanisms are NOT here. Waves, walls, bridges, envoys and market orders all
// live in their existing files; this file decides which of them is worth doing.

const AI_TICK_PERIOD = 2.0;    // seconds between brain ticks, staggered by faction
const MU_HORIZON = 30;         // seconds of income counted as "already coming"
const MU_FLOOR = 0.35;         // utility of a resource you have plenty of
const MU_GAIN = 2.6;           // extra utility at total scarcity
const MU_GOLD_NORM = 1.8;      // divisor turning gold MU into a 0..1 appetite
const STORE_TAPER = 50;        // units of headroom below which utility tapers off

// ---------- archetypes ----------
// A nation's current ambition. Doctrine re-evaluation (js/ai.js) moves nations
// between these as the world changes; the personality roll (js/factions.js)
// decides which one it starts leaning toward, so the line-up differs per match.
//
// The first three are the primary archetypes. Raider and Hegemon are the same
// schema and keep the plunder-war and coalition-builder play patterns alive.
const AI_ARCHETYPES = {
  // ---- AGGRESSOR: take the continent by force ----
  aggressor: {
    label: 'Aggressor',
    armyBase: 4, armyPerPop: 0.45, armyMax: 34, waveFraction: 0.8,
    buildWeights: { castle: 2, mine: 1.5, farm: 1.2, house: 1.2 },
    desire: { mine: 2, quarry: 2 }, secondCastlePop: 28,
    expansionAppetite: 0.9, warRatio: 1.3, peaceWeariness: 20,
    trainsPrince: false, upgradesEagerly: true,
    w: { economy: 0.8, military: 1.6, expand: 1.1, trade: 0.5, diplomacy: 0.4, defense: 0.7, raid: 0.9 },
    resourceBias: { food: 1.1, wood: 1.0, stone: 1.0, gold: 1.2 },
    reserve: { food: p => p * 3, wood: () => 60, stone: () => 40, gold: () => 80 },
    scarcityCurve: 1.4, scarcityAlarm: 2.2,
    happinessFloor: 34, growthPrepWindow: 35, goldHunger: 1.3,
    warBias: 1.5, tradeBias: 0.6, warThreshold: 0.9,
    riskTolerance: 0.75, minWinProb: 0.45, minConfidence: 0.35,
    scoutBudget: 2, scoutInterval: 20, staleTolerance: 45,
    rumor: n => `Travelers report soldiers drilling day and night in ${n}'s fields.`,
  },
  // ---- MERCHANT: out-earn everyone, buy what you lack, race the Grand Castle ----
  merchant: {
    label: 'Merchant',
    armyBase: 2, armyPerPop: 0.15, armyMax: 10, waveFraction: 0,
    buildWeights: { market: 2, church: 1.5, well: 1.5, house: 1.3, farm: 1.2 },
    desire: { market: 2, mine: 2 }, pursuesGrand: true,
    expansionAppetite: 0.5, warRatio: Infinity, peaceWeariness: 10,
    trainsPrince: true, upgradesEagerly: true,
    w: { economy: 1.5, military: 0.5, expand: 0.9, trade: 1.8, diplomacy: 1.4, defense: 0.9, raid: 0.1 },
    resourceBias: { food: 1.0, wood: 1.1, stone: 1.1, gold: 1.4 },
    reserve: { food: p => p * 4, wood: () => 120, stone: () => 100, gold: () => 200 },
    scarcityCurve: 1.1, scarcityAlarm: 1.6,
    happinessFloor: 48, growthPrepWindow: 60, goldHunger: 0.8,
    warBias: 0.35, tradeBias: 1.7, warThreshold: 1.8,
    riskTolerance: 0.30, minWinProb: 0.75, minConfidence: 0.60,
    scoutBudget: 1, scoutInterval: 35, staleTolerance: 90,
    rumor: n => `${n}'s markets are said to overflow with goods.`,
  },
  // ---- DEFENSIVE TURTLE: wall up, stockpile, punish intruders ----
  turtle: {
    label: 'Defensive Turtle',
    armyBase: 3, armyPerPop: 0.3, armyMax: 16, waveFraction: 0.3,
    buildWeights: { storehouse: 1.5, quarry: 1.5, house: 1.1 },
    desire: { quarry: 2, storehouse: 2 }, wallRing: true,
    expansionAppetite: 0.25, warRatio: Infinity, peaceWeariness: 14,
    trainsPrince: false, upgradesEagerly: false,
    w: { economy: 1.2, military: 0.9, expand: 0.35, trade: 1.0, diplomacy: 0.8, defense: 1.8, raid: 0.2 },
    resourceBias: { food: 1.2, wood: 1.0, stone: 1.5, gold: 0.9 },
    reserve: { food: p => p * 5, wood: () => 150, stone: () => 200, gold: () => 120 },
    scarcityCurve: 1.2, scarcityAlarm: 1.8,
    happinessFloor: 42, growthPrepWindow: 50, goldHunger: 0.9,
    warBias: 0.25, tradeBias: 1.2, warThreshold: 2.2,
    riskTolerance: 0.25, minWinProb: 0.80, minConfidence: 0.55,
    scoutBudget: 1, scoutInterval: 25, staleTolerance: 60,
    rumor: n => `${n}'s masons are quarrying stone at a furious pace.`,
  },
  // ---- RAIDER: short plunder wars; declare, rob, sue for peace with the loot ----
  raider: {
    label: 'Raider',
    armyBase: 3, armyPerPop: 0.25, armyMax: 18, waveFraction: 0.4,
    buildWeights: { storehouse: 1.5, mine: 0.5 },
    desire: { storehouse: 2 }, bandits: 4, plunderGoal: 150,
    expansionAppetite: 0.6, warRatio: 1.1, peaceWeariness: 12,
    trainsPrince: false, upgradesEagerly: false,
    w: { economy: 0.9, military: 1.2, expand: 0.8, trade: 0.7, diplomacy: 0.5, defense: 0.6, raid: 1.9 },
    resourceBias: { food: 1.1, wood: 0.9, stone: 0.8, gold: 1.5 },
    reserve: { food: p => p * 3, wood: () => 60, stone: () => 40, gold: () => 60 },
    scarcityCurve: 1.3, scarcityAlarm: 2.0,
    happinessFloor: 36, growthPrepWindow: 40, goldHunger: 1.4,
    warBias: 1.2, tradeBias: 0.7, warThreshold: 1.1,
    riskTolerance: 0.6, minWinProb: 0.40, minConfidence: 0.30,
    scoutBudget: 3, scoutInterval: 15, staleTolerance: 35,
    rumor: n => `Riders from ${n} have been seen scouting the roads at dusk.`,
  },
  // ---- HEGEMON: alliance webs, coalitions against any runaway power ----
  hegemon: {
    label: 'Hegemon',
    armyBase: 3, armyPerPop: 0.2, armyMax: 14, waveFraction: 0.5,
    buildWeights: { market: 1.6, church: 1.4, house: 1.3 },
    desire: {},
    expansionAppetite: 0.4, warRatio: Infinity, peaceWeariness: 12,
    trainsPrince: true, upgradesEagerly: false,
    w: { economy: 1.2, military: 0.8, expand: 0.7, trade: 1.3, diplomacy: 1.8, defense: 1.0, raid: 0.2 },
    resourceBias: { food: 1.0, wood: 1.0, stone: 1.0, gold: 1.2 },
    reserve: { food: p => p * 4, wood: () => 100, stone: () => 80, gold: () => 160 },
    scarcityCurve: 1.15, scarcityAlarm: 1.7,
    happinessFloor: 45, growthPrepWindow: 55, goldHunger: 0.9,
    warBias: 0.5, tradeBias: 1.3, warThreshold: 1.9,
    riskTolerance: 0.4, minWinProb: 0.70, minConfidence: 0.55,
    scoutBudget: 2, scoutInterval: 28, staleTolerance: 70,
    rumor: n => `${n}'s envoys ride to every court on the continent.`,
  },
};

function aiArchetype(f) { return AI_ARCHETYPES[f.ai.doctrine] || AI_ARCHETYPES.turtle; }

// ---------- marginal utility ----------

// What one more unit of `r` is worth to this nation right now, in gold-equivalent
// terms so "50 stone" and "50 gold" can be compared directly.
//
// The important idea: demand is derived from what is currently BLOCKED, not from
// an abstract curve. A nation wants stone because the quarry it is trying to
// build costs stone. When nothing is blocked, everything sits near MU_FLOOR and
// the nation is content; when the thing it wants most is unaffordable, the
// missing resource's utility climbs and pulls trade, expansion and eventually
// war toward fixing it.
function calculateMarginalUtility(f, r) {
  const arch = aiArchetype(f);
  const s = f.brain.perception.self();
  const demand = aiPlanDemand(f);

  const have = s[r];
  const need = arch.reserve[r](s.population) + demand[r];
  // income already on its way counts as supply — no point panicking over stone
  // when two quarries are running
  const projected = have + s.income[r] * MU_HORIZON;
  const coverage = projected / Math.max(1, need);
  const scarcity = Math.pow(clamp(1 - coverage, 0, 1), arch.scarcityCurve);

  // Goods you cannot store are worthless: deposit() silently discards overflow.
  const headroom = r === 'gold' ? 1 : clamp(s.headroom[r] / STORE_TAPER, 0, 1);

  // Survival overrides. Food below pop*2 blocks dawn growth outright, and an
  // empty granary kills citizens and weakens the army.
  let urgency = 1;
  if (r === 'food') {
    if (s.starving) urgency = 4;
    else if (have < s.population * 2) urgency = 2.5;
    else if (s.income.food < 0) urgency = 1.4;
  }

  const numeraire = r === 'gold' ? 1 : game.market.price(r);
  return numeraire * (MU_FLOOR + MU_GAIN * scarcity) * urgency * headroom * arch.resourceBias[r];
}

// Everything this nation is currently trying to pay for. This is what turns
// marginal utility from a static curve into a reflection of actual intent.
function aiPlanDemand(f) {
  const d = { food: 0, wood: 0, stone: 0, gold: 0 };
  const arch = aiArchetype(f), n = f.nation;
  const counts = {};
  for (const b of f.buildings) counts[b.type.key] = (counts[b.type.key] || 0) + 1;
  for (const wish of aiBuildWishes(f, counts)) {
    const cost = BUILDING_TYPES[wish].cost || {};
    for (const k in cost) if (k in d) d[k] += cost[k];
  }
  const up = CASTLE_UPGRADES[f.castleTier + 1];
  if (up && (arch.upgradesEagerly || n.pop > 22)) {
    for (const k in up.cost) if (k in d) d[k] += up.cost[k];
  }
  const short = Math.max(0, f.brain.utility.armyTarget() - f.armyUnits().length);
  if (short > 0) { d.food += short * 25; d.gold += short * 12; }
  if (arch.pursuesGrand && n.pop >= 40) {
    for (const k in GRAND_CASTLE_COST) if (k in d) d[k] += GRAND_CASTLE_COST[k];
  }
  return d;
}

// Cheap, NON-RECURSIVE scarcity signals. Build planning feeds plan demand, which
// feeds marginal utility — so anything called from aiBuildWishes must not reach
// back into calculateMarginalUtility or it recurses forever.
function aiStarvedOf(f, r) {
  return estimateIncome(f, r) <= 0.01 && f.nation.total(r) < 40;
}
function aiStructuralShortage(f) {
  return ['wood', 'stone', 'food'].find(r => aiStarvedOf(f, r)) || null;
}

// Which resource this nation is most starved of, and whether it can fix that
// itself. `local` false means no working production — the shortage is
// structural, and the only ways out are the market or somebody else's quarry.
function aiWorstShortage(f) {
  let worst = null, wv = 0;
  for (const r of ['food', 'wood', 'stone', 'gold']) {
    const mu = calculateMarginalUtility(f, r);
    if (mu > wv) { wv = mu; worst = r; }
  }
  if (!worst) return null;
  const income = f.brain.perception.self().income[worst];
  return { resource: worst, utility: wv, local: income > 0.02 };
}

// Perception-based replacement for maxThreatAgainst: threat is what we believe
// a rival can field, inflated by how long it has been since we looked.
function aiMaxThreat(f) {
  const p = f.brain.perception;
  let worst = 0;
  for (const o of game.factions) {
    if (o.id === f.id || o.eliminated) continue;
    const st = game.diplomacy.status(f.id, o.id);
    if (st === STATUS.ALLIANCE) continue;
    const est = p.threatStrength(o.id);
    if (st === STATUS.WAR) worst = Math.max(worst, est * 1.5);
    else if (st === STATUS.NEUTRAL) worst = Math.max(worst, est * 0.5);
  }
  return worst;
}

// ---------- tax / happiness controller ----------

// Population only grows at dawn, and only above HAPPY_GROWTH_GATE happiness.
// Happiness drifts at 0.15/s, so a nation that wants to grow has to stop
// squeezing its people roughly half a minute beforehand. That produces the
// visible rhythm: tax hard through the night, ease off before dawn.
//
// The ceiling comes from inverting the real happiness formula
// (Nation.happinessTargetWithoutTax) rather than a copy of it.
function solveTaxPolicy(f) {
  const arch = aiArchetype(f), n = f.nation;
  const s = f.brain.perception.self();
  const H0 = n.happinessTargetWithoutTax();

  const canGrow = !s.starving
    && s.population < s.housingCapacity - 1
    && s.food > s.population * 2 * 1.15;
  const prepping = canGrow && s.secondsToDawn < arch.growthPrepWindow;
  const floor = prepping ? HAPPY_GROWTH_GATE + 6 : arch.happinessFloor;

  const ceiling = clamp((H0 - floor) / TAX_HAPPINESS_COST, 0, TAX_MAX);
  // don't squeeze people for gold the nation has no use for
  const appetite = clamp(calculateMarginalUtility(f, 'gold') / MU_GOLD_NORM * arch.goldHunger, 0.15, 1);
  const target = ceiling * appetite;

  n.tax = clamp(n.tax + clamp(target - n.tax, -0.05, 0.05), 0, TAX_MAX);
  return { target, ceiling, prepping };
}

// ---------- the engine ----------

class AIUtilityEngine {
  constructor(faction) {
    this.faction = faction;
    this.slot = 0;
    this.lastAction = null;
  }

  archetype() { return aiArchetype(this.faction); }

  armyTarget() {
    const f = this.faction, arch = this.archetype();
    const threat = aiMaxThreat(f);
    return Math.min(arch.armyMax,
      Math.round((arch.armyBase + threat * 0.12 + f.nation.pop * arch.armyPerPop) * game.diff.armyMul));
  }

  // Every building in the game costs wood — including the Market, the only way
  // to buy wood. A nation that spends its last timber before it has one is
  // locked out of building ANYTHING for the rest of the match, however much
  // stone, food and gold it is sitting on. So hold back the price of the escape.
  woodFloor() {
    const f = this.faction;
    const hasMarket = f.buildings.some(b => b.type.key === 'market' && b.done && b.hp > 0);
    return hasMarket ? 0 : BUILDING_TYPES.market.cost.wood;
  }

  respectsWoodFloor(key) {
    if (key === 'market' || key === 'lumber') return true;   // these ARE the escape
    const cost = BUILDING_TYPES[key].cost || {};
    return this.faction.nation.total('wood') - (cost.wood || 0) >= this.woodFloor();
  }

  storagePressure() {
    const n = this.faction.nation;
    let worst = 0;
    for (const r of ['food', 'wood', 'stone']) {
      const cap = n.capacityFor(r);
      if (cap > 0) worst = Math.max(worst, n.total(r) / cap);
    }
    return worst;
  }

  // One brain tick. Heavy subsystems are spread across slots so a single
  // faction never does perception, diplomacy, pathfinding and wave planning in
  // the same frame.
  tick() {
    const f = this.faction, brain = f.brain;
    brain.perception.observe();
    aiStrategy(f);                       // doctrine re-evaluation, grudge decay (js/ai.js)
    solveTaxPolicy(f);
    this.staffWorkers();
    this.considerInvestment();
    if (this.slot % 2 === 0) brain.combat.trainTroops();
    if (this.slot % 3 === 0) brain.combat.tickScouting();
    if (this.slot % 4 === 1) brain.trade.tick();
    if (this.slot % 8 === 3) brain.combat.tickEngineering();
    brain.combat.tickWar();
    this.slot++;
  }

  // Keep citizens employed, farms first when food is going backwards — but hold
  // back recruits when the army is under strength. trainUnit turns a citizen
  // into a soldier and refuses when everyone is already at work, so a nation
  // that staffs every slot can never raise an army at all.
  staffWorkers() {
    const f = this.faction, n = f.nation;
    const foodRate = estimateFoodRate(f);
    const shortfall = Math.max(0, this.armyTarget() - f.armyUnits().length);
    // guns versus butter: never idle more than a third of the population
    const reserve = foodRate < 0 ? 0 : Math.min(shortfall, Math.floor(n.pop * 0.35));
    const order = foodRate < 0
      ? [...f.buildings].sort((a, b) => (b.type.key === 'farm' ? 1 : 0) - (a.type.key === 'farm' ? 1 : 0))
      : f.buildings;
    for (const b of order) {
      if (!b.done || !b.type.slots) continue;
      // don't staff a lumber camp whose forest is gone — those workers are idle
      // in all but name, and the vacancy is what surfaces the shortage
      if (b.type.key === 'lumber' && !lumberHasForest(game.map, b)) { b.workers = 0; continue; }
      while (b.workers < b.type.slots && n.idleWorkers() > reserve) b.workers++;
    }
    if (foodRate < 0 && n.idleWorkers() === 0) {
      const donor = f.buildings.find(b => b.workers > 0 && b.type.key !== 'farm');
      const field = f.buildings.find(b => b.done && b.type.key === 'farm' && b.workers < b.type.slots);
      if (donor && field) { donor.workers--; field.workers++; }
    }
  }

  // The arbitration. Score every way this nation could invest, then run the
  // best one that is actually affordable and placeable — a blocked first choice
  // falls through to the next instead of stalling growth for a tick.
  considerInvestment() {
    const cands = [
      this.scoreBuild(),
      this.scoreUpgrade(),
      this.scoreExpansion(),
      this.scoreGrandCastle(),
    ].filter(c => c && c.score > 0);
    if (!cands.length) return;
    // small bonus for continuing what we were already doing, so the nation
    // doesn't dither between two near-equal options every tick
    for (const c of cands) if (c.id === this.lastAction) c.score *= 1.08;
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (c.run()) { this.lastAction = c.id; return; }
    }
  }

  scoreBuild() {
    const f = this.faction, arch = this.archetype(), n = f.nation;
    const counts = {};
    for (const b of f.buildings) counts[b.type.key] = (counts[b.type.key] || 0) + 1;
    const wishes = aiBuildWishesScored(f, counts);
    if (!wishes.length) return null;
    // When the land will not give us something and we have coin, a Market stops
    // being a nicety and becomes the only way to get it. Without this a nation
    // whose forest ran out sits on a pile of gold it cannot spend.
    const shortage = aiWorstShortage(f);
    const mustBuy = shortage && !shortage.local && shortage.resource !== 'gold'
      && n.total('gold') > 120 && !counts.market;
    let best = null, bestScore = 0;
    wishes.forEach(([deficitScore, k]) => {
      const t = BUILDING_TYPES[k];
      let s = deficitScore * arch.w.economy;
      // a building is worth more when it makes what we are short of
      if (t.produces) s *= 1 + calculateMarginalUtility(f, t.produces);
      if (t.storage) s *= 1 + 0.6 * this.storagePressure();
      if (t.housing && n.pop >= n.housingCap() - 2) s *= 1.8;
      if (k === 'market' && mustBuy) s *= 4;
      if (!n.canStart(t.cost)) s *= 0.2;
      if (s > bestScore) { bestScore = s; best = k; }
    });
    if (!best) return null;
    return {
      id: 'build:' + best, score: bestScore,
      run: () => {
        // Don't stake out more ground than the builders can work. Every open site
        // holds a reservation against the stores, so a nation that keeps breaking
        // ground on a whim ends up with a dozen foundations, no free timber and
        // nothing finished.
        if (!aiCanBreakGround(f)) return false;
        if (!n.canStart(BUILDING_TYPES[best].cost)) return false;
        if (!this.respectsWoodFloor(best)) return false;
        const spot = findBuildSpot(f, best, f.ai.expansionSite);
        if (!spot) return false;
        startConstruction(game, best, spot[0], spot[1], f.id);
        return true;
      },
    };
  }

  scoreUpgrade() {
    const f = this.faction, arch = this.archetype(), n = f.nation;
    const up = CASTLE_UPGRADES[f.castleTier + 1];
    if (!up) return null;
    const castle = f.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0);
    if (!castle || castle.upgrading || !n.canAfford(up.cost)) return null;
    const threat = aiMaxThreat(f);
    let s = arch.w.military * (arch.upgradesEagerly ? 1.6 : 0.7);
    s *= 1 + clamp(threat / Math.max(20, f.strength()), 0, 2);
    if (n.pop > 22) s *= 1.3;
    return { id: 'upgrade', score: s, run: () => !f.startCastleUpgrade() };
  }

  scoreExpansion() {
    const f = this.faction, arch = this.archetype();
    const shortage = aiWorstShortage(f);
    if (!shortage) return null;
    // expansion is about ground, so only material shortages drive it
    const material = shortage.resource !== 'gold' ? shortage.utility : 0;
    let s = arch.w.expand * arch.expansionAppetite * (0.6 + material);
    if (shortage.local) s *= 0.45;     // we can still fix this at home
    // A nation that cannot produce something at home has to go and find it, and
    // that pressure has to outweigh temperament — otherwise a homebody sits
    // behind its walls with a worked-out forest and never builds anything again.
    else s += material * 1.2;
    return { id: 'expand', score: s, run: () => aiPlanExpansion(f, shortage) };
  }

  scoreGrandCastle() {
    const f = this.faction, arch = this.archetype(), n = f.nation;
    if (!arch.pursuesGrand) return null;
    if (n.pop < 50 || n.happiness < 70 || !n.canAfford(GRAND_CASTLE_COST)) return null;
    return { id: 'grand', score: 100, run: () => { aiPursueGrand(f); return true; } };
  }
}
