'use strict';
// Wonders of the world.
//
// Seven great works, each of which can stand in exactly one nation at a time.
// Anyone who has reached the right Age can stake one out, and several nations
// can race to raise the same Wonder — the first to finish it wins it, and every
// rival site for it is abandoned (half its delivered materials salvaged). A
// Wonder is a building like any other: builders haul its enormous cost to the
// site a load at a time (six of them at once, rather than three), an army can
// burn it, and a conqueror inherits it. One that is razed is lost to history
// for everyone.
//
// Wonders count toward the Culture victory (js/victory.js), toward legacy, and
// toward the Builder agenda's admiration (js/leaders.js). Their effects land in
// `f.mods` through recomputeMods like any technology's.

const WONDERS = {
  greatlibrary: {
    name: 'Great Library', era: 1, cost: { wood: 200, stone: 250, gold: 150 }, buildTime: 150,
    effects: { knowledgeFlat: 2, yield: { knowledge: 0.1 } },
    desc: 'All the learning of the age under one roof: +2 knowledge/s and +10% knowledge.',
  },
  bazaar: {
    name: 'Grand Bazaar', era: 1, cost: { wood: 250, stone: 150, gold: 250 }, buildTime: 150,
    effects: { trade: 0.5, goldFlat: 1.5 },
    desc: 'The crossroads of every caravan: trade income +50% and +1.5 gold/s.',
  },
  gardens: {
    name: 'Royal Gardens', era: 2, cost: { wood: 300, stone: 300, gold: 200 }, buildTime: 180,
    effects: { happiness: 10, housing: 2 },
    desc: 'Terraces of fruit and water: +10 happiness, and every House holds two more citizens.',
  },
  cathedral: {
    name: 'Great Cathedral', era: 2, cost: { wood: 200, stone: 450, gold: 250 }, buildTime: 200,
    effects: { happiness: 8, churchKnowledge: 0.06, heal: 0.5 },
    desc: 'A house of God to shame all others: +8 happiness, Churches study twice as hard, troops heal 50% faster.',
  },
  greatwall: {
    name: 'Great Wall', era: 2, cost: { wood: 150, stone: 600, gold: 150 }, buildTime: 180,
    effects: { wallHp: 1.0, slowInvaders: 0.15 },
    desc: 'Walls, gates and towers +100% HP, and enemy soldiers march 15% slower inside your borders.',
  },
  palace: {
    name: 'Imperial Palace', era: 3, cost: { wood: 400, stone: 500, gold: 500 }, buildTime: 240,
    effects: { yield: { food: 0.15, wood: 0.15, stone: 0.15, gold: 0.15 }, tax: 0.1, tribute: 0.5 },
    desc: 'The seat of an empire: all production +15%, taxes +10%, vassals pay half as much again.',
  },
  observatory: {
    name: 'Grand Observatory', era: 3, cost: { wood: 300, stone: 400, gold: 400 }, buildTime: 220,
    effects: { yield: { knowledge: 0.25 }, knowledgeFlat: 3 },
    desc: 'Charting the heavens: +25% knowledge and +3 knowledge/s.',
  },
};
const WONDER_KEYS = Object.keys(WONDERS);
const WONDER_HP = 1500;
const WONDER_BUILDERS = 6;

// Every Wonder is a building type: 2x2, walkable (a monument is a square you
// can cross, and a solid 2x2 dropped into a town can seal its lanes), three
// tiles of art tall.
// A Wonder is a late project, not a mid-game house: the table's costs and
// times are scaled here so the numbers above stay readable.
const WONDER_COST_MUL = 1.6, WONDER_TIME_MUL = 2;
for (const k of WONDER_KEYS) {
  const w = WONDERS[k];
  for (const r in w.cost) w.cost[r] = Math.round(w.cost[r] * WONDER_COST_MUL / 10) * 10;
  w.buildTime = Math.round(w.buildTime * WONDER_TIME_MUL);
  BUILDING_TYPES[k] = {
    key: k, name: w.name, art: null, size: 2, artH: 3, wonder: true,
    cost: w.cost, hp: WONDER_HP, buildTime: w.buildTime, slots: 0, maxBuilders: WONDER_BUILDERS,
    requires: { era: w.era },
    desc: `WONDER — ${w.desc} Only one nation can own it; the first to finish wins the race. Requires the ${ERAS[w.era].name}.`,
  };
}
BUILD_MENU.push(...WONDER_KEYS);
BUILD_TABS.find(t => t.key === 'wonders').keys.push(...WONDER_KEYS);

