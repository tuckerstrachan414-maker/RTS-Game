'use strict';
// Victory, legacy, and the chronicle of the match.
//
// Victory conditions are a choice made before the game (`game.victoryOn`, the
// `&victory=` URL parameter). With them on, five races run for every nation at
// once — including the AI, which picks one to pursue by its ambition and
// changes its mind as the world changes — and the first nation to finish one
// wins the match. If that nation is not you, you have lost. With them off the
// game is endless, exactly as before: only your Town Hall falling ends it.
//
// Either way the match keeps a chronicle (every war, Age, Wonder, betrayal and
// conquest, dated), awards first-to milestones, and scores every nation's
// legacy. Those are what the end screen is made of.

const VICTORY_TYPES = {
  domination: { name: 'Domination', icon: 'sword',
    desc: 'Every rival conquered, or sworn to you as a vassal.' },
  science: { name: 'Science', icon: 'book',
    desc: 'Complete The Enlightenment, the last great study of the Imperial Age.' },
  culture: { name: 'Culture', icon: 'pillar',
    desc: 'Amass culture: every standing Wonder radiates it (the Grand Castle and Churches a little). Raze or seize a rival\'s Wonders to stop them.' },
  economic: { name: 'Economic', icon: 'gold',
    desc: 'Become the world\'s trading empire: earn a fortune from caravans and merchant ships, and hold a great treasury, for three minutes.' },
  diplomatic: { name: 'Diplomatic', icon: 'handshake',
    desc: 'Every surviving nation your ally or vassal for three minutes, in the Age of Kingdoms or later.' },
};
const VICTORY_KEYS = Object.keys(VICTORY_TYPES);
// Culture: points per second from what a nation has raised. Wonders are the
// engine; a nation needs at least two standing to win this way at all.
const CULTURE_TARGET = 12000;       // × pace
const CULTURE_PER_WONDER = 1.0;
const CULTURE_GRAND = 0.5;
const CULTURE_PER_CHURCH = 0.04;
const CULTURE_MIN_WONDERS = 3;
function cultureTarget() { return Math.round(CULTURE_TARGET * (game.pace ? game.pace.victory : 1)); }
function cultureRate(f) {
  if (f.eliminated) return 0;
  let r = wondersOf(f.id).length * CULTURE_PER_WONDER;
  for (const b of f.buildings) {
    if (!b.done || b.hp <= 0) continue;
    if (b.grand) r += CULTURE_GRAND;
    if (b.type.key === 'church') r += CULTURE_PER_CHURCH;
  }
  return r;
}
// Economic victory: lifetime earnings from trade routes (caravans and merchant
// ships — so it needs partners, and an embargo or a sunk fleet hurts it) AND a
// treasury, both × pace.
const ECONOMIC_TRADE = 8000;
const ECONOMIC_GOLD = 20000;
const VICTORY_HOLD = 180;           // seconds the economic/diplomatic condition must hold
const VICTORY_WARN = [0.5, 0.75, 0.9];

function economicTarget() { return Math.round(ECONOMIC_GOLD * (game.pace ? game.pace.victory : 1)); }
function economicTradeTarget() { return Math.round(ECONOMIC_TRADE * (game.pace ? game.pace.victory : 1)); }

class VictoryState {
  constructor(n) {
    this.holdSince = [];     // [fid][type] = time the condition became true
    this.warned = [];        // [fid][type] = highest warning threshold passed
    this.milestones = {};    // key -> {fid, t}
    this.checkT = 0;
    this.sampleT = 0;
    this.samples = [];       // {t, legacy[], pop[], army[], era[], gold[], land[]}
    this.winner = null;      // {fid, type}
    for (let i = 0; i < n; i++) { this.holdSince[i] = {}; this.warned[i] = {}; }
  }
}

// ---------- progress (0..1) toward each victory, for one nation ----------

function rivalsOf(f) { return game.factions.filter(o => o.id !== f.id); }

function victoryProgress(f, type) {
  if (f.eliminated) return 0;
  const court = game.court;
  switch (type) {
    case 'domination': {
      const rivals = rivalsOf(f);
      const down = rivals.filter(o => o.eliminated || court.overlord[o.id] === f.id).length;
      return down / rivals.length;
    }
    case 'science':
      return hasTech(f, 'enlightenment') ? 1 : Math.min(0.99, f.techs.size / TECH_KEYS.length
        + (f.research && f.research.key === 'enlightenment' ? f.research.progress / techCost('enlightenment') * 0.03 : 0));
    case 'culture':
      return Math.min(1, (f.culture || 0) / cultureTarget());
    case 'economic':
      return 0.5 * Math.min(1, (f.tradeEarned || 0) / economicTradeTarget())
        + 0.5 * Math.min(1, f.nation.total('gold') / economicTarget());
    case 'diplomatic': {
      const alive = rivalsOf(f).filter(o => !o.eliminated);
      if (!alive.length) return 0;
      const bound = alive.filter(o => game.diplomacy.status(f.id, o.id) === STATUS.ALLIANCE || court.overlord[o.id] === f.id).length;
      const eraOk = f.era >= 2 ? 1 : 0.6;
      return Math.min(1, bound / alive.length) * eraOk;
    }
  }
  return 0;
}

