'use strict';
// Procedural map generation, terrain queries, water autotiling.

const T_GRASS = 0, T_WATER = 1, T_TREE = 2, T_ROCK = 3, T_CAVE = 4;
const MAP_W = 96, MAP_H = 96;

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
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const e = elev(x, y);
        if (e < 0.32) { this.terrain[i] = T_WATER; continue; }
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
    // Sprinkle caves on rocky ground
    let caves = 0;
    for (let tries = 0; tries < 4000 && caves < 14; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] === T_ROCK && this.decor[i] === 0) { this.terrain[i] = T_CAVE; caves++; }
    }
    // Four start zones, one per quadrant, cleared and provisioned
    const zones = [[24, 24], [72, 24], [24, 72], [72, 72]];
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
    return t === T_GRASS;
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
      const ng = gScore.get(k) + (map.road[nk] ? 0.7 : 1);
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
