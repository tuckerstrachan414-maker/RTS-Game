'use strict';
// Game setup, fixed-timestep simulation loop, victory/defeat, event log.

const SIM_DT = 0.1;   // seconds per sim tick

let game = null;

class Game {
  constructor(seed) {
    this.map = new GameMap(seed);
    this.factions = [];
    this.projectiles = [];
    this.time = 0;
    this.over = false;
    this.tradeGold = 0;   // lifetime gold earned from trade (stats)
    this.msgs = [];
    for (let i = 0; i < 4; i++) {
      this.factions.push(new Faction(i, i === 0, AI_PERSONALITIES[i] || { aggression: 0, mercantile: 0.5, label: 'you' }));
    }
    this.diplomacy = new Diplomacy(4);
    // found each nation at its start zone
    this.map.startZones.forEach((z, i) => {
      const th = placeBuilding(this, 'townhall', z.x - 1, z.y - 1, i);
      th.progress = 1;
      // a small starting escort
      const f = this.factions[i];
      const spots = [[z.x - 3, z.y + 2], [z.x + 2, z.y + 2], [z.x - 3, z.y - 3]];
      const escort = ['sword', 'spear', 'archer'];
      spots.forEach(([x, y], k) => {
        if (this.map.passable(x, y, i)) f.units.push(new Unit(escort[k], i, x, y));
      });
    });
  }

  log(text, cls = '') {
    this.msgs.push({ text, cls, t: this.time });
    if (this.msgs.length > 60) this.msgs.shift();
    const el = document.getElementById('log');
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    el.appendChild(div);
    while (el.children.length > 7) el.removeChild(el.firstChild);
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 1200); }, 9000);
  }

  tick(dt) {
    if (this.over) return;
    this.time += dt;
    for (const f of this.factions) {
      if (f.eliminated) continue;
      f.nation.tick(dt);
      f.tickTraining(dt);
      if (!f.isPlayer) aiTick(f, dt);
      for (const u of f.units) u.tick(dt);
      f.units = f.units.filter(u => !u.dead || u.deathT < 8);
    }
    for (const p of this.projectiles) p.tick(dt);
    this.projectiles = this.projectiles.filter(p => !p.done);
    this.diplomacy.tick(dt);
    this.checkVictory();
  }

  checkVictory() {
    // prosperity victory
    const player = this.factions[0];
    if (player.buildings.some(b => b.grand)) {
      return this.end(true, 'Prosperity Victory! Your Grand Castle stands as proof that a nation can flourish through trade, diplomacy and good governance.');
    }
    // conquest / elimination
    let rivalsAlive = 0;
    for (const f of this.factions) {
      if (f.eliminated) continue;
      if (!f.townhall()) {
        f.eliminated = true;
        f.units = [];
        for (const b of [...f.buildings]) removeBuilding(this, b);
        this.log(`The nation of ${f.name} has fallen!`, f.isPlayer ? 'bad' : '');
        for (let o = 0; o < 4; o++) if (o !== f.id) this.diplomacy.cancelRoute(f.id, o);
      }
    }
    for (const f of this.factions) if (!f.eliminated && !f.isPlayer) rivalsAlive++;
    if (this.factions[0].eliminated) return this.end(false, 'Your Town Hall lies in ruins. The nation is lost.');
    if (rivalsAlive === 0) return this.end(true, 'Conquest Victory! All rival nations have fallen — the continent is yours.');
    // allied victory: everyone left alive is allied with you
    const allAllied = this.factions.every(f => f.eliminated || f.isPlayer || this.diplomacy.status(0, f.id) === 'alliance');
    if (allAllied && rivalsAlive > 0 && this.time > 60) {
      return this.end(true, 'Diplomatic Victory! Every surviving nation stands in alliance with you. Peace reigns.');
    }
  }

  end(won, text) {
    if (this.over) return;
    this.over = true;
    const el = document.getElementById('gameover');
    el.style.display = 'flex';
    el.querySelector('h1').textContent = won ? '🏆 Victory' : '💀 Defeat';
    el.querySelector('p').textContent = text;
  }
}

function onUnitDeath(unit, attacker) {
  const f = game.factions[unit.faction];
  if (unit.type.key === 'king') {
    f.kingAlive = false;
    game.log(`The King of ${f.name} has fallen in battle!`, unit.faction === 0 ? 'bad' : '');
  }
  if (attacker && attacker.faction !== undefined) {
    game.diplomacy.addRel(unit.faction, attacker.faction, -4);
    game.factions[unit.faction].nation.warWeariness += 1.5;
  }
}

function onBuildingDestroyed(b, attacker) {
  removeBuilding(game, b);
  if (b.faction === 0) game.log(`Your ${b.type.name} was destroyed!`, 'bad');
  if (attacker) game.diplomacy.addRel(b.faction, attacker.faction, -8);
}

// ---------- boot ----------

let ui = null;

async function boot() {
  const status = document.getElementById('loading');
  try {
    await Assets.load();
  } catch (e) {
    status.textContent = 'Failed to load assets: ' + e.message + ' — serve this folder over HTTP (python3 -m http.server).';
    return;
  }
  status.style.display = 'none';
  const params = new URLSearchParams(location.search);
  const seed = parseInt(params.get('seed')) || (Math.random() * 1e9 | 0);
  game = new Game(seed);
  ui = new UI(document.getElementById('game'));
  ui.centerOn(game.map.startZones[0].x, game.map.startZones[0].y);
  game.log('Welcome to your nation! Feed your people, house them, and choose: trade or war.', 'good');
  game.log('Build farms and houses first. WASD to pan, wheel to zoom.');

  let last = performance.now();
  let acc = 0;
  let panelT = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += real * ui.speed;
    while (acc >= SIM_DT) { game.tick(SIM_DT); acc -= SIM_DT; }
    ui.tickInput(real);
    // advance animation clocks smoothly between sim ticks
    ui.render();
    ui.refreshTopbar();
    panelT -= real;
    if (panelT <= 0) { panelT = 0.5; ui.refreshPanel(); ui.refreshDiplomacy(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', boot);
