'use strict';
// Knowledge, research and the ages of a nation.
//
// A nation's scholars (Library and University workers), its churches and its
// Town Hall turn out Knowledge. Knowledge is not a good: it is not stored in a
// building, cannot be robbed, and is never traded. It flows every tick into
// whatever the nation is currently studying — a technology, or the next Age —
// and banks (up to a cap) while nothing is being studied.
//
// Technologies do three kinds of thing:
//   1. modify numbers (a farm yields +20%, melee strikes +10% harder) — every
//      effect lands in `f.mods`, rebuilt from scratch by `recomputeMods`, and
//      the systems that care read `f.mods` rather than the tech list;
//   2. unlock things (units, buildings, building levels);
//   3. gate the Ages. Advancing an Age is the big event of a match: it takes a
//      set number of the current Age's technologies, a knowledge project and a
//      payment in goods, and it opens the next Age's technologies, buildings
//      and castle upgrades.
//
// The Age a nation lives in is public — it shows in its buildings and its
// envoys' bearing — so the AI may read a rival's `era`. Which technologies a
// rival holds is NOT public, and nothing in the AI reads `o.techs`.

// Knowledge a Town Hall produces by itself per second: enough that a nation with
// no scholars still creeps forward, never enough to keep pace with one that
// staffs a Library.
const BASE_KNOWLEDGE = 0.08;
// Passive knowledge from each finished Church (monastic scholarship).
const CHURCH_KNOWLEDGE = 0.03;
// How much unspent knowledge a nation can bank while it studies nothing.
const KNOWLEDGE_BANK_CAP = 400;

const ERAS = [
  { key: 'tribal', name: 'Tribal Age', short: 'Tribal', title: 'Chieftain',
    desc: 'Villages of timber and thatch. Every nation begins here.' },
  { key: 'feudal', name: 'Feudal Age', short: 'Feudal', title: 'Lord',
    needTechs: 3, knowledge: 100, cost: { food: 150, gold: 60 },
    desc: 'Lords and levies. Unlocks the Garrison castle upgrade, iron arms, crossbows and the first building upgrades.' },
  { key: 'kingdom', name: 'Age of Kingdoms', short: 'Kingdom', title: 'King',
    needTechs: 4, knowledge: 300, cost: { gold: 250, stone: 150 },
    desc: 'Crowns and cathedrals. Unlocks the Royal Academy, the University, siege engines and chivalry.' },
  { key: 'imperial', name: 'Imperial Age', short: 'Imperial', title: 'Emperor',
    needTechs: 5, knowledge: 700, cost: { gold: 500, stone: 300, wood: 200 },
    desc: 'Empires of print and powder. Unlocks the Archmage, standing armies and the road to Enlightenment.' },
];

const TECH_BRANCHES = {
  economy: { label: 'Economy', css: '#c9a64a' },
  military: { label: 'Military', css: '#c95a4a' },
  civic: { label: 'Civic', css: '#5a8fc9' },
};