// Is the condition met right now (before any hold time)?
function victoryMet(f, type) {
  switch (type) {
    case 'domination': {
      const rivals = rivalsOf(f);
      const down = rivals.filter(o => o.eliminated || game.court.overlord[o.id] === f.id);
      // it has to be *your* victory: at least one fell to you or knelt to you
      const mine = rivals.some(o => game.court.overlord[o.id] === f.id || o.conqueredBy === f.id);
      return down.length === rivals.length && mine;
    }
    case 'science': return hasTech(f, 'enlightenment');
    case 'culture': return (f.culture || 0) >= cultureTarget() && wondersOf(f.id).length >= CULTURE_MIN_WONDERS;
    case 'economic': return (f.tradeEarned || 0) >= economicTradeTarget() && f.nation.total('gold') >= economicTarget();
    case 'diplomatic': {
      const alive = rivalsOf(f).filter(o => !o.eliminated);
      return f.era >= 2 && alive.length >= 1 && alive.every(o =>
        game.diplomacy.status(f.id, o.id) === STATUS.ALLIANCE || game.court.overlord[o.id] === f.id);
    }
  }
  return false;
}
const VICTORY_NEEDS_HOLD = { economic: true, diplomatic: true };

function tickVictory(dt) {
  const v = game.victory;
  if (!v || game.over) return;
  for (const f of game.factions) f.culture = (f.culture || 0) + cultureRate(f) * dt;
  v.sampleT -= dt;
  if (v.sampleT <= 0) { v.sampleT = 30; sampleStats(); }
  v.checkT -= dt;
  if (v.checkT > 0) return;
  v.checkT = 1;
  checkMilestones();
  if (!game.victoryOn) return;
  for (const f of game.factions) {
    if (f.eliminated) continue;
    for (const type of VICTORY_KEYS) {
      const p = victoryProgress(f, type);
      warnProgress(f, type, p);
      if (!victoryMet(f, type)) { v.holdSince[f.id][type] = null; continue; }
      if (VICTORY_NEEDS_HOLD[type]) {
        if (v.holdSince[f.id][type] == null) {
          v.holdSince[f.id][type] = game.time;
          const msg = f.isPlayer ? `Hold it for ${VICTORY_HOLD / 60} minutes and the world is yours.` : `Stop them within ${VICTORY_HOLD / 60} minutes or lose the match!`;
          game.log(`${f.name} has met the conditions for a ${VICTORY_TYPES[type].name} Victory! ${msg}`, f.isPlayer ? 'good' : 'bad');
          if (typeof ui !== 'undefined' && ui) ui.announce(`${VICTORY_TYPES[type].name} Victory at hand`, `${f.name} — ${msg}`, f.isPlayer ? '' : 'bad');
          chronicle(`${f.name} stood on the brink of a ${VICTORY_TYPES[type].name} Victory.`, f.id, 'major');
          continue;
        }
        if (game.time - v.holdSince[f.id][type] < VICTORY_HOLD) continue;
      }
      return declareVictory(f, type);
    }
  }
}

function victoryHoldLeft(f, type) {
  const since = game.victory.holdSince[f.id][type];
  return since == null ? null : Math.max(0, VICTORY_HOLD - (game.time - since));
}

function warnProgress(f, type, p) {
  const v = game.victory;
  const last = v.warned[f.id][type] || 0;
  const next = VICTORY_WARN.find(th => p >= th && th > last);
  if (!next) return;
  v.warned[f.id][type] = next;
  if (next < 0.75 && !f.isPlayer) return;           // the first rumble is only news for your own race
  const name = VICTORY_TYPES[type].name;
  const pct = Math.round(next * 100);
  if (f.isPlayer) {
    game.log(`Your nation is ${pct}% of the way to a ${name} Victory.`, 'good');
  } else {
    game.log(`${f.name} is ${pct}% of the way to a ${name} Victory!`, 'bad');
    if (next >= 0.9 && typeof ui !== 'undefined' && ui) ui.announce(`${f.name} nears victory`, `${pct}% of the way to a ${name} Victory. The world must act.`, 'bad');
    chronicle(`${f.name} drew near a ${name} Victory (${pct}%).`, f.id, next >= 0.9 ? 'major' : 'minor');
  }
}

