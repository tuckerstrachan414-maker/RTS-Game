'use strict';
// The seasons. Two days (ten minutes) each, four to a year, so a two-hour
// match lives through three winters.
//
//   Spring  — the fields wake (+10% farms); people are glad of it (+2 happiness)
//   Summer  — the long days (+20% farms)
//   Autumn  — the harvest (+35% farms): the time to fill the granaries
//   Winter  — the fields sleep (−55% farms), people feel the cold (−3), an army
//             marching through foreign land slows, and one camped in enemy
//             territory wears down (attrition wounds but does not kill)
//
// Everything here is a pure function of `game.dayCount`, so it replays exactly
// and the AI may plan around it — the calendar is public knowledge.

const SEASON_DAYS = 2;
const SEASONS = [
  { key: 'spring', name: 'Spring', farm: 1.10, happy: 2 },
  { key: 'summer', name: 'Summer', farm: 1.20, happy: 0 },
  { key: 'autumn', name: 'Autumn', farm: 1.35, happy: 0 },
  { key: 'winter', name: 'Winter', farm: 0.45, happy: -3 },
];
// Winter attrition: fraction of max HP per second for a soldier inside a
// hostile nation's claim.
const WINTER_ATTRITION = 0.0015;
const WINTER_MARCH = 0.88;

function seasonIndex() {
  if (typeof game === 'undefined' || !game) return 0;
  return Math.floor((game.dayCount - 1) / SEASON_DAYS) % 4;
}
function season() { return SEASONS[seasonIndex()]; }
function isWinter() { return seasonIndex() === 3; }
function yearOf() { return typeof game !== 'undefined' && game ? Math.floor((game.dayCount - 1) / (SEASON_DAYS * 4)) + 1 : 1; }
// Seconds until the next season turns.
function secondsToNextSeason() {
  const dayInSeason = (game.dayCount - 1) % SEASON_DAYS;
  const intoDay = game.time % DAY_NIGHT_CYCLE;
  return (SEASON_DAYS - dayInSeason) * DAY_NIGHT_CYCLE - intoDay;
}

function seasonFarmMul() { return season().farm; }
function seasonHappiness() { return season().happy; }

// Marching through foreign land in winter is slow going.
function seasonSpeedMul(u) {
  if (!isWinter() || u.type.naval || u.type.civilian) return 1;
  const t = game.territory;
  if (!t) return 1;
  return t.controls(u.faction, u.tileX, u.tileY) ? 1 : WINTER_MARCH;
}

// Winter attrition for a soldier inside a hostile nation's claim.
function attritionRate(u) {
  if (!isWinter()) return 0;
  const t = game.territory;
  if (!t) return 0;
  const own = t.ownerAt(u.tileX, u.tileY);
  if (own < 0 || own === u.faction || !game.diplomacy.hostile(own, u.faction)) return 0;
  return WINTER_ATTRITION;
}

// Called at dawn: announce a turning season to the player.
let lastSeasonAnnounced = -1;
function onNewDaySeason() {
  const idx = seasonIndex();
  const stamp = (game.dayCount - 1) / SEASON_DAYS;
  if (stamp !== Math.floor(stamp) || stamp === lastSeasonAnnounced) return;
  lastSeasonAnnounced = stamp;
  const s = SEASONS[idx];
  const lines = {
    spring: 'Spring comes: the fields wake and the people take heart.',
    summer: 'Summer: long days and full fields.',
    autumn: 'Autumn: the harvest is in — fill the granaries before winter.',
    winter: 'Winter falls: the fields sleep, and any army in enemy land will suffer.',
  };
  game.log(`${s.name} of Year ${yearOf()}. ${lines[s.key]}`, s.key === 'winter' ? 'bad' : 'good');
  if (s.key === 'winter' || s.key === 'spring') {
    if (typeof ui !== 'undefined' && ui) ui.announce(`${s.name}, Year ${yearOf()}`, lines[s.key], s.key === 'winter' ? 'bad' : '');
  }
}

