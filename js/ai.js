'use strict';
// The AI "goal brain": evolving doctrines (ambitions), world-state re-evaluation,
// proactive diplomacy and war planning. Mechanisms live in diplomacy.js /
// factions.js / units.js — this file decides WHEN and WHY to use them.
// aiTick in factions.js is the executor; it reads its knobs from f.ai here.

// ---------- doctrines ----------
// A doctrine is a nation's current ambition. Doctrines are re-scored against
// the world state (see reevaluateDoctrine): a rich nation turns mercantile, a
// threatened one turtles, a dominant one smells conquest. The player never
// sees the doctrine name — only rumors and visible behavior hint at it.
const DOCTRINES = {
  conquest: {   // build a huge army and take the continent
    armyBase: 4, armyPerPop: 0.45, armyMax: 34, waveFraction: 0.8,
    buildWeights: { castle: 2, mine: 1.5, farm: 1.2, house: 1.2 },
    desire: { mine: 2, quarry: 2 }, secondCastlePop: 28,
    expansionAppetite: 0.9, warRatio: 1.3, peaceWeariness: 20,
    trainsPrince: false, upgradesEagerly: true,
    rumor: n => `Travelers report soldiers drilling day and night in ${n}'s fields.`,
  },
  prosperity: { // a thriving economy, trade with everyone, race to the Grand Castle
    armyBase: 2, armyPerPop: 0.15, armyMax: 10, waveFraction: 0,
    buildWeights: { market: 2, church: 1.5, well: 1.5, house: 1.3, farm: 1.2 },
    desire: { market: 2, mine: 2 }, pursuesGrand: true,
    expansionAppetite: 0.5, warRatio: Infinity, peaceWeariness: 10,
    trainsPrince: true, upgradesEagerly: true,
    rumor: n => `${n}'s markets are said to overflow with goods.`,
  },
  turtle: {     // wall up, stockpile, punish intruders
    armyBase: 3, armyPerPop: 0.3, armyMax: 16, waveFraction: 0.3,
    buildWeights: { storehouse: 1.5, quarry: 1.5, house: 1.1 },
    desire: { quarry: 2, storehouse: 2 }, wallRing: true,
    expansionAppetite: 0.1, warRatio: Infinity, peaceWeariness: 14,
    trainsPrince: false, upgradesEagerly: false,
    rumor: n => `${n}'s masons are quarrying stone at a furious pace.`,
  },
  hegemon: {    // webs of alliances; leads coalitions against any runaway power
    armyBase: 3, armyPerPop: 0.2, armyMax: 14, waveFraction: 0.5,
    buildWeights: { market: 1.6, church: 1.4, house: 1.3 },
    desire: {},
    expansionAppetite: 0.4, warRatio: Infinity, peaceWeariness: 12,
    trainsPrince: true, upgradesEagerly: false,
    rumor: n => `${n}'s envoys ride to every court on the continent.`,
  },
  raider: {     // short plunder wars: declare, rob, sue for peace with the loot
    armyBase: 3, armyPerPop: 0.25, armyMax: 18, waveFraction: 0.4,
    buildWeights: { storehouse: 1.5, mine: 0.5 },
    desire: { storehouse: 2 }, bandits: 4, plunderGoal: 150,
    expansionAppetite: 0.6, warRatio: 1.1, peaceWeariness: 12,
    trainsPrince: false, upgradesEagerly: false,
    rumor: n => `Riders from ${n} have been seen scouting the roads at dusk.`,
  },
};

function initFactionAI(f) {
  f.ai = {
    doctrine: f.personality.aggression > 0.6 ? 'conquest'
      : f.personality.mercantile > 0.7 ? 'prosperity' : 'turtle',
    doctrineSince: -999,
    reevalAt: game.time + 15 + Math.random() * 10,
    grudge: game.factions.map(() => 0),   // per-rival grievance, decays slowly
    provocation: 0,                       // player-directed; gates wars on 'slanted'
    hurtT: -999,                          // last time we lost a building / the king
    plunder: 0,                           // loot banked during the current raid war
    wave: null,                           // {units, state, stagePos, stageUntil, targetFid}
    consolidationUntil: 0,                // no new offensive wars while game.time < this
    expansionSite: null,                  // {x, y} anchor for a second build cluster
    diploAt: game.time + 8 + Math.random() * 8,
    eventCooldownUntil: 0,                // min spacing between event cards to the player
  };
  if (f.ai.doctrine === 'turtle') reevaluateDoctrine(f, true);  // cautious seeds re-score
}

// Nudge a faction to rethink its ambition right now (war, losses, eliminations).
function aiPoke(fid, hurt = false) {
  const f = game.factions[fid];
  if (!f || !f.ai) return;
  f.ai.reevalAt = 0;
  if (hurt) f.ai.hurtT = game.time;
}