function declareVictory(f, type) {
  const v = game.victory;
  v.winner = { fid: f.id, type };
  const name = VICTORY_TYPES[type].name;
  chronicle(`${f.name} won a ${name} Victory.`, f.id, 'major');
  if (f.isPlayer) game.endGame('victory', `A ${name} Victory`, victoryText(f, type));
  else game.endGame('defeat', `${f.name} wins`, `${leaderFullName(f)} of ${f.name} achieved a ${name} Victory. ${victoryText(f, type)}`);
}

function victoryText(f, type) {
  switch (type) {
    case 'domination': return 'Every rival has fallen or bent the knee. The world answers to one throne.';
    case 'science': return 'The Enlightenment dawns. Reason lights the world, and history will remember who carried the lamp.';
    case 'culture': return 'The Wonders of the world stand in one nation, and every people envies it.';
    case 'economic': return 'The richest treasury the world has known. Every market answers to its coin.';
    case 'diplomatic': return 'Every nation is bound by alliance or fealty. Peace, at last, on one nation\'s terms.';
  }
  return '';
}

// ---------- what the AI knows about the race (public facts only) ----------

// A rival's progress as another nation can judge it: Wonders, conquests,
// vassals, alliances and Ages are public; a treasury is only what one's own
// eyes have seen of the storehouses; and a nation's scholars are known to be
// on the Enlightenment once they are in the Imperial Age and studying it,
// which is announced (see startResearch hook below).
function publicVictoryProgress(observer, o, type) {
  switch (type) {
    case 'domination': case 'culture': case 'diplomatic':
      return victoryProgress(o, type);
    case 'science':
      return o.era >= 3 ? (o.research && o.research.key === 'enlightenment' ? 0.85 : 0.6) : o.era * 0.18;
    case 'economic':
      // caravans and merchant fleets are seen by all, and a great treasury is
      // talked about in every market
      return victoryProgress(o, type);
  }
  return 0;
}

// The nation closest to winning, as `f` sees it: {fid, type, level} or null.
function aiVictoryThreat(f) {
  if (!game.victoryOn || !game.victory) return null;
  let best = null;
  for (const o of game.factions) {
    if (o.id === f.id || o.eliminated) continue;
    for (const type of VICTORY_KEYS) {
      const p = publicVictoryProgress(f, o, type);
      if (p >= 0.6 && (!best || p > best.level)) best = { fid: o.id, type, level: p };
    }
  }
  return best;
}

// The victory a nation is pursuing, re-chosen every couple of minutes.
const AI_VICTORY_AFFINITY = {
  aggressor: { domination: 2.2, science: 0.6, culture: 0.5, economic: 0.4, diplomatic: 0.2 },
  raider:    { domination: 1.4, science: 0.4, culture: 0.4, economic: 1.2, diplomatic: 0.2 },
  merchant:  { domination: 0.2, science: 1.0, culture: 1.0, economic: 2.2, diplomatic: 0.8 },
  turtle:    { domination: 0.3, science: 1.6, culture: 1.6, economic: 0.8, diplomatic: 0.6 },
  hegemon:   { domination: 0.5, science: 1.0, culture: 1.0, economic: 0.7, diplomatic: 2.2 },
};
function aiVictoryFocus(f) {
  if (!game.victoryOn || !f.ai) return null;
  if (f.ai.victoryAt && game.time < f.ai.victoryAt) return f.ai.victoryFocus;
  f.ai.victoryAt = game.time + 120;
  const aff = AI_VICTORY_AFFINITY[f.ai.doctrine] || AI_VICTORY_AFFINITY.turtle;
  let best = null, bs = -1;
  for (const type of VICTORY_KEYS) {
    const s = aff[type] * (0.6 + victoryProgress(f, type) * 1.6) + (f.ai.victoryFocus === type ? 0.3 : 0);
    if (s > bs) { bs = s; best = type; }
  }
  f.ai.victoryFocus = best;
  return best;
}
// How hard this nation is pushing for `type`, 0..1. Read by staffing (science),
// Wonder building (culture), army sizing (domination) and diplomacy.
function aiVictoryPush(f, type) {
  if (!game.victoryOn || !f.ai) return 0;
  if (aiVictoryFocus(f) !== type) return 0;
  return 0.5 + victoryProgress(f, type) * 0.5;
}

// ---------- milestones & legacy ----------

const MILESTONES = [
  { key: 'feudal', name: 'First into the Feudal Age', pts: 100, test: f => f.era >= 1 },
  { key: 'kingdom', name: 'First into the Age of Kingdoms', pts: 150, test: f => f.era >= 2 },
  { key: 'imperial', name: 'First into the Imperial Age', pts: 200, test: f => f.era >= 3 },
  { key: 'wonder', name: 'First to raise a Wonder', pts: 150, test: f => wondersOf(f.id).length >= 1 },
  { key: 'pop100', name: 'First nation of a hundred souls', pts: 80, test: f => f.nation.pop >= 100 },
  { key: 'conquest', name: 'First conquest', pts: 150, test: f => game.factions.some(o => o.conqueredBy === f.id && o.eliminated) },
  { key: 'vassal', name: 'First vassal', pts: 120, test: f => game.factions.some(o => game.court.overlord[o.id] === f.id) },
  { key: 'rich', name: 'First treasury of 3,000 gold', pts: 80, test: f => f.nation.total('gold') >= 3000 },
  { key: 'tech15', name: 'First to master fifteen technologies', pts: 100, test: f => f.techs.size >= 15 },
];