// effects (all optional; fractions are additive with each other):
//   yield: {food, wood, stone, gold, knowledge}   +fraction to that output
//   dmg: {melee, pierce, magic}                   +fraction to damage dealt
//   unitHp, mountedHp, mountedDmg, mountedSpeed   +fraction
//   range: {pierce}                               +tiles for ranged pierce units
//   trainTime                                     −fraction of training time
//   buildHp, wallHp                               +fraction of building HP
//   storage                                       +fraction of storehouse capacity
//   happiness                                     flat points
//   weariness                                     −fraction of war weariness gained
//   tax, trade                                    +fraction of tax / trade income
//   buildSpeed                                    +fraction construction speed
//   interest                                      fraction of treasury per minute
//   upkeep                                        −fraction of army upkeep
//   shipSpeed, shipHp                             +fraction
//   housing                                       +citizens per House
//   churchKnowledge                               +knowledge/s per Church
//   heal                                          +fraction healing rate
// unlocks: { units: [...], buildings: [...], level: n }
const TECHS = {
  // ---------------- Tribal Age ----------------
  husbandry: { name: 'Crop Rotation', era: 0, branch: 'economy', cost: 50,
    effects: { yield: { food: 0.2 } }, desc: 'Farms yield 20% more food.' },
  woodcraft: { name: 'Woodcraft', era: 0, branch: 'economy', cost: 45,
    effects: { yield: { wood: 0.2 } }, desc: 'Lumber camps yield 20% more wood.' },
  masonry: { name: 'Masonry', era: 0, branch: 'economy', cost: 55,
    effects: { yield: { stone: 0.2 }, wallHp: 0.25 }, unlocks: { buildings: ['watchtower'] },
    desc: 'Quarries yield 20% more stone; walls and gates +25% HP. Unlocks the Watchtower.' },
  bronze: { name: 'Bronze Working', era: 0, branch: 'military', cost: 55,
    effects: { dmg: { melee: 0.1 } }, desc: 'Melee troops strike 10% harder.' },
  archery: { name: 'Fletching', era: 0, branch: 'military', cost: 50,
    effects: { dmg: { pierce: 0.1 }, range: { pierce: 0.5 } }, desc: 'Archers hit 10% harder and reach half a tile further.' },
  writing: { name: 'Writing', era: 0, branch: 'civic', cost: 45,
    effects: { yield: { knowledge: 0.2 } }, desc: 'All knowledge +20%.' },
  mysticism: { name: 'Mysticism', era: 0, branch: 'civic', cost: 50,
    effects: { happiness: 3, churchKnowledge: 0.03 }, desc: '+3 happiness; each Church studies scripture for +0.03 knowledge/s.' },
  riding: { name: 'Horseback Riding', era: 0, branch: 'military', cost: 55,
    effects: { mountedSpeed: 0.1, trade: 0.1 }, desc: 'Mounted units ride 10% faster; caravans earn 10% more.' },

  // ---------------- Feudal Age ----------------
  iron: { name: 'Iron Working', era: 1, branch: 'military', cost: 130, req: ['bronze'],
    effects: { dmg: { melee: 0.1 } }, unlocks: { units: ['shield'] },
    desc: 'Melee +10% damage. Unlocks the Shieldman.' },
  crossbows: { name: 'Crossbows', era: 1, branch: 'military', cost: 140, req: ['archery'],
    effects: { dmg: { pierce: 0.1 } }, unlocks: { units: ['crossbow'] },
    desc: 'Pierce +10% damage. Unlocks the Crossbowman.' },
  feudalism: { name: 'Feudalism', era: 1, branch: 'civic', cost: 120,
    effects: { trainTime: 0.2, housing: 1 }, desc: 'Troops train 20% faster; every House holds one more citizen.' },
  plough: { name: 'Heavy Plough', era: 1, branch: 'economy', cost: 120, req: ['husbandry'],
    effects: { yield: { food: 0.25 } }, unlocks: { level: 2 },
    desc: 'Farms +25% food. Unlocks level-2 building upgrades.' },
  mining: { name: 'Deep Mining', era: 1, branch: 'economy', cost: 130, req: ['masonry'],
    effects: { yield: { gold: 0.25, stone: 0.15 } }, desc: 'Gold mines +25%, quarries +15%.' },
  currency: { name: 'Currency', era: 1, branch: 'economy', cost: 125,
    effects: { trade: 0.3, tax: 0.15 }, desc: 'Trade income +30%; taxes +15%.' },
  stonework: { name: 'Stonemasonry', era: 1, branch: 'economy', cost: 140, req: ['masonry'],
    effects: { buildHp: 0.2, storage: 0.4 }, desc: 'Buildings +20% HP; storehouses hold 40% more.' },
  laws: { name: 'Code of Laws', era: 1, branch: 'civic', cost: 120, req: ['writing'],
    effects: { happiness: 4, weariness: 0.25 }, desc: '+4 happiness; war weariness builds 25% slower.' },

  // ---------------- Age of Kingdoms ----------------
  engineering: { name: 'Engineering', era: 2, branch: 'military', cost: 280, req: ['iron'],
    effects: { buildSpeed: 0.2 }, unlocks: { units: ['catapult'] },
    desc: 'Construction 20% faster. Unlocks the Catapult siege engine.' },
  chivalry: { name: 'Chivalry', era: 2, branch: 'military', cost: 290, req: ['riding', 'iron'],
    effects: { mountedHp: 0.15, mountedDmg: 0.1 }, desc: 'Mounted units +15% HP and +10% damage; charges hit harder.' },
  guilds: { name: 'Guilds', era: 2, branch: 'economy', cost: 260, req: ['currency'],
    effects: { yield: { food: 0.1, wood: 0.1, stone: 0.1, gold: 0.1 } }, unlocks: { level: 3 },
    desc: 'All production +10%. Unlocks level-3 building upgrades.' },
  banking: { name: 'Banking', era: 2, branch: 'economy', cost: 300, req: ['currency'],
    effects: { interest: 0.01 }, desc: 'The treasury earns 1% interest per minute (up to 3 gold/s).' },
  education: { name: 'Education', era: 2, branch: 'civic', cost: 270, req: ['laws'],
    effects: { yield: { knowledge: 0.25 } }, unlocks: { buildings: ['university'] },
    desc: 'All knowledge +25%. Unlocks the University.' },
  theology: { name: 'Theology', era: 2, branch: 'civic', cost: 280, req: ['mysticism'],
    effects: { happiness: 5, churchKnowledge: 0.05, heal: 0.25 }, desc: '+5 happiness; Churches +0.05 knowledge/s; troops heal 25% faster.' },
  fortification: { name: 'Fortification', era: 2, branch: 'military', cost: 270, req: ['stonework'],
    effects: { wallHp: 0.5, buildHp: 0.1 }, desc: 'Walls, gates and towers +50% HP; all buildings +10%.' },
  navigation: { name: 'Navigation', era: 2, branch: 'economy', cost: 260,
    effects: { shipSpeed: 0.25, shipHp: 0.2 }, desc: 'Ships sail 25% faster with 20% more hull.' },

  // ---------------- Imperial Age ----------------
  arcana: { name: 'Arcane Mastery', era: 3, branch: 'military', cost: 520, req: ['education'],
    effects: { dmg: { magic: 0.15 } }, unlocks: { units: ['archmage'] },
    desc: 'Magic +15% damage. Unlocks the Archmage.' },
  standing: { name: 'Standing Army', era: 3, branch: 'military', cost: 500, req: ['chivalry'],
    effects: { unitHp: 0.15, upkeep: 0.4 }, desc: 'All troops +15% HP; army upkeep −40%.' },
  printing: { name: 'Printing Press', era: 3, branch: 'civic', cost: 480, req: ['education'],
    effects: { yield: { knowledge: 0.3 }, happiness: 3 }, desc: 'All knowledge +30%; +3 happiness.' },
  mercantilism: { name: 'Mercantilism', era: 3, branch: 'economy', cost: 500, req: ['banking'],
    effects: { trade: 0.5, yield: { gold: 0.2 } }, desc: 'Trade income +50%; gold +20%.' },
  architecture: { name: 'Architecture', era: 3, branch: 'civic', cost: 520, req: ['guilds', 'fortification'],
    effects: { buildSpeed: 0.3, buildHp: 0.2 }, desc: 'Construction 30% faster; buildings +20% HP; Wonders rise faster.' },
  enlightenment: { name: 'The Enlightenment', era: 3, branch: 'civic', cost: 5000,
    req: ['printing', 'arcana', 'mercantilism', 'architecture'], project: true,
    effects: { yield: { knowledge: 0.2 }, happiness: 10 },
    desc: 'The culmination of a civilization. With victory conditions on, completing it wins a Science Victory.' },
};
for (const k in TECHS) { TECHS[k].key = k; TECHS[k].req = TECHS[k].req || []; }
const TECH_KEYS = Object.keys(TECHS);