function aiAddGrudge(fid, vsFid, amount) {
  const f = game.factions[fid];
  if (!f || !f.ai || fid === vsFid) return;
  f.ai.grudge[vsFid] = Math.max(0, Math.min(60, f.ai.grudge[vsFid] + amount));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- doctrine re-evaluation ----------

function reevaluateDoctrine(f, silent = false) {
  const ai = f.ai, p = f.personality;
  ai.reevalAt = game.time + 60;
  const rivals = game.factions.filter(o => o.id !== f.id && !o.eliminated);
  if (rivals.length === 0) return;
  const myStr = f.strength();
  const avgStr = rivals.reduce((s, o) => s + o.strength(), 0) / rivals.length;
  const leader = rivals.reduce((a, b) => (a.strength() > b.strength() ? a : b));
  const threatNorm = clamp(maxThreatAgainst(f) / Math.max(20, myStr), 0, 1.5);
  const goldNorm = clamp(estimateIncome(f, 'gold') / 0.6, 0, 1);
  const atPeace = !game.diplomacy.atWarAny(f.id);
  const allyCount = game.factions.filter(o => o.id !== f.id && !o.eliminated
    && game.diplomacy.status(f.id, o.id) === 'alliance').length;
  const maxGrudge = Math.max(...ai.grudge);
  const recentlyHurt = game.time - ai.hurtT < 90;
  const richLootNorm = clamp(Math.max(...rivals.map(o =>
    o.nation.total('gold') + o.nation.total('food') * 0.3)) / 400, 0, 1);

  const score = {
    conquest: p.aggression * 2 + clamp(myStr / Math.max(1, avgStr) - 1, -1, 1.5)
      + maxGrudge * 0.02 + (game.diff.warAppetite - 1),
    prosperity: p.mercantile * 2 + goldNorm + (atPeace ? 0.5 : -0.5) - threatNorm,
    turtle: threatNorm * 1.8 + (recentlyHurt ? 1.5 : 0) + (1 - p.aggression) * 0.5,
    hegemon: p.mercantile + allyCount * 0.5 + (leader.strength() > myStr * 1.5 ? 1.4 : 0),
    raider: p.aggression + (goldNorm < 0.3 ? 1 : 0) + richLootNorm,
  };
  let best = ai.doctrine;
  for (const k in score) if (score[k] > score[best]) best = k;
  if (best === ai.doctrine) return;
  // hysteresis: a new ambition must clearly beat the old one, and not flip-flop
  if (score[best] < score[ai.doctrine] * 1.25 || score[best] < score[ai.doctrine] + 0.3) return;
  if (game.time - ai.doctrineSince < 90 && !silent) return;
  ai.doctrine = best;
  ai.doctrineSince = game.time;
  if (!silent) game.log(DOCTRINES[best].rumor(f.name));
}

// ---------- build planning ----------
// Deficit scoring replaces the old fixed build ladder: targets scale with
// population and ambition forever, so AI nations never stop growing.

function aiBuildWishes(f, counts) {
  const n = f.nation, prof = DOCTRINES[f.ai.doctrine], pop = n.pop;
  const have = k => counts[k] || 0;
  const desired = {
    farm: Math.max(1, Math.ceil((pop * EAT_RATE * 1.3) / (BUILDING_TYPES.farm.rate * BUILDING_TYPES.farm.slots))),
    house: Math.ceil(Math.max(0, pop * 1.35 - 10) / 6),
    lumber: 1 + Math.floor(pop / 20),
    quarry: prof.desire.quarry || 1,
    mine: prof.desire.mine || 1,
    storehouse: (prof.desire.storehouse || 1)
      + ['food', 'wood', 'stone'].filter(r => n.capacityFor(r) > 0 && n.total(r) > n.capacityFor(r) * 0.7).length,
    market: prof.desire.market || 1,
    church: 1,
    well: 1,
    castle: 1 + (prof.secondCastlePop && pop >= prof.secondCastlePop ? 1 : 0),
  };
  const scored = [];
  for (const k in desired) {
    const deficit = desired[k] - have(k);
    if (deficit <= 0) continue;
    let s = deficit * (prof.buildWeights[k] || 1);
    // bootstrap: stand up the essential production chain before anything fancy
    if ((k === 'farm' || k === 'lumber') && have(k) === 0) s += 10;
    if (k === 'quarry' && have(k) === 0 && have('lumber') > 0) s += 5;
    if (k === 'house' && n.pop >= n.housingCap() - 2) s += 6;   // growth is blocked right now
    if (k === 'castle' && have('quarry') === 0) s -= 5;         // no stone income yet
    scored.push([s, k]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 3).map(x => x[1]);
}

// Prosperity nations race for the Grand Castle — and win the game if it stands.
function aiPursueGrand(f) {
  const n = f.nation;
  const c = f.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0 && !b.grand && b.grandProgress === 0);
  if (!c || n.pop < 50 || n.happiness < 70 || !n.canAfford(GRAND_CASTLE_COST)) return;
  n.pay(GRAND_CASTLE_COST);
  c.grandProgress = 0.01;
  game.log(`${f.name} has begun raising a GRAND CASTLE — a bid to eclipse every other nation!`, 'bad');
}

// ---------- per-tick strategy ----------
// Called from aiTick each time it fires (~2-3s). Later phases hang proactive
// diplomacy off this.

function aiStrategy(f) {
  const ai = f.ai;
  for (let i = 0; i < ai.grudge.length; i++) ai.grudge[i] = Math.max(0, ai.grudge[i] - 0.12);
  ai.provocation = Math.max(0, ai.provocation - 0.02);
  if (game.time >= ai.reevalAt) reevaluateDoctrine(f);
}

// ---------- war waves ----------
// Two-stage attacks replace the old "dump 70% at their townhall" behavior:
// the army first MASSES at a staging point near the border (the player-visible
// telegraph), holds, then assaults doctrine-picked objectives.

function aiWarTick(f, enemies) {
  const ai = f.ai, prof = DOCTRINES[ai.doctrine];
  if (ai.wave) return aiTickWave(f);
  if (prof.waveFraction <= 0) return;   // defensive doctrines hold their ground
  const army = f.armyUnits();
  if (army.length < 6) return;
  // raiders go for the richest target, everyone else picks on the weakest
  let target = enemies.reduce((a, b) => (a.strength() < b.strength() ? a : b));
  if (prof.plunderGoal) target = enemies.reduce((a, b) => (aiLootValue(a) > aiLootValue(b) ? a : b));
  if (f.strength() < target.strength() * 0.9) return;   // outmatched: defend, don't suicide
  const th = target.townhall(), myTh = f.townhall();
  if (!th || !myTh) return;
  const waveUnits = army.slice(0, Math.max(4, Math.floor(army.length * prof.waveFraction)));
  const dx = myTh.cx - th.cx, dy = myTh.cy - th.cy;
  const d = Math.hypot(dx, dy) || 1;
  const sx = clamp(Math.round(th.cx + dx / d * 10), 1, MAP_W - 2);
  const sy = clamp(Math.round(th.cy + dy / d * 10), 1, MAP_H - 2);
  ai.wave = { units: waveUnits, size: waveUnits.length, state: 'staging',
    stagePos: [sx, sy], stageUntil: game.time + 20, targetFid: target.id, objective: null };
  formationMove(waveUnits, sx, sy);
}

function aiTickWave(f) {
  const w = f.ai.wave;
  w.units = w.units.filter(u => u.alive);
  const target = game.factions[w.targetFid];
  if (w.units.length < Math.max(2, w.size * 0.3) || target.eliminated
      || game.diplomacy.status(f.id, w.targetFid) !== 'war') {
    return aiDisbandWave(f);
  }
  if (w.state === 'staging') {
    if (game.time < w.stageUntil) return;
    w.state = 'assault';
    w.objective = aiPickAssaultTarget(f, target);
    if (!w.objective) return aiDisbandWave(f);
    for (const u of w.units) u.orderAttack(w.objective);
  } else if (!w.objective || w.objective.hp <= 0) {
    w.objective = aiPickAssaultTarget(f, target);
    if (!w.objective) return aiDisbandWave(f);
    for (const u of w.units) if (!u.target || targetDead(u.target)) u.orderAttack(w.objective);
  }
}

// Objective priority: loot-rich storehouses, then the castle, then the kill
// move on the townhall — which conquerors take straight away once the defender
// is broken.
function aiPickAssaultTarget(f, target) {
  const prof = DOCTRINES[f.ai.doctrine];
  if (prof.warRatio !== Infinity && target.strength() < f.strength() * 0.4) {
    const th = target.townhall();
    if (th) return th;
  }
  let best = null, bv = 20;
  for (const b of target.buildings) {
    if (!b.done || b.hp <= 0 || !b.type.storage || b.type.key === 'townhall') continue;
    const v = b.store.food + b.store.wood + b.store.stone + b.store.gold;
    if (v > bv) { bv = v; best = b; }
  }
  if (best) return best;
  const c = target.buildings.find(b => b.type.key === 'castle' && b.hp > 0);
  return c || target.townhall();
}

function aiDisbandWave(f) {
  const w = f.ai.wave;
  f.ai.wave = null;
  if (!w) return;
  const th = f.townhall();
  const survivors = w.units.filter(u => u.alive);
  for (const u of survivors) u.target = null;
  if (th && survivors.length) formationMove(survivors, Math.floor(th.cx), Math.floor(th.cy));
}

function aiLootValue(o) {
  const n = o.nation;
  return n.total('gold') * 2 + n.total('food') + n.total('wood') + n.total('stone');
}
