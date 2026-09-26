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

// Dev-mode cheat: floor the player's Town Hall reserves at this level every
// tick (see Game.devTopOff) so resources never run out. Written directly to
// the building's store, bypassing storage capacity — a deliberate cheat, not
// a change to how storage normally works. Comfortably above every cost in the
// game (the priciest single thing, the King, is food 100 / gold 100).
const DEV_RESOURCE_FLOOR = 9999;

let game = null;

class Game {
  // opts: { pace: 'quick'|'standard'|'epic', victory: bool } — set on the
  // pre-game screen and round-tripped through the URL like the seed.
  constructor(seed, diffKey = 'ramped', opts = {}) {
    this.diffKey = DIFFICULTIES[diffKey] ? diffKey : 'ramped';
    this.diff = DIFFICULTIES[this.diffKey];
    this.paceKey = PACES[opts.pace] ? opts.pace : 'standard';
    this.pace = PACES[this.paceKey];
    this.victoryOn = opts.victory !== false;
    // The world must be configured before anything sizes an array off MAP_W.
    // boot() normally does it from the URL; this is the safety net for a Game
    // constructed some other way (a headless verification script, say).
    if (!WORLD) configureWorld({});
    this.seed = seed | 0;   // the weather is rolled off it (js/seasons.js)
    this.devMode = false;   // cheat toggle: infinite resources + free/unlimited training for the player
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
    this.events = [];     // pending player choice-cards (js/events.js)
    this.market = new Market();
    // Seeded stream for every AI decision, derived from (but not shared with)
    // the map generator: personalities, tick jitter and the utility engine all
    // draw from it, so ?seed=N replays the opponents as well as the terrain.
    this.rng = mulberry32((seed | 0) ^ 0x5f3a7c1d);
    const personalities = rollPersonalities(this.rng, 4);
    for (let i = 0; i < 4; i++) {
      this.factions.push(new Faction(i, i === 0, personalities[i]));
    }
    this.diplomacy = new Diplomacy(4);
    this.territory = new Territory(4);
    // the people behind the nations: names, faces, memories (js/leaders.js)
    this.court = new LeaderCourt(4);
    rollLeaders(this);
    // the world's Wonders, the victory races, and the history of the match
    this.wonders = new WonderRegister();
    this.victory = new VictoryState(4);
    this.chronicle = [];
    this.endInfo = null;
    // Marching doctrine: shape of the ranks and which unit types take the front.
    // Player-set (Menu → Formations) and remembered across games.
    this.formations = loadFormations(this.factions[0].name);
    // found each nation at its start zone
    this.map.startZones.forEach((z, i) => {
      const th = placeBuilding(this, 'townhall', z.x - 1, z.y - 1, i);
      th.progress = 1;
      // seed starting resources physically into the Town Hall
      th.store.food = 120; th.store.wood = 90; th.store.stone = 50; th.store.gold = 40;
      // The Town Hall's two builder slots start filled: without a builder nothing
      // can be built at all, including the Builder House that makes more of them.
      th.workers = th.type.slots;
      // a small starting escort
      const f = this.factions[i];
      const spots = [[z.x - 3, z.y + 2], [z.x + 2, z.y + 2], [z.x - 3, z.y - 3]];
      const escort = ['sword', 'spear', 'archer'];
      spots.forEach(([x, y], k) => {
        if (this.map.passable(x, y, i)) f.units.push(new Unit(escort[k], i, x, y));
      });
    });
  }