// ---------- the world's register ----------

class WonderRegister {
  constructor() {
    this.owner = {};      // key -> fid of the nation holding the finished Wonder
    this.ruined = {};     // key -> true once razed; lost to history
    this.builtAt = {};    // key -> game.time finished
  }
}

function wondersOf(fid) {
  const out = [];
  const f = game.factions[fid];
  if (!f) return out;
  for (const b of f.buildings) if (b.type.wonder && b.done && b.hp > 0) out.push(b);
  return out;
}

function wonderStateKey() {
  const w = game.wonders;
  return w ? WONDER_KEYS.map(k => (w.owner[k] != null ? w.owner[k] : '-') + (w.ruined[k] ? 'x' : '')).join('') : '';
}

// Why this nation cannot stake out this Wonder now, or null.
function wonderBlocker(f, key) {
  const w = game.wonders;
  if (!w) return null;
  if (w.ruined[key]) return 'Lost to history — it was destroyed';
  if (w.owner[key] != null) return `Already stands in ${game.factions[w.owner[key]].name}`;
  if (f.buildings.some(b => b.type.key === key)) return 'Already under construction';
  return null;
}

// A Wonder was finished: the race is over for everyone else.
function onWonderCompleted(b) {
  const w = game.wonders, key = b.type.key, f = game.factions[b.faction];
  w.owner[key] = b.faction;
  w.builtAt[key] = game.time;
  if (f.leader) f.leader.deeds.wonders++;
  recomputeMods(f);
  // rivals' sites for the same Wonder are abandoned; half their materials salvaged
  for (const o of game.factions) {
    if (o.id === b.faction) continue;
    for (const s of [...o.buildings]) {
      if (s.type.key !== key || s.done) continue;
      const mats = siteMaterials(s);
      removeBuilding(game, s);
      if (mats) for (const r of RES_KEYS) if (mats[r] > 0) o.nation.deposit(r, Math.floor(mats[r] * 0.5));
      if (o.isPlayer) game.log(`${f.name} finished the ${b.type.name} first — your site is abandoned, half its materials salvaged.`, 'bad');
    }
  }
  const name = b.type.name;
  if (f.isPlayer) {
    game.log(`The ${name} is complete! ${WONDERS[key].desc}`, 'good');
    if (typeof ui !== 'undefined' && ui) ui.announce(name, `A Wonder of the world rises in ${f.name}.`);
    addMood(f, 'wonder_' + key, `Pride in the ${name}`, 8, 600);
  } else {
    game.log(`${f.name} has completed the ${name}, a Wonder of the world.`, 'bad');
    if (typeof ui !== 'undefined' && ui) ui.announce(name, `${leaderShort(f)} of ${f.name} completes a Wonder of the world.`, 'bad');
  }
  if (typeof chronicle === 'function') chronicle(`${f.name} completed the ${name}.`, f.id, 'major');
  // admirers and the envious
  for (const o of game.factions) {
    if (o.isPlayer || o.eliminated || o.id === f.id || !o.leader) continue;
    if (o.leader.agenda === 'builder') remember(o.id, f.id, 'wonder_' + key, `Built the ${name}`, 8, 2400);
  }
}

