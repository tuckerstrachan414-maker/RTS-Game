'use strict';
// Procedural world generation, terrain queries, water autotiling.
//
// The world is a cylinder (see js/world.js): x wraps, y does not, and the poles
// are ice. Generation runs as a pipeline — tectonics, sea, depth, rivers,
// climate, biomes, vegetation, plateaus, then the nations' homelands — and each
// stage writes a layer the next one reads. The climate layers (`temp`, `moist`,
// `elev`) and `biome` are kept on the map after generation because they are the
// groundwork biomes proper will be built on: adding a biome should mean adding a
// row to BIOMES and reading these fields, not rewriting any of this.

const T_GRASS = 0, T_WATER = 1, T_TREE = 2, T_ROCK = 3, T_CAVE = 4;
// Raised ground. A plateau is a mass of high tiles ringed by T_CLIFF — a rock
// face nothing can climb — with a T_RAMP stair or two cut into its south side.
// The top itself stays ordinary terrain (grass, and whatever trees and boulders
// the generator already put there) flagged in `high`, so it builds, harvests and
// fights exactly like low ground; what makes a plateau matter is that the only
// ways onto it are the ramps, which turns every mesa into a chokepoint.
const T_CLIFF = 5, T_RAMP = 6;
// Beach. Ordinary walkable ground that happens to be sand: it is what every
// coastline is made of now, so water never touches grass directly and the
// shoreline art has one job instead of two. Also the ground a Dock stands on.
const T_SAND = 7;
// Rough ground. Forest and boulder fields are crossable — troops push through
// the undergrowth and scramble over the stones — but it costs them. These are
// multipliers on how long a tile takes to cross: they divide unit speed
// (js/units.js followPath) and multiply the A* step cost (findPath below), so
// the pathfinder routes around a wood when open ground is only a little longer
// and cuts straight through when it isn't.
const TREE_MOVE_COST = 2.4;
const ROCK_MOVE_COST = 1.9;
// Loose sand is a little slower than turf. Small enough that it never makes the
// pathfinder walk into the sea to avoid a beach.
const SAND_MOVE_COST = 1.15;
// Climbing a stair is slower than walking round its foot. Kept modest: a ramp is
// meant to be a chokepoint worth holding, not a detour the pathfinder refuses.
const RAMP_MOVE_COST = 1.7;
// Plateau generation. PLATEAU_LEVEL is the height the noise has to clear for land
// to rise; the two minimums throw away masses too small to be worth a rim (and
// too small to have any usable ground on top once the rim is taken out of them);
// PLATEAU_START_CLEAR keeps cliffs off every nation's doorstep.
const PLATEAU_LEVEL = 0.63;
const MIN_PLATEAU = 26;
const MIN_PLATEAU_TOP = 8;
const PLATEAU_START_CLEAR = 12;
// How far from land the sea has to get before it reads as open ocean rather than
// coastal water. Drives the darker deep-water art, the globe's colouring, and
// (later) anything that cares about blue-water sailing.
const DEEP_WATER_DIST = 5;
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// A ramp can be cut into any of a plateau's four sides, not just the south one
// the tileset happened to draw. `d` is the step from the ramp tile toward the
// plateau top (the direction a unit climbs); `p` is the perpendicular step
// used to find the jamb tiles that close the gap either side of the stair
// (they sit at ramp ± p). `rot` is how many 90-degree clockwise turns the
// tileset's native south-rim art (rot 0: cut into the south rim, climbs north)
// needs to face this way — see AT.RAMP_* in js/assets.js and the note in
// tools/splice-cliffs.py for how those rotated tiles were baked.
const RAMP_DIRS = [
  { d: [0, -1], p: [1, 0], rot: 0 },   // south rim, climbs north (tileset's native art)
  { d: [1, 0], p: [0, 1], rot: 1 },    // west rim, climbs east
  { d: [0, 1], p: [-1, 0], rot: 2 },   // north rim, climbs south
  { d: [-1, 0], p: [0, -1], rot: 3 },  // east rim, climbs west
];
// Walkable tiles a nation must be able to reach from its start. On a world of
// continents this is the test for "is this landmass a country or a rock?" — a
// start zone whose island is smaller than this gets a track cut to real country.
const MIN_START_REGION = 500;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Smooth value noise built from a random grid.
//
// On a wrapping world the x grid has to close on itself or the seam shows as a
// straight north-south cliff of mismatched terrain running the height of the
// planet. The cell count is chosen so the grid divides MAP_W exactly and the
// lookup wraps modulo that count, which makes the field genuinely periodic in x
// rather than merely continuous.
function makeNoise(rng, gridSize) {
  const cells = Math.max(2, Math.round(MAP_W / gridSize));
  const gsx = MAP_W / cells;                     // exact divisor: the wrap is seamless
  const gw = WORLD_WRAP ? cells : cells + 2;
  const gh = Math.ceil(MAP_H / gridSize) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const lerp = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
  const cx = WORLD_WRAP ? xx => ((xx % gw) + gw) % gw : xx => Math.max(0, Math.min(gw - 1, xx));
  const cy = yy => Math.max(0, Math.min(gh - 1, yy));
  return (x, y) => {
    const gx = x / gsx, gy = y / gridSize;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const a = cx(x0), b = cx(x0 + 1), c = cy(y0), d = cy(y0 + 1);
    return lerp(lerp(g[c * gw + a], g[c * gw + b], fx), lerp(g[d * gw + a], g[d * gw + b], fx), fy);
  };
}

// Several octaves of the above, halving the wavelength and the weight each time.
// One octave of value noise makes rolling hills; four make coastlines with bays
// and headlands in them.
function makeFbm(rng, gridSize, octaves = 4, gain = 0.5) {
  const layers = [];
  let amp = 1, size = gridSize, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: makeNoise(rng, Math.max(2, size)), amp });
    total += amp; amp *= gain; size /= 2;
  }
  return (x, y) => {
    let v = 0;
    for (const l of layers) v += l.n(x, y) * l.amp;
    return v / total;
  };
}

class GameMap {
  constructor(seed) {
    this.w = MAP_W; this.h = MAP_H;
    const N = MAP_W * MAP_H;
    this.terrain = new Uint8Array(N);
    this.decor = new Int8Array(N).fill(-1);       // variant index for trees/rocks/grass
    this.high = new Uint8Array(N);                // 1 = walkable plateau top (see T_CLIFF)
    this.rampDir = new Uint8Array(N).fill(255);   // index into RAMP_DIRS for T_RAMP tiles
    this.bridge = new Uint8Array(N);              // 1=horizontal 2=vertical
    this.bridgeAt = new Array(N).fill(null);      // Building ref per bridge tile (bridges aren't in buildingAt)
    this.road = new Uint8Array(N);                // trade-route path marker
    this.buildingAt = new Array(N).fill(null);
    this.treeWood = new Float32Array(N);          // remaining wood in tree tiles
    // ---- world layers. Written once by generate(), read forever after. ----
    this.elev = new Float32Array(N);              // 0..1 raw height; sea level is WORLD.seaLevel
    this.temp = new Float32Array(N);              // 0 polar .. 1 equatorial
    this.moist = new Float32Array(N);             // 0 arid .. 1 saturated
    this.biome = new Uint8Array(N);               // index into BIOMES (js/world.js)
    this.depth = new Uint8Array(N);               // water: tiles from the nearest land (255 = far)
    this.continent = new Int16Array(N).fill(-1);  // land component id, -1 for water
    this.continentSize = [];                      // tiles per continent id
    this.startZones = [];
    this.generate(seed);
  }