  // `ms` is how long the line stays up; the Steward's counsel (js/ui-advisor.js)
  // stays longer than news, and wears a quill.
  log(text, cls = '', ms = 9000) {
    this.msgs.push({ text, cls, t: this.time });
    if (this.msgs.length > 60) this.msgs.shift();
    const el = document.getElementById('log');
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls === 'advice') {
      const q = document.createElement('span');
      q.className = 'icon icon-quill';
      div.appendChild(q);
      div.appendChild(document.createTextNode(' ' + text));
    } else div.textContent = text;
    el.appendChild(div);
    // A landscape phone is ~390px tall; seven stacked messages ate a quarter of it and
    // ran into the build panel. Keep fewer lines when there is less room for them.
    const maxLines = window.innerHeight < 460 ? 3 : window.innerHeight < 620 ? 5 : 7;
    while (el.children.length > maxLines) el.removeChild(el.firstChild);
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 1200); }, ms);
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
      onNewDaySeason();
    }
    this.isDay = isDayNow;
    for (const f of this.factions) {
      if (f.eliminated) continue;
      f.nation.tick(dt);
      if (this.devMode && f.isPlayer) this.devTopOff(f.nation);
      tickResearch(f, dt);
      f.tickTraining(dt);
      tickTowers(f, dt);
      if (!f.isPlayer) aiTick(f, dt);
      for (const u of f.units) u.tick(dt);
      f.units = f.units.filter(u => !u.dead || u.deathT < 8);
    }
    separateUnits(dt);
    tickArmy(dt);
    for (const p of this.projectiles) p.tick(dt);
    this.projectiles = this.projectiles.filter(p => !p.done);
    this.market.tick(dt);
    this.tickLoot(dt);
    this.diplomacy.tick(dt);
    this.territory.tick(dt);
    tickLeaders(dt);
    tickEvents();
    this.checkDefeat();
    tickVictory(dt);
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
          // spoils are a raider's business — civilians have their own loads to carry
          if (!u.alive || u.aboard || u.type.envoy || u.type.civilian || u.carryCap - u.carryTotal() <= 0) continue;
          const d = wdist(u.x, u.y, pile.x, pile.y);
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
            if (!u.alive || u.aboard || u.type.envoy || u.type.civilian || u.mission || u.target || u.path.length > 0) continue;
            if (u.carryCap - u.carryTotal() <= 0) continue;
            const d = wdist(u.x, u.y, pile.x, pile.y);
            if (d < cd) { cd = d; cand = u; }
          }
        }
        if (cand) cand.orderMove(Math.floor(pile.x), Math.floor(pile.y));
      }
    }
    this.loot = this.loot.filter(p => (p.res.food + p.res.wood + p.res.stone + p.res.gold) > 0.5 && p.t < 120);
  }

  // There is no way to win. Rival nations can still be conquered, eliminate
  // each other, race a Grand Castle, or ally with you — none of it ends the
  // game. The only thing that does is the player's own Town Hall falling.
  checkDefeat() {
    for (const f of this.factions) {
      if (f.eliminated) continue;
      if (!f.townhall()) {
        f.eliminated = true;
        f.units = [];
        // a conquered nation is absorbed, not erased: its farms, mines, markets
        // and full storehouses pass to whoever felled its Town Hall
        const victorFid = f.conqueredBy;
        const taken = annexBuildings(this, f, victorFid);
        if (victorFid != null && this.factions[victorFid] && !this.factions[victorFid].eliminated) leaderOnConquest(victorFid, f.id);
        else leaderOnConquest(-1, f.id);
        this.log(`The nation of ${f.name} has fallen!`, f.isPlayer ? 'bad' : '');
        chronicle(victorFid != null && this.factions[victorFid]
          ? `${f.name} fell to ${this.factions[victorFid].name}.` : `${f.name} fell.`, victorFid != null ? victorFid : f.id, 'major');
        if (taken > 0) {
          const victor = this.factions[victorFid];
          this.log(`${victor.name} annexes ${taken} of ${f.name}'s buildings.`,
            victor.isPlayer ? 'good' : f.isPlayer ? 'bad' : '');
        }
        for (let o = 0; o < 4; o++) if (o !== f.id) this.diplomacy.cancelRoute(f.id, o);
        // the world reshapes: every survivor rethinks its ambitions
        for (const o of this.factions) if (!o.eliminated) aiPoke(o.id);
      }
    }
    if (this.factions[0].eliminated) this.end('Your Town Hall lies in ruins. The nation is lost.');
  }

  // Refills the player's Town Hall directly, bypassing normal storage capacity —
  // the Town Hall always exists while the nation is alive, so this can't no-op
  // the way depositing into a full Storehouse would. Runs every tick devMode is
  // on, so consumption (eating, upkeep, spending) never drains it for long.
  devTopOff(nation) {
    const th = nation.faction.buildings.find(b => b.type.key === 'townhall');
    if (!th) return;
    for (const r of RES_KEYS) if (th.store[r] < DEV_RESOURCE_FLOOR) th.store[r] = DEV_RESOURCE_FLOOR;
  }

  toggleDevMode() {
    this.devMode = !this.devMode;
    this.log(this.devMode ? 'Dev mode ON — infinite resources, unlimited training.' : 'Dev mode off.',
      this.devMode ? 'good' : '');
    return this.devMode;
  }

  // The player's Town Hall has fallen.
  end(text) {
    chronicle(`Azuria fell. ${text}`, 0, 'major');
    this.endGame('defeat', 'Defeat', text);
  }

  // Freeze the sim and show the end screen (js/ui-victory.js). `kind` is
  // 'victory' or 'defeat'. A victory can be played on past, in which case the
  // match simply becomes endless; a defeat cannot.
  endGame(kind, title, text) {
    if (this.over) return;
    this.over = true;
    this.endInfo = { kind, title, text, t: this.time };
    sampleStats();
    if (typeof ui !== 'undefined' && ui) ui.showEndScreen(this.endInfo);
  }

  // After a victory, the player may keep ruling: victory conditions switch off
  // and the world carries on.
  continueAfterVictory() {
    this.over = false;
    this.victoryOn = false;
    this.endInfo = null;
    chronicle('Azuria chose to rule on beyond its victory.', 0, 'minor');
  }
}

