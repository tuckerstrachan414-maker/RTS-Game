'use strict';
// Asset loading, tile atlas, unit animation tables, faction palette swap.

const TILE = 16;          // tileset cell size in px
const UF = 32;            // unit frame size in px

// Tileset atlas coordinates [col,row] in tileset16x16_1.png (8x18 grid).
// A few entries are catalogued but unreferenced — see the note under the table.
const AT = {
  GRASS: [2, 4],
  GRASS_VARS: [[3, 4], [4, 4], [5, 4]],
  TREES: [[1, 0], [0, 13], [1, 13]],
  SAPLING: [2, 13],
  ROCKS: [[2, 0], [1, 11], [0, 12], [1, 12], [2, 12]],
  CAVE: [3, 0],
  POND_DECOR: [6, 0],
  SIGN: [1, 4],
  WELL: [7, 3],
  BRIDGE_H: [6, 4],
  BRIDGE_V: [7, 4],
  PATH_DOT: [7, 13],
  // Rampart set. The art is a side elevation: WALL is a pillar (cols 4-11) with
  // a parapet band running off its left edge (rows 3-11), WALL_V is that same
  // wall seen end-on as a plain column (cols 5-10, full height — it is exactly
  // the foot WALL_TOWER already trails downward), and GATE is a full-width
  // parapet with an arch punched through it. All three share the same band rows,
  // which is what lets `bakeRamparts` join them seamlessly.
  WALL: [6, 2],
  WALL_V: [1, 3],
  WALL_TOWER: [7, 1],
  GATE: [0, 3],
  // water 9-slice + strips (shorelines baked in, drawn over grass)
  W_C: [1, 6], W_N: [1, 5], W_S: [1, 7], W_W: [0, 6], W_E: [2, 6],
  W_NW: [0, 5], W_NE: [2, 5], W_SW: [0, 7], W_SE: [2, 7],
  W_VN: [3, 5], W_V: [3, 6], W_VS: [3, 7],
  W_HW: [4, 5], W_H: [5, 5], W_HE: [6, 5],
  W_ONE: [7, 5],
  // Cliff/plateau set, spliced in from PUNY_WORLD_v1 by tools/splice-cliffs.py.
  // A plateau is drawn as a rim of impassable T_CLIFF tiles around a walkable
  // top: the eight outer pieces below are the rim seen from slightly above (N is
  // the far lip, S is the tall face you cannot climb), CLIFF_TOP is the raised
  // ground itself, and the four I* pieces are the concave corners for where a
  // plateau's outline turns back on itself. `cliffTile` (js/map.js) picks between
  // them. Every piece except CLIFF_TOP is transparent outside the rock, so they
  // are drawn over the base grass tile.
  CLIFF_NW: [0, 14], CLIFF_N: [1, 14], CLIFF_NE: [2, 14],
  CLIFF_W:  [3, 14], CLIFF_TOP: [4, 14], CLIFF_E: [5, 14],
  CLIFF_SW: [6, 14], CLIFF_S: [7, 14], CLIFF_SE: [0, 15],
  // Concave corners, keyed by which corner is cut away (i.e. where the open
  // ground is). A plateau-top tile takes one of these when it touches low
  // ground diagonally — see `plateauTopTile` in js/map.js. NW/NE are the pack's
  // own art; SW/SE are composed from the plateau top plus the matching outer
  // corner's quadrant (tools/splice-cliffs.py), because the pack never drew them.
  CLIFF_IN_NW: [1, 15], CLIFF_IN_NE: [2, 15], CLIFF_IN_SW: [3, 15], CLIFF_IN_SE: [4, 15],
  // Ramp: a stair cut through a rim, indexed by `rot` (js/map.js RAMP_DIRS) —
  // 0..3 are 90-degree-clockwise turns of the pack's one staircase, which was
  // drawn for a south rim (climb north). RAMP_TREAD is the walkable face,
  // RAMP_TOP the step onto the plateau above it, RAMP_JAMB_NEG/POS the rock
  // jambs that close the rim either side of the gap (± the ramp's perpendicular
  // `p` vector — see RAMP_DIRS for which side is which at each rotation).
  RAMP_TREAD: [[6, 15], [1, 16], [5, 16], [1, 17]],
  RAMP_TOP: [[5, 15], [2, 16], [6, 16], [2, 17]],
  RAMP_JAMB_NEG: [[7, 15], [3, 16], [7, 16], [3, 17]],
  RAMP_JAMB_POS: [[5, 17], [4, 16], [0, 17], [4, 17]],
  // buildings: [orangeVariant, blueVariant] where a pair exists
  TOWNHALL: [[0, 0], [7, 0]],
  HOUSE: [[2, 3], [3, 3]],
  MARKET: [[4, 3], [5, 3]],
  LUMBER: [6, 3],
  MINE: [0, 4],
  // Bases for the buildings whose final art is composited in `bakeBuildings` — the
  // atlas cell alone reads as the wrong thing (see the comment there).
  CHURCH: [4, 0],
  CASTLE: [5, 0],
};

