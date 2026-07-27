'use strict';
// Procedural map generation, terrain queries, water autotiling.

const T_GRASS = 0, T_WATER = 1, T_TREE = 2, T_ROCK = 3, T_CAVE = 4;
// Highland. Three tiles that together make the map's second natural barrier
// after water: T_HILL is the walkable top of a plateau, T_CLIFF is the
// escarpment ringing it, T_MOUNTAIN is bare peak. Only the hill can be crossed.
const T_HILL = 5, T_CLIFF = 6, T_MOUNTAIN = 7;
const MAP_W = 96, MAP_H = 96;
// Rough ground. Forest and boulder fields are crossable — troops push through
// the undergrowth and scramble over the stones — but it costs them. These are
// multipliers on how long a tile takes to cross: they divide unit speed
// (js/units.js followPath) and multiply the A* step cost (findPath below), so
// the pathfinder routes around a wood when open ground is only a little longer
// and cuts straight through when it isn't.
const TREE_MOVE_COST = 2.4;
const ROCK_MOVE_COST = 1.9;
// Climbing onto a plateau and marching across its stony top is slower than open
// country, but nowhere near as slow as pushing through a wood.
const HILL_MOVE_COST = 1.5;
// Walkable tiles a nation must be able to reach from its start, or the map
// generator cuts it a track out (see connectStartZones).
const MIN_START_REGION = 500;

// Altitude thresholds on the highland noise field. Tuned against the generator's
// smoothed value noise (which clusters around 0.5 and rarely reaches the ends):
// ~15% of a map comes out highland and ~3.5% of it bare peak.
const HILL_LEVEL = 0.74, PEAK_LEVEL = 0.865;
// Highland is pushed down within this many tiles of a quadrant centre, so no
// nation opens the match walled into a corner of its own start zone.
const HIGHLAND_CLEARANCE = 12;
// A highland mass smaller than this is all rim and no plateau — a one-tile
// stub of cliff reads as litter, not landscape, so it drops back to boulders.
const MIN_HIGHLAND = 7;
// Roughly one ramp per this many tiles of escarpment, never fewer than two per
// plateau, and no two ramps closer together than RAMP_GAP tiles.
const RAMP_SPACING = 16, RAMP_GAP = 7;

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Is this tile part of the highland — plateau top, escarpment or peak? Used for
// autotiling the plateau surface (`highTile`) and for finding the rim.
function isHighland(t) { return t === T_HILL || t === T_CLIFF || t === T_MOUNTAIN; }

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Smooth value noise built from a random grid.
function makeNoise(rng, gridSize) {
  const gw = Math.ceil(MAP_W / gridSize) + 2, gh = Math.ceil(MAP_H / gridSize) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const lerp = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
  return (x, y) => {
    const gx = x / gridSize, gy = y / gridSize;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const v = (xx, yy) => g[yy * gw + xx];
    return lerp(lerp(v(x0, y0), v(x0 + 1, y0), fx), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), fx), fy);
  };
}