// ---------- formation settings ----------
// Stored per nation name (the player is always Azuria today, but keying by name
// means a future "pick your nation" screen keeps a doctrine per nation for free)
// and validated on the way in — a stale save from an older roster must not be
// able to smuggle a removed unit key into formationMove's ordering.
const FORMATION_KEY = name => `nations_formation_${name}`;

function defaultFormations() {
  return { shape: 'diamond', order: DEFAULT_FORMATION_ORDER.slice() };
}

function sanitizeFormations(raw) {
  const out = defaultFormations();
  if (!raw || typeof raw !== 'object') return out;
  if (FORMATION_SHAPES.includes(raw.shape)) out.shape = raw.shape;
  if (Array.isArray(raw.order)) {
    // keep the saved order of keys that still exist, then append anything new
    const kept = raw.order.filter((k, i) => UNIT_TYPES[k] && raw.order.indexOf(k) === i);
    out.order = kept.concat(out.order.filter(k => !kept.includes(k)));
  }
  return out;
}

function loadFormations(name) {
  try {
    return sanitizeFormations(JSON.parse(localStorage.getItem(FORMATION_KEY(name))));
  } catch (e) { return defaultFormations(); }   // storage blocked or corrupt JSON
}

function saveFormations(name, cfg) {
  try { localStorage.setItem(FORMATION_KEY(name), JSON.stringify(cfg)); } catch (e) { /* storage may be blocked */ }
}