// Catalogued but never drawn, kept so the next person hunting for art does not have
// to rediscover them:
//  SAPLING     — there is no tree regrowth (see docs/BUGS.md, design quirks)
//  POND_DECOR  — decorative pond, never placed by the generator
//  WELL        — a green mound with a doorway, all but identical to CAVE; the Well
//                is composited in `bakeBuildings` instead
//  WALL_V      — a 6px column; `bakeRamparts` takes its vertical run off WALL_TOWER
// (the concave CLIFF_IN_* corners were once in this list, on the theory that 4-connected
// rim membership made them unnecessary — that was wrong, and left visible holes wherever a
// plateau's edge ran diagonally. They are all four drawn now; see `plateauTopTile`.)

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

// Faction palettes. `hue` recolors the blue clothing on the unit sheets (null = leave the
// art as drawn, which is already blue). `roofHue` recolors the orange masonry on the
// tileset and the castle's violet stonework. Azuria used to leave BOTH alone, so the blue
// nation fielded blue troops out of orange buildings while every rival's buildings matched
// their banner; it now gets a roof hue like everyone else.
const FACTION_COLORS = [
  { key: 'blue',   name: 'Azuria',  hue: null, roofHue: 210, css: '#4a90d9' },
  { key: 'red',    name: 'Crimson', hue: 0,    roofHue: 0,   css: '#d94a4a' },
  { key: 'purple', name: 'Violeta', hue: 285,  roofHue: 285, css: '#a54ad9' },
  { key: 'yellow', name: 'Aurelia', hue: 48,   roofHue: 48,  css: '#d9b34a' },
];

const Assets = {
  tileset: null,
  factionTilesets: [],   // per-faction recolored tileset (roofs)
  unitSheets: [],        // [factionIdx][unitKey] -> {canvas, rows, frames[row]}
  projectiles: null,
  rampart: [],           // [factionIdx] -> {wallH, wallV, tower, gateH, gateV}, see bakeRamparts
  buildingArt: [],       // [factionIdx][typeKey] -> 16x16 canvas, see bakeBuildings
  bridgeVmid: null,      // seamless vertical bridge (caps replaced by the plank middle)
  tilled: null,          // farm field under construction (bare furrows)
  crop: null,            // finished farm field (furrows in crop)
  loaded: false,

  async load() {
    const tileset = await loadImage('assets/tileset16x16_1.png');
    this.projectiles = await loadImage('assets/units/HumansProjectiles.png');
    const rawUnits = {};
    for (const [key, file] of Object.entries(UNIT_SHEETS)) {
      rawUnits[key] = await loadImage('assets/units/' + file);
    }
    for (let f = 0; f < FACTION_COLORS.length; f++) {
      const { hue, roofHue } = FACTION_COLORS[f];
      this.factionTilesets[f] = roofHue === null ? tileset : recolor(tileset, roofHue, 'warm');
      this.unitSheets[f] = {};
      for (const [key, img] of Object.entries(rawUnits)) {
        const canvas = hue === null ? toCanvas(img) : recolor(img, hue, 'cool');
        this.unitSheets[f][key] = describeSheet(canvas);
      }
      this.rampart[f] = bakeRamparts(this.factionTilesets[f]);
      this.buildingArt[f] = bakeBuildings(tileset, this.factionTilesets[f], roofHue);
    }
    this.tileset = tileset;
    this.bridgeVmid = bakeTile(tileset, AT.BRIDGE_V, { replicateMid: [1, 13] });
    this.tilled = bakeFarmland(false);
    this.crop = bakeFarmland(true);
    this.loaded = true;
  },
};

