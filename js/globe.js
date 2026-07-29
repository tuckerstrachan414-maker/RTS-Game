'use strict';
// The planet, seen from orbit.
//
// Zoom out past the tile map and the world stops being a rectangle and becomes
// what it has actually been since js/world.js: a cylinder wrapped round a
// sphere. This draws that sphere — orthographic projection, terminator-free
// lambert shading, an atmosphere rim — and lets you spin it and drop back down
// anywhere on it.
//
// The trick that makes it cheap: with the camera fixed and the planet spinning
// about its own axis, the mapping from a screen pixel to a TEXTURE ROW and a
// LONGITUDE OFFSET never changes. Spinning only adds a constant to the
// longitude. So the expensive part — the inverse projection, the trig, the
// shading — is computed once per (radius, tilt) and cached; each frame is then
// an array copy with an add and a multiply per pixel, which holds 60fps on a
// phone.

// How big the disc is, as a fraction of the smaller screen axis, at each end of
// the globe zoom range. Past GLOBE_ZOOM_MAX the view drops back to the tiles.
const GLOBE_ZOOM_MIN = 0.30;
const GLOBE_ZOOM_MAX = 1.30;
// Sun direction in view space. Fixed, because the sim's day/night is global —
// a rolling terminator here would say the far side is in darkness while the
// tile map says the whole world is.
const GLOBE_LIGHT = [-0.42, -0.36, 0.83];
// How often the world texture is rebuilt (seconds). Terrain never changes;
// borders and towns do, and neither of them changes fast.
const GLOBE_TEXTURE_PERIOD = 2.5;

class GlobeRenderer {
  constructor() {
    this.tex = null;            // Uint8ClampedArray, MAP_W*MAP_H*4, equirectangular
    this.texAge = 1e9;
    this.texW = 0; this.texH = 0;
    // projection cache
    this.projR = -1; this.projTilt = NaN; this.projW = 0; this.projH = 0;
    this.rowOff = null;         // texture row offset per pixel, -1 outside the disc
    this.lonOff = null;         // texture column BEFORE the spin is added
    this.shade = null;          // lambert + rim, 0..255
    this.out = null;            // ImageData reused between frames
  }

  // ---- the world texture ----------------------------------------------
  // One texel per tile, coloured the way the minimap colours things: biome
  // first, then whose ground it is. Elevation gives it relief, which is most of
  // what makes a continent read as a continent from this far out.
  rebuild(force = false) {
    if (!force && this.tex && this.texAge < GLOBE_TEXTURE_PERIOD) return;
    this.texAge = 0;
    const map = game.map;
    const W = map.w, H = map.h;
    if (!this.tex || this.texW !== W || this.texH !== H) {
      this.tex = new Uint8ClampedArray(W * H * 4);
      this.texW = W; this.texH = H;
    }
    const t = this.tex;
    const owners = game.factions.map(f => [
      parseInt(f.color.css.slice(1, 3), 16),
      parseInt(f.color.css.slice(3, 5), 16),
      parseInt(f.color.css.slice(5, 7), 16),
    ]);
    const sea = WORLD.seaLevel;
    for (let i = 0; i < W * H; i++) {
      const b = BIOMES[map.biome[i]];
      let r = b.tint[0], g = b.tint[1], bl = b.tint[2];
      if (map.terrain[i] === T_WATER) {
        // Shelf to abyss: coastal water is bright, open ocean sinks toward navy.
        const deep = Math.min(1, map.depth[i] / 14);
        r *= 1 - deep * 0.5; g *= 1 - deep * 0.42; bl *= 1 - deep * 0.18;
      } else {
        // Hill shading from the elevation field: north-west light, so ranges
        // pick up a highlight on one flank and a shadow on the other.
        const e = (map.elev[i] - sea) / Math.max(0.05, 1 - sea);
        const wI = i - 1 < 0 ? i : i - 1;
        const nI = i - W < 0 ? i : i - W;
        const slope = (map.elev[i] * 2 - map.elev[wI] - map.elev[nI]) * 9;
        const k = 1 + Math.max(-0.34, Math.min(0.34, slope)) + e * 0.14;
        r *= k; g *= k; bl *= k;
      }
      const own = game.territory ? game.territory.owner[i] : -1;
      if (own >= 0) {
        const oc = owners[own], a = 0.34;
        r = r * (1 - a) + oc[0] * a; g = g * (1 - a) + oc[1] * a; bl = bl * (1 - a) + oc[2] * a;
      }
      const o = i * 4;
      t[o] = r; t[o + 1] = g; t[o + 2] = bl; t[o + 3] = 255;
    }
    // Towns are single tiles at this scale and would vanish into the terrain, so
    // they are stamped brighter than their territory afterwards.
    for (const f of game.factions) {
      const c = owners[f.id];
      for (const b of f.buildings) {
        if (!b.done || b.type.key === 'bridge') continue;
        const key = b.type.key;
        if (key !== 'townhall' && key !== 'castle' && key !== 'dock') continue;
        for (let dy = -1; dy <= b.type.size; dy++) {
          for (let dx = -1; dx <= b.type.size; dx++) {
            const x = wrapX(b.x + dx), y = b.y + dy;
            if (y < 0 || y >= H) continue;
            const o = (y * W + x) * 4;
            t[o] = Math.min(255, c[0] * 0.7 + 110);
            t[o + 1] = Math.min(255, c[1] * 0.7 + 110);
            t[o + 2] = Math.min(255, c[2] * 0.7 + 110);
          }
        }
      }
    }
  }