// A Wonder that falls is gone — for everyone.
function onWonderLost(b, attacker) {
  const w = game.wonders, key = b.type.key;
  if (!b.done) return;
  w.owner[key] = null;
  w.ruined[key] = true;
  const f = game.factions[b.faction];
  recomputeMods(f);
  const name = b.type.name;
  game.log(`The ${name} of ${f.name} has been destroyed — lost to history.`, b.faction === 0 ? 'bad' : '');
  if (typeof ui !== 'undefined' && ui) ui.announce(`The ${name} falls`, `Lost to history, forever.`, 'bad');
  if (typeof chronicle === 'function') chronicle(`The ${name} of ${f.name} was destroyed${attacker ? ' by ' + game.factions[attacker.faction].name : ''}.`, b.faction, 'major');
  for (const o of game.factions) {
    if (o.isPlayer || o.eliminated || !o.leader || !attacker) continue;
    if (o.leader.agenda === 'builder') remember(o.id, attacker.faction, 'razed_wonder', `Destroyed the ${name}`, -25, 3600);
  }
  if (f.isPlayer) addMood(f, 'wonder_lost', `The ${name} is lost`, -10, 600);
}

// A captured Wonder changes owners, effects and all.
function onWonderCaptured(b, fromFid) {
  const w = game.wonders;
  w.owner[b.type.key] = b.faction;
  if (game.factions[fromFid]) recomputeMods(game.factions[fromFid]);
  recomputeMods(game.factions[b.faction]);
  if (typeof chronicle === 'function') chronicle(`${game.factions[b.faction].name} seized the ${b.type.name} from ${game.factions[fromFid].name}.`, b.faction, 'major');
}

// Effects of the nation's standing Wonders, folded into f.mods (called from
// recomputeMods).
function applyWonderMods(f, m) {
  if (typeof game === 'undefined' || !game || !game.wonders) return;
  for (const b of f.buildings) {
    if (!b.type.wonder || !b.done || b.hp <= 0) continue;
    const e = WONDERS[b.type.key].effects;
    for (const grp of ['yield']) if (e[grp]) for (const k in e[grp]) m[grp][k] = (m[grp][k] || 0) + e[grp][k];
    for (const k in e) if (k !== 'yield') m[k] = (m[k] || 0) + e[k];
  }
}

// ---------- the AI ----------

// Which Wonder a nation should raise next, and how badly it wants to.
const AI_WONDER_TASTE = {
  merchant: ['bazaar', 'palace', 'gardens', 'greatlibrary'],
  hegemon: ['cathedral', 'gardens', 'greatlibrary', 'palace'],
  turtle: ['greatwall', 'cathedral', 'observatory', 'gardens'],
  aggressor: ['greatwall', 'palace'],
  raider: ['bazaar'],
};

function aiScoreWonder(f) {
  if (!aiCanBreakGround(f)) return null;
  if (f.buildings.some(b => b.type.wonder && !b.done)) return null;   // one at a time
  const doctrine = f.ai.doctrine;
  const taste = AI_WONDER_TASTE[doctrine] || [];
  const push = typeof aiVictoryPush === 'function' ? aiVictoryPush(f, 'wonder') : 0;
  const n = f.nation;
  let best = null, bs = 0;
  for (const k of WONDER_KEYS) {
    if (buildingBlocker(f, k)) continue;
    if (!n.canStart(BUILDING_TYPES[k].cost)) continue;
    let s = taste.includes(k) ? 18 - taste.indexOf(k) * 2 : 5;
    s *= 1 + push * 2;
    if (f.leader && f.leader.agenda === 'builder') s *= 1.6;
    // a Wonder somebody else is already raising is a riskier race
    const rivals = game.factions.some(o => o !== f && o.buildings.some(b => b.type.key === k && !b.done));
    if (rivals) s *= 0.6;
    if (s > bs) { bs = s; best = k; }
  }
  if (!best) return null;
  return {
    id: 'wonder:' + best, score: bs,
    run: () => {
      const spot = findBuildSpot(f, best);
      if (!spot) return false;
      const site = startConstruction(game, best, spot[0], spot[1], f.id);
      site.urgent = true;
      game.log(`${f.name} breaks ground on the ${BUILDING_TYPES[best].name}.`, 'bad');
      if (typeof chronicle === 'function') chronicle(`${f.name} began the ${BUILDING_TYPES[best].name}.`, f.id, 'minor');
      return true;
    },
  };
}