  // x wraps around the world; y never does. Callers may hand this a neighbour
  // one step off the edge and get the tile on the far side, which is what makes
  // every "for each of my four neighbours" loop in the game wrap for free.
  idx(x, y) { return y * this.w + wrapX(x); }
  inBounds(x, y) {
    if (y < 0 || y >= this.h) return false;
    return WORLD_WRAP || (x >= 0 && x < this.w);
  }
  t(x, y) { return this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : T_WATER; }
  // Water for every purpose that is not autotiling: sea, lake and river alike.
  isWater(x, y) { return this.t(x, y) === T_WATER; }
  // Open sea rather than a shoreline — see DEEP_WATER_DIST.
  isDeep(x, y) { return this.inBounds(x, y) && this.depth[this.idx(x, y)] >= DEEP_WATER_DIST; }
  biomeAt(x, y) { return BIOMES[this.biome[this.idx(x, y)]]; }
  continentAt(x, y) { return this.inBounds(x, y) ? this.continent[this.idx(x, y)] : -1; }

  // ---------- generation pipeline ----------
  generate(seed) {
    const rng = mulberry32(seed);
    this.buildElevation(rng);
    this.floodOceans();
    this.measureDepth();
    this.carveRivers(rng);
    this.buildClimate(rng);
    this.layBeaches(rng);
    this.classifyBiomes();
    this.plantVegetation(rng);
    // Raise the plateaus before anything else is placed on the map: they overwrite
    // whatever the noise put on their rim, and the passes below want to see the
    // finished cliffs so caves do not land in a rock face and the connectivity
    // guarantees are made against terrain nobody can climb.
    const zones = this.chooseHomelands(rng);
    this.generatePlateaus(rng, zones);
    this.digCaves(rng);
    this.provisionHomelands(rng, zones);
    // Everything above can put fresh grass against water: a capital's clearing
    // stamped on the shore, a corridor carved through a lake. Sand between the
    // two is an invariant the renderer relies on (the water art's only shoreline
    // is a sand lip), so the coastline is re-touched once, last.
    this.retouchShores();
    // Recount the continents: plateaus, caves and the homeland clearings all
    // moved walkable ground about, and the naval AI asks this layer whether a
    // target can be reached on foot.
    this.labelContinents();
  }

