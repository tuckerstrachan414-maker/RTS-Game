'use strict';
// The living world: everything the renderer adds that the simulation never
// reads. Nothing in this file touches `game.rng` or writes any sim state — it
// looks at the game and draws — and its randomness comes from `fxRand`, a
// private stream, so a match replays identically whether or not anyone is
// watching it. (The weather itself is sim state and lives in js/seasons.js;
// this file only paints it.)
//
//  * SeasonArt — the atlas re-baked per season: snow in winter, gold and red
//    woods in autumn, blossom and wildflowers in spring. One sheet per climate
//    per frame, blended across the last quarter of each season, chosen per
//    tile by `climateAt`. Baked once and swapped, so seasons cost the terrain
//    pass nothing. Fields change with the year too, and in winter roofs and
//    wall-walks carry snow (`SeasonArt.cap`).
//  * WeatherFX — rain, snow, fog, storms with lightning, drifting autumn
//    leaves and summer fireflies, in screen space over the scene.
//  * FX — world-space particles (dust, sparks, blood, smoke, embers, debris,
//    splashes) and ground decals (blood, scorch marks), fed by hooks the sim
//    calls (`fxHit`, `fxHitBuilding`, `fxRaze`, `fxImpact`, `fxCharge`); fire
//    on burning buildings with its glow at night, chimney smoke, hoof dust,
//    and the glint of sun on open water.

// ---------- a private random stream ----------
let fxSeed = 0x2545f491;
function fxRand() {
  fxSeed ^= fxSeed << 13; fxSeed ^= fxSeed >>> 17; fxSeed ^= fxSeed << 5;
  return ((fxSeed >>> 0) % 1000003) / 1000003;
}
// A stable pseudo-random value for a coordinate: the same every frame.
function fxHash(x, y, k = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Seasonal art
// ---------------------------------------------------------------------------

// Looks: the four seasons, and the tropics' dry season.
const LOOK_SPRING = 0, LOOK_SUMMER = 1, LOOK_AUTUMN = 2, LOOK_WINTER = 3, LOOK_DRY = 4;
const LOOK_COUNT = 5;
// Per climate, which look each season wears: the tropics stay green through
// autumn and bleach to straw in their dry winter; the far north is white from
// autumn. Every climate shows the year turning — the farms feel winter
// everywhere, so the land has to look it.
const CLIMATE_LOOKS = [
  [LOOK_SPRING, LOOK_SUMMER, LOOK_SUMMER, LOOK_DRY],      // hot
  [LOOK_SPRING, LOOK_SUMMER, LOOK_AUTUMN, LOOK_WINTER],   // temperate
  [LOOK_SPRING, LOOK_SUMMER, LOOK_WINTER, LOOK_WINTER],   // cold
];
// The last quarter of a season blends toward the next, in a few steps — the
// first snow, the first gold in the trees.
const SEASON_BLEND_FROM = 0.75;
const SEASON_BLEND_STEPS = 5;

const SeasonArt = {
  looks: null,           // [look] -> ImageData of the whole atlas
  fields: null,          // [look] -> { crop: ImageData, tilled: ImageData }
  data: new Map(),       // blend key -> ImageData
  phaseKey: '',
  frame: null,           // this phase's { sheets[shade], fields[shade], snow[shade] }
  caps: new WeakMap(),   // source image -> Map(region -> snow-cap canvas)

  ready() { return !!(Assets.loaded && Assets.tileset); },

  init() {
    if (this.looks || !this.ready()) return;
    const W = Assets.tileset.width, H = Assets.tileset.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(Assets.tileset, 0, 0);
    const base = g.getImageData(0, 0, W, H);
    this.looks = [];
    this.fields = [];
    for (let look = 0; look < LOOK_COUNT; look++) {
      this.looks.push(bakeSeasonLook(base, look));
      this.fields.push({ crop: bakeFieldLook(look, true), tilled: bakeFieldLook(look, false) });
    }
  },

  // Where the year is, as [seasonA, seasonB, t]: which season's art, blending
  // how far toward the next one.
  phase() {
    if (typeof game === 'undefined' || !game) return [1, 1, 0];
    const len = SEASON_DAYS * DAY_NIGHT_CYCLE;
    const frac = 1 - secondsToNextSeason() / len;
    const a = seasonIndex(), b = (a + 1) % 4;
    if (frac < SEASON_BLEND_FROM) return [a, a, 0];
    const t = (frac - SEASON_BLEND_FROM) / (1 - SEASON_BLEND_FROM);
    const k = Math.min(SEASON_BLEND_STEPS, Math.floor(t * (SEASON_BLEND_STEPS + 1)));
    return [a, b, k / (SEASON_BLEND_STEPS + 1)];
  },

  // Everything the renderer paints with this frame, by climate shade (see
  // `climateShadeAt`): the atlas, the farm fields, and how much snow lies on
  // the roofs. Rebuilt only when the phase of the year moves on — a few times
  // a season — so a frame costs one lookup per tile.
  current() {
    this.init();
    if (!this.looks) return null;
    const [a, b, t] = this.phase();
    const key = `${a}|${b}|${t.toFixed(3)}`;
    if (key === this.phaseKey && this.frame) return this.frame;
    this.phaseKey = key;
    this.data.clear();
    // the three pure climates at this point in the year…
    const pure = CLIMATE_LOOKS.map(L => ({
      atlas: this.mix(this.looks[L[a]], this.looks[L[b]], t),
      crop: this.mix(this.fields[L[a]].crop, this.fields[L[b]].crop, t),
      tilled: this.mix(this.fields[L[a]].tilled, this.fields[L[b]].tilled, t),
      snow: (L[a] === LOOK_WINTER ? 1 : 0) * (1 - t) + (L[b] === LOOK_WINTER ? 1 : 0) * t,
    }));
    // …and the shades between them
    const frame = { sheets: [], fields: [], snow: [] };
    for (let j = 0; j <= CLIMATE_SHADES; j++) {
      const c = j * 2 / CLIMATE_SHADES, lo = Math.min(1, Math.floor(c)), f = c - lo;
      const A = pure[lo], B = pure[lo + 1];
      frame.sheets.push(toCanvasFrom(this.mix(A.atlas, B.atlas, f)));
      frame.fields.push({ crop: toCanvasFrom(this.mix(A.crop, B.crop, f)), tilled: toCanvasFrom(this.mix(A.tilled, B.tilled, f)) });
      frame.snow.push(A.snow + (B.snow - A.snow) * f);
    }
    this.frame = frame;
    return frame;
  },

  // Per-pixel blend of two same-sized ImageData.
  mix(A, B, t) {
    if (t <= 0 || A === B) return A;
    if (t >= 1) return B;
    const out = new ImageData(A.width, A.height);
    const pa = A.data, pb = B.data, po = out.data;
    for (let i = 0; i < pa.length; i++) po[i] = pa[i] + (pb[i] - pa[i]) * t;
    return out;
  },

  snowWeight(shade) {
    const fr = this.current();
    return fr ? fr.snow[shade] : 0;
  },

  // A snow cap for one region of a sprite sheet: every opaque pixel with open
  // sky above it turns white, and the one beneath it pale — a roof ridge, a
  // parapet, the top of a tower. Cached per source and region.
  cap(src, sx, sy, sw, sh) {
    let bySrc = this.caps.get(src);
    if (!bySrc) this.caps.set(src, bySrc = new Map());
    const key = `${sx},${sy},${sw},${sh}`;
    if (bySrc.has(key)) return bySrc.get(key);
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    const d = g.getImageData(0, 0, sw, sh), p = d.data;
    const out = g.createImageData(sw, sh), q = out.data;
    const a = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh) ? 0 : p[(y * sw + x) * 4 + 3];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (a(x, y) < 120) continue;
        if (a(x, y - 1) >= 60) continue;
        const i = (y * sw + x) * 4;
        q[i] = 242; q[i + 1] = 246; q[i + 2] = 250; q[i + 3] = 255;
        if (a(x, y + 1) >= 120) {
          const j = ((y + 1) * sw + x) * 4;
          q[j] = 214; q[j + 1] = 224; q[j + 2] = 236; q[j + 3] = 200;
        }
      }
    }
    g.clearRect(0, 0, sw, sh);
    g.putImageData(out, 0, 0);
    bySrc.set(key, c);
    return c;
  },
};