// How much food a nation should hold going into winter: the AI's granary target.
function winterFoodReserve(f) {
  const idx = seasonIndex();
  if (idx !== 2 && idx !== 3) return 0;
  const n = f.nation;
  const eat = n.pop * EAT_RATE + (typeof armyUpkeep === 'function' ? armyUpkeep(f).food : 0);
  return eat * SEASON_DAYS * DAY_NIGHT_CYCLE * 0.5;
}

// ---------- climate ----------
// The seasons do not fall the same everywhere. A tile is hot, temperate or cold
// by the generator's temperature field: the tropics never see snow — their
// winter is a dry season, and its weather falls as rain — and the far north is
// under snow from autumn. Used by the weather below and by the renderer's
// seasonal art (js/fx.js).
const CLIMATE_HOT = 0, CLIMATE_TEMPERATE = 1, CLIMATE_COLD = 2;
const CLIMATE_BLUR = 6;          // tiles: climates come in regions, not specks
const CLIMATE_SHADES = 8;        // steps of the renderer's gradient, 0 (hot) .. 8 (cold)
function climateAt(x, y) {
  const map = game.map;
  if (!map.climate) classifyClimate(map);
  if (!map.inBounds(x, y)) return CLIMATE_TEMPERATE;
  return map.climate[map.idx(x, y)];
}
// The same reading as a continuous shade, for the renderer: 0 is fully hot,
// 4 fully temperate, 8 fully cold, and the steps between are the bands where
// one climate gives way to the next (js/fx.js blends the art across them).
function climateShadeAt(x, y) {
  const map = game.map;
  if (!map.climate) classifyClimate(map);
  if (!map.inBounds(x, y)) return CLIMATE_SHADES / 2;
  return map.climateShade[map.idx(x, y)];
}