  // ---- tectonics -------------------------------------------------------
  // Continents come from a handful of plates rather than straight from noise:
  // thresholded noise alone gives a spatter of islands of every size, which is
  // fine for a lake but does not read as a world map. Each plate is a soft blob;
  // the fractal noise then eats bays into it and throws islands off its coast.
  buildElevation(rng) {
    const cont = makeFbm(rng, Math.max(24, MAP_W / 10), 4);
    const detail = makeFbm(rng, Math.max(8, MAP_W / 40), 4);
    const ridge = makeFbm(rng, Math.max(14, MAP_W / 22), 3);
    const plates = this.seedPlates(rng);
    const polar = WORLD.polar;
    for (let y = 0; y < this.h; y++) {
      // Latitude 0 at the equator, 1 at either pole. The caps are pulled under
      // water so no continent runs off the top of the world, which would look
      // wrong the moment the globe is drawn.
      const lat = Math.abs(y / (this.h - 1) - 0.5) * 2;
      const capBite = Math.max(0, (lat - (1 - polar * 1.6)) / Math.max(0.05, polar * 1.6));
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const mass = this.plateField(plates, x, y);
        // The plate sets where land is; the noise decides what its edge looks
        // like. Weighting mass more heavily than noise is what keeps a continent
        // one continent instead of an archipelago.
        let e = mass * 0.62 + cont(x, y) * 0.3 + detail(x, y) * 0.12;
        // A ridge line through the middle of each mass: high interiors give the
        // rivers somewhere to start and the plateaus somewhere to stand.
        e += Math.max(0, mass - 0.45) * ridge(x, y) * 0.5;
        e -= capBite * capBite * 0.55;
        this.elev[i] = Math.max(0, Math.min(1, e));
      }
    }
  }

  // Plate centres, spread out by rejection sampling so two continents do not
  // land on top of each other. Radii are a fraction of the world's short axis,
  // and the poles are excluded — a continent centred on the ice cap is a
  // continent nobody can use.
  seedPlates(rng) {
    const n = WORLD.continents;
    const short = Math.min(this.w, this.h);
    const plates = [];
    const minSep = (WORLD.oneContinent ? 0 : short * 0.55);
    for (let tries = 0; plates.length < n && tries < 600; tries++) {
      const x = rng() * this.w;
      const y = this.h * (0.16 + rng() * 0.68);
      if (plates.some(p => wdist(x, y, p.x, p.y) < minSep)) continue;
      plates.push({
        x, y,
        rx: short * (0.3 + rng() * 0.22) * (WORLD.oneContinent ? 1.6 : 1),
        ry: short * (0.24 + rng() * 0.2) * (WORLD.oneContinent ? 1.6 : 1),
        // Each plate leans a different way, so continents are not all ovals.
        skew: (rng() - 0.5) * 0.8,
      });
    }
    return plates;
  }

  // How much land this plate set wants at (x, y): the strongest plate wins, so
  // two plates that do overlap merge into one bigger mass rather than summing
  // into a mountain range in the middle of the sea.
  plateField(plates, x, y) {
    let best = 0;
    for (const p of plates) {
      const dx = wdx(p.x, x), dy = y - p.y;
      const sx = dx + dy * p.skew;
      const d = Math.sqrt((sx / p.rx) * (sx / p.rx) + (dy / p.ry) * (dy / p.ry));
      if (d >= 1) continue;
      // smoothstep from the rim inward: a hard edge here would show through the
      // noise as a visible circle of coastline.
      const v = 1 - d;
      const s = v * v * (3 - 2 * v);
      if (s > best) best = s;
    }
    return best;
  }

  // Everything below sea level becomes water; everything above it starts as
  // grass and gets dressed later.
  floodOceans() {
    const sea = WORLD.seaLevel;
    for (let i = 0; i < this.terrain.length; i++) {
      this.terrain[i] = this.elev[i] < sea ? T_WATER : T_GRASS;
    }
  }

  // Distance (in tiles) from every water tile to the nearest land, by BFS from
  // the whole coastline at once. Drives the deep-water art, the ocean/coast
  // biome split, the moisture field and where beaches go.
  measureDepth() {
    const N = this.terrain.length;
    this.depth.fill(0);
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (this.terrain[i] === T_WATER) continue;
      seen[i] = 1;                       // land: distance 0, and a BFS source
      q[tail++] = i;
    }
    while (head < tail) {
      const i = q[head++];
      const x = i % this.w, y = (i / this.w) | 0;
      const d = this.depth[i];
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (seen[j] || this.terrain[j] !== T_WATER) continue;
        seen[j] = 1;
        this.depth[j] = Math.min(255, d + 1);
        q[tail++] = j;
      }
    }
  }

  // ---- rivers ----------------------------------------------------------
  // A river is a walk downhill. Sources are picked on high ground; each one
  // follows the steepest descent to the sea, and when it walks into a hollow it
  // floods the hollow rather than stopping — which is how lakes get made. A
  // river that never reaches the sea is rolled back, because a watercourse that
  // simply stops in a field looks like a bug.
  carveRivers(rng) {
    const sea = WORLD.seaLevel;
    const land = this.countLand();
    const target = Math.round(land / 1400 * WORLD.riverDensity);
    let made = 0;
    for (let tries = 0; tries < target * 40 && made < target; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] === T_WATER) continue;
      if (this.elev[i] < sea + 0.14) continue;      // sources belong in the hills
      if (this.traceRiver(rng, x, y)) made++;
    }
    if (made) this.measureDepth();                 // new water: coastlines moved
  }

  countLand() {
    let n = 0;
    for (let i = 0; i < this.terrain.length; i++) if (this.terrain[i] !== T_WATER) n++;
    return n;
  }

  traceRiver(rng, sx, sy) {
    const maxLen = Math.round(Math.max(this.w, this.h) * 0.7);
    const path = [];
    const onPath = new Set();
    let x = sx, y = sy;
    let reachedSea = false;
    for (let step = 0; step < maxLen; step++) {
      const i = this.idx(x, y);
      if (this.terrain[i] === T_WATER) { reachedSea = this.depth[i] === 0 || step > 0; break; }
      path.push(i); onPath.add(i);
      // steepest descent, with a little noise so rivers meander instead of
      // running dead straight down the gradient
      let bx = -1, by = -1, bv = this.elev[i];
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (onPath.has(j)) continue;
        const v = this.elev[j] + (rng() - 0.5) * 0.01;
        if (v < bv) { bv = v; bx = nx; by = ny; }
      }
      if (bx < 0) {
        // A hollow. Raise the water table: flood this tile and step to the
        // lowest neighbour anyway, which is what turns a basin into a lake.
        let lx = -1, ly = -1, lv = Infinity;
        for (const [dx, dy] of ORTH) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (onPath.has(j)) continue;
          if (this.elev[j] < lv) { lv = this.elev[j]; lx = nx; ly = ny; }
        }
        if (lx < 0) break;
        bx = lx; by = ly;
      }
      x = bx; y = by;
    }
    // Only keep a river that got somewhere: to the sea, or long enough to be a
    // lake chain in its own right.
    if (!reachedSea && path.length < 12) return false;
    for (const i of path) {
      this.terrain[i] = T_WATER;
      this.decor[i] = -1;
      this.treeWood[i] = 0;
      this.elev[i] = Math.min(this.elev[i], WORLD.seaLevel);
    }
    return path.length > 0;
  }

  // ---- climate ---------------------------------------------------------
  // Two fields, both of them the obvious physics and neither of them expensive:
  // temperature falls with latitude and with height, moisture falls with
  // distance from water. The noise on top is what stops the bands from reading
  // as stripes. These are the layers a real biome pass will live on.
  buildClimate(rng) {
    const tNoise = makeFbm(rng, Math.max(16, MAP_W / 14), 3);
    const mNoise = makeFbm(rng, Math.max(12, MAP_W / 18), 3);
    const sea = WORLD.seaLevel;
    const wet = this.distanceToWater();
    const wetScale = Math.max(6, Math.min(this.w, this.h) * 0.09);
    for (let y = 0; y < this.h; y++) {
      const lat = Math.abs(y / (this.h - 1) - 0.5) * 2;
      // cos-shaped falloff: broad tropics, a fast drop through the temperate
      // band, a long cold tail — near enough to the real thing to be legible.
      const base = Math.cos(lat * Math.PI / 2);
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const alt = Math.max(0, this.elev[i] - sea) / Math.max(0.05, 1 - sea);
        let t = base * 1.05 - alt * 0.42 + (tNoise(x, y) - 0.5) * 0.16;
        this.temp[i] = Math.max(0, Math.min(1, t));
        // Coasts are wet, continental interiors are dry, and the tropics are
        // wetter than the poles at the same distance from the sea.
        const dry = Math.min(1, wet[i] / wetScale);
        let m = (1 - dry) * 0.72 + (mNoise(x, y) - 0.5) * 0.5 + this.temp[i] * 0.18;
        this.moist[i] = Math.max(0, Math.min(1, m));
      }
    }
  }

  // Tiles from the nearest water, by BFS over land from every shore at once.
  distanceToWater() {
    const N = this.terrain.length;
    const dist = new Uint16Array(N).fill(0xffff);
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      if (this.terrain[i] !== T_WATER) continue;
      dist[i] = 0; q[tail++] = i;
    }
    while (head < tail) {
      const i = q[head++];
      const x = i % this.w, y = (i / this.w) | 0;
      const d = dist[i];
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (dist[j] !== 0xffff) continue;
        dist[j] = d + 1;
        q[tail++] = j;
      }
    }
    // A world with no water at all leaves the field unvisited; treat it as arid.
    for (let i = 0; i < N; i++) if (dist[i] === 0xffff) dist[i] = 0xfff;
    return dist;
  }

  // ---- beaches ---------------------------------------------------------
  // Every shore gets sand. Doing it everywhere (rather than only on gentle
  // coasts) is a rendering decision as much as a terrain one: with sand always
  // between grass and sea, the water only ever has to draw one kind of edge, and
  // the coastline stops flickering between two shoreline styles along its run.
  //
  // Width follows the land: a flat coast gets a broad strand, a steep one gets a
  // single tile of shingle. Cold coasts get less of it — that reads as rock and
  // ice rather than beach once the polar tint is on.
  layBeaches(rng) {
    const sea = WORLD.seaLevel;
    const first = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.terrain[i] !== T_GRASS) continue;
        if (!ORTH.some(([dx, dy]) => this.isWater(x + dx, y + dy))) continue;
        this.terrain[i] = T_SAND;
        first.push([x, y]);
      }
    }
    // A second rank inland where the ground is flat and warm.
    for (const [x, y] of first) {
      const flat = Math.max(0, 1 - (this.elev[this.idx(x, y)] - sea) * 7);
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.terrain[j] !== T_GRASS) continue;
        const warm = 0.35 + this.temp[j] * 0.65;
        if (rng() < flat * warm * 0.55) this.terrain[j] = T_SAND;
      }
    }
  }

  // Any land left touching water after the homelands and their corridors were
  // cut gets its strip of sand. One rank only — this is a repair pass, not the
  // beach generator.
  retouchShores() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.terrain[i] !== T_GRASS) continue;
        if (!ORTH.some(([dx, dy]) => this.isWater(x + dx, y + dy))) continue;
        this.terrain[i] = T_SAND;
        this.decor[i] = -1;
        this.biome[i] = this.temp[i] < 0.12 ? BIOME_IDS.ice : BIOME_IDS.beach;
      }
    }
  }

  // ---- biomes ----------------------------------------------------------
  classifyBiomes() {
    const sea = WORLD.seaLevel;
    const span = Math.max(0.05, 1 - sea);
    for (let i = 0; i < this.terrain.length; i++) {
      if (this.terrain[i] === T_WATER) {
        // Sea ice is scenery, not terrain: polar water still sails, it just
        // reads as ice from orbit.
        this.biome[i] = this.temp[i] < 0.1 ? BIOME_IDS.ice
          : this.depth[i] >= DEEP_WATER_DIST ? BIOME_IDS.ocean : BIOME_IDS.coast;
      } else if (this.terrain[i] === T_SAND) {
        this.biome[i] = this.temp[i] < 0.12 ? BIOME_IDS.ice : BIOME_IDS.beach;
      } else {
        const alt = Math.max(0, this.elev[i] - sea) / span;
        this.biome[i] = classifyBiome(this.temp[i], this.moist[i], alt);
      }
    }
  }

  // ---- vegetation ------------------------------------------------------
  // Trees and boulders are placed by biome, not by a single global noise field:
  // the biome table says how densely each one grows things, the noise says
  // where the woods clump. That is the whole point of the biome groundwork —
  // a rainforest is dense because its row says 2.2, not because of a special case.
  plantVegetation(rng) {
    const forest = makeFbm(rng, Math.max(6, MAP_W / 48), 3);
    const rocks = makeFbm(rng, Math.max(5, MAP_W / 60), 2);
    // Averaged octaves pile up around 0.5, so the raw field is nearly flat.
    // `spread` stretches it back out into something with a top and a bottom to
    // threshold against — without it a forest biome and a desert plant at
    // indistinguishable rates.
    const spread = (v, mid) => Math.max(0, Math.min(1, (v - mid) * 3.4));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.terrain[i] !== T_GRASS) continue;
        const b = BIOMES[this.biome[i]];
        if (rng() < spread(forest(x, y), 0.42) * b.tree * 0.8) {
          this.terrain[i] = T_TREE;
          this.decor[i] = Math.floor(rng() * 3);
          this.treeWood[i] = 40 + rng() * 30;
          continue;
        }
        if (rng() < spread(rocks(x, y), 0.5) * b.rock * 0.45) {
          this.terrain[i] = T_ROCK;
          this.decor[i] = Math.floor(rng() * 5);
          continue;
        }
        this.decor[i] = rng() < 0.12 ? Math.floor(rng() * 3) : -1;
      }
    }
  }

  // ---- caves -----------------------------------------------------------
  // Sprinkle caves on rocky ground. A cave is a mouth in a rock face rather
  // than ground, so it is the one thing placed after the plateaus that can take
  // walkable ground away from them: on top it can cut the plateau in two and
  // strand the half without a stair, and at the foot of a ramp it seals the
  // only way up. Keep them off both.
  digCaves(rng) {
    // Scaled to LAND, not to the size of the world: caves are what a Gold Mine
    // needs, and an ocean's worth of extra tiles should not multiply the gold
    // supply of the continents.
    const want = Math.max(14, Math.round(this.countLand() / 260));
    let caves = 0;
    for (let tries = 0; tries < want * 300 && caves < want; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] !== T_ROCK || this.high[i]) continue;
      // Cave mouths are scattered, never in pairs — two adjacent ones read as a
      // hole in the rock rather than as two workable adits.
      if (this.countAdjacent(x, y, T_CAVE, 2) > 0) continue;
      // Is this candidate a ramp's footing — the tile it climbs from — in any
      // of the 4 directions a ramp can face? (Not just south: a ramp only
      // exists next to rock its own generation already found footing on, so a
      // neighbour of any orientation could be one.)
      if (ORTH.some(([nx, ny]) => {
        const rx = x + nx, ry = y + ny;
        if (!this.inBounds(rx, ry) || this.terrain[this.idx(rx, ry)] !== T_RAMP) return false;
        const d = RAMP_DIRS[this.rampDir[this.idx(rx, ry)]].d;
        return nx === d[0] && ny === d[1];
      })) continue;
      this.terrain[i] = T_CAVE; caves++;
    }
  }

  // ---- homelands -------------------------------------------------------
  // One nation per continent, which is the whole point of a world with oceans in
  // it. Continents are ranked by usable size; each of the first four gets a
  // capital sited well inland, so nobody starts with their Town Hall in the surf.
  // If the world did not produce enough continents (a small preset, a mean seed,
  // or Duel Island by design) the leftovers are spread across the biggest one,
  // as far from each other as the ground allows.
  chooseHomelands(rng) {
    this.labelContinents();
    const nations = 4;
    // Seat nations on continents with real room on them. The generous threshold
    // is the first choice; if the world did not make four of those, fall back to
    // the bare minimum rather than crowding everyone onto one landmass.
    const all = this.continentSize.map((size, id) => ({ id, size })).sort((a, b) => b.size - a.size);
    const roomy = all.filter(c => c.size >= MIN_START_REGION * 2.5);
    const ranked = roomy.length >= 4 ? roomy : all.filter(c => c.size >= MIN_START_REGION);
    const zones = [];
    const used = [];
    const wanted = WORLD.oneContinent ? 1 : Math.min(nations, ranked.length);
    for (let k = 0; k < wanted; k++) {
      const spot = this.inlandSpot(rng, ranked[k].id, used);
      if (spot) { zones.push(spot); used.push(spot); }
    }
    // Not enough continents to go round: double up on the largest ones, taking
    // the biggest first so the crowded continent is also the roomiest.
    for (let k = 0; zones.length < nations; k++) {
      const c = ranked[k % Math.max(1, ranked.length)];
      const spot = c ? this.inlandSpot(rng, c.id, used) : null;
      if (spot) { zones.push(spot); used.push(spot); }
      else if (k > nations * 4) break;              // nowhere left: fall through
    }
    // A world so hostile it could not seat four nations. Put the stragglers
    // anywhere walkable rather than crash — the connectivity pass below will
    // cut them a country out.
    while (zones.length < nations) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      if (this.terrain[this.idx(x, y)] === T_WATER) continue;
      zones.push([x, y]);
    }
    return zones;
  }

  // The most sheltered spot on a continent: far from the sea, far from the other
  // capitals, and not on a mountain top. Sampled rather than exhaustive — on a
  // planet-sized map an exact answer costs more than it is worth.
  inlandSpot(rng, continentId, used) {
    const wet = this._inlandField || (this._inlandField = this.distanceToWater());
    let best = null, bestScore = -Infinity;
    const samples = Math.min(4000, Math.max(600, this.continentSize[continentId] | 0));
    for (let s = 0; s < samples; s++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.continent[i] !== continentId) continue;
      if (this.elev[i] > WORLD.seaLevel + 0.34) continue;       // not on the peaks
      // Comfortably inland, but not so far that the coast is a week's march.
      let score = Math.min(wet[i], 26) * 1.6 + this.moist[i] * 8 + this.temp[i] * 6;
      for (const [ux, uy] of used) score += Math.min(wdist(x, y, ux, uy), 90) * 0.9;
      // keep clear of the map's top and bottom rows: no room for a 13x13 clearing
      if (y < 8 || y > this.h - 9) score -= 500;
      if (score > bestScore) { bestScore = score; best = [x, y]; }
    }
    return best;
  }

  // Clear each capital's ground, guarantee it the resources a nation needs to
  // open with, and make sure it is not marooned on a sandbar.
  provisionHomelands(rng, zones) {
    for (const [cx, cy] of zones) {
      this.startZones.push({ x: cx, y: cy });
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const x = cx + dx, y = cy + dy;
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d <= 3) { this.terrain[i] = T_GRASS; this.decor[i] = -1; this.high[i] = 0; }
        }
      }
      // guarantee trees, rocks and a cave near each start
      this.plant(rng, cx, cy, T_TREE, 8, 5, 7);
      this.plant(rng, cx, cy, T_ROCK, 5, 5, 7);
      this.plant(rng, cx, cy, T_CAVE, 1, 5, 7);
    }
    this.connectStartZones();
  }

  // 4-connected components of walkable land, so the rest of the game can ask
  // "can this army walk there?" without running a pathfind. Water, cliffs and
  // cave mouths all break a component; a bridge does not join two, because a
  // bridge is built during play and this is generation-time truth.
  labelContinents() {
    this.continent.fill(-1);
    this.continentSize = [];
    const N = this.terrain.length;
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (this.continent[s] >= 0 || !this.landAt(s)) continue;
      const id = this.continentSize.length;
      let head = 0, tail = 0, size = 0;
      this.continent[s] = id; q[tail++] = s;
      while (head < tail) {
        const i = q[head++]; size++;
        const x = i % this.w, y = (i / this.w) | 0;
        for (const [dx, dy] of ORTH) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (this.continent[j] >= 0 || !this.landAt(j)) continue;
          this.continent[j] = id; q[tail++] = j;
        }
      }
      this.continentSize.push(size);
    }
  }

  // Ground an army can stand on, by index. Trees and boulders count — they slow
  // a march, they do not stop one.
  landAt(i) {
    const t = this.terrain[i];
    return t === T_GRASS || t === T_SAND || t === T_TREE || t === T_ROCK || t === T_RAMP;
  }

  // How much ground is reachable on foot from here, counting rough terrain,
  // stopping once `limit` tiles have been found. The generation-time answer to
  // "is this nation marooned?".
  walkRegionSize(sx, sy, limit) {
    const start = this.idx(sx, sy);
    if (!this.landAt(start)) return 0;
    const seen = new Set([start]);
    const q = [[wrapX(sx), sy]];
    while (q.length && seen.size < limit) {
      const [x, y] = q.pop();
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (seen.has(j) || !this.landAt(j)) continue;
        seen.add(j);
        q.push([wrapX(nx), ny]);
      }
    }
    return seen.size;
  }

  // Raise the high ground. Works on its own noise field so plateaus land
  // independently of where the coastline and the woods fell, then commits one
  // mass at a time — a mass that cannot be given a usable stair is abandoned
  // whole rather than left as a wall around ground no one can reach.
  generatePlateaus(rng, zones) {
    const N = this.w * this.h;
    const field = makeNoise(rng, Math.max(8, MAP_W / 8));
    let plat = new Uint8Array(N);
    // A rim tile needs its neighbours to exist. On a wrapping world "the border"
    // is only the top and bottom rows; east-west the field runs right round.
    const x0 = WORLD_WRAP ? 0 : 2, x1 = WORLD_WRAP ? this.w : this.w - 2;
    // Highlands get more rock: the plateau field is biased by the same elevation
    // the continents came from, so mesas cluster in the interior rather than
    // scattering evenly over farmland and beach alike.
    const level = PLATEAU_LEVEL / Math.max(0.2, WORLD.plateauDensity);
    for (let y = 2; y < this.h - 2; y++) {
      for (let x = x0; x < x1; x++) {
        const i = this.idx(x, y);
        if (this.terrain[i] === T_WATER || this.terrain[i] === T_SAND) continue;
        const lift = Math.max(0, this.elev[i] - WORLD.seaLevel) * 0.45;
        if (field(x, y) + lift > level) plat[i] = 1;
      }
    }
    // Majority smoothing. Thresholded noise frays into single-tile spurs and
    // pinholes, and against this art every one of those reads as a stray boulder
    // rather than a cliff; three passes settle it into masses with an outline.
    for (let pass = 0; pass < 3; pass++) {
      const next = plat.slice();
      for (let y = 2; y < this.h - 2; y++) {
        for (let x = x0; x < x1; x++) {
          const i = this.idx(x, y);
          if (this.terrain[i] === T_WATER || this.terrain[i] === T_SAND) { next[i] = 0; continue; }
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if ((dx || dy) && plat[this.idx(x + dx, y + dy)]) n++;
          next[i] = n >= 5 ? 1 : n <= 2 ? 0 : plat[i];
        }
      }
      plat = next;
    }
    // Nobody starts walled in. Cleared after the smoothing rather than before it,
    // or the passes above would grow the mass straight back over the start zone.
    for (const [cx, cy] of zones) {
      for (let y = cy - PLATEAU_START_CLEAR; y <= cy + PLATEAU_START_CLEAR; y++)
        for (let x = cx - PLATEAU_START_CLEAR; x <= cx + PLATEAU_START_CLEAR; x++)
          if (this.inBounds(x, y)) plat[this.idx(x, y)] = 0;
    }
    // Erode anything one tile thick. The rim set has a piece for a tile with one
    // open side (an edge) or two adjacent ones (a corner) — and nothing else. A
    // tile open on three sides is a finger of rock; a tile open on two OPPOSITE
    // sides is a wall one tile thick. Both fall through to the tall south face,
    // whose turf lip then meets open grass with no rock between it. Clearing the
    // start zones above carves fresh ones out of whatever it cuts through, so
    // this runs after that, and repeats until the outline stops changing.
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      const next = plat.slice();
      for (let y = 2; y < this.h - 2; y++) {
        for (let x = x0; x < x1; x++) {
          const i = this.idx(x, y);
          if (!plat[i]) continue;
          const n = !plat[this.idx(x, y - 1)], s = !plat[this.idx(x, y + 1)];
          const e = !plat[this.idx(x + 1, y)], w = !plat[this.idx(x - 1, y)];
          const open = n + s + e + w;
          if (open >= 3 || (n && s) || (e && w)) { next[i] = 0; changed = true; }
        }
      }
      plat = next;
      if (!changed) break;
    }

    for (const comp of this.plateauMasses(plat)) {
      if (comp.length < MIN_PLATEAU) continue;
      const inComp = new Set(comp);
      // Rim by 4-connectivity, not 8: this game paths and walks orthogonally, so
      // a tile whose four sides are all plateau is inside it however its corners
      // fall. That also means every rim tile has an open side for the artwork to
      // face, which is the whole reason the set only needs its eight outer pieces.
      const rim = [], top = [];
      for (const i of comp) {
        const x = i % this.w, y = (i / this.w) | 0;
        const edge = ORTH.some(([dx, dy]) => !inComp.has(this.idx(x + dx, y + dy)));
        (edge ? rim : top).push(i);
      }
      if (top.length < MIN_PLATEAU_TOP) continue;
      const topSet = new Set(top);
      const ramps = this.pickRamps(rng, plat, inComp, topSet, rim);
      if (!ramps.length) continue;
      // Every tile up there has to be walkable from a stair. A mass with a lobe
      // the stairs cannot reach would be ground the game shows but nobody can use.
      if (!this.rampsReachAll(ramps, topSet, top)) continue;
      for (const i of rim) { this.terrain[i] = T_CLIFF; this.decor[i] = -1; this.treeWood[i] = 0; }
      for (const { i, dir } of ramps) {
        this.terrain[i] = T_RAMP; this.decor[i] = -1; this.treeWood[i] = 0; this.rampDir[i] = dir;
      }
      // The tufted grass variants have low-ground turf baked into them, so leaving
      // decor on a raised tile would punch a patch of valley colour into the top.
      for (const i of top) {
        this.high[i] = 1;
        if (this.terrain[i] === T_GRASS) this.decor[i] = -1;
      }
    }
  }

  // 4-connected components of the raised field.
  plateauMasses(plat) {
    const seen = new Uint8Array(plat.length), out = [];
    for (let s = 0; s < plat.length; s++) {
      if (!plat[s] || seen[s]) continue;
      const comp = [s];
      seen[s] = 1;
      for (let qi = 0; qi < comp.length; qi++) {
        const x = comp[qi] % this.w, y = (comp[qi] / this.w) | 0;
        for (const [dx, dy] of ORTH) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (plat[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
        }
      }
      out.push(comp);
    }
    return out;
  }

  // Cut stairs into any of the rim's four sides — the art is a front elevation
  // (treads and two rock jambs, drawn as if looking straight at the face) so it
  // only reads where its own three neighbours match: open ground to arrive from
  // on the outside, plateau top directly on the inside to step onto, and rim
  // either side for the jambs to close against. `RAMP_DIRS` gives the four
  // rotations of that one shape; a rim tile qualifies for whichever of them its
  // neighbours happen to satisfy.
  pickRamps(rng, plat, inComp, topSet, rim) {
    const cand = [];
    for (const i of rim) {
      const x = i % this.w, y = (i / this.w) | 0;
      for (let dir = 0; dir < RAMP_DIRS.length; dir++) {
        const { d, p } = RAMP_DIRS[dir];
        const ox = x - d[0], oy = y - d[1];   // outside: where you climb up from
        const tx = x + d[0], ty = y + d[1];   // inside: the plateau top you reach
        if (!this.inBounds(ox, oy) || !this.inBounds(tx, ty)) continue;
        const outside = this.idx(ox, oy);
        if (plat[outside]) continue;
        const ot = this.terrain[outside];
        if (ot === T_WATER || ot === T_CAVE) continue;
        if (!topSet.has(this.idx(tx, ty))) continue;
        const jambs = [-1, 1].every(s => {
          const jx = x + s * p[0], jy = y + s * p[1];
          if (!this.inBounds(jx, jy)) return false;
          const j = this.idx(jx, jy);
          const jox = jx - d[0], joy = jy - d[1];
          return inComp.has(j) && !topSet.has(j)
            && this.inBounds(jox, joy) && !plat[this.idx(jox, joy)];
        });
        if (jambs) cand.push({ i, dir });
      }
    }
    for (let k = cand.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [cand[k], cand[j]] = [cand[j], cand[k]];
    }
    const ramps = [];
    for (const c of cand) {
      const x = c.i % this.w, y = (c.i / this.w) | 0;
      const near = ramps.some(r => {
        const rx = r.i % this.w, ry = (r.i / this.w) | 0;
        return Math.abs(wdx(x, rx)) + Math.abs(ry - y) < 7;
      });
      if (!near) ramps.push(c);
      if (ramps.length >= 3) break;
    }
    return ramps;
  }

  // Can you get from a stair to every tile on top, walking orthogonally?
  rampsReachAll(ramps, topSet, top) {
    const reach = new Set(ramps.map(r => r.i)), q = ramps.map(r => r.i);
    while (q.length) {
      const i = q.pop(), x = i % this.w, y = (i / this.w) | 0;
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (topSet.has(j) && !reach.has(j)) { reach.add(j); q.push(j); }
      }
    }
    return top.every(i => reach.has(i));
  }

  // Is this tile part of a plateau — its top, its rim, or a stair through it?
  // What the rim artwork keys off: a cliff tile draws the face that looks out
  // over whichever of its sides is NOT raised.
  raised(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.high[i] === 1 || this.terrain[i] === T_CLIFF || this.terrain[i] === T_RAMP;
  }

  // Pick the rim piece for a cliff tile. Corners first (two open sides meeting
  // at a right angle), then a straight edge (one open side). A tile open on
  // opposite sides (a one-tile-thick neck) or on three has no piece of its own —
  // the tall south face is the one that reads from any angle, so it stands in.
  // A tile beside a ramp still gets its ordinary rim piece here; the stair's
  // jamb goes on top of it (see rampJamb), so the rim run stays unbroken.
  cliffTile(x, y) {
    const n = !this.raised(x, y - 1), s = !this.raised(x, y + 1);
    const e = !this.raised(x + 1, y), w = !this.raised(x - 1, y);
    if (n && w && !s && !e) return AT.CLIFF_NW;
    if (n && e && !s && !w) return AT.CLIFF_NE;
    if (s && w && !n && !e) return AT.CLIFF_SW;
    if (s && e && !n && !w) return AT.CLIFF_SE;
    // A south face is the only fully opaque piece in the set, turf lip and all,
    // so where the rim reverses direction beside one — an east edge above it, say,
    // whose own art cuts its outer half away — that lip is left meeting open
    // ground. Reading the far diagonal turns it back into the corner it really is.
    if (s && !n && !e && !w) {
      if (!this.raised(x + 1, y - 1)) return AT.CLIFF_SE;
      if (!this.raised(x - 1, y - 1)) return AT.CLIFF_SW;
      return AT.CLIFF_S;
    }
    if (n && !s && !e && !w) {
      if (!this.raised(x + 1, y + 1)) return AT.CLIFF_NE;
      if (!this.raised(x - 1, y + 1)) return AT.CLIFF_NW;
      return AT.CLIFF_N;
    }
    if (w && !n && !s && !e) return AT.CLIFF_W;
    if (e && !n && !s && !w) return AT.CLIFF_E;
    return AT.CLIFF_S;
  }

  // The stair jamb for a cliff tile flanking a ramp, or null. Drawn OVER the
  // tile's ordinary rim piece rather than instead of it: the jamb art is a
  // narrow rock post, sized to frame a stair against a rim that is already
  // there, so using it as the whole tile punched a hole in the rim run either
  // side of every ramp (a stair floating in a gap of bare grass).
  rampJamb(x, y) {
    for (const [nx, ny] of ORTH) {
      const rx = x + nx, ry = y + ny;
      if (!this.inBounds(rx, ry) || this.terrain[this.idx(rx, ry)] !== T_RAMP) continue;
      const { p, rot } = RAMP_DIRS[this.rampDir[this.idx(rx, ry)]];
      // This tile's offset from the ramp is the reverse of the ramp's offset
      // from it, so it lands on the ramp's +p side or its -p side.
      if (-nx === p[0] && -ny === p[1]) return AT.RAMP_JAMB_POS[rot];
      if (-nx === -p[0] && -ny === -p[1]) return AT.RAMP_JAMB_NEG[rot];
    }
    return null;
  }

  // What to paint a plateau-top tile with. Normally the raised turf, but a top
  // tile can still touch low ground at a CORNER: `high` is 4-connected (all four
  // sides raised), which is the right rule for an orthogonal pathfinder but says
  // nothing about diagonals. Wherever a plateau's edge runs diagonally, the tile
  // inside the step has all four sides raised and open ground off one corner,
  // and painting it flat turf left raised turf meeting grass with no rock
  // between — the staircase of disconnected rim fragments.
  //
  // All four corners need a piece: the neighbouring rim tiles are transparent on
  // their outward side by design, so whichever way the step turns, the corner
  // between them is see-through. A tile cut at more than one corner would need
  // art that does not exist; that means a one-tile neck, which `generatePlateaus`
  // erodes away, so first match wins.
  plateauTopTile(x, y) {
    if (!this.raised(x - 1, y - 1)) return AT.CLIFF_IN_NW;
    if (!this.raised(x + 1, y - 1)) return AT.CLIFF_IN_NE;
    if (!this.raised(x - 1, y + 1)) return AT.CLIFF_IN_SW;
    if (!this.raised(x + 1, y + 1)) return AT.CLIFF_IN_SE;
    return AT.CLIFF_TOP;
  }

  // Is this high tile the one a neighbouring ramp climbs onto? Returns that
  // ramp's RAMP_DIRS index (so the caller can draw the correctly rotated
  // RAMP_TOP over it), or -1. Used to lay the stair's top step, which belongs
  // to the plateau-top tile rather than the ramp tile itself.
  rampTopHere(x, y) {
    for (const [ox, oy] of ORTH) {
      const rx = x + ox, ry = y + oy;
      if (!this.inBounds(rx, ry)) continue;
      const ri = this.idx(rx, ry);
      if (this.terrain[ri] !== T_RAMP) continue;
      const dir = this.rampDir[ri], { d } = RAMP_DIRS[dir];
      if (d[0] === -ox && d[1] === -oy) return dir;
    }
    return -1;
  }

  // idx() clamped to the map, for neighbour lookups that only want to read.
  // Only y needs clamping now — x wraps.
  idx2(x, y) {
    return this.idx(x, Math.min(this.h - 1, Math.max(0, y)));
  }

  // Terrain-only walkability. Used during generation, before any building exists.
  // Stairs count: they are how the ground on a plateau joins the rest of the map,
  // so a flood that stopped at them would read every mesa as its own island.
  // Beach counts too — it is the ground every landing party steps onto.
  openAt(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === T_GRASS || t === T_RAMP || t === T_SAND;
  }

  // Flood the contiguous walkable region containing (sx, sy), stopping early
  // once `limit` tiles have been found.
  floodRegion(sx, sy, limit = Infinity) {
    const seen = new Set();
    if (!this.openAt(sx, sy)) return seen;
    const q = [[sx, sy]];
    seen.add(this.idx(sx, sy));
    while (q.length && seen.size < limit) {
      const [x, y] = q.pop();
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.openAt(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        q.push([wrapX(nx), ny]);
      }
    }
    return seen;
  }

  // Tiles of a track between two points, stepping one axis at a time. A
  // straight-line rasterisation would step diagonally, and pathfinding here is
  // 4-directional — a diagonal chain of tiles is not a route anyone can walk.
  // East-west it takes the short way round the world.
  linePath(x0, y0, x1, y1) {
    const tiles = [[x0, y0]];
    let x = x0, y = y0;
    let guard = this.w + this.h + 4;
    while ((wrapX(x) !== wrapX(x1) || y !== y1) && guard-- > 0) {
      const dx = wdx(x, x1), dy = y1 - y;
      if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) x = wrapX(x + Math.sign(dx));
      else y += Math.sign(dy);
      tiles.push([x, y]);
    }
    return tiles;
  }

  // How expensive is a track between these points? Forest and rock are free to
  // cut; water has to be filled into an isthmus, so routes needing less of it
  // win. Caves and cliffs are never cut, so a route through either is rejected.
  lineCost(x0, y0, x1, y1) {
    let water = 0;
    for (const [x, y] of this.linePath(x0, y0, x1, y1)) {
      if (!this.inBounds(x, y)) return null;
      const t = this.terrain[this.idx(x, y)];
      // Caves are too valuable to bulldoze; a cliff cannot be bulldozed at all,
      // so a track that would have to breach one is no track. carveShortestLink
      // is the fallback and it will go round.
      if (t === T_CAVE || t === T_CLIFF) return null;
      if (t === T_WATER) water++;
    }
    return water;
  }

  // Cut the track, filling water as it goes.
  carveLine(x0, y0, x1, y1) {
    for (const [x, y] of this.linePath(x0, y0, x1, y1)) {
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      // Grass, sand and ramps are already open ground; caves are never touched.
      // A ramp that happened to lie on this line is left alone rather than
      // flattened — if it were its plateau's only stair, bulldozing it would
      // seal the top.
      const t = this.terrain[i];
      if (t === T_CAVE || t === T_GRASS || t === T_SAND || t === T_RAMP) continue;
      this.terrain[i] = T_GRASS;
      this.decor[i] = -1;
      // `high` is deliberately left alone: a plateau-top tile crossed by this
      // corridor becomes ordinary plateau-top grass (fine — most of a top is
      // already grass), not a hole in the plateau. Clearing it here once turned
      // a forested top tile into low ground mid-rim: same terrain either side,
      // suddenly no longer part of the mesa, `openAt` connectivity restored at
      // the cost of quietly breaching what was supposed to be sealed rock.
      this.treeWood[i] = 0;
    }
  }

  // A cut-off start zone is a prison. The clearing above stamps a 7x7 square of
  // grass wherever the capital lands — including on a sandbar — and then plants
  // trees and rocks in the ring just outside it. The result can be an island: a
  // nation with ~46 walkable tiles that can never scout, expand, trade overland,
  // attack, or be attacked for the whole match. Guarantee every start reaches
  // real country by cutting the cheapest track to the nearest large region,
  // filling water into an isthmus where it must.
  //
  // What this deliberately no longer does is join the nations to each other. On
  // a world of continents they are *supposed* to start apart; crossing the
  // ocean is what docks and transports are for (js/naval.js). Only Duel Island,
  // which declares itself one landmass, still gets the old guarantee.
  connectStartZones() {
    for (const z of this.startZones) {
      // The test is "can this nation walk anywhere", so it runs over everything
      // a unit can cross — forest and boulder field included. `floodRegion`
      // (clear ground only) is deliberately stricter and is the right rule for
      // deciding where to CUT a corridor, but using it to decide WHETHER to cut
      // one condemned any nation seated on a wooded continent to having an
      // isthmus bulldozed across the ocean it was supposed to be isolated by.
      if (this.walkRegionSize(z.x, z.y, MIN_START_REGION + 1) > MIN_START_REGION) continue;
      const home = this.floodRegion(z.x, z.y, MIN_START_REGION + 1);
      let best = null;
      const reach = Math.min(45, Math.floor(Math.min(this.w, this.h) / 2) - 2);
      for (let r = 4; r < reach; r++) {
        for (let a = 0; a < 64; a++) {
          const ang = a / 64 * Math.PI * 2;
          const x = Math.round(z.x + Math.cos(ang) * r), y = Math.round(z.y + Math.sin(ang) * r);
          if (!this.openAt(x, y) || home.has(this.idx(x, y))) continue;
          const water = this.lineCost(z.x, z.y, x, y);
          if (water === null) continue;
          if (this.floodRegion(x, y, MIN_START_REGION + 1).size <= MIN_START_REGION) continue;
          if (!best || water < best.water) best = { x, y, water };
          if (best.water === 0) break;
        }
        // a dry route is ideal, but keep widening the search a little in case a
        // much shorter crossing lies just beyond the first one found
        if (best && (best.water === 0 || r > 20)) break;
      }
      if (best) this.carveLine(z.x, z.y, best.x, best.y);
    }
    if (WORLD.oneContinent) this.linkStartZones();
  }

  // Duel Island only. Every nation must be able to walk to every other: quadrant
  // centres can land on separate landmasses, and when they do those nations are
  // invisible to each other forever — no scouting, no overland trade, no
  // expansion toward each other, and no war. Rather than a canal-straight
  // highway, link them at the NARROWEST crossing so the result reads as an
  // isthmus.
  linkStartZones() {
    for (let i = 1; i < this.startZones.length; i++) {
      const home = this.floodRegion(this.startZones[0].x, this.startZones[0].y);
      const z = this.startZones[i];
      if (home.has(this.idx(z.x, z.y))) continue;
      // Go round the mesas first. Only if there is genuinely no route at all does
      // the second attempt allow cutting through one: a breach leaves plateau top
      // beside open ground with no rock between, which no rim piece can paint,
      // and linking the nations matters more than one seed's cosmetics.
      if (!this.carveShortestLink(z, home)) this.carveShortestLink(z, home, true);
    }
  }

  // Dijkstra from a start zone to the nearest tile of `targetSet`. Existing
  // grass is nearly free, forest and rock cost a little (they can be cut), water
  // costs a lot (it has to be filled), and caves and cliffs are impassable unless
  // `allowCliff` (see linkStartZones). The route hugs the land and crosses at the
  // tightest gap it can find.
  carveShortestLink(z, targetSet, allowCliff = false) {
    const N = this.w * this.h;
    // Float64, not Float32. `nd` below is computed in double precision, so a
    // Float32 store rounds it — and when it rounds UP, `nd < dist[j]` is still
    // true next time round and the node is pushed again with a distance it never
    // actually improves on. That is an infinite loop, not a slow one: 0.1 steps
    // over grass hit it readily (nd 1.6000002384185792 vs a stored
    // 1.600000262260437). `settled` is the other half of the fix — with
    // non-negative costs a node's distance is final the first time it is popped,
    // so expanding it once is both correct and what stops stale heap entries
    // from re-relaxing the graph.
    const dist = new Float64Array(N).fill(Infinity);
    const settled = new Uint8Array(N);
    const prev = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    const start = this.idx(z.x, z.y);
    dist[start] = 0;
    heap.push(0, start);
    let goal = -1;
    while (heap.size()) {
      const i = heap.pop();
      if (settled[i]) continue;
      settled[i] = 1;
      if (targetSet.has(i)) { goal = i; break; }
      const d = dist[i];
      const x = i % this.w, y = (i / this.w) | 0;
      for (const [dx, dy] of ORTH) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny), t = this.terrain[j];
        if (t === T_CAVE) continue;
        if (t === T_CLIFF && !allowCliff) continue;
        // Ramps and beach are already open ground, same as grass — no reason to
        // route around one, and (see carveLine) no reason to flatten it either.
        const open = t === T_GRASS || t === T_RAMP || t === T_SAND;
        const nd = d + (open ? 0.1 : t === T_WATER ? 6 : t === T_CLIFF ? 9 : 1);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
      }
    }
    if (goal < 0) return false;
    for (let i = goal; i !== -1; i = prev[i]) {
      const t = this.terrain[i];
      if (t === T_GRASS || t === T_RAMP || t === T_SAND) continue;
      this.terrain[i] = T_GRASS;
      this.decor[i] = -1;
      // `high` left alone — see carveLine.
      this.treeWood[i] = 0;
    }
    return true;
  }

  plant(rng, cx, cy, type, count, rMin, rMax) {
    for (let tries = 0, placed = 0; tries < 300 && placed < count; tries++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      if (this.terrain[i] !== T_GRASS) continue;
      this.terrain[i] = type;
      if (type === T_TREE) { this.decor[i] = Math.floor(rng() * 3); this.treeWood[i] = 50; }
      else this.decor[i] = type === T_CAVE ? 0 : Math.floor(rng() * 5);
      placed++;
    }
  }

  passable(x, y, faction) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    const b = this.buildingAt[i];
    if (b) {
      // Gates open for their owner and allies; walls and keeps (town hall / castle) are
      // solid barriers. Everything else — houses, farms, camps, markets — is walkable, so
      // troops can move freely between the buildings of a settlement.
      if (b.type.key === 'gate') return faction === undefined || b.faction === faction
        || (typeof game !== 'undefined' && game.diplomacy.status(b.faction, faction) === 'alliance');
      if (b.type.solid) return false;
      return true;
    }
    const t = this.terrain[i];
    if (t === T_WATER) return this.bridge[i] !== 0;
    // A cliff face is the one piece of terrain with no way through it at all —
    // no bridge, no cutting, no siege. Getting onto a plateau means finding one
    // of its ramps, which is what makes the high ground worth taking.
    if (t === T_CLIFF) return false;
    // Caves are mouths in the rock face, not ground. Everything else — grass,
    // sand, forest, boulder field, stairs — can be walked; rough ground just
    // slows the walker down (see moveCost).
    return t !== T_CAVE;
  }

  // Water a hull can float on. The mirror image of `passable`: open water only,
  // with a bridge deck counting as blocked — a span sits on the water, so a ship
  // cannot sail through one any more than an army can ford a river.
  navigable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.terrain[i] !== T_WATER) return false;
    return !this.bridge[i] && !this.bridgeAt[i];
  }

  // Is this land tile on the shore — i.e. can a dock be built here and can a
  // boat tie up against it?
  coastal(x, y) {
    if (!this.inBounds(x, y) || this.terrain[this.idx(x, y)] === T_WATER) return false;
    return ORTH.some(([dx, dy]) => this.navigable(x + dx, y + dy));
  }

  // How slow is this tile to cross? 1 is open ground; forest and rock are
  // higher. Roads, bridges and building tiles are cleared ground by definition,
  // so they always cross at full speed.
  moveCost(x, y) {
    if (!this.inBounds(x, y)) return 1;
    const i = this.idx(x, y);
    if (this.buildingAt[i] || this.bridge[i] || this.road[i]) return 1;
    const t = this.terrain[i];
    return t === T_TREE ? TREE_MOVE_COST : t === T_ROCK ? ROCK_MOVE_COST
      : t === T_RAMP ? RAMP_MOVE_COST : t === T_SAND ? SAND_MOVE_COST : 1;
  }

  // Pick the right water tile from the 9-slice/strip set based on neighbors.
  waterTile(x, y) {
    const w = (dx, dy) => this.t(x + dx, y + dy) === T_WATER;
    const n = w(0, -1), s = w(0, 1), e = w(1, 0), o = w(-1, 0);
    if (!n && !s && !e && !o) return AT.W_ONE;
    if (!e && !o) return !n ? AT.W_VN : !s ? AT.W_VS : AT.W_V;
    if (!n && !s) return !o ? AT.W_HW : !e ? AT.W_HE : AT.W_H;
    if (!n && !o) return AT.W_NW;
    if (!n && !e) return AT.W_NE;
    if (!s && !o) return AT.W_SW;
    if (!s && !e) return AT.W_SE;
    if (!n) return AT.W_N;
    if (!s) return AT.W_S;
    if (!o) return AT.W_W;
    if (!e) return AT.W_E;
    return AT.W_C;
  }

  // Which piece of the 3x3 sand set a beach tile takes, as [col,row] within the
  // set: 0,0 is the north-west corner, 1,1 the solid middle. A tile's neighbours
  // decide it, and water counts as sand for the purpose — the strand runs right
  // up to the waterline and the water's own baked shore covers the join, so the
  // outline drawn here is the sand's INLAND edge only.
  sandEdge(x, y) {
    const s = (dx, dy) => {
      const t = this.t(x + dx, y + dy);
      return t === T_SAND || t === T_WATER;
    };
    const n = s(0, -1), so = s(0, 1), e = s(1, 0), w = s(-1, 0);
    return [w ? (e ? 1 : 2) : 0, n ? (so ? 1 : 2) : 0];
  }

  countAdjacent(x, y, type, radius = 1) {
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.t(x + dx, y + dy) === type) n++;
      }
    return n;
  }
}