function onUnitDeath(unit, attacker) {
  const f = game.factions[unit.faction];
  // A hull going down takes everyone below decks with it. They are not on the
  // map to be killed individually, so the sinking is the only thing that can.
  if (unit.cargo && unit.cargo.length) {
    const lost = unit.cargo.slice();
    unit.cargo.length = 0;
    for (const p of lost) {
      p.aboard = null;
      if (!p.dead) { p.dead = true; p.hp = 0; onUnitDeath(p, attacker); }
    }
    game.log(unit.faction === 0
      ? `Your ${unit.type.name} goes down with ${lost.length} aboard!`
      : `${f.name}'s ${unit.type.name} is sunk with all hands.`,
      unit.faction === 0 ? 'bad' : '');
  }
  // a killed civilian is a citizen the nation no longer has
  if (unit.type.civilian) onCivilianDeath(unit);
  // comrades falling around a soldier shake it; a King falling shakes an army
  if (!unit.type.civilian && !unit.type.naval) {
    forEachSoldierNear(unit.x, unit.y, 5, v => { if (v !== unit && v.faction === unit.faction) hitMorale(v, 8); });
  }
  if (unit.type.key === 'king') {
    for (const v of f.units) hitMorale(v, 35);
    f.kingAlive = false;
    game.log(`The King of ${f.name} has fallen in battle!`, unit.faction === 0 ? 'bad' : '');
    chronicle(`The King of ${f.name} fell in battle${attacker && attacker.faction !== undefined ? ' against ' + game.factions[attacker.faction].name : ''}.`, unit.faction, 'major');
    addMood(f, 'king_dead', 'Mourning the King', -6, 300);
    aiPoke(unit.faction, true);
  }
  // a slain envoy takes its undelivered proposal to the grave
  if (unit.type.envoy && unit.mission && unit.mission.kind === 'envoy') {
    game.log(`${f.name}'s envoy was slain on the road — the proposal died with him.`, unit.faction === 0 ? 'bad' : '');
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
  // only tempt the player when it's actually their fight (or their troops are close)
  if (b.faction !== 0) {
    const relevant = game.diplomacy.hostile(0, b.faction)
      || game.factions[0].units.some(u => u.alive && wdist(u.x, u.y, b.cx, b.cy) < 20);
    if (relevant) game.log(`${game.factions[b.faction].name}'s ${b.type.name} spills its stores — grab the loot!`, 'good');
  }
}

function onBuildingDestroyed(b, attacker) {
  if (typeof fxRaze === 'function') fxRaze(b);
  // razing a storehouse scatters its goods on the ground to be carried off
  if (b.type.storage) dropLoot(b);
  // so does knocking over a half-built site: the materials the builders carried
  // there are lying on the ground, and anyone with a sack can take them
  if (b.site) {
    const mats = siteMaterials(b);
    if (mats) game.loot.push({ x: b.cx, y: b.cy, res: mats, t: 0 });
  }
  if (b.type.key === 'bridge') {
    // a single tile going down brings the whole straight span with it
    collapseBridgeSpan(game, b);
    if (b.faction === 0) game.log('Your bridge collapses into the water!', 'bad');
    else {
      const relevant = game.diplomacy.hostile(0, b.faction)
        || game.factions[0].units.some(u => u.alive && wdist(u.x, u.y, b.cx, b.cy) < 20);
      if (relevant) game.log(`${game.factions[b.faction].name}'s bridge collapses into the water!`, 'good');
    }
  } else {
    removeBuilding(game, b);
    if (b.type.wonder) onWonderLost(b, attacker);
    if (b.faction === 0) game.log(`Your ${b.type.name} was destroyed!`, 'bad');
  }
  if (attacker) {
    if (attacker.faction !== b.faction) leaderOnRaze(b.faction, attacker.faction);
    game.diplomacy.addRel(b.faction, attacker.faction, -8);
    game.diplomacy.lastBlood[b.faction][attacker.faction] = game.time;
    game.diplomacy.lastBlood[attacker.faction][b.faction] = game.time;
    aiAddGrudge(b.faction, attacker.faction, 8);
    // a felled townhall ends a nation; on paced difficulties the victor
    // rests and digests instead of rolling straight into the next war
    if (b.type.key === 'townhall' && attacker.faction !== b.faction) {
      const victor = game.factions[attacker.faction];
      // remember who struck the seat of government down — checkDefeat hands
      // that nation whatever the fallen one still owns
      game.factions[b.faction].conqueredBy = attacker.faction;
      if (victor.ai && game.diff.consolidation) {
        victor.ai.consolidationUntil = game.time + game.diff.consolidation;
        game.log(`${victor.name}'s armies rest and garrison their conquests.`);
      }
    }
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
  // Size and shape the planet before anything else — every array in the game is
  // allocated from MAP_W/MAP_H, and `game` is not built until a difficulty is
  // picked, so this is safely ahead of all of it.
  worldFromQuery(params);
  const seed = parseInt(params.get('seed')) || (Math.random() * 1e9 | 0);
  const diffKey = params.get('difficulty');
  // match options: pace and victory conditions, round-tripped in the URL
  const opts = {
    pace: PACES[params.get('pace')] ? params.get('pace') : 'standard',
    victory: params.get('victory') !== '0',
  };
  if (DIFFICULTIES[diffKey]) return startGame(seed, diffKey, opts);
  // no difficulty chosen yet: show the pre-game screen; the sim does not start
  // (and `game` stays null) until a mode is picked
  const overlay = document.getElementById('difficulty');
  buildWorldPicker(overlay);
  buildMatchOptions(overlay, opts);
  overlay.querySelectorAll('button[data-diff]').forEach(btn => {
    const d = DIFFICULTIES[btn.dataset.diff];
    btn.querySelector('.diff-desc').textContent = d.desc;
    btn.onclick = () => { overlay.style.display = 'none'; startGame(seed, btn.dataset.diff, opts); };
  });
  overlay.style.display = 'flex';
}

// Victory conditions on/off and the pace — the two choices that decide how long
// and how final a match is. Same thin pattern as the world picker: buttons that
// set a value, a line that describes the current choice.
function buildMatchOptions(overlay, opts) {
  const vic = overlay.querySelector('.victory-row'), vdesc = overlay.querySelector('.victory-desc');
  const pace = overlay.querySelector('.pace-row'), pdesc = overlay.querySelector('.pace-desc');
  if (!vic || !pace) return;
  const paint = () => {
    vic.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === opts.victory));
    vdesc.textContent = opts.victory
      ? 'Five races — Domination, Science, Culture, Economic, Diplomatic — for every nation. The first to finish one wins the match; if it is not you, you lose.'
      : 'Endless: no victory, only your legacy. The match ends when you stop playing — or when your Town Hall falls.';
    pace.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.pace === opts.pace));
    pdesc.textContent = PACES[opts.pace].desc;
  };
  vic.innerHTML = '';
  for (const [v, label] of [['1', 'Victory conditions'], ['0', 'Endless']]) {
    const b = document.createElement('button');
    b.dataset.v = v; b.textContent = label;
    b.onclick = () => { opts.victory = v === '1'; paint(); };
    vic.appendChild(b);
  }
  pace.innerHTML = '';
  for (const [k, p] of Object.entries(PACES)) {
    const b = document.createElement('button');
    b.dataset.pace = k; b.textContent = p.label;
    b.onclick = () => { opts.pace = k; paint(); };
    pace.appendChild(b);
  }
  paint();
}