// Built once per map, onto `map.climate` (hot/temperate/cold, what the weather
// asks) and `map.climateShade` (0..8, what the renderer paints). The
// temperature field is box-blurred first — the raw field carries enough noise
// that a few cool tiles inside a savanna made a snowy rectangle in the dry
// season — and the shade ramps across a band either side of each threshold, so
// a snowline thins out over several tiles instead of stopping at a tile edge.
function classifyClimate(map) {
  const W = MAP_W, H = MAP_H, R = CLIMATE_BLUR;
  const row = new Float32Array(W * H);
  map.climate = new Uint8Array(W * H);
  map.climateShade = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {           // horizontal pass, wrapping east-west
    let sum = 0;
    for (let dx = -R; dx <= R; dx++) sum += map.temp[y * W + ((dx % W) + W) % W];
    for (let x = 0; x < W; x++) {
      row[y * W + x] = sum / (2 * R + 1);
      sum += map.temp[y * W + (x + R + 1) % W] - map.temp[y * W + ((x - R) % W + W) % W];
    }
  }
  // coldness 0 (hot) .. 2 (cold): flat inside each climate, ramped across the
  // bands [0.66, 0.78] (hot/temperate) and [0.24, 0.36] (temperate/cold)
  const coldness = t => t >= 0.78 ? 0 : t >= 0.66 ? (0.78 - t) / 0.12
    : t >= 0.36 ? 1 : t >= 0.24 ? 1 + (0.36 - t) / 0.12 : 2;
  for (let x = 0; x < W; x++) {           // vertical pass, clamped at the poles
    for (let y = 0; y < H; y++) {
      let sum = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        sum += row[yy * W + x]; n++;
      }
      const c = coldness(sum / n);
      const i = y * W + x;
      map.climate[i] = c < 0.5 ? CLIMATE_HOT : c > 1.5 ? CLIMATE_COLD : CLIMATE_TEMPERATE;
      // a half-step of fixed per-tile jitter breaks the gradient's staircase
      // into texture — neighbouring shades differ too little to read as blocks
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const jitter = (((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5) * 1.1;
      const shade = Math.round(c * CLIMATE_SHADES / 2 + (c > 0 && c < 2 && c !== 1 ? jitter : 0));
      map.climateShade[i] = Math.max(0, Math.min(CLIMATE_SHADES, shade));
    }
  }
}

// ---------- weather ----------
// Each half-day (daylight, then night) has its weather: a pure function of the
// match seed, the day and the season — never `game.rng` — so a match replays
// exactly and the weather is as public as the sky. It matters, a little:
//
//   Rain   — wet bowstrings: arrows and bolts hit 15% softer
//   Storm  — arrows 25% softer, and ships sail 20% slower
//   Snow   — troops march 10% slower
//   Fog    — every lookout sees 40% less far (the AI's eyes included)
//
// Where a tile's climate cannot hold the day's weather it changes kind: snow
// falls as rain in the tropics, and rain as snow on cold ground in the colder
// half of the year.
const WEATHER = {
  clear: { key: 'clear', name: 'Clear', desc: 'Fair weather.' },
  rain:  { key: 'rain', name: 'Rain', desc: 'Wet bowstrings: arrows and bolts hit 15% softer.', pierce: 0.85 },
  storm: { key: 'storm', name: 'Storm', desc: 'Arrows and bolts hit 25% softer; ships sail 20% slower.', pierce: 0.75, ship: 0.8 },
  snow:  { key: 'snow', name: 'Snow', desc: 'Troops march 10% slower.', march: 0.9 },
  fog:   { key: 'fog', name: 'Fog', desc: 'Lookouts see 40% less far.', sight: 0.6 },
};
// Per season, cumulative odds of each kind; whatever is left is clear.
const WEATHER_ODDS = [
  [['rain', 0.30], ['fog', 0.40], ['storm', 0.45]],     // spring
  [['storm', 0.10], ['rain', 0.20]],                    // summer
  [['rain', 0.28], ['fog', 0.48], ['storm', 0.54]],     // autumn
  [['snow', 0.55], ['fog', 0.70]],                      // winter
];

// The day's weather over the world as a whole.
function weatherNow() {
  if (typeof game === 'undefined' || !game) return WEATHER.clear;
  const stamp = game.dayCount * 2 + (game.isDay ? 0 : 1);
  if (game.weatherStamp !== stamp) {
    game.weatherStamp = stamp;
    const roll = mulberry32(((game.seed | 0) ^ Math.imul(stamp, 0x9e3779b1)) >>> 0)();
    let kind = 'clear';
    for (const [k, p] of WEATHER_ODDS[seasonIndex()]) if (roll < p) { kind = k; break; }
    game.weather = WEATHER[kind];
  }
  return game.weather;
}

// The weather as it falls on one tile, after its climate has had its say.
function weatherAt(x, y) {
  const w = weatherNow();
  if (w.key !== 'snow' && w.key !== 'rain') return w;
  const c = climateAt(Math.floor(x), Math.floor(y));
  if (w.key === 'snow' && c === CLIMATE_HOT) return WEATHER.rain;
  if (w.key === 'rain' && c === CLIMATE_COLD && seasonIndex() !== 1) return WEATHER.snow;
  return w;
}

// The modifiers, each asked where the unit (or tower) stands.
function weatherSpeedMul(u) {
  if (u.type.civilian) return 1;
  const w = weatherAt(u.x, u.y);
  if (u.type.naval) return w.ship || 1;
  return w.march || 1;
}
function weatherPierceMul(attacker) {
  const x = attacker.cx !== undefined ? attacker.cx : attacker.x;
  const y = attacker.cy !== undefined ? attacker.cy : attacker.y;
  return weatherAt(x, y).pierce || 1;
}
function weatherSightMul(x, y) { return weatherAt(x, y).sight || 1; }