  // ---- the projection cache -------------------------------------------
  // Inverse orthographic: for each pixel of the disc, which texel is under it
  // and how lit is it? Depends only on the disc's radius and the axial tilt, so
  // it survives every frame the user spends spinning the planet.
  buildProjection(w, h, radius, tilt) {
    if (this.projR === radius && this.projTilt === tilt
        && this.projW === w && this.projH === h && this.rowOff) return;
    this.projR = radius; this.projTilt = tilt; this.projW = w; this.projH = h;
    // Only the disc's bounding box is projected, buffered and blitted. At a
    // typical window the planet covers a third of the canvas, and walking the
    // other two thirds every frame to write transparent pixels was most of the
    // cost of the view.
    const cx = w / 2, cy = h / 2;
    const r = Math.ceil(radius) + 1;
    this.bx = Math.max(0, Math.floor(cx - r));
    this.by = Math.max(0, Math.floor(cy - r));
    this.bw = Math.min(w, Math.ceil(cx + r)) - this.bx;
    this.bh = Math.min(h, Math.ceil(cy + r)) - this.by;
    const n = this.bw * this.bh;
    this.rowOff = new Int32Array(n).fill(-1);
    this.lonOff = new Int32Array(n);
    this.shade = new Float32Array(n);
    this.out = null;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const [lx, ly, lz] = GLOBE_LIGHT;
    const W = this.texW, H = this.texH;
    const invR = 1 / radius;
    for (let by = 0; by < this.bh; by++) {
      const ny = (by + this.by + 0.5 - cy) * invR;
      for (let bx = 0; bx < this.bw; bx++) {
        const i = by * this.bw + bx;
        const nx = (bx + this.bx + 0.5 - cx) * invR;
        const r2 = nx * nx + ny * ny;
        if (r2 >= 1) continue;
        const nz = Math.sqrt(1 - r2);
        // Un-tilt about the X axis to get the point in planet space. Screen y
        // runs down, so +y is south.
        const py2 = ny * ct - nz * st;
        const pz2 = ny * st + nz * ct;
        const lat = Math.asin(Math.max(-1, Math.min(1, py2)));   // -pi/2 .. pi/2
        const lon = Math.atan2(nx, pz2);                          // -pi .. pi
        let ty = Math.floor((lat / Math.PI + 0.5) * H);
        if (ty < 0) ty = 0; else if (ty >= H) ty = H - 1;
        let tx = Math.floor((lon / (2 * Math.PI) + 0.5) * W);
        if (tx < 0) tx = 0; else if (tx >= W) tx = W - 1;
        this.rowOff[i] = ty * W;
        this.lonOff[i] = tx;
        // Lambert on the sphere normal, floored so the night limb is dim rather
        // than black, plus a rim term for the atmosphere.
        const lam = Math.max(0, nx * lx + ny * ly + nz * lz);
        const rim = Math.pow(r2, 5) * 0.55;
        this.shade[i] = 0.34 + lam * 0.86 + rim;
      }
    }
  }

  // ---- draw ------------------------------------------------------------
  // `spin` is a longitude in tiles: the texture column that ends up facing the
  // viewer. `tilt` is radians, positive tipping the north pole toward us.
  draw(ctx, w, h, radius, spin, tilt, dim = 0) {
    this.rebuild();
    this.buildProjection(w, h, radius, tilt);
    if (this.bw <= 0 || this.bh <= 0) return;
    if (!this.out || this.out.width !== this.bw || this.out.height !== this.bh) {
      this.out = ctx.createImageData(this.bw, this.bh);
    }
    const px = this.out.data, tex = this.tex, W = this.texW;
    const rowOff = this.rowOff, lonOff = this.lonOff, shade = this.shade;
    const lit = 1 - dim * 0.55;
    let s = Math.round(spin) % W; if (s < 0) s += W;
    for (let i = 0, o = 0; i < rowOff.length; i++, o += 4) {
      const row = rowOff[i];
      if (row < 0) { px[o + 3] = 0; continue; }
      let col = lonOff[i] + s;
      if (col >= W) col -= W;
      const t = (row + col) * 4;
      const k = shade[i] * lit;
      px[o] = tex[t] * k;
      px[o + 1] = tex[t + 1] * k;
      px[o + 2] = tex[t + 2] * k;
      px[o + 3] = 255;
    }
    ctx.putImageData(this.out, this.bx, this.by);
  }

  // Screen pixel -> world tile, or null if the click missed the planet. The
  // inverse of the projection above, done directly rather than from the cache
  // so it stays correct even on the frame the cache is rebuilt.
  pick(px, py, w, h, radius, spin, tilt) {
    const nx = (px - w / 2) / radius, ny = (py - h / 2) / radius;
    const r2 = nx * nx + ny * ny;
    if (r2 >= 1) return null;
    const nz = Math.sqrt(1 - r2);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const py2 = ny * ct - nz * st, pz2 = ny * st + nz * ct;
    const lat = Math.asin(Math.max(-1, Math.min(1, py2)));
    const lon = Math.atan2(nx, pz2);
    const ty = Math.max(0, Math.min(MAP_H - 1, Math.floor((lat / Math.PI + 0.5) * MAP_H)));
    const tx = wrapX(Math.floor((lon / (2 * Math.PI) + 0.5) * MAP_W) + Math.round(spin));
    return [tx, ty];
  }

  tick(dt) { this.texAge += dt; }
}

// Stars behind the planet. Deterministic from the pixel grid so they do not
// crawl when the canvas is resized, and drawn once into a cached canvas.
function bakeStarfield(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, '#0b1020');
  grad.addColorStop(1, '#04060d');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 8) & 0xffffff) / 0xffffff;
  };
  const n = Math.round(w * h / 5200);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, a = 0.25 + rnd() * 0.75;
    const s = rnd() < 0.9 ? 1 : 2;
    g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    g.fillRect(x | 0, y | 0, s, s);
  }
  return c;
}
