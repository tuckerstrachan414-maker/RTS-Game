'use strict';
// The planet: how big it is, whether it wraps, and what a biome is.
//
// This file exists because the map stopped being a fixed 96x96 rectangle. A
// world is now a *configuration* — size, sea level, how many continents to aim
// for, how wet and how mountainous it should be — chosen before the map is
// generated. `configureWorld` is the one place that decides it, and the eventual
// world-creator screen is meant to be a form over `WORLD_PRESETS` and the
// per-knob overrides below, not a second generator.
//
// MAP_W and MAP_H are `let`, not `const`, and every consumer reads them at call
// time. Nothing may cache them at script-load time — `configureWorld` runs after
// the scripts are parsed and before `new Game()`.

let MAP_W = 384, MAP_H = 192;

// East-west wrap. The world is a cylinder: walk west far enough and you arrive
// from the east. North and south are the poles — capped with ice and ocean, and
// hard bounds for movement, which is what a globe actually looks like to
// something walking on it. `wrapX` folds an x back into range; y never wraps.
let WORLD_WRAP = true;

const WORLD_PRESETS = {
  // The old map, kept playable and honest about what it is: one landmass, four
  // nations elbow to elbow, no wrap. Fastest to generate and the only preset
  // where the whole world fits on one screen.
  duel: {
    label: 'Duel Island', w: 96, h: 96, wrap: false, continents: 1,
    seaLevel: 0.34, riverDensity: 0.4, plateauDensity: 1, oneContinent: true,
    desc: 'The original close-quarters map. One island, four neighbours, nowhere to hide.',
  },
  small: {
    label: 'Small World', w: 256, h: 128, wrap: true, continents: 3,
    seaLevel: 0.44, riverDensity: 0.8, plateauDensity: 1,
    desc: 'A compact planet. Continents are close enough that a fleet crosses in good time.',
  },
  standard: {
    label: 'Standard World', w: 384, h: 192, wrap: true, continents: 4,
    seaLevel: 0.47, riverDensity: 1, plateauDensity: 1,
    desc: 'Four continents, real oceans, rivers to the sea. The default planet.',
  },
  large: {
    label: 'Large World', w: 768, h: 384, wrap: true, continents: 5,
    seaLevel: 0.49, riverDensity: 1.2, plateauDensity: 1.1,
    desc: 'Room to lose an army in. Long voyages, deep interiors, distant neighbours.',
  },
  planet: {
    label: 'Planet', w: 1024, h: 512, wrap: true, continents: 6,
    seaLevel: 0.5, riverDensity: 1.3, plateauDensity: 1.2,
    desc: 'Full planetary scale. Expect long marches and longer crossings.',
  },
};

// The live world configuration. Read by the generator, the globe renderer and
// (later) the world creator. Replaced wholesale by `configureWorld`.
let WORLD = null;

// Build the world configuration and publish its size to the globals the rest of
// the game reads. `opts` may name a preset and override any individual knob, so
// a creator screen can offer "Large World, but drier" without a new preset.
function configureWorld(opts = {}) {
  const base = WORLD_PRESETS[opts.preset] || WORLD_PRESETS.standard;
  const w = clampInt(opts.w, base.w, 64, 2048);
  const h = clampInt(opts.h, base.h, 64, 1024);
  WORLD = {
    preset: WORLD_PRESETS[opts.preset] ? opts.preset : 'standard',
    label: base.label,
    w, h,
    wrap: opts.wrap === undefined ? base.wrap : !!opts.wrap,
    // Fraction of the height taken by the ice caps at each pole. Scaled by the
    // world's own aspect: a tall world has more room for climate bands.
    polar: clampNum(opts.polar, 0.1, 0, 0.4),
    // Height the land has to clear to be dry. Higher = more ocean.
    seaLevel: clampNum(opts.seaLevel, base.seaLevel, 0.25, 0.75),
    // How many big landmasses the generator aims for. It is a target, not a
    // guarantee — plates merge and split — but it sets the plate count.
    continents: clampInt(opts.continents, base.continents, 1, 12),
    riverDensity: clampNum(opts.riverDensity, base.riverDensity, 0, 3),
    plateauDensity: clampNum(opts.plateauDensity, base.plateauDensity, 0, 3),
    // Suppresses the multi-continent split entirely (Duel Island): every nation
    // is guaranteed to share one walkable landmass.
    oneContinent: opts.oneContinent === undefined ? !!base.oneContinent : !!opts.oneContinent,
    desc: base.desc,
  };
  MAP_W = WORLD.w; MAP_H = WORLD.h; WORLD_WRAP = WORLD.wrap;
  return WORLD;
}

function clampInt(v, dflt, lo, hi) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
function clampNum(v, dflt, lo, hi) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

// Read a world out of the URL. `?world=large` picks a preset; `?mapw=&maph=`
// and the other knobs override it. This is the seam the creator screen replaces:
// it will hand `configureWorld` the same object shape from a form instead.
function worldFromQuery(params) {
  return configureWorld({
    preset: params.get('world'),
    w: params.get('mapw'), h: params.get('maph'),
    wrap: params.has('wrap') ? params.get('wrap') !== '0' : undefined,
    seaLevel: params.get('sea'),
    continents: params.get('continents'),
    riverDensity: params.get('rivers'),
  });
}