// The five pieces a wall run is assembled from (see `drawRampart` in js/ui.js).
// The atlas art was drawn as standalone tiles with grass baked into the margins,
// so a straight run left visible gaps between segments and a north-south run had
// no art at all. Each piece below is the SAME sprite, edited only enough that its
// tile edges match its neighbours' exactly:
//
//  wallH  AT.WALL with the grass margin (cols 12-15) refilled from the parapet
//         band at col 1, so the band now runs edge to edge and consecutive tiles
//         butt together. The pillar in the middle is untouched.
//  wallV  AT.WALL_TOWER's own body row (row 10) repeated down the tile. It used to
//         come from AT.WALL_V flattened, which is a 6px-wide column (cols 5-10) —
//         two pixels narrower than the tower it runs into and with none of its
//         shading, so a north-south run read as a line of fence posts beside the
//         chunky east-west parapet, and stepped in and out at every tower. Taking
//         the row straight off the tower makes the two identical by construction.
//  tower  AT.WALL_TOWER, grass stripped, with its empty top row filled from the
//         crenellation below it — otherwise a wall coming down from the tile above
//         met a one-pixel transparent seam at the tower's crown.
//  gateH  AT.GATE, grass stripped. Its parapet already spans the full tile width
//         on the same rows as wallH's band, so it drops into a run untouched.
//  gateV  wallV with GATE's own arch (a 6x6 block) composited into the middle —
//         the vertical gate the tileset never had.
function bakeRamparts(sheet) {
  const vertical = { stripGreen: true, replicateMid: [10, 10] };
  return {
    wallH: bakeTile(sheet, AT.WALL, { stripGreen: true, fillCols: [12, 15, 1] }),
    wallV: bakeTile(sheet, AT.WALL_TOWER, vertical),
    tower: bakeTile(sheet, AT.WALL_TOWER, { stripGreen: true, fillRows: [0, 0, 1] }),
    gateH: bakeTile(sheet, AT.GATE, { stripGreen: true }),
    gateV: bakeTile(sheet, AT.WALL_TOWER, { ...vertical,
      overlay: { at: AT.GATE, sx: 5, sy: 6, w: 6, h: 6, dx: 5, dy: 5 } }),
  };
}