// The game's pace scales every knowledge cost (and, in js/victory.js, every
// victory threshold). Chosen on the setup screen; stored on the Game.
const PACES = {
  quick:    { label: 'Quick', research: 0.8, victory: 0.6, desc: 'About an hour. The Ages come quickly and the races are short.' },
  standard: { label: 'Standard', research: 1.8, victory: 1.4, desc: 'The intended pace: roughly two hours of rising Ages before anyone can claim the world.' },
  epic:     { label: 'Epic', research: 2.6, victory: 2.0, desc: 'An evening-long saga. Every Age is hard-won and every race is long.' },
};
function paceMul() { return (game && game.pace ? game.pace.research : 1); }
// Later Ages cost disproportionately more. A late nation's knowledge stacks
// many bonuses (Writing, Education, Printing, the Great Library and the
// Observatory, research pacts, a University's worth of scholars) and without a
// steeper curve the whole Imperial Age and the Enlightenment fell in about ten
// minutes once a nation got there.
const ERA_COST_MUL = [1, 1.35, 2.3, 3.4];
function techCost(key) { return Math.round(TECHS[key].cost * ERA_COST_MUL[TECHS[key].era] * paceMul()); }
function eraKnowledgeCost(era) { return Math.round((ERAS[era].knowledge || 0) * ERA_COST_MUL[era - 1] * paceMul()); }