// ---------- wrapped coordinates ----------
// Everything that steps across a tile boundary, measures a distance or indexes
// the terrain has to go through these when the world wraps. The rule: an x is
// only ever *stored* in [0, MAP_W); it is folded back the moment it is used.

function wrapX(x) {
  if (!WORLD_WRAP) return x;
  const w = MAP_W;
  // Neighbour steps are the overwhelming majority of calls, so handle ±1 (and
  // any single overshoot) with a branch and keep the modulo for the rare jump.
  if (x >= 0 && x < w) return x;
  if (x < 0 && x >= -w) return x + w;
  if (x >= w && x < 2 * w) return x - w;
  return ((x % w) + w) % w;
}

// b - a, taking the short way round the world. Works for fractional positions.
function wdx(a, b) {
  let d = b - a;
  if (!WORLD_WRAP) return d;
  const w = MAP_W;
  if (d > w / 2) d -= w;
  else if (d < -w / 2) d += w;
  return d;
}

// Straight-line distance between two world positions, the short way round.
function wdist(ax, ay, bx, by) {
  const dx = wdx(ax, bx), dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

// Squared version, for the many places that only compare distances.
function wdist2(ax, ay, bx, by) {
  const dx = wdx(ax, bx), dy = by - ay;
  return dx * dx + dy * dy;
}

// Manhattan distance, the short way round — the A* heuristic and every
// "how far is that, roughly" check in the AI.
function wmanhattan(ax, ay, bx, by) {
  return Math.abs(wdx(ax, bx)) + Math.abs(by - ay);
}

// ---------- biomes ----------
// A biome is climate made concrete: what grows there, how hard it is to cross,
// and what colour it is from orbit. The classifier below reads three per-tile
// fields the generator computes (`map.temp`, `map.moist`, `map.elev`) and picks
// one row of this table; the row is stored in `map.biome`.
//
// Groundwork note: every biome in this table is generated and classified today,
// and each one tints its ground and steers how densely the generator plants
// trees and rocks. What is deliberately NOT here yet is per-biome ART — desert
// dunes, jungle canopy, snow — so a desert is sand-toned grassland rather than a
// different-looking place. Adding a biome later should mean adding a row here
// and an art hook in `js/assets.js`, not touching the generator.

const BIOME_IDS = {};
const BIOMES = [
  // key          name              tint            wash  tree  rock  desc
  ['ocean',       'Ocean',          [26, 74, 128],  0,    0,    0],
  ['coast',       'Coastal Waters', [58, 134, 168], 0,    0,    0],
  ['beach',       'Beach',          [214, 194, 132], 0,    0,    0.02],
  ['grassland',   'Grassland',      [126, 176, 78], 0,    0.5,  0.7],
  ['forest',      'Woodland',       [74, 136, 62],  0.16, 1.7,  0.6],
  ['rainforest',  'Rainforest',     [46, 128, 60],  0.3,  2.2,  0.3],
  ['savanna',     'Savanna',        [186, 176, 88], 0.28, 0.35, 0.8],
  ['desert',      'Desert',         [222, 202, 140], 0.5, 0.05, 1.0],
  ['steppe',      'Steppe',         [166, 172, 104], 0.24, 0.2, 0.9],
  ['taiga',       'Taiga',          [92, 132, 106],  0.26, 1.5, 0.8],
  ['tundra',      'Tundra',         [156, 168, 152], 0.34, 0.15, 1.0],
  ['ice',         'Ice Cap',        [226, 236, 244], 0.62, 0,   0.3],
  ['alpine',      'Highlands',      [136, 140, 120], 0.3,  0.5, 1.6],
  ['wetland',     'Wetland',        [104, 148, 96],  0.2,  1.0, 0.2],
].map(([key, name, tint, wash, tree, rock], id) => {
  BIOME_IDS[key] = id;
  return {
    id, key, name, tint, wash, tree, rock,
    css: `rgb(${tint[0]},${tint[1]},${tint[2]})`,
    // The tint as a translucent fill, ready for the renderer to lay over the
    // ground coat. Precomputed because it is used once per visible tile.
    washCss: `rgba(${tint[0]},${tint[1]},${tint[2]},${wash})`,
  };
});

// Land biomes only — water tiles take `ocean`/`coast` straight from the depth
// field, so the classifier never has to think about them.
// `t` is temperature 0..1 (0 polar, 1 equatorial), `m` is moisture 0..1,
// `e` is elevation above sea level 0..1.
function classifyBiome(t, m, e) {
  if (t < 0.12) return BIOME_IDS.ice;
  if (e > 0.78) return BIOME_IDS.alpine;
  if (t < 0.24) return BIOME_IDS.tundra;
  if (t < 0.42) return m > 0.42 ? BIOME_IDS.taiga : BIOME_IDS.steppe;
  if (m < 0.2) return t > 0.66 ? BIOME_IDS.desert : BIOME_IDS.steppe;
  if (m < 0.38) return t > 0.62 ? BIOME_IDS.savanna : BIOME_IDS.grassland;
  if (m > 0.82) return BIOME_IDS.wetland;
  if (m > 0.62) return t > 0.68 ? BIOME_IDS.rainforest : BIOME_IDS.forest;
  return t > 0.72 ? BIOME_IDS.savanna : BIOME_IDS.grassland;
}