// A* pathfinding over the tile grid (4-directional).
//
// `mode` picks what counts as passable: 'land' (the default — everything that
// walks) or 'sea', which paths a hull over open water instead. Both share the
// heuristic and the wrap handling, so a ship steering round a headland and an
// army steering round a wood are the same search.
function findPath(map, sx, sy, tx, ty, faction, maxIter = 6000, mode = 'land') {
  if (sx === tx && sy === ty) return [];
  const sea = mode === 'sea';
  const key = (x, y) => y * map.w + wrapX(x);
  const open = new MinHeap();
  const came = new Map(), gScore = new Map();
  const h = (x, y) => wmanhattan(x, y, tx, ty);
  const startK = key(sx, sy);
  gScore.set(startK, 0);
  open.push(h(sx, sy), [sx, sy]);
  let bestK = startK, bestH = h(sx, sy);
  let iter = 0;
  const ok = (x, y) => sea ? map.navigable(x, y) : map.passable(x, y, faction);
  while (open.size() && iter++ < maxIter) {
    const [x, y] = open.pop();
    const k = key(x, y);
    if (wrapX(x) === wrapX(tx) && y === ty) return reconstruct(came, k, map);
    const hh = h(x, y);
    if (hh < bestH) { bestH = hh; bestK = k; }
    for (const [dx, dy] of ORTH) {
      const nx = wrapX(x + dx), ny = y + dy;
      const isGoal = nx === wrapX(tx) && ny === ty;
      if (!map.inBounds(nx, ny)) continue;
      // A bridge only runs one way: a horizontal span (orient 1) can only be
      // entered moving east/west, a vertical one (orient 2) only north/south.
      // Two bridges are never allowed to physically join (see canPlace), but
      // this is what actually stops a unit from turning off one span onto a
      // perpendicular one if they ever end up touching regardless.
      if (!sea) {
        const brOrient = map.bridge[map.idx(nx, ny)];
        if (brOrient && ((brOrient === 1 && dy !== 0) || (brOrient === 2 && dx !== 0))) continue;
      }
      if (!isGoal && !ok(nx, ny)) continue;
      if (isGoal && !ok(nx, ny)) {
        // allow ending adjacent to an impassable goal (attack/harvest target,
        // or — for a ship — the quay it is putting in at)
        const nk = key(nx, ny);
        if (!gScore.has(nk) || gScore.get(k) + 1 < gScore.get(nk)) {
          came.set(nk, k); gScore.set(nk, gScore.get(k) + 1);
          return reconstruct(came, nk, map);
        }
        continue;
      }
      const nk = key(nx, ny);
      // Rough ground is a real cost, not a wall: a wood is worth going around
      // when the detour is short and worth cutting through when it isn't.
      const step = sea ? 1 : (map.road[nk] ? 0.7 : map.moveCost(nx, ny));
      const ng = gScore.get(k) + step;
      if (!gScore.has(nk) || ng < gScore.get(nk)) {
        came.set(nk, k); gScore.set(nk, ng);
        open.push(ng + h(nx, ny), [nx, ny]);
      }
    }
  }
  return reconstruct(came, bestK, map); // partial path toward goal
}

function reconstruct(came, k, map) {
  const path = [];
  while (came.has(k)) {
    path.push([k % map.w, Math.floor(k / map.w)]);
    k = came.get(k);
  }
  return path.reverse();
}

class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(pri, v) {
    this.a.push([pri, v]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p][0] <= this.a[i][0]) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p;
    }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l][0] < this.a[m][0]) m = l;
        if (r < this.a.length && this.a[r][0] < this.a[m][0]) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m;
      }
    }
    return top[1];
  }
}