function toCanvasFrom(data) {
  const c = document.createElement('canvas');
  c.width = data.width; c.height = data.height;
  c.getContext('2d').putImageData(data, 0, 0);
  return c;
}

// One season's version of the whole atlas.
function bakeSeasonLook(base, look) {
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  if (look === LOOK_SUMMER) return out;
  const p = out.data, W = base.width;
  const cellOf = (x, y) => `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
  const treeCells = new Map();
  AT.TREES.forEach((at, i) => treeCells.set(`${at[0]},${at[1]}`, i));
  treeCells.set(`${AT.SAPLING[0]},${AT.SAPLING[1]}`, 3);
  const rockCells = new Set(AT.ROCKS.map(at => `${at[0]},${at[1]}`));
  const flowerCells = new Set(AT.GRASS_VARS.map(at => `${at[0]},${at[1]}`));
  // autumn colours per tree variant: orange, red, yellow, and the sapling amber
  const AUTUMN_HUE = [28, 15, 44, 34];
  const green = (h, s, l) => h >= 48 && h <= 172 && s >= 0.12 && l >= 0.08 && l <= 0.93;
  const water = (h, s) => h >= 188 && h <= 256 && s >= 0.28;
  const foam = (h, s, l) => h >= 168 && h < 200 && s >= 0.35 && l >= 0.5;
  const orig = base.data;
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= base.height) ? 0 : orig[(y * W + x) * 4 + 3];
  const greenAt = (x, y) => {
    if (alphaAt(x, y) < 60) return false;
    const i = (y * W + x) * 4;
    const [h, s, l] = rgbToHsl(orig[i], orig[i + 1], orig[i + 2]);
    return green(h, s, l);
  };
  const set = (i, r, g, b) => { p[i] = r; p[i + 1] = g; p[i + 2] = b; };
  const mix = (c0, c1, t) => [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Translucent pixels are the sprites' soft shadows: they keep their
      // colour, or an autumn wood grows a halo of bright red.
      if (p[i + 3] < 200) continue;
      const [h, s, l] = rgbToHsl(orig[i], orig[i + 1], orig[i + 2]);
      const cell = cellOf(x, y);
      const tree = treeCells.has(cell) ? treeCells.get(cell) : -1;
      const rock = rockCells.has(cell);
      if (rock && look === LOOK_WINTER) {
        // a boulder keeps its stone and wears snow on its upper faces
        const top = alphaAt(x, y - 1) < 60 || (alphaAt(x, y - 2) < 60 && l > 0.45);
        if (top) set(i, 238, 243, 248);
        else if (green(h, s, l)) set(i, ...hslToRgb(210, 0.08, l * 0.95));
      } else if (green(h, s, l)) {
        if (look === LOOK_WINTER) {
          if (tree >= 0) {
            // evergreen dark under a cap of snow on every upward face
            const top = !greenAt(x, y - 1) || y % TILE === 0;
            const top2 = !top && (!greenAt(x, y - 2) || (y - 1) % TILE === 0);
            if (top || l > 0.62) set(i, 236, 242, 248);
            else if (top2) set(i, 204, 216, 228);
            else set(i, ...hslToRgb(152, s * 0.5, l * 0.78));
          } else {
            // snow over the ground, keeping the grass's shading as drifts
            const t = Math.max(0, Math.min(1, (l - 0.22) / 0.46));
            set(i, ...(l < 0.2 ? mix([96, 110, 132], [150, 164, 184], l / 0.2) : mix([184, 198, 214], [236, 241, 246], t)));
          }
        } else if (look === LOOK_AUTUMN) {
          if (tree >= 0) {
            const hue = AUTUMN_HUE[tree] + (h - 110) * 0.18;
            // the soft outer leaves are fallen ones: browner and duller, or a
            // red wood grows a ring that reads as blood
            if (p[i + 3] < 250) set(i, ...hslToRgb(hue + 14, s * 0.55, l * 0.85));
            else set(i, ...hslToRgb(hue, Math.min(0.7, s * 1.1 + 0.06), Math.min(0.76, l)));
          } else {
            set(i, ...hslToRgb(h + (40 - h) * 0.55, s * 0.82, l * 0.95));
          }
        } else if (look === LOOK_DRY) {
          if (tree >= 0) set(i, ...hslToRgb(h + (72 - h) * 0.35, s * 0.72, l * 0.95));
          else set(i, ...hslToRgb(h + (46 - h) * 0.72, s * 0.58, Math.min(0.86, l * 1.06)));
        } else if (look === LOOK_SPRING) {
          if (tree >= 0) {
            const bloom = (tree === 2 || tree === 0) && l > 0.4 && fxHash(x, y, 7) < (tree === 2 ? 0.2 : 0.09);
            if (bloom) set(i, ...(fxHash(x, y, 9) < 0.5 ? [247, 182, 210] : [255, 236, 244]));
            else set(i, ...hslToRgb(h + 4, Math.min(1, s * 1.1), Math.min(0.85, l * 1.05)));
          } else {
            // fresher and a little bluer than summer, not brighter: the
            // flowers carry the season
            set(i, ...hslToRgb(h + 9, s * 0.92, l * 0.98));
          }
        }
      } else if (look === LOOK_WINTER && water(h, s)) {
        set(i, ...hslToRgb(h, s * 0.72, Math.min(0.9, l * 0.95 + 0.06)));
      } else if (look === LOOK_WINTER && foam(h, s, l)) {
        set(i, 226, 240, 248);        // ice along the shore
      }
    }
  }
  // spring: wildflowers in the meadow tiles (the decor variants, never the
  // plain grass — a flower on every tile would read as wallpaper)
  if (look === LOOK_SPRING) {
    const PETALS = [[247, 170, 204], [255, 244, 214], [250, 214, 90], [190, 170, 250]];
    for (const at of AT.GRASS_VARS) {
      for (let k = 0; k < 3; k++) {
        const fx0 = at[0] * TILE + 2 + Math.floor(fxHash(at[0], at[1], k * 2) * 11);
        const fy0 = at[1] * TILE + 2 + Math.floor(fxHash(at[0], at[1], k * 2 + 1) * 11);
        const col = PETALS[Math.floor(fxHash(at[0], k, 5) * PETALS.length)];
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
          const j = ((fy0 + dy) * W + fx0 + dx) * 4;
          p[j] = col[0]; p[j + 1] = col[1]; p[j + 2] = col[2]; p[j + 3] = 255;
        }
        const j = (fy0 * W + fx0) * 4;
        p[j] = 255; p[j + 1] = 220; p[j + 2] = 90; p[j + 3] = 255;
      }
    }
  }
  return out;
}

// A farm field in each season: shoots in spring, the green crop of summer,
// gold at harvest, and bare furrows under snow in winter.
function bakeFieldLook(look, planted) {
  const c = bakeArt(null, px => {
    px('#6d4a2c', 0, 0, TILE, TILE);
    for (let y = 0; y < TILE; y += 4) {
      px('#5a3b22', 0, y, TILE, 1);
      px('#7d5734', 0, y + 2, TILE, 1);
    }
    if (look === LOOK_WINTER) {
      for (let y = 0; y < TILE; y += 4) {
        px('#dfe7ef', 0, y + 2, TILE, 1);
        for (let x = 0; x < TILE; x += 2) if (fxHash(x, y, 3) < 0.45) px('#f1f5f9', x, y + 1, 2, 1);
      }
      return;
    }
    if (!planted) return;
    for (let y = 0; y < TILE; y += 4) {
      for (let x = 1; x < TILE; x += 3) {
        const ripe = (x + y) % 6 === 0;
        if (look === LOOK_SPRING) {
          px('#5f9a3c', x, y + 1, 1, 2);
          px('#8fd06a', x, y + 1, 1, 1);
        } else if (look === LOOK_DRY) {
          if ((x + y) % 2) continue;                  // a thin dry-season crop
          px('#a88a4a', x, y + 1, 1, 2);
          px('#cbb070', x, y + 1, 1, 1);
        } else if (look === LOOK_AUTUMN) {
          px(ripe ? '#b98c2c' : '#d4aa3c', x, y, 2, 3);
          px(ripe ? '#e0bb55' : '#f2d56e', x, y, 1, 1);
        } else {
          px(ripe ? '#c9ad42' : '#4f8a33', x, y, 2, 3);
          px(ripe ? '#e2c766' : '#6fb04a', x, y, 1, 1);
        }
      }
    }
  });
  return c.getContext('2d').getImageData(0, 0, TILE, TILE);
}

// ---------------------------------------------------------------------------
// Particles and decals
// ---------------------------------------------------------------------------

const FX_MAX_PARTICLES = 900;
const FX_MAX_DECALS = 140;
const FX_PAL = {
  dust: ['#b8a58a', '#9c8a70', '#cbbba0'],
  smoke: ['#5f5a56', '#6e6a66', '#7c7772'],
  chimney: ['#cfcac4', '#b8b3ae', '#a9a49f'],
  spark: ['#fff3b0', '#ffd24a', '#ffffff'],
  ember: ['#ff9a3a', '#ffcf5a', '#ff6a2a'],
  blood: ['#8a1c1c', '#6e1414', '#a52a2a'],
  debris: ['#7a5a3a', '#5c4430', '#9a9088'],
  splash: ['#dff3ff', '#a9d8f0', '#ffffff'],
  magic: ['#ff7a2a', '#ffd04a', '#ff4a1a'],
  snowpuff: ['#eef3f8', '#dde6ee', '#ffffff'],
};

const FX = {
  parts: [],
  decals: [],
  last: 0,
  dt: 0,
  timers: new WeakMap(),   // per-building/unit emitter clocks
  shake: 0,
  glowSprite: null,

  beginFrame() {
    const now = performance.now();
    this.dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.now = now / 1000;
  },

  // Add a particle. Positions and speeds are world tiles; `z` is height above
  // the ground in tiles (drawn upward), so debris can arc and fall where it
  // lands. `size` and `grow` are in art pixels (1/16 of a tile), so a puff
  // keeps its proportions at every zoom.
  add(kind, x, y, o = {}) {
    // At the cap a new puff is simply dropped: shifting the oldest out is an
    // O(n) move per particle, and a tab in the background (or a headless run)
    // never renders, so nothing ages out and every blow would pay it.
    if (this.parts.length >= FX_MAX_PARTICLES) return;
    const pal = FX_PAL[kind] || FX_PAL.dust;
    this.parts.push({
      kind, x, y, z: o.z || 0,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      g: o.g || 0, drag: o.drag || 0,
      life: o.life || 0.6, age: 0,
      size: o.size || 1, grow: o.grow || 0,
      alpha: o.alpha != null ? o.alpha : 1,
      col: pal[Math.floor(fxRand() * pal.length)],
      rise: o.rise || 0,
    });
  },

  burst(kind, x, y, n, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = fxRand() * Math.PI * 2, sp = (o.speed || 1) * (0.4 + fxRand() * 0.8);
      this.add(kind, x + (fxRand() - 0.5) * (o.spread || 0.2), y + (fxRand() - 0.5) * (o.spread || 0.2), {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5,
        vz: o.up ? o.up * (0.5 + fxRand()) : 0, g: o.g || 0, drag: o.drag || 1.5,
        z: o.z || 0, life: (o.life || 0.5) * (0.7 + fxRand() * 0.6),
        size: (o.size || 1) * (0.7 + fxRand() * 0.6), grow: o.grow || 0,
        alpha: o.alpha != null ? o.alpha : 1, rise: o.rise || 0,
      });
    }
  },

  decal(kind, x, y, r, life) {
    if (this.decals.length >= FX_MAX_DECALS) this.decals.shift();
    this.decals.push({ kind, x, y, r, life, age: 0, seed: Math.floor(fxRand() * 1e6) });
  },

  update() {
    const dt = this.dt;
    const parts = this.parts;
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt + p.rise * dt;
      if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.5; p.vy *= 0.5; }
      p.size += p.grow * dt;
      parts[w++] = p;
    }
    parts.length = w;
    for (const d of this.decals) d.age += dt;
    this.decals = this.decals.filter(d => d.age < d.life);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 12);
  },

  drawParticles(ui) {
    const ctx = ui.ctx, z = ui.cam.zoom;
    for (const p of this.parts) {
      if (!ui.onScreen(p.x, p.y, 1)) continue;
      const [sx, sy] = ui.worldToScreen(p.x, p.y - p.z);
      const fade = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, p.alpha * (p.kind === 'smoke' || p.kind === 'chimney' || p.kind === 'dust' || p.kind === 'snowpuff' ? fade : Math.min(1, fade * 2)));
      ctx.fillStyle = p.col;
      const d = Math.max(1, Math.round(p.size * z));
      ctx.fillRect(Math.round(sx - d / 2), Math.round(sy - d / 2), d, d);
      if ((p.kind === 'smoke' || p.kind === 'chimney' || p.kind === 'dust') && d >= 3) {
        // a puff is two offset squares, so it reads round rather than blocky
        const e = Math.round(d * 0.7);
        ctx.fillRect(Math.round(sx - e / 2 + d * 0.3), Math.round(sy - e / 2 - d * 0.25), e, e);
      }
    }
    ctx.globalAlpha = 1;
  },

  drawDecals(ui) {
    const ctx = ui.ctx, z = ui.cam.zoom;
    for (const d of this.decals) {
      if (!ui.onScreen(d.x, d.y, 2)) continue;
      const fade = Math.min(1, (d.life - d.age) / (d.life * 0.4));
      const [sx, sy] = ui.worldToScreen(d.x, d.y);
      const R = d.r * TILE * z;
      const n = d.kind === 'blood' ? 6 : 9;
      ctx.globalAlpha = fade * (d.kind === 'blood' ? 0.75 : 0.55);
      ctx.fillStyle = d.kind === 'blood' ? '#5e1212' : '#2a2018';
      for (let k = 0; k < n; k++) {
        const a = fxHash(d.seed, k, 1) * Math.PI * 2, r = fxHash(d.seed, k, 2) * R;
        const s = Math.max(1, Math.round((0.35 + fxHash(d.seed, k, 3) * 0.65) * R * 0.6));
        ctx.fillRect(Math.round(sx + Math.cos(a) * r - s / 2), Math.round(sy + Math.sin(a) * r * 0.55 - s / 4), s, Math.max(1, Math.round(s * 0.55)));
      }
    }
    ctx.globalAlpha = 1;
  },

  // ---------- fire ----------

  // Fire on every building below half its strength: one flame, two, three as it
  // burns down, each throwing smoke and the odd ember. Returns the flames drawn
  // so their light can be added after the night overlay.
  drawFires(ui) {
    const ctx = ui.ctx, z = ui.cam.zoom, t = this.now || 0;
    const lit = [];
    for (const f of game.factions) {
      for (const b of f.buildings) {
        if (!b.done || b.hp <= 0 || b.type.key === 'bridge' || b.type.flat) continue;
        const ratio = b.hp / b.maxHp;
        if (ratio >= 0.5) continue;
        if (!ui.onScreen(b.cx, b.cy, b.type.size + 1)) continue;
        const n = ratio < 0.2 ? 3 : ratio < 0.35 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const fx0 = b.x + 0.2 + fxHash(b.x, b.y, k * 2) * (b.type.size - 0.4);
          const fy0 = b.y + 0.3 + fxHash(b.x, b.y, k * 2 + 1) * (b.type.size * 0.45);
          const [sx, sy] = ui.worldToScreen(fx0, fy0);
          drawFlame(ctx, sx, sy, z, t * 11 + k * 2.3 + b.x);
          lit.push([sx, sy]);
          this.emit(b, k, 0.18, () => this.add('smoke', fx0 + (fxRand() - 0.5) * 0.1, fy0, {
            z: 0.35, rise: 0.9 + fxRand() * 0.4, vx: 0.08 + (fxRand() - 0.5) * 0.12, drag: 0.2,
            life: 2.2, size: 5, grow: 5, alpha: 0.5 }));
          this.emit(b, k + 10, 0.55, () => this.add('ember', fx0, fy0, {
            z: 0.3, rise: 1.4, vx: (fxRand() - 0.5) * 0.6, drag: 0.4, life: 0.9, size: 1 }));
        }
      }
    }
    return lit;
  },

  // Fire and burning light at night, drawn over the dark.
  drawGlow(ui, lit) {
    if (!lit.length) return;
    const dark = 1 - game.lightLevel();
    const ctx = ui.ctx, z = ui.cam.zoom;
    if (!this.glowSprite) this.glowSprite = makeGlowSprite();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.1 + dark * 0.32;
    const R = 1.5 * TILE * z;
    for (const [sx, sy] of lit) ctx.drawImage(this.glowSprite, sx - R, sy - R, R * 2, R * 2);
    ctx.restore();
  },

  // Rate-limit an emitter keyed on an object and a slot: `fn` runs about once
  // every `period` seconds per slot.
  emit(obj, slot, period, fn) {
    let m = this.timers.get(obj);
    if (!m) this.timers.set(obj, m = {});
    const now = this.now || 0;
    if (m[slot] === undefined) m[slot] = now + fxRand() * period;
    if (now < m[slot]) return;
    m[slot] = now + period * (0.7 + fxRand() * 0.6);
    fn();
  },

  // Houses keep a fire going: a thread of chimney smoke, thicker on a cold night.
  chimney(ui, b) {
    if (ui.cam.zoom < 1.5) return;
    const cold = (typeof isWinter === 'function' && isWinter()) ? 1 : 0;
    const dark = 1 - game.lightLevel();
    const period = 0.9 - cold * 0.35 - dark * 0.25;
    const x = b.x + (b.type.key === 'townhall' ? 1.45 : 0.72), y = b.y + (b.type.key === 'townhall' ? 0.25 : 0.14);
    this.emit(b, 'c', period, () => this.add('chimney', x + (fxRand() - 0.5) * 0.05, y, {
      z: 0.1, rise: 0.55 + fxRand() * 0.2, vx: 0.12 + fxRand() * 0.08, drag: 0.1,
      life: 2.6, size: 3, grow: 3.2, alpha: 0.42 }));
  },

  // Horses and wheels kick up the road.
  hoof(ui, u) {
    if (ui.cam.zoom < 1.5) return;
    const snow = SeasonArt.snowWeight(climateShadeAt(u.tileX, u.tileY)) > 0.5;
    this.emit(u, 'h', 0.16, () => this.add(snow ? 'snowpuff' : 'dust', u.x + (fxRand() - 0.5) * 0.3, u.y + 0.05, {
      vx: -(u.facing || 1) * (0.3 + fxRand() * 0.3), vy: (fxRand() - 0.5) * 0.1, drag: 2,
      life: 0.7, size: 3, grow: 4, alpha: 0.5 }));
  },

  // A glint of light on open water: a few tiles in every patch catch the sun
  // in turn. Called from the terrain pass, so it costs one branch per tile
  // when there is nothing to draw.
  waterGlint(ui, x, y) {
    const h = fxHash(x, y, 11);
    if (h > 0.12) return;
    const ph = Math.sin((this.now || 0) * (1.2 + h * 6) + h * 80);
    if (ph < 0.78) return;
    const z = ui.cam.zoom;
    const [sx, sy] = ui.worldToScreen(x + 0.2 + fxHash(x, y, 12) * 0.6, y + 0.2 + fxHash(x, y, 13) * 0.6);
    const ctx = ui.ctx;
    ctx.globalAlpha = (ph - 0.78) / 0.22 * (0.35 + game.lightLevel() * 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(sx), Math.round(sy), Math.max(1, Math.round(2 * z)), Math.max(1, Math.round(z * 0.6)));
    ctx.globalAlpha = 1;
  },
};

function drawFlame(ctx, sx, sy, z, t) {
  const cols = [[-2, '#c8401c'], [-1, '#ff7a2a'], [0, '#ff9a2a'], [1, '#ff7a2a'], [2, '#c8401c']];
  for (const [c, col] of cols) {
    const h = (5.5 - Math.abs(c) * 1.4) * (0.75 + 0.3 * Math.sin(t + c * 1.7) + 0.15 * Math.sin(t * 2.3 - c));
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(sx + c * z), Math.round(sy - h * z), Math.max(1, Math.round(z)), Math.max(1, Math.round(h * z)));
  }
  for (const c of [-1, 0, 1]) {
    const h = (3.4 - Math.abs(c)) * (0.7 + 0.3 * Math.sin(t * 1.3 + c));
    ctx.fillStyle = c === 0 ? '#fff0a0' : '#ffd24a';
    ctx.fillRect(Math.round(sx + c * z), Math.round(sy - h * z), Math.max(1, Math.round(z)), Math.max(1, Math.round(h * z)));
  }
}

function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,170,70,0.55)');
  grd.addColorStop(0.4, 'rgba(255,120,40,0.22)');
  grd.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// ---------- hooks the simulation calls ----------
// Each one only reads what it is handed and adds particles; none returns
// anything or changes the object it is given. They are no-ops for anything
// off screen, so a headless run collects no particles.

function fxVisible(x, y) { return typeof ui !== 'undefined' && ui && ui.canvas && ui.onScreen(x, y, 2); }

// A unit takes a blow.
function fxHit(u, attacker, amount, killed) {
  if (!fxVisible(u.x, u.y)) return;
  if (u.type.naval) {
    FX.burst('splash', u.x, u.y, killed ? 14 : 3, { speed: 1.2, up: 1.5, g: 5, life: 0.6, size: 1.5 });
    if (killed) FX.burst('debris', u.x, u.y, 10, { speed: 1.5, up: 2, g: 6, life: 1, size: 1.8 });
    return;
  }
  const melee = attacker && attacker.type && attacker.type.dmgType === 'melee';
  const armoured = (u.type.armor || 0) > 0 || u.type.key === 'shield' || u.type.key === 'knight';
  if (melee && armoured) FX.burst('spark', u.x, u.y - 0.35, 3, { speed: 2.2, up: 1, g: 4, life: 0.25, size: 1 });
  if (!u.type.baked) FX.burst('blood', u.x, u.y - 0.3, Math.min(6, 1 + Math.round(amount / 6)), { speed: 0.9, up: 1.2, g: 6, life: 0.5, size: 1.4, z: 0.3 });
  if (killed) {
    FX.burst('dust', u.x, u.y, 5, { speed: 0.5, life: 0.8, size: 4, grow: 5, alpha: 0.55 });
    if (!u.type.baked && !u.type.civilian) FX.decal('blood', u.x, u.y + 0.1, 0.22, 26);
    else if (!u.type.baked) FX.decal('blood', u.x, u.y + 0.1, 0.16, 18);
  }
}

// A building takes a blow.
function fxHitBuilding(b, attacker, dmg) {
  if (!fxVisible(b.cx, b.cy)) return;
  const x = b.cx + (fxRand() - 0.5) * b.type.size * 0.6, y = b.cy + (fxRand() - 0.5) * b.type.size * 0.4;
  FX.burst('debris', x, y, Math.min(5, 1 + Math.round(dmg / 12)), { speed: 1, up: 1.4, g: 6, life: 0.7, size: 1.4, z: 0.4 });
  FX.burst('dust', x, y, 2, { speed: 0.4, life: 0.7, size: 4, grow: 5, alpha: 0.5, z: 0.2 });
}

// A building falls.
function fxRaze(b) {
  if (!fxVisible(b.cx, b.cy)) return;
  const n = 8 + b.type.size * 6;
  FX.burst('dust', b.cx, b.cy, n, { speed: 0.9, spread: b.type.size * 0.8, life: 1.6, size: 7, grow: 8, alpha: 0.7 });
  FX.burst('debris', b.cx, b.cy, n, { speed: 1.8, spread: b.type.size * 0.6, up: 2.2, g: 7, life: 1.1, size: 1.8 });
  FX.burst('smoke', b.cx, b.cy, 6, { speed: 0.3, spread: b.type.size * 0.5, life: 2.6, size: 8, grow: 8, alpha: 0.55, rise: 0.8 });
  FX.decal('scorch', b.cx, b.cy, 0.45 * b.type.size + 0.2, 90);
  FX.shake = Math.max(FX.shake, 1.5);
}

// A missile lands.
function fxImpact(p) {
  if (!fxVisible(p.x, p.y)) return;
  if (p.kind === 'boulder') {
    FX.burst('dust', p.x, p.y, 10, { speed: 1.1, life: 1.1, size: 6, grow: 7, alpha: 0.7 });
    FX.burst('debris', p.x, p.y, 8, { speed: 1.8, up: 2, g: 7, life: 0.9, size: 1.8 });
    FX.decal('scorch', p.x, p.y, 0.25, 40);
    FX.shake = Math.max(FX.shake, 1);
  } else if (p.kind === 'fireball') {
    FX.burst('magic', p.x, p.y, 9, { speed: 1.4, up: 0.6, g: 1, life: 0.45, size: 1.8 });
    FX.burst('smoke', p.x, p.y, 2, { speed: 0.3, life: 1, size: 5, grow: 5, alpha: 0.4, rise: 0.5 });
  } else {
    FX.burst('dust', p.x, p.y, 1, { speed: 0.2, life: 0.35, size: 2, grow: 3, alpha: 0.4 });
  }
}

// A cavalry charge strikes home.
function fxCharge(u, t) {
  if (!fxVisible(u.x, u.y)) return;
  FX.burst('dust', t.x, t.y, 8, { speed: 1.4, life: 0.9, size: 5, grow: 6, alpha: 0.65 });
  FX.burst('spark', t.x, t.y - 0.3, 5, { speed: 2.5, up: 1, g: 4, life: 0.3, size: 1 });
}

// ---------------------------------------------------------------------------
// Weather, in screen space
// ---------------------------------------------------------------------------

const WeatherFX = {
  drops: [], flakes: [], leaves: [], flies: [], splashes: [],
  kind: 'clear', level: 0,
  flash: 0, nextBolt: 8,
  camX: null, camY: null,

  // The weather as seen where the camera is looking.
  current(ui) {
    const s = TILE * ui.cam.zoom;
    const cx = ui.cam.x + ui.canvas.width / s / 2, cy = ui.cam.y + ui.canvas.height / s / 2;
    return typeof weatherAt === 'function' ? weatherAt(wrapX(Math.floor(cx)), Math.max(0, Math.min(MAP_H - 1, Math.floor(cy)))) : { key: 'clear' };
  },

  draw(ui) {
    const ctx = ui.ctx, W = ui.canvas.width, H = ui.canvas.height;
    const dt = FX.dt;
    const w = this.current(ui);
    // ease in and out rather than switching on the stroke of a half-day
    if (w.key !== this.kind) {
      this.level = Math.max(0, this.level - dt / 3);
      if (this.level === 0) this.kind = w.key;
    } else this.level = Math.min(1, this.level + dt / 5);
    // particles live in screen space but are carried with the camera, so a pan
    // moves the ground under the weather rather than the weather with you
    const s = TILE * ui.cam.zoom;
    if (this.camX !== null) {
      const dx = wdx(this.camX, ui.cam.x) * s, dy = (ui.cam.y - this.camY) * s;
      if (Math.abs(dx) < W && Math.abs(dy) < H) {
        for (const a of [this.drops, this.flakes, this.leaves, this.flies]) for (const p of a) { p.x -= dx; p.y -= dy; }
      }
    }
    this.camX = ui.cam.x; this.camY = ui.cam.y;
    const area = W * H;
    const kind = this.kind, lv = this.level;
    const rainy = kind === 'rain' || kind === 'storm';
    this.fill(this.drops, rainy ? Math.round(area / (kind === 'storm' ? 1100 : 1900) * lv) : 0, () => ({
      x: fxRand() * W, y: fxRand() * H, v: 700 + fxRand() * 400, len: 8 + fxRand() * 9 }));
    this.fill(this.flakes, kind === 'snow' ? Math.round(area / 2600 * lv) : 0, () => {
      const near = fxRand();                       // nearer flakes: bigger, faster, brighter
      return { x: fxRand() * W, y: fxRand() * H, v: 28 + near * 70, r: 2 + Math.floor(near * 2.6), ph: fxRand() * 6, a: 0.55 + near * 0.45 };
    });
    const autumn = typeof seasonIndex === 'function' && seasonIndex() === 2 && kind !== 'storm';
    this.fill(this.leaves, autumn ? Math.round(area / 42000) : 0, () => ({
      x: fxRand() * W, y: fxRand() * H, v: 18 + fxRand() * 22, ph: fxRand() * 6,
      col: ['#d9822b', '#c4451c', '#e8b53a', '#a8541e'][Math.floor(fxRand() * 4)] }));
    const dark = 1 - game.lightLevel();
    const summerNight = typeof seasonIndex === 'function' && seasonIndex() === 1 && dark > 0.45 && !rainy;
    this.fill(this.flies, summerNight ? Math.round(area / 30000) : 0, () => ({
      x: fxRand() * W, y: fxRand() * H, ph: fxRand() * 6, vx: (fxRand() - 0.5) * 12, vy: (fxRand() - 0.5) * 12 }));

    // fog: a grey veil with slow banks drifting through it
    if (kind === 'fog' && lv > 0) {
      ctx.fillStyle = `rgba(206,212,218,${(0.2 * lv).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      if (!FX.glowSprite) FX.glowSprite = makeGlowSprite();
      if (!this.fogSprite) this.fogSprite = makeFogSprite();
      const t = FX.now || 0;
      ctx.globalAlpha = 0.4 * lv;
      for (let k = 0; k < 5; k++) {
        const bx = ((fxHash(k, 1) * W + t * (8 + k * 3) - (this.camX || 0) * s * 0.3) % (W + 600) + W + 600) % (W + 600) - 300;
        const by = fxHash(k, 2) * H;
        const R = 260 + fxHash(k, 3) * 220;
        ctx.drawImage(this.fogSprite, bx - R, by - R * 0.5, R * 2, R);
      }
      ctx.globalAlpha = 1;
    }
    if (rainy && lv > 0) {
      // a wet day is a grey one
      ctx.fillStyle = `rgba(30,38,52,${((kind === 'storm' ? 0.2 : 0.1) * lv).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    // rain: one path of streaks, blown a little sideways
    if (this.drops.length) {
      const wind = kind === 'storm' ? -0.28 : -0.12;
      ctx.strokeStyle = `rgba(206,218,238,${(0.55 * lv).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.v * dt; d.x += d.v * wind * dt;
        if (d.y > H) { d.y -= H + d.len; d.x = fxRand() * W; if (fxRand() < 0.25) this.splashes.push({ x: d.x, y: fxRand() * H, t: 0 }); }
        if (d.x < -20) d.x += W + 20; else if (d.x > W + 20) d.x -= W + 20;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * wind, d.y - d.len);
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(214,226,244,${(0.5 * lv).toFixed(3)})`;
      for (const p of this.splashes) { p.t += dt; ctx.fillRect(p.x - 1, p.y, 3, 1); }
      this.splashes = this.splashes.filter(p => p.t < 0.12).slice(-120);
    }
    if (this.flakes.length) {
      const t = FX.now || 0;
      ctx.fillStyle = '#f8fbff';
      for (const f of this.flakes) {
        f.y += f.v * dt; f.x += Math.sin(t * 1.3 + f.ph) * 14 * dt;
        if (f.y > H) { f.y -= H; f.x = fxRand() * W; }
        if (f.x < 0) f.x += W; else if (f.x > W) f.x -= W;
        ctx.globalAlpha = f.a * lv;
        ctx.fillRect(Math.round(f.x), Math.round(f.y), f.r, f.r);
      }
      ctx.globalAlpha = 1;
    }
    if (this.leaves.length) {
      const t = FX.now || 0;
      for (const l of this.leaves) {
        l.y += l.v * dt; l.x += (Math.sin(t * 0.9 + l.ph) * 30 - 10) * dt;
        if (l.y > H) { l.y -= H; l.x = fxRand() * W; }
        if (l.x < 0) l.x += W; else if (l.x > W) l.x -= W;
        ctx.fillStyle = l.col;
        const flip = Math.sin(t * 3 + l.ph) > 0;
        ctx.fillRect(Math.round(l.x), Math.round(l.y), flip ? 3 : 2, flip ? 2 : 3);
      }
    }
    if (this.flies.length) {
      const t = FX.now || 0;
      for (const f of this.flies) {
        f.x += f.vx * dt + Math.sin(t + f.ph) * 6 * dt; f.y += f.vy * dt + Math.cos(t * 0.8 + f.ph) * 6 * dt;
        if (f.x < 0) f.x += W; else if (f.x > W) f.x -= W;
        if (f.y < 0) f.y += H; else if (f.y > H) f.y -= H;
        const blink = Math.max(0, Math.sin(t * 2.2 + f.ph * 3));
        if (blink < 0.2) continue;
        ctx.fillStyle = `rgba(214,255,120,${(blink * dark).toFixed(3)})`;
        ctx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2);
      }
    }
    // lightning: a flash over everything, now and then
    if (kind === 'storm' && lv > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 5 + fxRand() * 12; }
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${(this.flash * 0.45).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt * 4);
    }
  },

  fill(arr, want, make) {
    while (arr.length < want) arr.push(make());
    if (arr.length > want) arr.length = want;
  },
};

function makeFogSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(226,230,236,0.55)');
  grd.addColorStop(0.6, 'rgba(220,226,232,0.2)');
  grd.addColorStop(1, 'rgba(220,226,232,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}