class GameMap {
  constructor(seed) {
    this.w = MAP_W; this.h = MAP_H;
    this.terrain = new Uint8Array(MAP_W * MAP_H);
    this.decor = new Int8Array(MAP_W * MAP_H).fill(-1);   // variant index for trees/rocks/grass
    this.bridge = new Uint8Array(MAP_W * MAP_H);          // 1=horizontal 2=vertical
    this.road = new Uint8Array(MAP_W * MAP_H);            // trade-route path marker
    this.buildingAt = new Array(MAP_W * MAP_H).fill(null);
    this.treeWood = new Float32Array(MAP_W * MAP_H);      // remaining wood in tree tiles
    this.startZones = [];
    this.generate(seed);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  t(x, y) { return this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : T_WATER; }

  generate(seed) {
    const rng = mulberry32(seed);
    const elev = makeNoise(rng, 14);
    const forest = makeNoise(rng, 8);
    const rock = makeNoise(rng, 6);
    // Altitude is its own field, not a re-read of `elev`: tying the peaks to the
    // coastline would ring every lake with mountains and leave the interior flat.
    const alt = makeNoise(rng, 15);
    const zones = [[24, 24], [72, 24], [24, 72], [72, 72]];
    // Flatten the altitude field toward each quadrant centre. Without this a
    // seed can drop a mountain range straight across a start zone and the only
    // thing standing between that nation and a sealed box is the connectivity
    // repair at the end — which cuts one 1-tile track and calls it a country.
    const damp = (x, y) => {
      let d = Infinity;
      for (const [zx, zy] of zones) d = Math.min(d, Math.hypot(x - zx, y - zy));
      return d >= HIGHLAND_CLEARANCE ? 0 : (1 - d / HIGHLAND_CLEARANCE) * 0.45;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const e = elev(x, y);
        if (e < 0.32) { this.terrain[i] = T_WATER; continue; }
        const a = alt(x, y) - damp(x, y);
        // Highland wins over forest and boulders: a plateau is bare stone, and a
        // wood drawn on top of one would hide the very barrier it is there to be.
        if (a > PEAK_LEVEL) {
          this.terrain[i] = T_MOUNTAIN;
          this.decor[i] = Math.floor(rng() * 3);
          continue;
        }
        if (a > HILL_LEVEL) { this.terrain[i] = T_HILL; this.decor[i] = -1; continue; }
        if (forest(x, y) > 0.66 && rng() < 0.75) {
          this.terrain[i] = T_TREE;
          this.decor[i] = Math.floor(rng() * 3);
          this.treeWood[i] = 40 + rng() * 30;
        } else if (rock(x, y) > 0.74 && rng() < 0.6) {
          this.terrain[i] = T_ROCK;
          this.decor[i] = Math.floor(rng() * 5);
        } else {
          this.terrain[i] = T_GRASS;
          this.decor[i] = rng() < 0.12 ? Math.floor(rng() * 3) : -1;
        }
      }
    }
    this.raiseHighlands(rng);
    // Sprinkle caves on rocky ground
    let caves = 0;
    for (let tries = 0; tries < 4000 && caves < 14; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] === T_ROCK && this.decor[i] === 0) { this.terrain[i] = T_CAVE; caves++; }
    }
    // …and a few shafts driven into the mountainside, so a range is somewhere a
    // nation wants to reach rather than only something in its way: a Gold Mine
    // needs a cave beside it, and the peak the shaft is cut from stays solid.
    for (let tries = 0, shafts = 0; tries < 3000 && shafts < 5; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] !== T_MOUNTAIN) continue;
      if (!DIRS4.some(([dx, dy]) => this.buildableGround(x + dx, y + dy))) continue;
      this.terrain[i] = T_CAVE; this.decor[i] = 0; shafts++;
    }
    // Four start zones, one per quadrant, cleared and provisioned
    for (const [cx, cy] of zones) {
      this.startZones.push({ x: cx, y: cy });
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const x = cx + dx, y = cy + dy;
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d <= 3) { this.terrain[i] = T_GRASS; this.decor[i] = -1; }
        }
      }
      // guarantee trees, rocks and a cave near each start
      this.plant(rng, cx, cy, T_TREE, 8, 5, 7);
      this.plant(rng, cx, cy, T_ROCK, 5, 5, 7);
      this.plant(rng, cx, cy, T_CAVE, 1, 5, 7);
    }
    this.connectStartZones();
  }

  // Give the raw altitude blobs an edge. Three passes:
  //
  //  1. Every plateau tile touching lower ground becomes an escarpment
  //     (T_CLIFF, impassable), so a highland is a walled tableland rather than a
  //     patch of slow grass. Off-map counts as lower ground, which is why a
  //     plateau running off the edge is still hemmed in there.
  //  2. Highland masses under MIN_HIGHLAND tiles are demoted to boulders: after
  //     pass 1 they are all rim and no top, and a two-tile stub of cliff reads as
  //     litter rather than landscape.
  //  3. Ramps are cut into the rim, once per PLATEAU TOP rather than once per
  //     highland mass — a single mass can hold several tops separated by peaks,
  //     and cutting per mass left whole tabletops sealed. A plateau you cannot
  //     climb is just a bigger lake; one with two or three ways up is high ground
  //     worth holding.
  //
  // A mass whose every tile is cliff after pass 1 (a ridge one or two tiles wide)
  // has no top to cut ramps into and is left whole on purpose: that is the range
  // that makes a chokepoint.
  raiseHighlands(rng) {
    const rim = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (this.terrain[i] !== T_HILL) continue;
        if (DIRS4.some(([dx, dy]) => !isHighland(this.t(x + dx, y + dy)))) rim.push(i);
      }
    }
    for (const i of rim) { this.terrain[i] = T_CLIFF; this.decor[i] = Math.floor(rng() * 2); }

    for (const mass of this.components(isHighland)) {
      if (mass.length >= MIN_HIGHLAND) continue;
      for (const i of mass) { this.terrain[i] = T_ROCK; this.decor[i] = Math.floor(rng() * 5); }
    }
    for (const top of this.components(t => t === T_HILL)) this.cutRamps(rng, top);
  }

  // Every 4-connected group of tiles whose terrain satisfies `match`, as arrays
  // of tile indices. Snapshots the terrain as it stands when called.
  components(match) {
    const seen = new Uint8Array(this.w * this.h);
    const out = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const start = this.idx(x, y);
        if (seen[start] || !match(this.terrain[start])) continue;
        const group = [start];
        seen[start] = 1;
        for (let head = 0; head < group.length; head++) {
          const i = group[head], cx = i % this.w, cy = (i / this.w) | 0;
          for (const [dx, dy] of DIRS4) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.inBounds(nx, ny)) continue;
            const j = this.idx(nx, ny);
            if (seen[j] || !match(this.terrain[j])) continue;
            seen[j] = 1; group.push(j);
          }
        }
        out.push(group);
      }
    }
    return out;
  }

  // Open ways up one plateau top. A ramp head is a rim tile with this top behind
  // it and ground worth stepping onto in front — a cliff whose outward face is
  // lake or cave mouth is no way up, and opening it would only have cost the
  // plateau a piece of its wall. Heads are spaced RAMP_GAP apart so the ways up
  // land on different sides rather than side by side, and each takes its
  // neighbouring cliffs with it, so a ramp is a gap a column can march through
  // and not a one-tile turnstile.
  //
  // A top whose whole rim faces water gets nothing: that is an island plateau,
  // and it is no more sealed than any other island on the map.
  cutRamps(rng, top) {
    const onTop = new Set(top);
    const heads = new Map();
    for (const k of top) {
      const kx = k % this.w, ky = (k / this.w) | 0;
      for (const [dx, dy] of DIRS4) {
        const x = kx + dx, y = ky + dy;
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        if (heads.has(i) || this.terrain[i] !== T_CLIFF) continue;
        const descends = DIRS4.some(([ex, ey]) => {
          const t = this.t(x + ex, y + ey);
          return (t === T_GRASS || t === T_TREE || t === T_ROCK)
            && !onTop.has(this.idx(x + ex, y + ey));
        });
        if (descends) heads.set(i, [x, y]);
      }
    }
    if (!heads.size) return;
    const order = [...heads.values()];
    for (let i = order.length - 1; i > 0; i--) {  // Fisher–Yates on the map's own rng
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const want = Math.max(2, Math.round(order.length / RAMP_SPACING));
    const picked = [];
    for (const [x, y] of order) {
      if (picked.length >= want) break;
      if (picked.some(([px, py]) => Math.hypot(px - x, py - y) < RAMP_GAP)) continue;
      picked.push([x, y]);
    }
    for (const [x, y] of picked) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!this.inBounds(x + dx, y + dy)) continue;
          const i = this.idx(x + dx, y + dy);
          if (this.terrain[i] !== T_CLIFF) continue;
          this.terrain[i] = T_HILL; this.decor[i] = -1;
        }
      }
    }
  }

  // Terrain-only walkability. Used during generation, before any building exists.
  // Plateau tops count: they are open ground that happens to be uphill, and the
  // start-zone repair below has to see a ramp as a way out.
  openAt(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === T_GRASS || t === T_HILL;
  }

  // Ground a building's footprint may claim, used by the generator when siting
  // the mountain shafts. `canPlace` (js/buildings.js) is the runtime authority.
  buildableGround(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === T_GRASS || t === T_TREE || t === T_ROCK || t === T_HILL;
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.openAt(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  // Tiles of a track between two points, stepping one axis at a time. A
  // straight-line rasterisation would step diagonally, and pathfinding here is
  // 4-directional — a diagonal chain of tiles is not a route anyone can walk.
  linePath(x0, y0, x1, y1) {
    const tiles = [[x0, y0]];
    let x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      if (Math.abs(x1 - x) >= Math.abs(y1 - y)) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
      tiles.push([x, y]);
    }
    return tiles;
  }

  // How expensive is a track between these points? Forest and rock are free to
  // cut; water has to be filled into an isthmus and rock face has to be blasted
  // through, so routes needing less of either win. Caves are too valuable to
  // bulldoze, so a route through one is rejected.
  lineCost(x0, y0, x1, y1) {
    let cost = 0;
    for (const [x, y] of this.linePath(x0, y0, x1, y1)) {
      if (!this.inBounds(x, y)) return null;
      const t = this.terrain[this.idx(x, y)];
      if (t === T_CAVE) return null;
      if (t === T_WATER) cost += 3;
      else if (t === T_MOUNTAIN) cost += 2;
      else if (t === T_CLIFF) cost += 1;
    }
    return cost;
  }

  // Cut the track, filling water and breaking rock face as it goes. Plateau tops
  // are already walkable, so a track that climbs one is left as it is.
  carveLine(x0, y0, x1, y1) {
    for (const [x, y] of this.linePath(x0, y0, x1, y1)) {
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      const t = this.terrain[i];
      if (t === T_CAVE || t === T_GRASS || t === T_HILL) continue;
      this.terrain[i] = T_GRASS;
      this.decor[i] = -1;
      this.treeWood[i] = 0;
    }
  }

  // A cut-off start zone is a prison. The clearing above stamps a 7x7 square of
  // grass wherever the quadrant centre lands — including in the middle of a
  // lake — and then plants trees and rocks in the ring just outside it. The
  // result can be an island: a nation with ~46 walkable tiles that can never
  // scout, expand, trade overland, attack, or be attacked for the whole match.
  // Guarantee every start reaches real country by cutting the cheapest track to
  // the nearest large region, filling water into an isthmus where it must.
  connectStartZones() {
    for (const z of this.startZones) {
      const home = this.floodRegion(z.x, z.y, MIN_START_REGION + 1);
      if (home.size > MIN_START_REGION) continue;
      let best = null;
      for (let r = 4; r < 45; r++) {
        for (let a = 0; a < 64; a++) {
          const ang = a / 64 * Math.PI * 2;
          const x = Math.round(z.x + Math.cos(ang) * r), y = Math.round(z.y + Math.sin(ang) * r);
          if (!this.openAt(x, y) || home.has(this.idx(x, y))) continue;
          const cost = this.lineCost(z.x, z.y, x, y);
          if (cost === null) continue;
          if (this.floodRegion(x, y, MIN_START_REGION + 1).size <= MIN_START_REGION) continue;
          if (!best || cost < best.cost) best = { x, y, cost };
          if (best.cost === 0) break;
        }
        // a route needing no earthworks is ideal, but keep widening the search a
        // little in case a much shorter crossing lies just beyond the first one
        if (best && (best.cost === 0 || r > 20)) break;
      }
      if (best) this.carveLine(z.x, z.y, best.x, best.y);
    }
    this.linkStartZones();
  }

  // Every nation must be able to walk to every other. Quadrant centres can land
  // on separate landmasses, and when they do those nations are invisible to each
  // other forever: no scouting, no overland trade, no expansion toward each
  // other, and no war — aiReachInfo (js/ai.js) refuses a campaign it cannot
  // path, and aiFindCrossing only bridges channels up to 16 tiles wide. Rather
  // than a canal-straight highway, link them at the NARROWEST crossing so the
  // result reads as an isthmus.
  linkStartZones() {
    for (let i = 1; i < this.startZones.length; i++) {
      const home = this.floodRegion(this.startZones[0].x, this.startZones[0].y);
      const z = this.startZones[i];
      if (home.has(this.idx(z.x, z.y))) continue;
      this.carveShortestLink(z, home);
    }
  }

  // Dijkstra from a start zone to the nearest tile of `targetSet`. Existing
  // grass and plateau top are nearly free (both are already walkable), forest
  // and rock cost a little (they can be cut), escarpment and peak cost more (a
  // pass has to be broken through them), water costs the most (it has to be
  // filled), and caves are never touched — so the route hugs the land, prefers a
  // ramp already cut into a plateau over blasting its own, and crosses at the
  // tightest gap it can find.
  //
  // `dist` is deliberately Float64Array. It was Float32Array, and the step costs
  // below are values like 0.1 that have no exact float32: writing `dist[j] = nd`
  // rounded the double UP, so the very next time j came up as a neighbour
  // `nd < dist[j]` was true AGAIN and j went back on the heap. Every pop
  // re-pushed all four neighbours, which re-pushed theirs — the search still
  // crawled forward, but at 4^depth cost. It only ever finished because the goal
  // used to be a few thousand pops away; asked for a longer link it hangs the
  // tab. Float64 makes the write round-trip exactly, so a settled node stays
  // settled. (docs/BUGS.md #12.)
  carveShortestLink(z, targetSet) {
    const N = MAP_W * MAP_H;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    const start = this.idx(z.x, z.y);
    dist[start] = 0;
    heap.push(0, start);
    let goal = -1;
    while (heap.size()) {
      const i = heap.pop();
      if (targetSet.has(i)) { goal = i; break; }
      const d = dist[i];
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny), t = this.terrain[j];
        if (t === T_CAVE) continue;
        const nd = d + (t === T_GRASS ? 0.1 : t === T_HILL ? 0.3 : t === T_WATER ? 6
          : t === T_MOUNTAIN ? 4 : t === T_CLIFF ? 2.5 : 1);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
      }
    }
    if (goal < 0) return false;
    for (let i = goal; i !== -1; i = prev[i]) {
      if (this.terrain[i] === T_GRASS || this.terrain[i] === T_HILL) continue;
      this.terrain[i] = T_GRASS;
      this.decor[i] = -1;
      this.treeWood[i] = 0;
    }
    return true;
  }

  plant(rng, cx, cy, type, count, rMin, rMax) {
    for (let tries = 0, placed = 0; tries < 300 && placed < count; tries++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!this.inBounds(x, y) || this.terrain[this.idx(x, y)] !== T_GRASS) continue;
      const i = this.idx(x, y);
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
    // Caves are mouths in the rock face, not ground; escarpments and peaks are
    // the rock face itself — nothing climbs either, which is what makes a
    // plateau defensible and a range a barrier. Everything else — grass, forest,
    // boulder field, plateau top — can be walked; rough or uphill ground just
    // slows the walker down (see moveCost).
    return t !== T_CAVE && t !== T_CLIFF && t !== T_MOUNTAIN;
  }

  // How slow is this tile to cross? 1 is open ground; forest, rock and the climb
  // onto a plateau are higher. Roads, bridges and building tiles are cleared
  // ground by definition, so they always cross at full speed.
  moveCost(x, y) {
    if (!this.inBounds(x, y)) return 1;
    const i = this.idx(x, y);
    if (this.buildingAt[i] || this.bridge[i] || this.road[i]) return 1;
    const t = this.terrain[i];
    return t === T_TREE ? TREE_MOVE_COST : t === T_ROCK ? ROCK_MOVE_COST
      : t === T_HILL ? HILL_MOVE_COST : 1;
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

  // The same neighbour inspection for the plateau surface, over the AT.HI_* set
  // in js/assets.js. Escarpment and peak count as highland here: the rock face
  // and the peaks are drawn standing ON the plateau surface (js/ui.js), so the
  // tableland has to run underneath them unbroken.
  //
  // Returns null for a tile with highland on all four sides — the caller paints
  // the baked interior fill instead. Unlike the water set, this one has no plain
  // cell: every piece of it carries fringe, its "centre" included, so using that
  // cell for the interior tiled a grass tuft across the whole tabletop in a
  // visible grid. See Assets.highFill.
  highTile(x, y) {
    const w = (dx, dy) => isHighland(this.t(x + dx, y + dy));
    const n = w(0, -1), s = w(0, 1), e = w(1, 0), o = w(-1, 0);
    if (n && s && e && o) return null;
    if (!n && !s && !e && !o) return AT.HI_ONE;
    if (!e && !o) return !n ? AT.HI_VN : !s ? AT.HI_VS : AT.HI_V;
    if (!n && !s) return !o ? AT.HI_HW : !e ? AT.HI_HE : AT.HI_H;
    if (!n && !o) return AT.HI_NW;
    if (!n && !e) return AT.HI_NE;
    if (!s && !o) return AT.HI_SW;
    if (!s && !e) return AT.HI_SE;
    if (!n) return AT.HI_N;
    if (!s) return AT.HI_S;
    if (!o) return AT.HI_W;
    return AT.HI_E;
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
function findPath(map, sx, sy, tx, ty, faction, maxIter = 6000) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * map.w + x;
  const open = new MinHeap();
  const came = new Map(), gScore = new Map();
  const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
  const startK = key(sx, sy);
  gScore.set(startK, 0);
  open.push(h(sx, sy), [sx, sy]);
  let bestK = startK, bestH = h(sx, sy);
  let iter = 0;
  while (open.size() && iter++ < maxIter) {
    const [x, y] = open.pop();
    const k = key(x, y);
    if (x === tx && y === ty) return reconstruct(came, k, map);
    const hh = h(x, y);
    if (hh < bestH) { bestH = hh; bestK = k; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      const isGoal = nx === tx && ny === ty;
      if (!map.inBounds(nx, ny)) continue;
      if (!isGoal && !map.passable(nx, ny, faction)) continue;
      if (isGoal && !map.passable(nx, ny, faction)) {
        // allow ending adjacent to an impassable goal (attack/harvest target)
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
      const ng = gScore.get(k) + (map.road[nk] ? 0.7 : map.moveCost(nx, ny));
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
