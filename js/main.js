'use strict';
// Game setup, fixed-timestep simulation loop, victory/defeat, event log.

const SIM_DT = 0.1;   // seconds per sim tick

// Difficulty modes, chosen on the pre-game screen (or via ?difficulty=key).
// They control how ruthlessly AI nations pursue their ambitions:
//  warAppetite  — multiplies how eagerly AIs start wars (higher = more wars)
//  ultimatums   — wars against the player are telegraphed by an ultimatum first
//  consolidation— seconds a victor rests after eliminating a nation
//  coalitions   — other nations (and the player) can gang up on a runaway power
//  armyMul      — scales AI army-size targets
//  playerGrace  — no AI-initiated war on the player before this game time (s)
//  provokedOnly — AIs only declare war on the player after real provocation
const DIFFICULTIES = {
  ramped:   { label: 'Measured March', warAppetite: 0.8, ultimatums: true,  consolidation: 180,
              coalitions: true,  armyMul: 0.9,  playerGrace: 300, provokedOnly: false,
              desc: 'Wars are telegraphed — relations sour, armies mass, ultimatums arrive before blades are drawn. Conquerors still snowball if unchecked.' },
  ruthless: { label: 'Iron Age', warAppetite: 1.4, ultimatums: false, consolidation: 0,
              coalitions: false, armyMul: 1.15, playerGrace: 0,   provokedOnly: false,
              desc: 'Nations attack the moment they sense an advantage — including against you, from the very start. The map consolidates fast.' },
  slanted:  { label: 'Quiet Frontier', warAppetite: 1.0, ultimatums: true,  consolidation: 120,
              coalitions: true,  armyMul: 1.0,  playerGrace: 0,   provokedOnly: true,
              desc: 'AI nations wage real wars on each other, but only march on you if provoked — raid, embargo or bully them and they will answer.' },
};

// day/night cycle: bright day and dark night, each 2.5 minutes, for a 5-minute full day.
const DAY_LENGTH = 150;
const NIGHT_LENGTH = 150;
const DAY_NIGHT_CYCLE = DAY_LENGTH + NIGHT_LENGTH;

let game = null;