// ---------- per-nation state ----------

function initResearch(f) {
  f.era = 0;
  f.techs = new Set();
  f.research = null;          // {key, progress} — key is a tech, or 'era:N'
  f.researchQueue = [];       // further tech keys, studied in order
  f.knowledgeBank = 0;        // unspent knowledge while nothing is studied
  f.knowledgeIn = 0;          // scholars' output since the last research tick
  f.knowledgeRate = 0;        // smoothed knowledge/second, for the HUD and the AI
  f.knowledgeTotal = 0;       // lifetime knowledge (legacy score)
  f.mods = emptyMods();
}

function emptyMods() {
  return {
    yield: { food: 0, wood: 0, stone: 0, gold: 0, knowledge: 0 },
    dmg: { melee: 0, pierce: 0, magic: 0 },
    range: { pierce: 0 },
    unitHp: 0, mountedHp: 0, mountedDmg: 0, mountedSpeed: 0,
    trainTime: 0, buildHp: 0, wallHp: 0, storage: 0, happiness: 0, weariness: 0,
    tax: 0, trade: 0, buildSpeed: 0, interest: 0, upkeep: 0, shipSpeed: 0, shipHp: 0,
    housing: 0, churchKnowledge: 0, heal: 0,
    // from Wonders (js/wonders.js)
    knowledgeFlat: 0, goldFlat: 0, tribute: 0, slowInvaders: 0,
    units: new Set(), buildings: new Set(), level: 1,
  };
}

// Rebuild the modifier table from the nation's technologies. Anything that
// depends on a maximum (hit points) is rescaled so a finished tech never
// leaves a unit or building looking "damaged", or suddenly over its cap.
function recomputeMods(f) {
  const live = typeof game !== 'undefined' && game;
  // every maximum as it stands under the OLD modifiers, before they change
  const units = live ? f.units.filter(u => u.alive && !u.type.civilian).map(u => [u, unitMaxHp(u)]) : [];
  const blds = live ? f.buildings.map(b => [b, buildingMaxHp(b)]) : [];
  const m = emptyMods();
  for (const key of f.techs) {
    const t = TECHS[key];
    const e = t.effects || {};
    for (const grp of ['yield', 'dmg', 'range']) {
      if (e[grp]) for (const k in e[grp]) m[grp][k] = (m[grp][k] || 0) + e[grp][k];
    }
    for (const k in e) {
      if (grp_(k)) continue;
      m[k] = (m[k] || 0) + e[k];
    }
    const u = t.unlocks || {};
    for (const x of u.units || []) m.units.add(x);
    for (const x of u.buildings || []) m.buildings.add(x);
    if (u.level) m.level = Math.max(m.level, u.level);
  }
  if (typeof applyWonderMods === 'function') applyWonderMods(f, m);
  f.mods = m;
  for (const [u, old] of units) {
    const next = unitMaxHp(u);
    if (Math.abs(next - old) > 0.01) u.hp = u.hp * next / old;
    u.maxHp = next;
  }
  for (const [b, old] of blds) {
    const next = buildingMaxHp(b);
    if (Math.abs(next - old) > 0.01) b.hp = b.hp * next / old;
  }
}
function grp_(k) { return k === 'yield' || k === 'dmg' || k === 'range'; }