// The world picker on the pre-game screen. Deliberately thin: it re-runs
// `configureWorld` with a preset name and nothing else, so the eventual
// creator screen can add sea level, continent count and the rest as further
// controls over the same call rather than as a second code path.
function buildWorldPicker(overlay) {
  const row = overlay.querySelector('.world-row');
  const desc = overlay.querySelector('.world-desc');
  if (!row) return;
  row.innerHTML = '';
  const paint = () => {
    row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.world === WORLD.preset));
    desc.textContent = `${WORLD.w}×${WORLD.h} tiles — ${WORLD.desc}`;
  };
  for (const [key, preset] of Object.entries(WORLD_PRESETS)) {
    const b = document.createElement('button');
    b.dataset.world = key;
    b.textContent = preset.label;
    b.onclick = () => { configureWorld({ preset: key }); paint(); };
    row.appendChild(b);
  }
  paint();
}

function startGame(seed, diffKey, opts = {}) {
  // the URL round-trips seed, difficulty, world and options, so replays reproduce the game
  try {
    const w = WORLD.preset === 'standard' ? '' : `&world=${WORLD.preset}`;
    const p = opts.pace && opts.pace !== 'standard' ? `&pace=${opts.pace}` : '';
    const v = opts.victory === false ? '&victory=0' : '';
    history.replaceState(null, '', `?seed=${seed}&difficulty=${diffKey}${w}${p}${v}`);
  } catch (e) {}
  game = new Game(seed, diffKey, opts);
  ui = new UI(document.getElementById('game'));
  ui.centerOn(game.map.startZones[0].x, game.map.startZones[0].y);
  game.log('Welcome to your nation! Feed your people, house them, and choose: trade or war.', 'good');
  if (game.victoryOn) game.log('Victory conditions are ON — press V to see the five races. Every nation is running them.', 'good');
  chronicle(`Azuria was founded${game.victoryOn ? ', and the race for the world began' : ''}.`, 0, 'minor');
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
    if (panelT <= 0) { panelT = 0.5; ui.refreshPanel(); ui.refreshDiplomacy(); ui.refreshTooltip(); ui.refreshEventCard(); ui.refreshResearch(); ui.refreshLeader(); ui.refreshLedger(); ui.tickAdvisor(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', boot);
