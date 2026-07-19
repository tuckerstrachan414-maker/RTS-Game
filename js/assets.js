'use strict';
// Asset loading, tile atlas, unit animation tables, faction palette swap.

const TILE = 16;          // tileset cell size in px
const UF = 32;            // unit frame size in px

// Tileset atlas coordinates [col,row] in tileset16x16_1.png (8x14 grid)
const AT = {
  GRASS: [2, 4],
  GRASS_VARS: [[3, 4], [4, 4], [5, 4]],
  CROP_VARS: [[4, 4], [5, 4]],          // tuft tiles double as crop fields
  TREES: [[1, 0], [0, 13], [1, 13]],
  SAPLING: [2, 13],
  ROCKS: [[2, 0], [1, 11], [0, 12], [1, 12], [2, 12]],
  CAVE: [3, 0],
  POND_DECOR: [6, 0],
  SIGN: [1, 4],
  WELL: [7, 3],
  BRIDGE_H: [6, 4],
  BRIDGE_V: [7, 4],
  ROAD: [1, 3],
  PATH_DOT: [7, 13],
  WALL: [6, 2],
  WALL_TOWER: [7, 1],
  GATE: [0, 3],
  // water 9-slice + strips (shorelines baked in, drawn over grass)
  W_C: [1, 6], W_N: [1, 5], W_S: [1, 7], W_W: [0, 6], W_E: [2, 6],
  W_NW: [0, 5], W_NE: [2, 5], W_SW: [0, 7], W_SE: [2, 7],
  W_VN: [3, 5], W_V: [3, 6], W_VS: [3, 7],
  W_HW: [4, 5], W_H: [5, 5], W_HE: [6, 5],
  W_ONE: [7, 5],
  // buildings: [orangeVariant, blueVariant] where a pair exists
  TOWNHALL: [[0, 0], [7, 0]],
  HOUSE: [[2, 3], [3, 3]],
  MARKET: [[4, 3], [5, 3]],
  LUMBER: [6, 3],
  QUARRY: [0, 11],
  MINE: [0, 4],
  CHURCH: [4, 0],
  CASTLE: [5, 0],
};

// Unit spritesheets. Rows: 0=idle, 1=walk, rows-3=attack, rows-2=hurt, rows-1=death.
const UNIT_SHEETS = {
  sword:    'MiniSwordMan.png',
  spear:    'MiniSpearMan.png',
  shield:   'MiniShieldMan.png',
  halberd:  'MiniHalberdMan.png',
  archer:   'MiniArcherMan.png',
  crossbow: 'MiniCrossBowMan.png',
  mage:     'MiniMage.png',
  archmage: 'MiniArchMage.png',
  horseman: 'MiniHorseMan.png',
  cavalier: 'MiniCavalierMan.png',
  king:     'MiniKingMan.png',
  prince:   'MiniPrinceMan.png',
};

// Faction palettes: hue used to recolor the blue clothing / orange roofs.
const FACTION_COLORS = [
  { key: 'blue',   name: 'Azuria',  hue: null, css: '#4a90d9' }, // player: native blue art
  { key: 'red',    name: 'Crimson', hue: 0,    css: '#d94a4a' },
  { key: 'purple', name: 'Violeta', hue: 285,  css: '#a54ad9' },
  { key: 'yellow', name: 'Aurelia', hue: 48,   css: '#d9b34a' },
];

const Assets = {
  tileset: null,
  factionTilesets: [],   // per-faction recolored tileset (roofs)
  unitSheets: [],        // [factionIdx][unitKey] -> {canvas, rows, frames[row]}
  projectiles: null,
  loaded: false,

  async load() {
    const tileset = await loadImage('assets/tileset16x16_1.png');
    this.projectiles = await loadImage('assets/units/HumansProjectiles.png');
    const rawUnits = {};
    for (const [key, file] of Object.entries(UNIT_SHEETS)) {
      rawUnits[key] = await loadImage('assets/units/' + file);
    }
    for (let f = 0; f < FACTION_COLORS.length; f++) {
      const hue = FACTION_COLORS[f].hue;
      this.factionTilesets[f] = hue === null ? tileset : recolor(tileset, hue, 'warm');
      this.unitSheets[f] = {};
      for (const [key, img] of Object.entries(rawUnits)) {
        const canvas = hue === null ? toCanvas(img) : recolor(img, hue, 'cool');
        this.unitSheets[f][key] = describeSheet(canvas);
      }
    }
    this.tileset = tileset;
    this.loaded = true;
  },
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('failed to load ' + src));
    img.src = src;
  });
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// Recolor: shift blue hues (units, 'cool') or orange hues (roofs, 'warm') to target hue.
function recolor(img, targetHue, mode) {
  const c = toCanvas(img);
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const [lo, hi] = mode === 'cool' ? [175, 260] : [8, 42];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s > 0.2 && h >= lo && h <= hi) {
      const [r, g, b] = hslToRgb(targetHue, s, l);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Count non-empty frames per row of a 32px-grid sheet.
function describeSheet(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rows = Math.floor(canvas.height / UF);
  const cols = Math.floor(canvas.width / UF);
  const frames = [];
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let r = 0; r < rows; r++) {
    let count = 0;
    for (let col = 0; col < cols; col++) {
      let hasPixel = false;
      for (let y = r * UF; y < (r + 1) * UF && !hasPixel; y += 2) {
        for (let x = col * UF; x < (col + 1) * UF && !hasPixel; x += 2) {
          if (data[(y * canvas.width + x) * 4 + 3] > 10) hasPixel = true;
        }
      }
      if (hasPixel) count = col + 1;
    }
    frames.push(Math.max(count, 1));
  }
  const anims = {
    idle:   { row: 0, frames: frames[0], fps: 5, loop: true },
    walk:   { row: 1, frames: frames[1], fps: 9, loop: true },
    attack: { row: rows - 3, frames: frames[rows - 3], fps: 10, loop: false },
    hurt:   { row: rows - 2, frames: frames[rows - 2], fps: 8, loop: false },
    death:  { row: rows - 1, frames: frames[rows - 1], fps: 7, loop: false },
  };
  return { canvas, rows, frames, anims };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