function checkMilestones() {
  const v = game.victory;
  for (const m of MILESTONES) {
    if (v.milestones[m.key]) continue;
    const winner = game.factions.find(f => !f.eliminated && m.test(f));
    if (!winner) continue;
    v.milestones[m.key] = { fid: winner.id, t: game.time };
    chronicle(`${winner.name}: ${m.name}.`, winner.id, 'minor');
    if (winner.isPlayer) {
      game.log(`Milestone — ${m.name}! (+${m.pts} legacy)`, 'good');
      if (typeof ui !== 'undefined' && ui) ui.announce(m.name, `+${m.pts} legacy`);
    } else {
      game.log(`${winner.name} is ${m.name.charAt(0).toLowerCase() + m.name.slice(1)}.`);
    }
  }
}

// A nation's standing in history. The end screen ranks by it, and in an
// endless game it is the score.
function legacyScore(f) {
  let s = 0;
  s += f.era * 150;
  s += f.techs.size * 15;
  s += wondersOf(f.id).length * 200;
  s += Math.round((f.culture || 0) / 20);
  if (!f.eliminated) s += f.nation.pop * 2;
  if (game.territory && !f.eliminated) s += Math.round(game.territory.claimCount[f.id] / 12);
  s += Math.round((f.tradeEarned || 0) / 25);
  s += game.factions.filter(o => game.court.overlord[o.id] === f.id).length * 150;
  s += game.factions.filter(o => o.eliminated && o.conqueredBy === f.id).length * 250;
  if (f.buildings.some(b => b.grand)) s += 100;
  for (const k in game.victory.milestones) {
    const m = game.victory.milestones[k];
    if (m.fid === f.id) s += MILESTONES.find(x => x.key === k).pts;
  }
  if (f.leader) s += f.leader.deeds.promisesKept * 10 - f.leader.deeds.promisesBroken * 25 - f.leader.deeds.betrayals * 40;
  return Math.max(0, Math.round(s));
}

function sampleStats() {
  const v = game.victory;
  v.samples.push({
    t: game.time,
    legacy: game.factions.map(f => legacyScore(f)),
    pop: game.factions.map(f => (f.eliminated ? 0 : f.nation.pop)),
    army: game.factions.map(f => (f.eliminated ? 0 : f.armyUnits().length)),
    gold: game.factions.map(f => (f.eliminated ? 0 : Math.round(f.nation.total('gold')))),
    land: game.factions.map(f => (f.eliminated || !game.territory ? 0 : game.territory.claimCount[f.id])),
    era: game.factions.map(f => f.era),
  });
  // a long match should not grow this without bound: thin the older half
  if (v.samples.length > 400) v.samples = v.samples.filter((s, i) => i % 2 === 0 || i > 200);
}

// ---------- the chronicle ----------

// weight: 'major' (wars, Ages, Wonders, conquests, betrayals, victories) or
// 'minor' (contacts, pacts, milestones). The end screen shows the majors.
function chronicle(text, fid = -1, weight = 'minor') {
  if (!game || !game.chronicle) return;
  game.chronicle.push({ t: game.time, day: game.dayCount, text, fid, weight });
  if (game.chronicle.length > 600) game.chronicle.splice(0, game.chronicle.length - 600);
}

// The player's epithet, earned by how they played.
function playerEpithet() {
  const f = game.factions[0];
  const d = f.leader.deeds;
  const conquests = game.factions.filter(o => o.eliminated && o.conqueredBy === 0).length;
  const vassals = game.factions.filter(o => game.court.overlord[o.id] === 0).length;
  if (d.betrayals >= 1 || d.promisesBroken >= 3) return 'the Faithless';
  if (conquests >= 2) return 'the Conqueror';
  if (vassals >= 2) return 'the Overlord';
  if (wondersOf(0).length >= 2) return 'the Builder';
  if (hasTech(f, 'enlightenment')) return 'the Enlightened';
  if ((f.tradeEarned || 0) > 3000) return 'the Merchant';
  if (d.warsDeclared === 0 && game.time > 1800) return 'the Peaceful';
  if (d.promisesKept >= 3) return 'the Just';
  if (d.warsDeclared >= 3) return 'the Bold';
  return 'the Steadfast';
}