function factionMods(fid) {
  const f = typeof game !== 'undefined' && game && game.factions[fid];
  return f && f.mods ? f.mods : null;
}

// A unit's maximum hit points: its type, its nation's technology, and (see
// js/units.js) its veterancy.
function unitMaxHp(u) {
  let mul = 1;
  const m = factionMods(u.faction);
  if (m && !u.type.civilian) {
    if (u.type.naval) mul += m.shipHp;
    else {
      mul += m.unitHp;
      if (u.type.mounted) mul += m.mountedHp;
    }
  }
  if (u.rank) mul += RANK_BONUS * u.rank;
  return u.type.hp * mul;
}

// A building's maximum hit points: its type, its level, and its owner's
// technology. Captured buildings take their new owner's technology.
function buildingMaxHp(b) {
  let mul = 1 + ((b.level || 1) - 1) * 0.35;
  const m = factionMods(b.faction);
  if (m) {
    mul += m.buildHp;
    if (b.type.fortification) mul += m.wallHp;
  }
  return b.type.hp * mul;
}

function hasTech(f, key) { return !!(f && f.techs && f.techs.has(key)); }

// ---------- what a nation may study ----------

// null when this tech can be started now, else the reason it cannot.
function techBlocker(f, key) {
  const t = TECHS[key];
  if (!t) return 'Unknown technology';
  if (f.techs.has(key)) return 'Already known';
  if (t.era > f.era) return `Requires the ${ERAS[t.era].name}`;
  const missing = t.req.filter(r => !f.techs.has(r));
  if (missing.length) return 'Requires ' + missing.map(r => TECHS[r].name).join(', ');
  return null;
}

function availableTechs(f) {
  return TECH_KEYS.filter(k => !techBlocker(f, k));
}

// How many of the given Age's technologies a nation holds.
function techsOfEra(f, era) {
  let n = 0;
  for (const k of f.techs) if (TECHS[k].era === era) n++;
  return n;
}

// null when the next Age can be started now, else the reason it cannot.
function eraBlocker(f) {
  const next = ERAS[f.era + 1];
  if (!next) return 'Your nation stands in the final Age';
  if (f.research && f.research.key.startsWith('era:')) return 'Already advancing';
  const have = techsOfEra(f, f.era);
  if (have < next.needTechs) return `Needs ${next.needTechs} ${ERAS[f.era].short} technologies (${have}/${next.needTechs})`;
  if (!f.nation.canAfford(next.cost)) return 'Not enough resources: ' + Object.entries(next.cost).map(([r, v]) => `${v} ${r}`).join(', ');
  return null;
}

// Start (or queue) research. Returns an error string, or null.
function startResearch(f, key) {
  const err = techBlocker(f, key);
  if (err) return err;
  if (f.research && f.research.key === key) return 'Already studying it';
  if (f.research) {
    if (f.researchQueue.includes(key)) return 'Already queued';
    f.researchQueue.push(key);
    return null;
  }
  f.research = { key, progress: Math.min(techCost(key), f.knowledgeBank) };
  f.knowledgeBank = Math.max(0, f.knowledgeBank - f.research.progress);
  // The Enlightenment is no secret: the whole world hears when a nation's
  // scholars begin it — which is what lets rivals try to stop them.
  if (TECHS[key].project && typeof game !== 'undefined' && game && game.victoryOn !== undefined) {
    game.log(f.isPlayer ? 'Your scholars begin The Enlightenment. The world will know.' : `${f.name}'s scholars have begun The Enlightenment!`, f.isPlayer ? 'good' : 'bad');
    if (typeof chronicle === 'function') chronicle(`${f.name} began The Enlightenment.`, f.id, 'major');
  }
  return null;
}