// ---------------------------------------------------------------------------
// Buildings whose atlas cell reads as the wrong thing. Same approach as the
// ramparts: composite from what the tileset already has rather than adding art.
//
//  storehouse  The atlas has ONE warehouse-ish cell ([6,3], a log cabin) and the
//              Lumber Camp already uses it — two different buildings were sharing
//              one sprite. The Storehouse becomes the cottage silhouette with its
//              little door replaced by barn doors and sacks piled outside.
//  quarry      [0,11] is a cottage with a red roof: it read as a second House, not
//              as a stone works. Replaced with a cut rock face and stacked blocks.
//  well        [7,3] is a green mound with a doorway — all but identical to the
//              CAVE terrain tile ([3,0]), so a Well looked like a mine mouth.
//              Replaced with an actual wellhead: stone rim, water, roof on posts.
//  church      [4,0] is a stone hut wearing two pink mushroom caps. The caps are
//              lifted off and the two halves become a belfry (spire + cross) and
//              a gabled nave with a lit window — the stonework underneath is the
//              atlas's own.
//  castle      [5,0] is violet, and `recolor`'s warm range never touched it, so
//              every nation's castle came out the same purple. Its stonework is
//              shifted to the faction's colour here instead.
function bakeBuildings(plain, sheet, roofHue) {
  const STONE = { lit: '#cfc6b8', mid: '#a0938e', dim: '#7d7071', dark: '#5a5353' };
  const SLATE = { lit: '#8b93a0', mid: '#666e7a', dark: '#474e58' };
  const WOOD = { lit: '#e2ad6e', mid: '#af834c', dim: '#93674d', dark: '#704d38' };
  return {
    storehouse: bakeArt({ sheet, at: AT.HOUSE[1] }, px => {
      px('#3a2a12', 4, 12, 8, 4);                       // barn doorway
      px('#67512a', 4, 11, 8, 1);                       // lintel
      px('#8a6a3a', 4, 12, 1, 4); px('#8a6a3a', 11, 12, 1, 4);
      px('#a0823f', 7, 12, 2, 4);                       // post between the leaves
      px('#8a7448', 1, 12, 3, 4); px('#c9b07a', 1, 12, 3, 3); px('#e0cb9a', 1, 12, 3, 1);
      px('#8a7448', 12, 13, 3, 3); px('#c9b07a', 12, 13, 3, 2); px('#e0cb9a', 12, 13, 3, 1);
    }),
    quarry: bakeArt(null, px => {
      px(STONE.dim, 4, 2, 3, 1); px(STONE.dim, 2, 3, 6, 1);    // outcrop, uneven crest
      px(STONE.dim, 1, 4, 9, 6);
      px(STONE.mid, 4, 2, 3, 1); px(STONE.mid, 2, 3, 6, 1); px(STONE.mid, 1, 4, 9, 1);
      px(STONE.lit, 5, 3, 2, 1); px(STONE.lit, 2, 4, 3, 1);
      px(STONE.dark, 7, 5, 3, 4); px(STONE.dim, 8, 6, 2, 2);   // shadowed cut in the face
      px(STONE.dark, 1, 9, 9, 1);
      const block = (x, y, w) => {                             // dressed blocks, stacked
        px(STONE.dim, x, y, w, 3); px(STONE.lit, x, y, w, 1); px(STONE.dark, x, y + 2, w, 1);
      };
      block(10, 5, 5); block(10, 9, 5); block(1, 11, 5); block(7, 11, 6);
      px(WOOD.dark, 12, 1, 1, 4); px(STONE.mid, 11, 1, 3, 1);  // pick left against the stack
    }),
    well: bakeArt(null, px => {
      px(WOOD.dark, 3, 3, 1, 7); px(WOOD.dark, 12, 3, 1, 7);   // posts
      px(WOOD.dim, 2, 2, 12, 1); px(WOOD.mid, 3, 1, 10, 1); px(WOOD.lit, 5, 0, 6, 1);
      px(WOOD.dark, 4, 4, 8, 1);                        // winding bar
      px(WOOD.dim, 8, 5, 1, 3);
      px(STONE.dim, 3, 9, 10, 5);                       // rim
      px(STONE.mid, 3, 9, 10, 1); px(STONE.lit, 4, 10, 8, 1); px(STONE.dark, 3, 13, 10, 1);
      px('#1d2a44', 5, 10, 6, 3); px('#2f4a7a', 5, 11, 6, 1);  // water
      px(WOOD.lit, 7, 7, 3, 3); px(WOOD.mid, 7, 7, 3, 1);      // bucket on the bar
    }),
    // Baked off the UNTOUCHED atlas: `strip` matches exact hexes, and on the recolored
    // faction sheet the caps' pinks have already moved. Tinted afterwards with the same
    // rule the sheet uses, so the door still matches the nation's other buildings.
    church: bakeArt({ sheet: plain, at: AT.CHURCH }, (px, strip, g) => {
      strip(['#ffaeb6', '#8e478c', '#cd6093']);         // lift the mushroom caps off
      if (roofHue !== null) shiftHue(g, WARM, roofHue);
      px('#e8d98a', 4, 0, 1, 3); px('#e8d98a', 3, 1, 3, 1);    // cross
      px(SLATE.mid, 4, 3, 1, 1); px(SLATE.mid, 3, 4, 3, 1);    // spire
      px(SLATE.lit, 2, 5, 5, 1); px(SLATE.mid, 2, 6, 5, 1);
      px(STONE.lit, 1, 7, 7, 1);                        // belfry cornice
      px(STONE.dim, 2, 8, 5, 3); px('#332f2f', 3, 9, 3, 2);    // bell opening
      px(SLATE.mid, 10, 7, 2, 1); px(SLATE.lit, 9, 8, 4, 1);   // nave gable
      px(SLATE.mid, 8, 9, 6, 1); px(SLATE.dark, 7, 10, 8, 1);
      px('#e8c96a', 10, 12, 2, 2); px(STONE.dark, 10, 11, 2, 1);
    }),
    castle: bakeArt({ sheet, at: AT.CASTLE }, (px, strip, g) => {
      if (roofHue !== null) shiftHue(g, VIOLET, roofHue);
    }),
  };
}