class Game {
  constructor(seed, diffKey = 'ramped') {
    this.diffKey = DIFFICULTIES[diffKey] ? diffKey : 'ramped';
    this.diff = DIFFICULTIES[this.diffKey];
    this.map = new GameMap(seed);
    this.factions = [];
    this.projectiles = [];
    this.loot = [];       // dropped plunder piles awaiting pickup
    this.time = 0;
    this.dayCount = 1;
    this.isDay = true;
    this.over = false;
    this.tradeGold = 0;   // lifetime gold earned from trade (stats)
    this.msgs = [];
    this.market = new Market();
    for (let i = 0; i < 4; i++) {
      this.factions.push(new Faction(i, i === 0, AI_PERSONALITIES[i] || { aggression: 0, mercantile: 0.5, label: 'you' }));
    }
    this.diplomacy = new Diplomacy(4);
    // found each nation at its start zone
    this.map.startZones.forEach((z, i) => {
      const th = placeBuilding(this, 'townhall', z.x - 1, z.y - 1, i);
      th.progress = 1;
      // seed starting resources physically into the Town Hall
      th.store.food = 120; th.store.wood = 90; th.store.stone = 50; th.store.gold = 40;
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

  // 1 at midday (brightest), 0 at midnight (darkest). A single cosine over the whole
  // day+night cycle so the light never jumps — dawn/dusk fall at the 0.5 crossing.
  lightLevel() {
    const t = this.time % DAY_NIGHT_CYCLE;
    return 0.5 + 0.5 * Math.cos(2 * Math.PI * (t - DAY_LENGTH / 2) / DAY_NIGHT_CYCLE);
  }

  tick(dt) {
    if (this.over) return;
    this.time += dt;
    const isDayNow = (this.time % DAY_NIGHT_CYCLE) < DAY_LENGTH;
    if (isDayNow && !this.isDay) {
      this.dayCount++;
      let grown = 0;
      for (const f of this.factions) {
        if (f.eliminated) continue;
        const before = f.nation.pop;
        f.nation.growForNewDay();
        if (f.id === 0) grown = f.nation.pop - before;
      }
      if (grown > 0) this.log(`Dawn breaks — ${grown} new citizen${grown > 1 ? 's' : ''} joined your nation.`, 'good');
    }
    this.isDay = isDayNow;
    for (const f of this.factions) {
      if (f.eliminated) continue;
      f.nation.tick(dt);
      f.tickTraining(dt);
      if (!f.isPlayer) aiTick(f, dt);
      for (const u of f.units) u.tick(dt);
      f.units = f.units.filter(u => !u.dead || u.deathT < 8);
    }
    separateUnits(dt);
    for (const p of this.projectiles) p.tick(dt);
    this.projectiles = this.projectiles.filter(p => !p.done);
    this.market.tick(dt);
    this.tickLoot(dt);
    this.diplomacy.tick(dt);
    this.checkVictory();
  }

  // Plunder dropped on the ground: units scoop it up when they reach it, and
  // idle nearby units are drawn over to collect the spoils.
  tickLoot(dt) {
    for (const pile of this.loot) {
      pile.t += dt;
      // pick up if a capable unit is standing on the wreckage
      let best = null, bd = 1.3;
      for (const f of this.factions) {
        for (const u of f.units) {
          if (!u.alive || u.type.envoy || u.carryCap - u.carryTotal() <= 0) continue;
          const d = Math.hypot(u.x - pile.x, u.y - pile.y);
          if (d < bd) { bd = d; best = u; }
        }
      }
      if (best) {
        let room = best.carryCap - best.carryTotal();
        for (const r of ['gold', 'stone', 'wood', 'food']) {
          if (room <= 0) break;
          const take = Math.min(pile.res[r], room);
          if (take <= 0) continue;
          pile.res[r] -= take; best.carry[r] += take; room -= take;
        }
        if (best.faction === 0 && !pile.claimed) { pile.claimed = true; game.log('Your troops seized plunder — get it home to bank it!', 'good'); }
      } else {
        // no one on it: send the nearest idle carrier over to collect it
        let cand = null, cd = 5;
        for (const f of this.factions) {
          for (const u of f.units) {
            if (!u.alive || u.type.envoy || u.mission || u.target || u.path.length > 0) continue;
            if (u.carryCap - u.carryTotal() <= 0) continue;
            const d = Math.hypot(u.x - pile.x, u.y - pile.y);
            if (d < cd) { cd = d; cand = u; }
          }
        }
        if (cand) cand.orderMove(Math.floor(pile.x), Math.floor(pile.y));
      }
    }
    this.loot = this.loot.filter(p => (p.res.food + p.res.wood + p.res.stone + p.res.gold) > 0.5 && p.t < 120);
  }

  checkVictory() {
    // prosperity victory — and prosperity DEFEAT: a rival's Grand Castle ends the game too
    const player = this.factions[0];
    if (player.buildings.some(b => b.grand)) {
      return this.end(true, 'Prosperity Victory! Your Grand Castle stands as proof that a nation can flourish through trade, diplomacy and good governance.');
    }
    for (const f of this.factions) {
      if (!f.isPlayer && !f.eliminated && f.buildings.some(b => b.grand)) {
        return this.end(false, `${f.name} has completed its Grand Castle. The continent flocks to their banner, and your nation fades into their shadow.`);
      }
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
        // the world reshapes: every survivor rethinks its ambitions
        for (const o of this.factions) if (!o.eliminated) aiPoke(o.id);
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
    el.querySelector('h1').innerHTML = won ? '<span class="icon icon-trophy"></span> Victory' : '<span class="icon icon-skull"></span> Defeat';
    el.querySelector('p').textContent = text;
  }
}

function onUnitDeath(unit, attacker) {
  const f = game.factions[unit.faction];
  if (unit.type.key === 'king') {
    f.kingAlive = false;
    game.log(`The King of ${f.name} has fallen in battle!`, unit.faction === 0 ? 'bad' : '');
    aiPoke(unit.faction, true);
  }
  // a slain porter spills whatever plunder it was carrying
  if (unit.carryTotal && unit.carryTotal() > 0.5) {
    game.loot.push({ x: unit.x, y: unit.y, res: { ...unit.carry }, t: 0 });
  }
  if (attacker && attacker.faction !== undefined) {
    game.diplomacy.addRel(unit.faction, attacker.faction, -4);
    game.factions[unit.faction].nation.warWeariness += 1.5;
    game.diplomacy.lastBlood[unit.faction][attacker.faction] = game.time;
    game.diplomacy.lastBlood[attacker.faction][unit.faction] = game.time;
    aiAddGrudge(unit.faction, attacker.faction, 2);
    // unprovoked killing by the player is remembered (gates wars on 'slanted')
    if (attacker.faction === 0 && f.ai && !game.diplomacy.hostile(0, unit.faction)) f.ai.provocation += 1;
  }
}

function dropLoot(b) {
  const s = b.store;
  if (!s || s.food + s.wood + s.stone + s.gold < 0.5) return;
  game.loot.push({ x: b.cx, y: b.cy, res: { food: s.food, wood: s.wood, stone: s.stone, gold: s.gold }, t: 0 });
  if (b.faction !== 0) game.log(`${game.factions[b.faction].name}'s ${b.type.name} spills its stores — grab the loot!`, 'good');
}

function onBuildingDestroyed(b, attacker) {
  // razing a storehouse scatters its goods on the ground to be carried off
  if (b.type.storage) dropLoot(b);
  removeBuilding(game, b);
  if (b.faction === 0) game.log(`Your ${b.type.name} was destroyed!`, 'bad');
  if (attacker) {
    game.diplomacy.addRel(b.faction, attacker.faction, -8);
    game.diplomacy.lastBlood[b.faction][attacker.faction] = game.time;
    game.diplomacy.lastBlood[attacker.faction][b.faction] = game.time;
    aiAddGrudge(b.faction, attacker.faction, 8);
  }
  aiPoke(b.faction, true);
}

// ---------- boot ----------

let ui = null;

async function boot() {
  const status = document.getElementById('loading');
  // landscape is optional: honor a saved "play in portrait" choice and wire the button
  try {
    if (localStorage.getItem('nations_ignoreRotate') === '1') document.body.classList.add('force-play');
  } catch (e) { /* storage may be blocked */ }
  const portraitBtn = document.getElementById('play-portrait');
  if (portraitBtn) portraitBtn.onclick = () => {
    document.body.classList.add('force-play');
    try { localStorage.setItem('nations_ignoreRotate', '1'); } catch (e) {}
    if (ui) ui.resize();
  };
  try {
    await Assets.load();
  } catch (e) {
    status.textContent = 'Failed to load assets: ' + e.message + ' — serve this folder over HTTP (python3 -m http.server).';
    return;
  }
  status.style.display = 'none';
  const params = new URLSearchParams(location.search);
  const seed = parseInt(params.get('seed')) || (Math.random() * 1e9 | 0);
  const diffKey = params.get('difficulty');
  if (DIFFICULTIES[diffKey]) return startGame(seed, diffKey);
  // no difficulty chosen yet: show the pre-game screen; the sim does not start
  // (and `game` stays null) until a mode is picked
  const overlay = document.getElementById('difficulty');
  overlay.querySelectorAll('button[data-diff]').forEach(btn => {
    const d = DIFFICULTIES[btn.dataset.diff];
    btn.querySelector('.diff-desc').textContent = d.desc;
    btn.onclick = () => { overlay.style.display = 'none'; startGame(seed, btn.dataset.diff); };
  });
  overlay.style.display = 'flex';
}

function startGame(seed, diffKey) {
  // the URL round-trips both seed and difficulty, so replays reproduce the game
  try { history.replaceState(null, '', `?seed=${seed}&difficulty=${diffKey}`); } catch (e) {}
  game = new Game(seed, diffKey);
  ui = new UI(document.getElementById('game'));
  ui.centerOn(game.map.startZones[0].x, game.map.startZones[0].y);
  game.log('Welcome to your nation! Feed your people, house them, and choose: trade or war.', 'good');
  if (ui.isTouch) {
    game.log('Build farms and houses first. Drag to pan, pinch to zoom, tap to select.');
    game.log('Double-tap (or two-finger tap) to move/attack/set rally. Hold and drag to box-select.');
  } else {
    game.log('Build farms and houses first. WASD to pan, wheel to zoom.');
  }

  let last = performance.now();
  let acc = 0;
  let panelT = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (ui.paused) { acc = 0; }   // pause menu open: freeze the sim, keep rendering the frozen frame
    else {
      acc += real * ui.speed;
      while (acc >= SIM_DT) { game.tick(SIM_DT); acc -= SIM_DT; }
    }
    ui.tickInput(real);
    // advance animation clocks smoothly between sim ticks
    ui.render();
    ui.refreshTopbar();
    panelT -= real;
    if (panelT <= 0) { panelT = 0.5; ui.refreshPanel(); ui.refreshDiplomacy(); ui.refreshTooltip(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', boot);