// Queue a tech together with every prerequisite it is still missing, in an
// order that respects the tree. A player clicking a far-off tech gets the path
// to it, the way Civilization does.
function queueResearchPath(f, key) {
  const t = TECHS[key];
  if (!t || f.techs.has(key)) return 'Already known';
  if (t.era > f.era) return `Requires the ${ERAS[t.era].name}`;
  const path = [];
  const visit = k => {
    if (f.techs.has(k) || path.includes(k)) return true;
    if (TECHS[k].era > f.era) return false;
    for (const r of TECHS[k].req) if (!visit(r)) return false;
    path.push(k);
    return true;
  };
  if (!visit(key)) return `A prerequisite needs a later Age`;
  for (const k of path) {
    if (f.research && f.research.key === k) continue;
    if (f.researchQueue.includes(k)) continue;
    if (!f.research) startResearch(f, k);
    else f.researchQueue.push(k);
  }
  return null;
}

function cancelResearch(f, key) {
  if (f.research && f.research.key === key) {
    // A cancelled study is not wasted: the knowledge goes back in the bank.
    if (!key.startsWith('era:')) f.knowledgeBank = Math.min(KNOWLEDGE_BANK_CAP * 3, f.knowledgeBank + f.research.progress);
    f.research = null;
    pullNextResearch(f);
    return;
  }
  f.researchQueue = f.researchQueue.filter(k => k !== key);
}

function startEraAdvance(f) {
  const err = eraBlocker(f);
  if (err) return err;
  const next = f.era + 1;
  f.nation.pay(ERAS[next].cost);
  // an Age outranks whatever was being studied; that tech goes back to the queue head
  if (f.research) f.researchQueue.unshift(f.research.key), f.knowledgeBank += f.research.progress;
  f.research = { key: 'era:' + next, progress: 0 };
  const take = Math.min(eraKnowledgeCost(next), f.knowledgeBank);
  f.research.progress = take;
  f.knowledgeBank -= take;
  if (f.isPlayer) game.log(`Your nation begins its advance into the ${ERAS[next].name}.`, 'good');
  return null;
}

function researchCost(key) {
  if (key.startsWith('era:')) return eraKnowledgeCost(+key.slice(4));
  return techCost(key);
}

function researchName(key) {
  if (key.startsWith('era:')) return ERAS[+key.slice(4)].name;
  return TECHS[key].name;
}

function pullNextResearch(f) {
  while (!f.research && f.researchQueue.length) {
    const k = f.researchQueue.shift();
    if (!techBlocker(f, k)) startResearch(f, k);
  }
}

// ---------- the tick ----------

// Knowledge per second this nation is producing from buildings that do not
// need scholars. Scholars' output arrives through `creditKnowledge`.
function passiveKnowledge(f) {
  if (!f.townhall()) return 0;
  let k = BASE_KNOWLEDGE;
  const perChurch = CHURCH_KNOWLEDGE + f.mods.churchKnowledge;
  for (const b of f.buildings) {
    if (b.done && b.hp > 0 && b.type.key === 'church') k += perChurch;
    if (b.done && b.hp > 0 && b.type.knowledgeAura) k += b.type.knowledgeAura;
  }
  return (k + f.mods.knowledgeFlat) * (1 + f.mods.yield.knowledge);
}

// Called by a scholar at work (js/civilians.js). Already multiplied by the
// nation's knowledge bonus through workerYieldRate.
function creditKnowledge(fid, amount) {
  const f = game.factions[fid];
  if (f && f.techs) f.knowledgeIn += amount;
}