// Farm fields. The atlas has no farm art whatsoever — farms used to draw as two of
// the GRASS_VARS tuft tiles, which is to say they were invisible against grass. These
// two tiles are ploughed soil (while the farm is being built) and the same field in
// crop (once it is finished), so a farm reads as a farm and its progress reads too.
function bakeFarmland(planted) {
  return bakeArt(null, px => {
    px('#6d4a2c', 0, 0, TILE, TILE);
    for (let y = 0; y < TILE; y += 4) {
      px('#5a3b22', 0, y, TILE, 1);
      px('#7d5734', 0, y + 2, TILE, 1);
    }
    if (!planted) return;
    for (let y = 0; y < TILE; y += 4) {
      for (let x = 1; x < TILE; x += 3) {
        px((x + y) % 6 === 0 ? '#c9ad42' : '#4f8a33', x, y, 2, 3);
        px((x + y) % 6 === 0 ? '#e2c766' : '#6fb04a', x, y, 1, 1);
      }
    }
  });
}

// Tiny 16x16 pixel canvas. `px(color, x, y, w, h)` paints a run; `strip(colors)`
// erases every pixel matching one of the given hexes (used to lift a motif off an
// atlas tile before drawing over it); the raw context is passed too for hue shifts.
function bakeArt(base, draw) {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  if (base) g.drawImage(base.sheet, base.at[0] * TILE, base.at[1] * TILE, TILE, TILE, 0, 0, TILE, TILE);
  const px = (color, x, y, w = 1, h = 1) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
  const strip = colors => {
    const want = colors.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    const d = g.getImageData(0, 0, TILE, TILE), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      for (const [r, gg, b] of want) {
        if (Math.abs(p[i] - r) < 12 && Math.abs(p[i + 1] - gg) < 12 && Math.abs(p[i + 2] - b) < 12) { p[i + 3] = 0; break; }
      }
    }
    g.putImageData(d, 0, 0);
  };
  draw(px, strip, g);
  return c;
}

// Rotate a hue band of an already-drawn 16x16 tile onto `targetHue`, keeping its
// saturation and lightness. `test` is a predicate on the hue; `WARM` reuses the exact
// band `recolor` applies to the whole tileset, so a tile baked from the *untouched*
// atlas still ends up matching its faction's other buildings.
const WARM = h => h >= 345 || h <= 42;
const VIOLET = h => h >= 250 && h <= 320;
function shiftHue(g, test, targetHue) {
  const d = g.getImageData(0, 0, TILE, TILE), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const [h, s, l] = rgbToHsl(p[i], p[i + 1], p[i + 2]);
    if (s > 0.15 && test(h)) {
      const [r, gg, b] = hslToRgb(targetHue, s, l);
      p[i] = r; p[i + 1] = gg; p[i + 2] = b;
    }
  }
  g.putImageData(d, 0, 0);
}

