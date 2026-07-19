'use strict';
// Rendering, camera, input, HUD, build menu, selection, diplomacy panel, minimap.

const ZOOMS = [1, 2, 3, 4];

class UI {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.cam = { x: 0, y: 0, zoom: 2 };
    this.mouse = { x: 0, y: 0, down: false, dragStart: null };
    this.selection = { units: [], building: null };
    this.placing = null;            // building type key while placing
    this.keys = {};
    this.minimapT = 0;
    this.minimap = document.getElementById('minimap');
    this.minictx = this.minimap.getContext('2d');
    this.minictx.imageSmoothingEnabled = false;
    this.mini = document.createElement('canvas');
    this.mini.width = MAP_W; this.mini.height = MAP_H;
    this.speed = 1;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.touches = new Map();       // identifier -> {x,y,startX,startY,t,lastX,lastY}
    this.gesture = null;            // null | 'pending' | 'pan' | 'box' | 'placeDrag' | 'pinch'
    this.longPressTimer = null;
    this.pinch = null;              // active 2-finger gesture state
    this.bindEvents();
    this.buildHud();
  }

  // ---------- coordinate helpers ----------
  worldToScreen(wx, wy) { const s = TILE * this.cam.zoom; return [(wx - this.cam.x) * s, (wy - this.cam.y) * s]; }
  screenToWorld(sx, sy) { const s = TILE * this.cam.zoom; return [sx / s + this.cam.x, sy / s + this.cam.y]; }
  screenToTile(sx, sy) { const [wx, wy] = this.screenToWorld(sx, sy); return [Math.floor(wx), Math.floor(wy)]; }

  centerOn(tx, ty) {
    const s = TILE * this.cam.zoom;
    this.cam.x = tx - this.canvas.width / (2 * s);
    this.cam.y = ty - this.canvas.height / (2 * s);
    this.clampCam();
  }
  clampCam() {
    const s = TILE * this.cam.zoom;
    const vw = this.canvas.width / s, vh = this.canvas.height / s;
    this.cam.x = Math.max(-2, Math.min(MAP_W - vw + 2, this.cam.x));
    this.cam.y = Math.max(-2, Math.min(MAP_H - vh + 2, this.cam.y));
  }

  // ---------- input ----------
  bindEvents() {
    const c = this.canvas;
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    this.resize();
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') { this.placing = null; this.clearSelection(); this.closeDiplomacy(); }
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      const i = ZOOMS.reduce((best, z, idx) => Math.abs(z - this.cam.zoom) < Math.abs(ZOOMS[best] - this.cam.zoom) ? idx : best, 0);
      const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
      if (ni !== i) {
        const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
        this.cam.zoom = ZOOMS[ni];
        const s = TILE * this.cam.zoom;
        this.cam.x = wx - e.offsetX / s;
        this.cam.y = wy - e.offsetY / s;
        this.clampCam();
      }
    }, { passive: false });
    c.addEventListener('mousedown', e => {
      this.mouse.x = e.offsetX; this.mouse.y = e.offsetY;
      if (e.button === 0) {
        if (this.placing) { this.tryPlace(); return; }
        this.mouse.down = true;
        this.mouse.dragStart = [e.offsetX, e.offsetY];
      } else if (e.button === 2) {
        if (this.placing) { this.placing = null; return; }
        this.rightClick(e.offsetX, e.offsetY);
      }
    });
    c.addEventListener('mousemove', e => { this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; });
    c.addEventListener('mouseup', e => {
      if (e.button !== 0 || !this.mouse.down) return;
      this.mouse.down = false;
      const [sx, sy] = this.mouse.dragStart;
      const dx = Math.abs(e.offsetX - sx), dy = Math.abs(e.offsetY - sy);
      if (dx < 6 && dy < 6) this.clickSelect(e.offsetX, e.offsetY);
      else this.boxSelect(sx, sy, e.offsetX, e.offsetY);
      this.mouse.dragStart = null;
    });
    this.minimap.addEventListener('mousedown', e => this.minimapTap(e.clientX, e.clientY));
    this.minimap.addEventListener('touchstart', e => {
      e.preventDefault();
      this.minimapTap(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    this.bindTouchEvents();
  }

  minimapTap(clientX, clientY) {
    const r = this.minimap.getBoundingClientRect();
    const tx = (clientX - r.left) / r.width * MAP_W;
    const ty = (clientY - r.top) / r.height * MAP_H;
    this.centerOn(tx, ty);
  }

  resize() {
    const vv = window.visualViewport;
    this.canvas.width = Math.round(vv ? vv.width : window.innerWidth);
    this.canvas.height = Math.round(vv ? vv.height : window.innerHeight);
    this.ctx.imageSmoothingEnabled = false;
    this.clampCam();
  }

  // ---------- touch gestures ----------
  // 1 finger: quick tap = select (or place, if placing) · drag = pan camera ·
  //           hold-then-drag = box-select. 2 fingers: pinch = zoom+pan (Maps-style) ·
  //           quick tap = "right-click" equivalent (move/attack/rally/cancel-placement).
  bindTouchEvents() {
    const c = this.canvas;
    c.addEventListener('touchstart', e => this.onTouchStart(e), { passive: false });
    c.addEventListener('touchmove', e => this.onTouchMove(e), { passive: false });
    c.addEventListener('touchend', e => this.onTouchEnd(e), { passive: false });
    c.addEventListener('touchcancel', e => this.onTouchEnd(e), { passive: false });
  }

  touchPoint(t) {
    const r = this.canvas.getBoundingClientRect();
    return [t.clientX - r.left, t.clientY - r.top];
  }

  worldFromCam(sx, sy, camX, camY, zoom) {
    const s = TILE * zoom;
    return [sx / s + camX, sy / s + camY];
  }

  onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const [x, y] = this.touchPoint(t);
      this.touches.set(t.identifier, { x, y, startX: x, startY: y, t: performance.now() });
    }
    const ids = [...this.touches.keys()];
    clearTimeout(this.longPressTimer);
    if (ids.length === 1) {
      this.gesture = 'pending';
      this.pinch = null;
      const id = ids[0];
      this.longPressTimer = setTimeout(() => {
        if (this.gesture === 'pending' && this.touches.has(id)) {
          this.gesture = 'box';
          const p = this.touches.get(id);
          this.mouse.dragStart = [p.startX, p.startY];
          this.mouse.x = p.x; this.mouse.y = p.y;
        }
      }, 380);
    } else if (ids.length >= 2) {
      this.mouse.dragStart = null;
      const [a, b] = ids.slice(0, 2).map(id => this.touches.get(id));
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      this.pinch = {
        ids: [ids[0], ids[1]],
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX, midY,
        anchor: this.worldFromCam(midX, midY, this.cam.x, this.cam.y, this.cam.zoom),
        moved: false, startT: performance.now(),
      };
      this.gesture = 'pinch';
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = this.touches.get(t.identifier);
      if (p) { const [x, y] = this.touchPoint(t); p.x = x; p.y = y; }
    }
    const ids = [...this.touches.keys()];

    if (this.gesture === 'pending' && ids.length === 1) {
      const p = this.touches.get(ids[0]);
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > 10) {
        clearTimeout(this.longPressTimer);
        this.gesture = this.placing ? 'placeDrag' : 'pan';
        p.lastX = p.startX; p.lastY = p.startY;
      }
    }

    if (this.gesture === 'pan' && ids.length === 1) {
      const p = this.touches.get(ids[0]);
      const s = TILE * this.cam.zoom;
      this.cam.x -= (p.x - p.lastX) / s;
      this.cam.y -= (p.y - p.lastY) / s;
      this.clampCam();
      p.lastX = p.x; p.lastY = p.y;
    } else if ((this.gesture === 'placeDrag' || this.gesture === 'box') && ids.length === 1) {
      const p = this.touches.get(ids[0]);
      this.mouse.x = p.x; this.mouse.y = p.y;
    } else if (this.gesture === 'pinch' && ids.length >= 2 && this.pinch) {
      const pn = this.pinch;
      const a = this.touches.get(pn.ids[0]), b = this.touches.get(pn.ids[1]);
      if (a && b) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        if (Math.abs(dist - pn.dist) > 8 || Math.hypot(midX - pn.midX, midY - pn.midY) > 8) pn.moved = true;
        const newZoom = Math.max(1, Math.min(4, this.cam.zoom * (dist / pn.dist)));
        const s = TILE * newZoom;
        this.cam.x = pn.anchor[0] - midX / s;
        this.cam.y = pn.anchor[1] - midY / s;
        this.cam.zoom = newZoom;
        this.clampCam();
        pn.dist = dist; pn.midX = midX; pn.midY = midY;
        pn.anchor = this.worldFromCam(midX, midY, this.cam.x, this.cam.y, this.cam.zoom);
      }
    }
  }

  onTouchEnd(e) {
    e.preventDefault();
    const endedIds = [...e.changedTouches].map(t => t.identifier);

    if (this.gesture === 'pending') {
      const id = [...this.touches.keys()][0];
      const p = id !== undefined ? this.touches.get(id) : null;
      if (p) {
        if (this.placing) { this.mouse.x = p.x; this.mouse.y = p.y; this.tryPlace(); }
        else this.clickSelect(p.x, p.y);
      }
    } else if (this.gesture === 'placeDrag') {
      const id = [...this.touches.keys()][0];
      const p = id !== undefined ? this.touches.get(id) : null;
      if (p) { this.mouse.x = p.x; this.mouse.y = p.y; this.tryPlace(); }
    } else if (this.gesture === 'box') {
      const id = [...this.touches.keys()][0];
      const p = id !== undefined ? this.touches.get(id) : null;
      if (p && this.mouse.dragStart) this.boxSelect(this.mouse.dragStart[0], this.mouse.dragStart[1], p.x, p.y);
      this.mouse.dragStart = null;
    } else if (this.gesture === 'pinch' && this.pinch) {
      const pn = this.pinch;
      if (!pn.moved && performance.now() - pn.startT < 300 && endedIds.some(id => pn.ids.includes(id))) {
        if (this.placing) this.placing = null;
        else this.rightClick(pn.midX, pn.midY);
        // resolved as a two-finger tap: ignore the trailing finger so its
        // lift doesn't also register as a separate single-finger tap
        this.gesture = 'ignore';
      }
    }

    clearTimeout(this.longPressTimer);
    for (const id of endedIds) this.touches.delete(id);
    if (this.touches.size === 0) {
      this.gesture = null; this.pinch = null; this.mouse.dragStart = null;
    } else if (this.touches.size === 1 && this.gesture !== 'ignore') {
      // a real pinch/pan lost one finger mid-gesture: keep tracking the other
      this.gesture = 'pending';
      this.pinch = null;
      const p = this.touches.get([...this.touches.keys()][0]);
      p.startX = p.x; p.startY = p.y; p.t = performance.now();
      const id2 = [...this.touches.keys()][0];
      this.longPressTimer = setTimeout(() => {
        if (this.gesture === 'pending' && this.touches.has(id2)) {
          this.gesture = 'box';
          this.mouse.dragStart = [p.x, p.y];
        }
      }, 380);
    }
  }

  tickInput(dt) {
    const pan = 22 * dt * (this.keys['shift'] ? 2.5 : 1);
    if (this.keys['w'] || this.keys['arrowup']) this.cam.y -= pan;
    if (this.keys['s'] || this.keys['arrowdown']) this.cam.y += pan;
    if (this.keys['a'] || this.keys['arrowleft']) this.cam.x -= pan;
    if (this.keys['d'] || this.keys['arrowright']) this.cam.x += pan;
    this.clampCam();
  }

  clearSelection() { this.selection.units = []; this.selection.building = null; this.refreshPanel(); }

  selectArmy() {
    const units = game.factions[0].units.filter(u => u.alive && !u.mission && !u.type.envoy);
    if (units.length === 0) { game.log('No army to select.'); return; }
    this.selection.units = units; this.selection.building = null;
    this.refreshPanel();
  }

  clickSelect(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    // unit first
    let best = null, bestD = 0.8;
    for (const u of game.factions[0].units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - wx, u.y - wy + 0.3);
      if (d < bestD) { best = u; bestD = d; }
    }
    if (best) { this.selection.units = [best]; this.selection.building = null; this.refreshPanel(); return; }
    const [tx, ty] = [Math.floor(wx), Math.floor(wy)];
    const b = game.map.inBounds(tx, ty) ? game.map.buildingAt[game.map.idx(tx, ty)] : null;
    if (b) { this.selection.building = b; this.selection.units = []; this.refreshPanel(); return; }
    this.clearSelection();
  }

  boxSelect(x0, y0, x1, y1) {
    const [wx0, wy0] = this.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const [wx1, wy1] = this.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const picked = game.factions[0].units.filter(u =>
      u.alive && !u.mission && u.x >= wx0 && u.x <= wx1 && u.y >= wy0 && u.y <= wy1);
    if (picked.length) { this.selection.units = picked; this.selection.building = null; }
    this.refreshPanel();
  }

  rightClick(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const tx = Math.floor(wx), ty = Math.floor(wy);
    if (!game.map.inBounds(tx, ty)) return;
    // set rally for selected own castle
    if (this.selection.building && this.selection.building.faction === 0 && this.selection.building.type.key === 'castle') {
      this.selection.building.rally = [tx, ty];
      game.log('Rally point set.');
      return;
    }
    if (this.selection.units.length === 0) return;
    // attack target?
    let target = null;
    for (const f of game.factions) {
      if (!game.diplomacy.hostile(0, f.id)) continue;
      for (const u of f.units) {
        if (u.alive && Math.hypot(u.x - wx, u.y - wy) < 0.8) { target = u; break; }
      }
    }
    if (!target) {
      const b = game.map.buildingAt[game.map.idx(tx, ty)];
      if (b && game.diplomacy.hostile(0, b.faction)) target = b;
      else if (b && b.faction !== 0 && !game.diplomacy.hostile(0, b.faction)) {
        game.log(`You are not at war with ${game.factions[b.faction].name}. Declare war first (Diplomacy).`);
      }
    }
    if (target) {
      for (const u of this.selection.units) if (u.alive && !u.mission) u.orderAttack(target);
    } else {
      // spread move formation
      const n = this.selection.units.length;
      const side = Math.ceil(Math.sqrt(n));
      this.selection.units.forEach((u, i) => {
        if (!u.alive || u.mission) return;
        const ox = (i % side) - (side - 1) / 2;
        const oy = Math.floor(i / side) - (side - 1) / 2;
        let gx = tx + Math.round(ox), gy = ty + Math.round(oy);
        if (!game.map.passable(gx, gy, 0)) { gx = tx; gy = ty; }
        u.orderMove(gx, gy);
      });
    }
  }

  tryPlace() {
    const key = this.placing;
    const type = BUILDING_TYPES[key];
    const [tx, ty] = this.screenToTile(this.mouse.x, this.mouse.y);
    const nation = game.factions[0].nation;
    if (!canPlace(game.map, key, tx, ty, 0)) {
      game.log(`Cannot build here${type.reqText ? ' — ' + type.reqText : ''}.`, 'bad');
      return;
    }
    if (!nation.canAfford(type.cost)) { game.log('Not enough resources.', 'bad'); return; }
    nation.pay(type.cost);
    placeBuilding(game, key, tx, ty, 0);
    if (!this.keys['shift']) this.placing = null;
  }

  // ---------- HUD ----------
  buildHud() {
    const bar = document.getElementById('buildbar');
    for (const key of BUILD_MENU) {
      const t = BUILDING_TYPES[key];
      const btn = document.createElement('button');
      btn.className = 'bbtn';
      btn.innerHTML = `<b>${t.name}</b><span>${costText(t.cost)}</span>`;
      btn.title = t.desc + (t.reqText ? ` (${t.reqText})` : '');
      btn.onclick = () => { this.placing = key; this.clearSelection(); };
      bar.appendChild(btn);
    }
    document.getElementById('diplo-btn').onclick = () => this.toggleDiplomacy();
    document.getElementById('army-btn').onclick = () => this.selectArmy();
    document.getElementById('cancel-place').onclick = () => { this.placing = null; };
    document.getElementById('speed-btn').onclick = () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
      document.getElementById('speed-btn').textContent = '⏩ ' + this.speed + 'x';
    };
    const tax = document.getElementById('tax');
    tax.oninput = () => {
      game.factions[0].nation.tax = tax.value / 100;
      document.getElementById('taxval').textContent = tax.value + '%';
    };
  }

  refreshTopbar() {
    const n = game.factions[0].nation;
    const el = id => document.getElementById(id);
    el('r-food').textContent = Math.floor(n.res.food);
    el('r-wood').textContent = Math.floor(n.res.wood);
    el('r-stone').textContent = Math.floor(n.res.stone);
    el('r-gold').textContent = Math.floor(n.res.gold);
    el('r-pop').textContent = `${n.pop}/${n.housingCap()}`;
    el('r-idle').textContent = n.idleWorkers();
    const hap = Math.round(n.happiness);
    el('r-happy').textContent = hap + '%' + (n.starving ? ' 🥀' : hap >= 70 ? ' 😊' : hap >= 40 ? ' 😐' : ' 😠');
    el('r-happy').className = hap >= 70 ? 'good' : hap >= 40 ? '' : 'bad';
    el('r-food').className = n.starving ? 'bad' : '';
  }

  refreshPanel() {
    const p = document.getElementById('panel');
    const b = this.selection.building;
    const us = this.selection.units.filter(u => u.alive);
    if (!b && us.length === 0) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    if (b) {
      const own = b.faction === 0;
      let html = `<h3><span class="dot" style="background:${game.factions[b.faction].color.css}"></span> ${b.type.name}${own ? '' : ' — ' + game.factions[b.faction].name}</h3>`;
      html += `<div>HP ${Math.max(0, Math.ceil(b.hp))}/${b.type.hp}${b.done ? '' : ` — building ${Math.round(b.progress * 100)}%`}</div>`;
      html += `<div class="desc">${b.type.desc}</div>`;
      if (own && b.done && b.type.slots) {
        html += `<div class="workers">Workers: <button id="wminus">−</button> <b>${b.workers}/${b.type.slots}</b> <button id="wplus">+</button> <span class="dim">(idle: ${game.factions[0].nation.idleWorkers()})</span></div>`;
      }
      if (own && b.done && b.type.key === 'castle') {
        html += `<div class="trainrow">` + TRAIN_MENU.map(k => {
          const t = UNIT_TYPES[k];
          return `<button class="tbtn" data-u="${k}" title="${t.desc}\n${costText(t.cost)} · ${t.trainTime}s">${t.name}</button>`;
        }).join('') + `</div>`;
        if (b.trainQueue.length) {
          const q = b.trainQueue[0];
          html += `<div class="dim">Training ${UNIT_TYPES[q.unitKey].name} ${Math.round(q.t / UNIT_TYPES[q.unitKey].trainTime * 100)}% (+${b.trainQueue.length - 1} queued)</div>`;
        }
        html += this.isTouch
          ? `<div class="dim">Two-finger tap the map to set a rally point.</div>`
          : `<div class="dim">Right-click the map to set a rally point.</div>`;
        if (!b.grand && b.grandProgress === 0) {
          html += `<button id="grand" title="Prosperity victory: requires 50 population and 70% happiness.\nCosts 300 gold, 200 wood, 200 stone.">👑 Build Grand Castle</button>`;
        } else if (!b.grand) {
          html += `<div class="good">Grand Castle rising… ${Math.round(b.grandProgress / 30 * 100)}%</div>`;
        } else {
          html += `<div class="good">👑 Grand Castle</div>`;
        }
      }
      p.innerHTML = html;
      if (own && b.type.slots) {
        const n = game.factions[0].nation;
        const minus = document.getElementById('wminus'), plus = document.getElementById('wplus');
        if (minus) minus.onclick = () => { if (b.workers > 0) b.workers--; this.refreshPanel(); };
        if (plus) plus.onclick = () => { if (b.workers < b.type.slots && n.idleWorkers() > 0) b.workers++; this.refreshPanel(); };
      }
      if (own && b.type.key === 'castle') {
        p.querySelectorAll('.tbtn').forEach(btn => {
          btn.onclick = () => {
            const err = game.factions[0].trainUnit(btn.dataset.u);
            if (err) game.log(err, 'bad'); else this.refreshPanel();
          };
        });
        const g = document.getElementById('grand');
        if (g) g.onclick = () => {
          const n = game.factions[0].nation;
          if (n.pop < 50) return game.log('The Grand Castle needs a great nation: 50 population required.', 'bad');
          if (n.happiness < 70) return game.log('Your people must be content (70% happiness) to raise the Grand Castle.', 'bad');
          const cost = { gold: 300, wood: 200, stone: 200 };
          if (!n.canAfford(cost)) return game.log('The Grand Castle costs 300 gold, 200 wood, 200 stone.', 'bad');
          n.pay(cost);
          b.grandProgress = 0.01;
          game.log('Construction of the Grand Castle has begun!', 'good');
        };
      }
    } else {
      const byType = {};
      for (const u of us) byType[u.type.name] = (byType[u.type.name] || 0) + 1;
      let html = `<h3>${us.length} unit${us.length > 1 ? 's' : ''} selected</h3>`;
      html += '<div>' + Object.entries(byType).map(([n, c]) => `${c}× ${n}`).join(', ') + '</div>';
      html += this.isTouch
        ? `<div class="dim">Two-finger tap: move / attack. Hold + drag: box-select.</div>`
        : `<div class="dim">Right-click: move / attack. Drag: box-select.</div>`;
      p.innerHTML = html;
    }
  }

  // ---------- diplomacy panel ----------
  toggleDiplomacy() {
    const d = document.getElementById('diplomacy');
    if (d.style.display === 'block') { d.style.display = 'none'; return; }
    d.style.display = 'block';
    this.refreshDiplomacy();
  }
  closeDiplomacy() { document.getElementById('diplomacy').style.display = 'none'; }

  refreshDiplomacy() {
    const d = document.getElementById('diplomacy');
    if (d.style.display !== 'block') return;
    const dip = game.diplomacy;
    let html = `<h2>Diplomacy <button id="dip-close">✕</button></h2>`;
    for (let i = 1; i < game.factions.length; i++) {
      const f = game.factions[i];
      const rel = Math.round(dip.relation(0, i));
      const st = dip.status(0, i);
      const stLabel = { war: '⚔️ AT WAR', neutral: '· Neutral', trade: '🐎 Trade Pact', alliance: '🤝 Alliance' }[st];
      html += `<div class="nation ${f.eliminated ? 'dead' : ''}">
        <div class="nhead"><span class="dot" style="background:${f.color.css}"></span> <b>${f.name}</b>
        <span class="dim">(${f.personality.label})</span> — ${f.eliminated ? '☠️ fallen' : stLabel}</div>`;
      if (!f.eliminated) {
        const pct = (rel + 100) / 2;
        html += `<div class="relbar"><div class="relfill" style="width:${pct}%;background:${rel >= 0 ? '#6a5' : '#a55'}"></div></div>
          <div class="dim">Relations: ${rel}</div>
          <div class="dipbtns">
            <button data-act="gift" data-f="${i}" title="Send 50 gold. Improves relations.">🎁 Gift 50g</button>
            <button data-act="trade" data-f="${i}" title="A Prince envoy carries the offer. Both markets earn gold from caravans.">🐎 Trade Pact</button>
            <button data-act="ally" data-f="${i}" title="Requires strong relations. Allies defend each other.">🤝 Alliance</button>
            ${st === 'war'
              ? `<button data-act="peace" data-f="${i}" title="Pay 100 gold in reparations.">🕊️ Sue for Peace</button>`
              : `<button data-act="war" data-f="${i}" title="No going back cheaply.">⚔️ Declare War</button>`}
          </div>`;
      }
      html += `</div>`;
    }
    html += `<div class="dim" style="margin-top:8px">Trade pacts need a Market on both sides and a Prince envoy to deliver the offer.<br>Allies join wars in each other's defense. Peace is always a path: gift, trade, ally — and win by prosperity.</div>`;
    d.innerHTML = html;
    document.getElementById('dip-close').onclick = () => this.closeDiplomacy();
    d.querySelectorAll('button[data-act]').forEach(btn => {
      btn.onclick = () => {
        const fid = +btn.dataset.f, act = btn.dataset.act;
        let err = null;
        if (act === 'gift') err = game.diplomacy.sendGift(0, fid, 50);
        else if (act === 'trade') err = game.diplomacy.propose(0, fid, 'trade');
        else if (act === 'ally') err = game.diplomacy.propose(0, fid, 'alliance');
        else if (act === 'war') game.diplomacy.declareWar(0, fid);
        else if (act === 'peace') err = game.diplomacy.suePeace(0, fid);
        if (err) game.log(err, 'bad');
        this.refreshDiplomacy();
      };
    });
  }

  // ---------- rendering ----------
  render() {
    const cancelBtn = document.getElementById('cancel-place');
    cancelBtn.style.display = this.placing ? 'block' : 'none';
    const ctx = this.ctx;
    const s = TILE * this.cam.zoom;
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const x0 = Math.max(0, Math.floor(this.cam.x)), y0 = Math.max(0, Math.floor(this.cam.y));
    const x1 = Math.min(MAP_W - 1, Math.ceil(this.cam.x + this.canvas.width / s));
    const y1 = Math.min(MAP_H - 1, Math.ceil(this.cam.y + this.canvas.height / s));
    const map = game.map;

    // terrain
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = map.idx(x, y);
        const t = map.terrain[i];
        this.tile(AT.GRASS, x, y);
        if (t === T_GRASS) {
          if (map.road[i]) this.tile(AT.PATH_DOT, x, y);
          else if (map.decor[i] >= 0) this.tile(AT.GRASS_VARS[map.decor[i] % 3], x, y);
        } else if (t === T_WATER) {
          this.tile(map.waterTile(x, y), x, y);
          if (map.bridge[i]) this.tile(map.bridge[i] === 2 ? AT.BRIDGE_V : AT.BRIDGE_H, x, y);
        } else if (t === T_TREE) {
          this.tile(AT.TREES[map.decor[i] % 3], x, y);
        } else if (t === T_ROCK) {
          this.tile(AT.ROCKS[map.decor[i] % 5], x, y);
        } else if (t === T_CAVE) {
          this.tile(AT.CAVE, x, y);
        }
      }
    }

    // buildings (skip bridges: drawn as terrain)
    for (const f of game.factions) {
      for (const b of f.buildings) {
        if (b.type.key === 'bridge') continue;
        if (b.x + b.type.size < x0 || b.x > x1 || b.y + b.type.size < y0 || b.y > y1) continue;
        this.drawBuilding(b);
      }
    }

    // units, y-sorted
    const units = [];
    for (const f of game.factions) for (const u of f.units) {
      if (u.dead && u.deathT > 6) continue;
      if (u.x < x0 - 1 || u.x > x1 + 1 || u.y < y0 - 1 || u.y > y1 + 1) continue;
      units.push(u);
    }
    units.sort((a, b) => a.y - b.y);
    for (const u of units) this.drawUnit(u);

    // projectiles
    for (const p of game.projectiles) this.drawProjectile(p);

    // placement ghost
    if (this.placing) this.drawGhost();

    // drag box
    if (this.mouse.dragStart) {
      const [sx, sy] = this.mouse.dragStart;
      ctx.strokeStyle = 'rgba(120,255,120,0.9)';
      ctx.strokeRect(sx, sy, this.mouse.x - sx, this.mouse.y - sy);
    }

    this.minimapT -= 1;
    if (this.minimapT <= 0) { this.minimapT = 20; this.renderMinimap(); }
    this.blitMinimap();
  }

  tile(at, x, y, sheet, scale = 1) {
    const s = TILE * this.cam.zoom;
    const [sx, sy] = this.worldToScreen(x, y);
    this.ctx.drawImage(sheet || Assets.tileset, at[0] * TILE, at[1] * TILE, TILE, TILE, Math.floor(sx), Math.floor(sy), Math.ceil(s * scale), Math.ceil(s * scale));
  }

  drawBuilding(b) {
    const ctx = this.ctx;
    const s = TILE * this.cam.zoom;
    let art = b.type.art;
    const sheet = Assets.factionTilesets[b.faction];
    if (b.type.key === 'farm') {
      // farms are drawn as crop fields with a sign
      for (const [tx, ty] of b.footprint()) {
        this.tile(AT.CROP_VARS[(tx + ty) % 2], tx, ty, b.done ? Assets.tileset : null);
      }
      this.tile(AT.SIGN, b.x, b.y);
    } else {
      if (b.type.pair) art = b.faction === 0 ? b.type.art[1] : b.type.art[0];
      const [sx, sy] = this.worldToScreen(b.x, b.y);
      ctx.globalAlpha = b.done ? 1 : 0.55;
      ctx.drawImage(sheet, art[0] * TILE, art[1] * TILE, TILE, TILE,
        Math.floor(sx), Math.floor(sy), Math.ceil(s * b.type.size), Math.ceil(s * b.type.size));
      ctx.globalAlpha = 1;
      if (b.grand) {
        ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
        ctx.strokeRect(Math.floor(sx) + 1, Math.floor(sy) + 1, s * b.type.size - 2, s * b.type.size - 2);
      }
    }
    const [px, py] = this.worldToScreen(b.x, b.y);
    // construction progress
    if (!b.done) {
      this.bar(px, py - 5, s * b.type.size, b.progress, '#7ac');
    } else if (b.hp < b.type.hp) {
      this.bar(px, py - 5, s * b.type.size, Math.max(0, b.hp / b.type.hp), '#5c5');
    }
    // selection outline + faction tint corner
    if (this.selection.building === b) {
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(px + 0.5, py + 0.5, s * b.type.size - 1, s * b.type.size - 1);
    }
    ctx.fillStyle = game.factions[b.faction].color.css;
    ctx.fillRect(px + 1, py + 1, 4, 4);
  }

  drawUnit(u) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const sheet = Assets.unitSheets[u.faction][u.type.key];
    const anim = sheet.anims[u.anim] || sheet.anims.idle;
    let frame;
    if (anim.loop) frame = Math.floor(u.animT * anim.fps) % anim.frames;
    else {
      frame = Math.min(anim.frames - 1, Math.floor(u.animT * anim.fps));
      if (u.anim !== 'death' && frame >= anim.frames - 1 && u.animT * anim.fps > anim.frames) u.setAnim('idle');
    }
    const [sx, sy] = this.worldToScreen(u.x, u.y);
    const size = UF * z;
    const drawX = sx - size / 2, drawY = sy - size * 0.72;
    if (u.dead && u.deathT > 3) ctx.globalAlpha = Math.max(0, 1 - (u.deathT - 3) / 3);
    // selection ring
    if (this.selection.units.includes(u)) {
      ctx.strokeStyle = '#8f8'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2 * z, 7 * z, 3.5 * z, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    if (u.facing < 0) { ctx.translate(sx * 2, 0); ctx.scale(-1, 1); }
    ctx.drawImage(sheet.canvas, frame * UF, anim.row * UF, UF, UF, Math.floor(u.facing < 0 ? drawX : drawX), Math.floor(drawY), size, size);
    ctx.restore();
    // faction chevron + hp
    if (!u.dead) {
      ctx.fillStyle = game.factions[u.faction].color.css;
      ctx.fillRect(sx - 2 * z, drawY + 2 * z, 4 * z, 1.5 * z);
      if (u.hp < u.type.hp) this.bar(sx - 7 * z, drawY, 14 * z, u.hp / u.type.hp, '#5c5');
      if (u.mission && u.mission.kind === 'caravan') {
        ctx.fillStyle = '#fd5';
        ctx.fillRect(sx - 1.5 * z, drawY - 2 * z, 3 * z, 3 * z);
      }
      if (u.mission && u.mission.kind === 'envoy') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx - 1.5 * z, drawY - 2 * z, 3 * z, 3 * z);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawProjectile(p) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const [sx, sy] = this.worldToScreen(p.x, p.y - 0.4);
    const P = Assets.projectiles;
    if (p.impactT >= 0) {
      const f = Math.min(4, Math.floor(p.impactT / 0.4 * 5));
      ctx.drawImage(P, f * TILE, 2 * TILE, TILE, TILE, sx - 8 * z, sy - 8 * z, TILE * z, TILE * z);
      return;
    }
    const row = p.kind === 'arrow' ? 0 : 1;
    const frame = Math.floor(performance.now() / 100) % 2;
    const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.drawImage(P, frame * TILE, row * TILE, TILE, TILE, -8 * z, -8 * z, TILE * z, TILE * z);
    ctx.restore();
  }

  drawGhost() {
    const type = BUILDING_TYPES[this.placing];
    const [tx, ty] = this.screenToTile(this.mouse.x, this.mouse.y);
    const ok = canPlace(game.map, this.placing, tx, ty, 0) && game.factions[0].nation.canAfford(type.cost);
    const s = TILE * this.cam.zoom;
    const [sx, sy] = this.worldToScreen(tx, ty);
    this.ctx.globalAlpha = 0.6;
    let art = type.art;
    if (type.pair) art = art[1];
    if (this.placing === 'farm') {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.tile(AT.CROP_VARS[(dx + dy) % 2], tx + dx, ty + dy);
    } else if (art) {
      this.ctx.drawImage(Assets.tileset, art[0] * TILE, art[1] * TILE, TILE, TILE, sx, sy, s * type.size, s * type.size);
    }
    this.ctx.globalAlpha = 1;
    this.ctx.strokeStyle = ok ? '#6f6' : '#f66';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(sx, sy, s * type.size, s * type.size);
  }

  bar(x, y, w, frac, color) {
    const ctx = this.ctx;
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 3);
  }

  renderMinimap() {
    const mctx = this.mini.getContext('2d');
    const img = mctx.createImageData(MAP_W, MAP_H);
    const map = game.map;
    const colors = {
      [T_GRASS]: [116, 196, 80], [T_WATER]: [64, 120, 200],
      [T_TREE]: [40, 120, 50], [T_ROCK]: [130, 130, 130], [T_CAVE]: [80, 70, 70],
    };
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      let c = colors[map.terrain[i]];
      if (map.road[i]) c = [200, 180, 120];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    for (const f of game.factions) {
      mctx.fillStyle = f.color.css;
      for (const b of f.buildings) {
        if (b.type.key === 'bridge') continue;
        mctx.fillRect(b.x, b.y, b.type.size + 1, b.type.size + 1);
      }
      for (const u of f.units) if (u.alive) mctx.fillRect(Math.floor(u.x), Math.floor(u.y), 1, 1);
    }
  }

  blitMinimap() {
    const mm = this.minictx;
    mm.clearRect(0, 0, this.minimap.width, this.minimap.height);
    mm.drawImage(this.mini, 0, 0, this.minimap.width, this.minimap.height);
    // viewport rectangle
    const s = TILE * this.cam.zoom;
    const kx = this.minimap.width / MAP_W, ky = this.minimap.height / MAP_H;
    mm.strokeStyle = '#fff';
    mm.strokeRect(this.cam.x * kx, this.cam.y * ky, this.canvas.width / s * kx, this.canvas.height / s * ky);
  }
}

function costText(cost) {
  const icons = { food: '🍞', wood: '🪵', stone: '🪨', gold: '🪙' };
  return Object.entries(cost).map(([k, v]) => `${icons[k]}${v}`).join(' ') || 'free';
}