// War disrupts scholarship: every war a nation is fighting costs it 15% of
// its knowledge, to at most 45%. It is what lets a coalition's war actually
// slow a nation racing for the Enlightenment (js/victory.js) rather than just
// burning its farms, and it is the price an aggressor pays in the long run.
const WAR_KNOWLEDGE_COST = 0.15, WAR_KNOWLEDGE_MAX = 0.45;
function warKnowledgePenalty(f) {
  if (typeof game === 'undefined' || !game || !game.diplomacy) return 0;
  let wars = 0;
  for (const o of game.factions) {
    if (o.id !== f.id && !o.eliminated && game.diplomacy.status(f.id, o.id) === 'war') wars++;
  }
  return Math.min(WAR_KNOWLEDGE_MAX, wars * WAR_KNOWLEDGE_COST);
}

function tickResearch(f, dt) {
  if (!f.techs) return;
  const pact = typeof researchPactBonus === 'function' ? researchPactBonus(f) : 0;
  const gained = (passiveKnowledge(f) * dt + f.knowledgeIn) * (1 + pact) * (1 - warKnowledgePenalty(f));
  f.knowledgeIn = 0;
  f.knowledgeTotal += gained;
  // an exponential average makes a readable rate out of scholars' lumpy deliveries
  const inst = gained / dt;
  f.knowledgeRate += (inst - f.knowledgeRate) * Math.min(1, dt * 0.08);
  let pool = gained;
  while (pool > 0) {
    if (!f.research) pullNextResearch(f);
    if (!f.research) {
      f.knowledgeBank = Math.min(KNOWLEDGE_BANK_CAP * paceMul(), f.knowledgeBank + pool);
      break;
    }
    const need = researchCost(f.research.key) - f.research.progress;
    const use = Math.min(need, pool);
    f.research.progress += use;
    pool -= use;
    if (f.research.progress >= researchCost(f.research.key) - 1e-6) completeResearch(f);
    else break;
  }
}

function completeResearch(f) {
  const key = f.research.key;
  f.research = null;
  if (key.startsWith('era:')) {
    const era = +key.slice(4);
    f.era = Math.max(f.era, era);
    onEraAdvanced(f, era);
  } else {
    f.techs.add(key);
    recomputeMods(f);
    onTechResearched(f, key);
  }
  pullNextResearch(f);
}

function onTechResearched(f, key) {
  const t = TECHS[key];
  if (f.isPlayer) {
    game.log(`Research complete: ${t.name}. ${t.desc}`, 'good');
    if (typeof ui !== 'undefined' && ui) ui.researchDirty = true;
  }
  if (typeof chronicle === 'function' && (t.project || f.isPlayer && t.era >= 2)) {
    chronicle(`${f.name} ${t.project ? 'completed' : 'mastered'} ${t.name}.`, f.id, t.project ? 'major' : 'minor');
  }
  if (typeof onVictoryTech === 'function') onVictoryTech(f, key);
}

function onEraAdvanced(f, era) {
  const e = ERAS[era];
  if (f.isPlayer) {
    game.log(`Your nation has entered the ${e.name}!`, 'good');
    if (typeof ui !== 'undefined' && ui) { ui.announce(e.name, e.desc); ui.researchDirty = true; }
  } else {
    game.log(`${f.name} has entered the ${e.name}.`, era >= 2 ? 'bad' : '');
  }
  if (typeof chronicle === 'function') chronicle(`${f.name} entered the ${e.name}.`, f.id, 'major');
  if (typeof leaderReactEra === 'function') leaderReactEra(f, era);
  if (typeof aiPoke === 'function') for (const o of game.factions) if (!o.eliminated && o !== f) aiPoke(o.id);
}

// ---------- the AI's research ----------