// Extract one 16x16 atlas tile into its own canvas, cleaned up so structures tile without seams.
//  stripGreen  — knock out the grass baked into a sprite's corners (turns opaque grass transparent)
//  replicateMid[a,b] — rebuild every row from the clamped [a..b] band, erasing top/bottom end-caps
//  fillCols[x0,x1,src] — overwrite columns x0..x1 with a copy of column `src`, so a band that
//                        stopped short of the tile edge now reaches it (left/right end-caps)
//  fillRows[y0,y1,src] — the same for rows (top/bottom end-caps)
//  overlay{at,sx,sy,w,h,dx,dy} — composite a rect from another atlas tile on top
function bakeTile(tileset, at, opts = {}) {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(tileset, at[0] * TILE, at[1] * TILE, TILE, TILE, 0, 0, TILE, TILE);
  const d = g.getImageData(0, 0, TILE, TILE), p = d.data;
  const A = i => p[i + 3];
  if (opts.stripGreen) {
    for (let i = 0; i < p.length; i += 4) {
      if (A(i) > 30 && p[i + 1] > p[i] + 18 && p[i + 1] > p[i + 2] + 18) p[i + 3] = 0;
    }
  }
  if (opts.replicateMid) {
    const [a, b] = opts.replicateMid, src = p.slice();
    for (let y = 0; y < TILE; y++) {
      const sy = Math.min(b, Math.max(a, y));
      for (let x = 0; x < TILE; x++) {
        const di = (y * TILE + x) * 4, si = (sy * TILE + x) * 4;
        p[di] = src[si]; p[di + 1] = src[si + 1]; p[di + 2] = src[si + 2]; p[di + 3] = src[si + 3];
      }
    }
  }
  if (opts.fillCols) {
    const [x0, x1, src] = opts.fillCols, from = p.slice();
    for (let y = 0; y < TILE; y++) for (let x = x0; x <= x1; x++) {
      const di = (y * TILE + x) * 4, si = (y * TILE + src) * 4;
      p[di] = from[si]; p[di + 1] = from[si + 1]; p[di + 2] = from[si + 2]; p[di + 3] = from[si + 3];
    }
  }
  if (opts.fillRows) {
    const [y0, y1, src] = opts.fillRows, from = p.slice();
    for (let y = y0; y <= y1; y++) for (let x = 0; x < TILE; x++) {
      const di = (y * TILE + x) * 4, si = (src * TILE + x) * 4;
      p[di] = from[si]; p[di + 1] = from[si + 1]; p[di + 2] = from[si + 2]; p[di + 3] = from[si + 3];
    }
  }
  g.putImageData(d, 0, 0);
  if (opts.overlay) {
    const o = opts.overlay;
    g.drawImage(tileset, o.at[0] * TILE + o.sx, o.at[1] * TILE + o.sy, o.w, o.h, o.dx, o.dy, o.w, o.h);
  }
  return c;
}

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
  // The warm band wraps through red (345°..42°) rather than starting at 8°: the Lumber
  // Camp's timber straddles that seam, so half of it used to recolor and half did not —
  // it came out the same muddy brown for every nation while the other nine buildings
  // took their banner's colour cleanly.
  const inBand = mode === 'cool' ? (h => h >= 175 && h <= 260) : WARM;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s > 0.2 && inBand(h)) {
      const [r, g, b] = hslToRgb(targetHue, s, l);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Count non-empty frames per row of a 32px-grid sheet, and find where inside the frame
// the character actually is. `top`/`bottom` are the opaque bounds of the poses a unit
// holds most of the time (idle and walk): a foot soldier's art starts about half way
// down its 32px frame, so anything positioned from the frame's edges — the health bar,
// the faction flash, the selection ring — sits nowhere near the figure.
function describeSheet(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rows = Math.floor(canvas.height / UF);
  const cols = Math.floor(canvas.width / UF);
  const frames = [];
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // A row counts as "the figure" only once it is several pixels wide in some frame —
  // a couched lance or a raised staff is one or two pixels and would otherwise drag the
  // measured top of a horseman a third of the way up the frame, taking his health bar
  // with it.
  const BODY_PX = 5;
  const opaque = (r, y) => {
    let run = 0;
    for (let f = 0; f < frames[r]; f++) {
      let n = 0;
      for (let x = f * UF; x < (f + 1) * UF; x++) {
        if (data[((r * UF + y) * canvas.width + x) * 4 + 3] > 10) n++;
      }
      if (n > run) run = n;
    }
    return run >= BODY_PX;
  };
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
  let top = UF, bottom = 0;
  for (const r of [0, Math.min(1, rows - 1)]) {
    for (let y = 0; y < top; y++) if (opaque(r, y)) { top = y; break; }
    for (let y = UF - 1; y > bottom; y--) if (opaque(r, y)) { bottom = y; break; }
  }
  if (top >= UF) top = 0;
  if (bottom <= 0) bottom = UF - 1;
  const anims = {
    idle:   { row: 0, frames: frames[0], fps: 5, loop: true },
    walk:   { row: 1, frames: frames[1], fps: 9, loop: true },
    attack: { row: rows - 3, frames: frames[rows - 3], fps: 10, loop: false },
    hurt:   { row: rows - 2, frames: frames[rows - 2], fps: 8, loop: false },
    death:  { row: rows - 1, frames: frames[rows - 1], fps: 7, loop: false },
  };
  return { canvas, rows, frames, anims, top, bottom };
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
