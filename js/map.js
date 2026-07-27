'use strict';
// Procedural map generation, terrain queries, water autotiling.

const T_GRASS = 0, T_WATER = 1, T_TREE = 2, T_ROCK = 3, T_CAVE = 4;
// Raised ground. A plateau is a mass of high tiles ringed by T_CLIFF — a rock
// face nothing can climb — with a T_RAMP stair or two cut into its south side.
// The top itself stays ordinary terrain (grass, and whatever trees and boulders
// the generator already put there) flagged in `high`, so it builds, harvests and
// fights exactly like low ground; what makes a plateau matter is that the only
// ways onto it are the ramps, which turns every mesa into a chokepoint.
const T_CLIFF = 5, T_RAMP = 6;
const MAP_W = 96, MAP_H = 96;
// Rough ground. Forest and boulder fields are crossable — troops push through
// the undergrowth and scramble over the stones — but it costs them. These are
// multipliers on how long a tile takes to cross: they divide unit speed
// (js/units.js followPath) and multiply the A* step cost (findPath below), so
// the pathfinder routes around a wood when open ground is only a little longer
// and cuts straight through when it isn't.
const TREE_MOVE_COST = 2.4;
const ROCK_MOVE_COST = 1.9;
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
// Walkable tiles a nation must be able to reach from its start, or the map
// generator cuts it a track out (see connectStartZones).
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
    this.high = new Uint8Array(MAP_W * MAP_H);            // 1 = walkable plateau top (see T_CLIFF)
    this.rampDir = new Uint8Array(MAP_W * MAP_H).fill(255); // index into RAMP_DIRS for T_RAMP tiles
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
    // One start zone per quadrant. Declared up here because the plateaus need to
    // know where they are before they can avoid them.
    const zones = [[24, 24], [72, 24], [24, 72], [72, 72]];
    // Raise the plateaus before anything else is placed on the map: they overwrite
    // whatever the noise put on their rim, and the passes below want to see the
    // finished cliffs so caves do not land in a rock face and the connectivity
    // guarantees are made against terrain nobody can climb.
    this.generatePlateaus(rng, zones);
    // Sprinkle caves on rocky ground. A cave is a mouth in a rock face rather
    // than ground, so it is the one thing placed after the plateaus that can take
    // walkable ground away from them: on top it can cut the plateau in two and
    // strand the half without a stair, and at the foot of a ramp it seals the
    // only way up. Keep them off both.
    let caves = 0;
    for (let tries = 0; tries < 4000 && caves < 14; tries++) {
      const x = Math.floor(rng() * this.w), y = Math.floor(rng() * this.h);
      const i = this.idx(x, y);
      if (this.terrain[i] !== T_ROCK || this.decor[i] !== 0 || this.high[i]) continue;
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
    // Clear and provision each start zone
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

  // Raise the high ground. Works on its own noise field so plateaus land
  // independently of where the coastline and the woods fell, then commits one
  // mass at a time — a mass that cannot be given a usable stair is abandoned
  // whole rather than left as a wall around ground no one can reach.
  generatePlateaus(rng, zones) {
    const N = this.w * this.h;
    const field = makeNoise(rng, 12);
    let plat = new Uint8Array(N);
    // A rim tile needs its neighbours to exist, so keep the mass off the border.
    for (let y = 2; y < this.h - 2; y++) {
      for (let x = 2; x < this.w - 2; x++) {
        const i = this.idx(x, y);
        if (this.terrain[i] !== T_WATER && field(x, y) > PLATEAU_LEVEL) plat[i] = 1;
      }
    }
    // Majority smoothing. Thresholded noise frays into single-tile spurs and
    // pinholes, and against this art every one of those reads as a stray boulder
    // rather than a cliff; three passes settle it into masses with an outline.
    for (let pass = 0; pass < 3; pass++) {
      const next = plat.slice();
      for (let y = 2; y < this.h - 2; y++) {
        for (let x = 2; x < this.w - 2; x++) {
          const i = this.idx(x, y);
          if (this.terrain[i] === T_WATER) { next[i] = 0; continue; }
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
        for (let x = 2; x < this.w - 2; x++) {
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
        return Math.abs(rx - x) + Math.abs(ry - y) < 7;
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
  idx2(x, y) {
    return this.idx(Math.min(this.w - 1, Math.max(0, x)), Math.min(this.h - 1, Math.max(0, y)));
  }

  // Terrain-only walkability. Used during generation, before any building exists.
  // Stairs count: they are how the ground on a plateau joins the rest of the map,
  // so a flood that stopped at them would read every mesa as its own island.
  openAt(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === T_GRASS || t === T_RAMP;
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
      // Grass and ramps are already open ground; caves are never touched. A ramp
      // that happened to lie on this line is left alone rather than flattened —
      // if it were its plateau's only stair, bulldozing it would seal the top.
      if (this.terrain[i] === T_CAVE || this.terrain[i] === T_GRASS || this.terrain[i] === T_RAMP) continue;
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
    const N = MAP_W * MAP_H;
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
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny), t = this.terrain[j];
        if (t === T_CAVE) continue;
        if (t === T_CLIFF && !allowCliff) continue;
        // Ramps are already open ground, same as grass — no reason to route
        // around one, and (see carveLine) no reason to flatten it either.
        const nd = d + (t === T_GRASS || t === T_RAMP ? 0.1 : t === T_WATER ? 6 : t === T_CLIFF ? 9 : 1);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
      }
    }
    if (goal < 0) return false;
    for (let i = goal; i !== -1; i = prev[i]) {
      if (this.terrain[i] === T_GRASS || this.terrain[i] === T_RAMP) continue;
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
    // A cliff face is the one piece of terrain with no way through it at all —
    // no bridge, no cutting, no siege. Getting onto a plateau means finding one
    // of its ramps, which is what makes the high ground worth taking.
    if (t === T_CLIFF) return false;
    // Caves are mouths in the rock face, not ground. Everything else — grass,
    // forest, boulder field, stairs — can be walked; rough ground just slows the
    // walker down (see moveCost).
    return t !== T_CAVE;
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
      : t === T_RAMP ? RAMP_MOVE_COST : 1;
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