// ---------- art ----------
// 32x48 canvases (2 tiles wide, 3 tall), drawn in code in the tilesets' style:
// hard pixel edges, a three-step palette per material, light from the top-left.

const WSTONE = { hi: '#ece5d6', lit: '#d9d2c3', mid: '#b3a894', dim: '#8f8574', dark: '#6a6153', black: '#3a352e' };
const WGOLD = { hi: '#fff3b0', lit: '#ffd24a', mid: '#e0a82e', dark: '#9c6f1c' };
const WWOOD = { lit: '#c08a4e', mid: '#8f6436', dark: '#5c3f22' };
const WGREEN = { hi: '#8fd05a', lit: '#6fb04a', mid: '#4f8a33', dark: '#2f5a22' };
const WWATER = { lit: '#9fe0f0', mid: '#4ab0d9', dark: '#2a70a0' };

function bakeWonders(css) {
  const out = {};
  const dark = shade(css, -0.35), lit = shade(css, 0.25);
  const mk = draw => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 48;
    const g = c.getContext('2d');
    const px = (col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    draw(px);
    return c;
  };
  const steps = (px, y) => {                                  // a stepped stone plinth
    px(WSTONE.dark, 0, y + 4, 32, 4); px(WSTONE.mid, 1, y + 2, 30, 2); px(WSTONE.lit, 2, y, 28, 2);
    px(WSTONE.hi, 2, y, 28, 1); px(WSTONE.black, 0, y + 7, 32, 1);
  };
  const banner = (px, x, y, h = 6) => {
    px(WWOOD.dark, x, y, 1, h + 3); px(css, x + 1, y, 3, h - 2); px(lit, x + 1, y, 3, 1); px(dark, x + 1, y + h - 3, 3, 1);
  };

  out.greatlibrary = mk(px => {
    steps(px, 40);
    // colonnade
    px(WSTONE.dim, 3, 22, 26, 18);
    for (let x = 4; x < 29; x += 5) { px(WSTONE.hi, x, 22, 2, 18); px(WSTONE.lit, x + 2, 22, 1, 18); px(WSTONE.dark, x + 3, 23, 1, 17); }
    px(WSTONE.black, 14, 30, 4, 10); px('#5a3a1e', 14, 30, 4, 1);                   // door
    // entablature and pediment with the nation's colour
    px(WSTONE.lit, 1, 19, 30, 3); px(WSTONE.hi, 1, 19, 30, 1); px(WSTONE.dark, 1, 21, 30, 1);
    for (let i = 0; i < 9; i++) px(i < 8 ? WSTONE.lit : WSTONE.hi, 2 + i * 1.5 | 0, 18 - i, 28 - i * 3, 1);
    px(css, 9, 14, 14, 3); px(lit, 11, 14, 10, 1);
    // dome
    px(WGOLD.dark, 11, 5, 10, 5); px(WGOLD.mid, 12, 4, 8, 5); px(WGOLD.lit, 13, 3, 5, 4); px(WGOLD.hi, 14, 3, 2, 2);
    px(WGOLD.dark, 15, 0, 2, 3);
    // scroll racks glimpsed between the columns
    px('#efe4c4', 9, 26, 3, 1); px('#efe4c4', 19, 28, 3, 1); px('#efe4c4', 24, 25, 2, 1);
  });

  out.bazaar = mk(px => {
    steps(px, 42);
    // central minaret
    px(WSTONE.dim, 14, 6, 5, 36); px(WSTONE.lit, 14, 6, 2, 36);
    px(WGOLD.mid, 13, 3, 7, 4); px(WGOLD.lit, 14, 2, 4, 3); px(WGOLD.dark, 16, 0, 1, 3);
    px(WSTONE.black, 15, 12, 2, 3);
    // three striped awnings over stalls
    const tent = (x, y, w, c1, c2) => {
      for (let i = 0; i < w; i += 2) { px(c1, x + i, y, 1, 5); px(c2, x + i + 1, y, 1, 5); }
      px(shade(c1, -0.4), x, y + 5, w, 1);
      px(WWOOD.dark, x, y + 6, 1, 8); px(WWOOD.dark, x + w - 1, y + 6, 1, 8);
      px(WWOOD.mid, x + 1, y + 11, w - 2, 3); px(WWOOD.lit, x + 1, y + 11, w - 2, 1);
    };
    tent(1, 22, 12, css, '#f0e8d8');
    tent(20, 22, 12, '#c95a4a', '#f0e8d8');
    tent(8, 29, 16, '#4ab0a0', '#f0e8d8');
    // goods on the counters
    for (const [x, y, c] of [[3, 33, '#ffd24a'], [6, 33, '#c95a4a'], [9, 33, '#6fb04a'], [22, 33, '#e0a82e'], [26, 33, '#8a5acd'], [11, 40, '#ffd24a'], [15, 40, '#4ab0d9'], [19, 40, '#c95a4a']])
      px(c, x, y, 2, 1);
  });

  out.gardens = mk(px => {
    // three terraces of stone, each planted, water running down the middle
    const terrace = (x, y, w) => {
      px(WSTONE.dark, x, y + 6, w, 3); px(WSTONE.mid, x, y + 6, w, 1);
      px(WGREEN.mid, x, y, w, 6); px(WGREEN.lit, x, y, w, 2);
      for (let i = x + 1; i < x + w - 1; i += 4) {
        px(WGREEN.dark, i, y - 3, 3, 4); px(WGREEN.hi, i, y - 3, 2, 1);
        px('#e85a8a', i + 1, y - 2, 1, 1);
      }
    };
    terrace(0, 38, 32);
    terrace(4, 28, 24);
    terrace(8, 18, 16);
    px(WWATER.dark, 15, 12, 3, 30); px(WWATER.mid, 15, 12, 2, 30); px(WWATER.lit, 15, 12, 1, 30);
    // fountain on top
    px(WSTONE.lit, 12, 10, 9, 3); px(WWATER.lit, 13, 9, 7, 1); px(WWATER.lit, 16, 5, 1, 4); px('#ffffff', 16, 4, 1, 1);
    banner(px, 3, 20); banner(px, 27, 20);
  });

  out.cathedral = mk(px => {
    steps(px, 42);
    px(WSTONE.dim, 4, 16, 24, 26); px(WSTONE.lit, 4, 16, 3, 26);
    // twin spires
    for (const x of [2, 24]) {
      px(WSTONE.mid, x, 10, 6, 32); px(WSTONE.lit, x, 10, 2, 32);
      for (let i = 0; i < 9; i++) px(i % 2 ? WSTONE.dark : '#5a5f6a', x + (i >> 1) * 0.5 | 0, 9 - i, 6 - i * 0.6 | 0, 1);
      px('#5a5f6a', x + 2, 0, 2, 3); px(WGOLD.lit, x + 2, 0, 2, 1);
      px(WSTONE.black, x + 2, 16, 2, 4);
    }
    // gable and rose window of the nation's colour
    for (let i = 0; i < 8; i++) px(WSTONE.lit, 8 + i, 16 - i, 16 - i * 2, 1);
    px(WSTONE.dark, 11, 19, 10, 10);
    px(css, 12, 20, 8, 8); px(lit, 14, 21, 4, 2); px(WGOLD.lit, 15, 23, 2, 2); px(dark, 12, 27, 8, 1);
    px('#ffffff', 15, 20, 2, 1);
    // great door
    px(WSTONE.black, 13, 33, 6, 9); px('#5a3a1e', 14, 34, 4, 8); px(WGOLD.mid, 15, 37, 2, 1);
    px(WGOLD.lit, 15, 8, 2, 4); px(WGOLD.lit, 14, 9, 4, 1);   // cross over the gable
  });

  out.greatwall = mk(px => {
    // a gatehouse between two towers, the wall running out either side
    px(WSTONE.dim, 0, 28, 32, 16); px(WSTONE.lit, 0, 28, 32, 2);
    for (let x = 0; x < 32; x += 4) px(WSTONE.lit, x, 26, 2, 2);
    for (const x of [2, 22]) {
      px(WSTONE.mid, x, 10, 8, 34); px(WSTONE.lit, x, 10, 3, 34); px(WSTONE.dark, x + 7, 10, 1, 34);
      for (let i = 0; i < 8; i += 3) px(WSTONE.lit, x + i, 7, 2, 3);
      px(WSTONE.black, x + 3, 16, 2, 4); px(WSTONE.black, x + 3, 26, 2, 4);
      banner(px, x + 3, 0);
    }
    px(WSTONE.mid, 10, 18, 12, 26); px(WSTONE.lit, 10, 18, 12, 2);
    for (let x = 10; x < 22; x += 3) px(WSTONE.lit, x, 16, 2, 2);
    px(WSTONE.black, 12, 30, 8, 14); px(WWOOD.dark, 13, 31, 6, 13);
    for (let y = 32; y < 44; y += 3) px(WWOOD.mid, 13, y, 6, 1);                       // portcullis
    px(WSTONE.black, 0, 44, 32, 4); px(WSTONE.dark, 0, 43, 32, 1);
  });

  out.palace = mk(px => {
    steps(px, 42);
    px(WSTONE.lit, 1, 24, 30, 18); px(WSTONE.hi, 1, 24, 30, 1);
    for (let x = 3; x < 30; x += 4) { px(WSTONE.dim, x, 26, 1, 16); }
    for (let x = 4; x < 30; x += 8) { px(WSTONE.black, x, 30, 3, 5); px(WGOLD.mid, x, 30, 3, 1); }
    px(WSTONE.black, 14, 33, 4, 9); px(WGOLD.lit, 14, 33, 4, 1);
    px(css, 0, 21, 32, 3); px(lit, 0, 21, 32, 1);
    // three golden domes, the great one in the middle
    const dome = (cx, y, r) => {
      for (let i = 0; i <= r; i++) {
        const w = Math.round(Math.sqrt(r * r - (r - i) * (r - i)) * 2);
        px(i < r / 2 ? WGOLD.lit : WGOLD.mid, cx - w / 2 | 0, y + i, w, 1);
      }
      px(WGOLD.hi, cx - 2, y + 1, 2, 2);
      px(WGOLD.dark, cx, y - 4, 1, 4);
    };
    dome(16, 5, 9); dome(5, 13, 5); dome(27, 13, 5);
    px(css, 16, 0, 3, 2);
  });

  out.observatory = mk(px => {
    steps(px, 42);
    // round tower
    px(WSTONE.mid, 7, 16, 18, 26); px(WSTONE.lit, 7, 16, 5, 26); px(WSTONE.dark, 23, 16, 2, 26);
    for (let y = 20; y < 42; y += 6) px(WSTONE.dim, 7, y, 18, 1);
    px(WSTONE.black, 14, 34, 4, 8); px(WWOOD.dark, 14, 34, 4, 1);
    px(WSTONE.black, 10, 24, 2, 3); px(WSTONE.black, 20, 24, 2, 3);
    // the dome, split open, and the great telescope
    for (let i = 0; i < 9; i++) {
      const w = Math.round(Math.sqrt(81 - (9 - i) * (9 - i)) * 2.2);
      px(i < 4 ? '#8b93a0' : '#666e7a', 16 - w / 2 | 0, 7 + i, w, 1);
    }
    px(WSTONE.black, 15, 6, 3, 10);
    px(WGOLD.mid, 17, 3, 2, 8); px(WGOLD.lit, 18, 1, 3, 3); px(WGOLD.hi, 20, 1, 1, 1);
    px(css, 6, 15, 20, 1);
    // stars
    for (const [x, y] of [[2, 3], [27, 5], [5, 9], [29, 1], [24, 12]]) px('#fff3b0', x, y, 1, 1);
  });
  return out;
}