// How much each ambition cares about each branch.
const AI_TECH_AFFINITY = {
  aggressor: { military: 2.0, economy: 1.0, civic: 0.6 },
  merchant:  { military: 0.5, economy: 2.0, civic: 1.5 },
  turtle:    { military: 1.2, economy: 1.3, civic: 1.0 },
  raider:    { military: 1.6, economy: 1.2, civic: 0.5 },
  hegemon:   { military: 0.8, economy: 1.2, civic: 2.0 },
};
// Individual techs a given ambition reaches for first.
const AI_TECH_FAVOURITES = {
  aggressor: ['bronze', 'iron', 'engineering', 'chivalry', 'standing'],
  merchant: ['currency', 'banking', 'mercantilism', 'writing', 'guilds'],
  turtle: ['masonry', 'stonework', 'fortification', 'architecture', 'laws'],
  raider: ['riding', 'chivalry', 'currency', 'bronze'],
  hegemon: ['writing', 'laws', 'education', 'printing', 'theology'],
};

// Pick what to study next. Runs a few times a minute; cheap.
function aiChooseResearch(f) {
  if (f.research && f.researchQueue.length) return;
  const doctrine = f.ai ? f.ai.doctrine : 'turtle';
  const aff = AI_TECH_AFFINITY[doctrine] || AI_TECH_AFFINITY.turtle;
  const fav = AI_TECH_FAVOURITES[doctrine] || [];
  const avail = availableTechs(f).filter(k => !(f.research && f.research.key === k)
    && !f.researchQueue.includes(k));
  if (!avail.length) return;
  const next = ERAS[f.era + 1];
  const needForEra = next ? Math.max(0, next.needTechs - techsOfEra(f, f.era)) : 0;
  let best = null, bs = -1;
  for (const k of avail) {
    const t = TECHS[k];
    let s = aff[t.branch] || 1;
    if (fav.includes(k)) s += 1.2;
    // a nation short of something studies how to make more of it
    const y = (t.effects && t.effects.yield) || {};
    for (const r of RES_KEYS) {
      if (y[r] && f.brain && typeof aiStarvedOf === 'function' && aiStarvedOf(f, r)) s += 1.5;
    }
    if (y.food && f.nation.starving) s += 2;
    // being threatened makes the sword look better than the plough
    if (t.branch === 'military' && game.diplomacy.atWarAny(f.id)) s += 0.8;
    // techs of the current Age move the nation toward the next one
    if (t.era === f.era && needForEra > 0) s += 0.6;
    // cheaper first, all else equal: a quicker win compounds
    s /= Math.pow(techCost(k) / 100, 0.35);
    s *= 0.85 + game.rng() * 0.3;
    if (t.project) s *= 3;   // the Enlightenment, once it is on the table, is the goal
    if (s > bs) { bs = s; best = k; }
  }
  if (best) startResearch(f, best);
}

// A candidate for the utility engine's investment arbitration (js/ai-utility.js).
function aiScoreEraAdvance(f) {
  if (eraBlocker(f)) return null;
  const arch = aiArchetype(f);
  // An Age is the single biggest investment a nation makes and it happens once
  // per Age, so once it is affordable it outranks every ordinary building —
  // otherwise an always-affordable House wins the arbitration every tick and
  // the nation sits in the old Age forever with the bill paid in its vaults.
  let s = 40 + (arch.w.economy + arch.w.military + arch.w.diplomacy) * 4;
  if (game.diplomacy.atWarAny(f.id)) s *= 0.8;
  return { id: 'era', score: s, run: () => !startEraAdvance(f) };
}

// Knowledge buildings a nation should aim for.
function aiDesiredScholarBuildings(f) {
  const pop = f.nation.pop;
  const doctrine = f.ai ? f.ai.doctrine : 'turtle';
  const bookish = doctrine === 'merchant' || doctrine === 'hegemon' ? 1 : 0;
  return {
    library: pop >= 12 ? 1 + bookish + Math.floor(pop / 30) : 0,
    university: f.mods.buildings.has('university') && pop >= 28 ? 1 : 0,
  };
}

// Short summary of a tech's cost/era for tooltips.
function techSummary(key) {
  const t = TECHS[key];
  return `${t.name} — ${ERAS[t.era].short}, ${techCost(key)} knowledge. ${t.desc}`;
}
