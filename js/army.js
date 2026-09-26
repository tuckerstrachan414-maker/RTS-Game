'use strict';
// The life of a soldier: experience and rank, morale and the rout, wounds that
// heal at home and a campaign that wears an army down abroad, and what a
// standing army costs the nation that keeps it.
//
// Also the player's alarm bell: a throttled alert, with a ping on the minimap,
// whenever something of theirs is attacked — and Space to jump to it.

// ---------- veterancy ----------

const RANKS = [
  { name: 'Recruit', xp: 0 },
  { name: 'Veteran', xp: 40 },
  { name: 'Elite', xp: 120 },
  { name: 'Legend', xp: 260 },
];
// Experience: a share of the damage a soldier deals, and a lump for a kill.
const XP_PER_DAMAGE = 0.3;
const XP_PER_KILL = 12;
const XP_PER_RAZE = 18;

const LEGEND_EPITHETS = ['the Bold', 'the Unbroken', 'Ironhand', 'the Lion', 'Oathkeeper', 'the Grim',
  'Stormborn', 'the Wall', 'Swiftblade', 'the Red', 'Longshot', 'the Fearless', 'Shieldbreaker', 'the Old'];
const LEGEND_NAMES = ['Aldric', 'Bryn', 'Cedric', 'Dagny', 'Edric', 'Freda', 'Gunnar', 'Hilde', 'Ivo', 'Jorunn',
  'Kael', 'Lida', 'Marek', 'Nessa', 'Osric', 'Petra', 'Quill', 'Runa', 'Sten', 'Tove', 'Ulric', 'Vera', 'Wulf', 'Ysolde'];

function gainXp(u, amount) {
  if (!u || !(u instanceof Unit) || u.dead || u.type.civilian || u.type.envoy) return;
  u.xp = (u.xp || 0) + amount;
  const next = RANKS[u.rank + 1];
  if (next && u.xp >= next.xp) promote(u);
}

function promote(u) {
  const oldMax = u.maxHp;
  u.rank++;
  u.maxHp = unitMaxHp(u);
  // a promotion is a second wind: wounds partly forgotten, spirit restored
  u.hp = Math.min(u.maxHp, u.hp * u.maxHp / oldMax + u.maxHp * 0.2);
  u.morale = Math.min(100, (u.morale || 100) + 30);
  const rank = RANKS[u.rank].name;
  if (u.rank === 3) {
    // Legends are named, deterministically, from the sim's own stream
    const n = LEGEND_NAMES[Math.floor(game.rng() * LEGEND_NAMES.length)];
    const e = LEGEND_EPITHETS[Math.floor(game.rng() * LEGEND_EPITHETS.length)];
    u.legendName = `${n} ${e}`;
    const f = game.factions[u.faction];
    game.log(u.faction === 0
      ? `Your ${u.type.name} has become a LEGEND: ${u.legendName}! Nearby troops take heart from them.`
      : `${f.name}'s ${u.type.name} ${u.legendName} is spoken of as a legend.`, u.faction === 0 ? 'good' : '');
    chronicle(`${u.legendName}, ${u.type.name} of ${f.name}, became a legend.`, u.faction, 'minor');
  } else if (u.faction === 0 && game.time - (game.promoLogT || -99) > 8) {
    game.promoLogT = game.time;
    game.log(`Your ${u.type.name} is now ${rank === 'Elite' ? 'an' : 'a'} ${rank}.`, 'good');
  }
}

// ---------- morale ----------
//
// Every soldier has morale, 0-100. Wounds, friends falling around them, the
// King's death and being outnumbered wear it down; standing on home ground, the
// King or a Legend nearby, and simply being out of the fight build it back. A
// soldier whose morale breaks ROUTS: it drops everything, runs for home, and
// will not fight until it rallies. Veterans hold longer. A routing soldier is
// bad for the men beside it.

const ROUT_AT = 12;          // morale below this breaks the unit
const RALLY_AT = 45;         // and it rallies once back above this
const ROUT_MIN = 6;          // seconds a rout lasts at least
const MORALE_CELL = 6;       // tiles per cell of the morale grid

function moraleResist(u) { return 1 - 0.15 * (u.rank || 0); }

function hitMorale(u, amount) {
  if (!u || u.dead || u.type.civilian || u.type.naval || u.mission) return;
  u.morale = Math.max(0, (u.morale == null ? 100 : u.morale) - amount * moraleResist(u));
  if (u.morale < ROUT_AT && !u.routing) startRout(u);
}

function startRout(u) {
  u.routing = { until: game.time + ROUT_MIN };
  u.target = null; u.path = []; u.order = null;
  u.formSpeed = 0;
  if (u.faction === 0 && game.time - (game.routLogT || -99) > 6) {
    game.routLogT = game.time;
    game.log(`Your ${u.type.name} breaks and flees!`, 'bad');
    alertPlayer(u.x, u.y, 'Your troops are routing!', 'rout');
  }
  // panic is catching
  forEachSoldierNear(u.x, u.y, 4, v => { if (v !== u && v.faction === u.faction) hitMorale(v, 5); });
}

// A routing soldier's whole behaviour: run home.
function tickRout(u, dt) {
  const r = u.routing;
  const th = game.factions[u.faction].townhall();
  if ((u.morale >= RALLY_AT && game.time >= r.until) || !th) {
    u.routing = null;
    u.path = [];
    if (u.faction === 0 && game.time - (game.rallyLogT || -99) > 8) {
      game.rallyLogT = game.time;
      game.log(`Your ${u.type.name} rallies.`, 'good');
    }
    return;
  }
  if (wdist(u.x, u.y, th.cx, th.cy) < 4) { u.setAnim('idle'); return; }
  u.replan(Math.floor(th.cx), Math.floor(th.cy), 2);
  u.formSpeed = 0;
  u.followPath(dt);
}

// A coarse grid of where every soldier is, rebuilt twice a second, so morale
// can ask "how many friends and foes are near me?" without an O(n²) scan.
let moraleGrid = null;
function buildMoraleGrid() {
  const g = new Map();
  for (const f of game.factions) {
    for (const u of f.units) {
      if (!u.alive || u.aboard || u.type.civilian || u.type.envoy) continue;
      const k = Math.floor(wrapX(Math.floor(u.x)) / MORALE_CELL) + Math.floor(u.y / MORALE_CELL) * 1024;
      let arr = g.get(k);
      if (!arr) g.set(k, arr = []);
      arr.push(u);
    }
  }
  moraleGrid = g;
}
function forEachSoldierNear(x, y, r, fn) {
  if (!moraleGrid) return;
  const cx = Math.floor(wrapX(Math.floor(x)) / MORALE_CELL), cy = Math.floor(y / MORALE_CELL);
  const reach = Math.ceil(r / MORALE_CELL);
  const cols = Math.ceil(MAP_W / MORALE_CELL);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      let gx = cx + dx;
      if (WORLD_WRAP) gx = ((gx % cols) + cols) % cols;
      const arr = moraleGrid.get(gx + (cy + dy) * 1024);
      if (!arr) continue;
      for (const u of arr) if (u.alive && wdist(x, y, u.x, u.y) <= r) fn(u);
    }
  }
}

let armyTickAcc = 0;
// Twice a second: morale drift, healing and attrition for every soldier.
function tickArmy(dt) {
  armyTickAcc += dt;
  if (armyTickAcc < 0.5) return;
  const step = armyTickAcc;
  armyTickAcc = 0;
  buildMoraleGrid();
  const T = game.territory;
  for (const f of game.factions) {
    if (f.eliminated) continue;
    const kings = f.units.filter(u => u.alive && !u.aboard && u.type.key === 'king');
    const legends = f.units.filter(u => u.alive && !u.aboard && u.rank >= 3);
    const unpaid = f.unpaid;
    for (const u of f.units) {
      if (!u.alive || u.aboard || u.type.civilian || u.type.envoy) continue;
      if (u.morale == null) u.morale = 100;
      // --- morale ---
      if (!u.type.naval && !u.mission) {
        let foes = 0, friends = 0;
        forEachSoldierNear(u.x, u.y, 6, v => {
          if (v.faction === u.faction || game.diplomacy.allied(u.faction, v.faction)) friends++;
          else if (game.diplomacy.hostile(u.faction, v.faction)) foes++;
        });
        let d = 0;
        if (foes === 0) d += 6;
        else if (foes > friends * 1.5) d -= Math.min(8, 3 * (foes / Math.max(1, friends) - 1));
        const home = T && T.controls(f.id, u.tileX, u.tileY);
        if (home) d += 3;
        if (kings.some(k => k !== u && wdist(k.x, k.y, u.x, u.y) <= 4)) d += 4;
        if (legends.some(k => k !== u && wdist(k.x, k.y, u.x, u.y) <= 4)) d += 2;
        if (f.nation.starving) d -= 1;
        const cap = unpaid ? 60 : 100;
        u.morale = Math.max(0, Math.min(cap, u.morale + d * step * (d < 0 ? moraleResist(u) : 1)));
        if (u.morale < ROUT_AT && !u.routing) startRout(u);
        // badly wounded and shaken is enough to break
        else if (!u.routing && u.hp < u.maxHp * 0.25 && u.morale < 30 && foes > 0) startRout(u);
      }
      // --- healing: out of the fight, faster at home and faster still by a keep or church ---
      if (u.hp < u.maxHp && game.time - (u.lastHurtT || -99) > 6) {
        let rate = 0;
        const home = T && T.controls(f.id, u.tileX, u.tileY);
        if (home) rate = 0.012;
        if (home && nearHealer(f, u)) rate = 0.03;
        if (u.type.naval && nearDock(f, u)) rate = 0.03;
        rate *= 1 + (f.mods ? f.mods.heal : 0);
        if (rate) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rate * step);
      }
      // --- attrition: winter deep in a hostile land wears an army down ---
      if (typeof attritionRate === 'function' && !u.type.naval) {
        const a = attritionRate(u);
        if (a > 0) {
          u.hp -= u.maxHp * a * step;
          if (u.hp <= 0) { u.hp = 0.1; }   // attrition wounds; it does not kill
        }
      }
    }
  }
}

function nearHealer(f, u) {
  for (const b of f.buildings) {
    if (!b.done || b.hp <= 0) continue;
    const k = b.type.key;
    if ((k === 'townhall' || k === 'castle' || k === 'church' || k === 'cathedral') && wdist(b.cx, b.cy, u.x, u.y) <= 7) return true;
  }
  return false;
}
function nearDock(f, u) {
  return f.buildings.some(b => b.type.key === 'dock' && b.done && wdist(b.cx, b.cy, u.x, u.y) <= 6);
}

// ---------- upkeep ----------
//
// A soldier is a citizen who no longer farms: they still eat, and they expect
// pay. Food per soldier is a little under a citizen's; gold is a small wage
// (siege engines and ships cost only gold — nobody feeds a catapult). Standing
// Army takes 40% off. A nation that cannot pay its army finds its soldiers'
// spirit capped (see tickArmy) and its people unhappy.

const UPKEEP_FOOD = 0.04;     // food per soldier per second
const UPKEEP_GOLD = 0.015;    // gold per soldier per second
const UPKEEP_GOLD_MACHINE = 0.04;

function armyUpkeep(f) {
  let food = 0, gold = 0;
  for (const u of f.units) {
    if (!u.alive || u.type.civilian || u.type.envoy) continue;
    if (u.mission && u.mission.kind === 'caravan') continue;   // traders pay their own way
    if (u.type.naval || u.type.siege) gold += UPKEEP_GOLD_MACHINE;
    else { food += UPKEEP_FOOD; gold += UPKEEP_GOLD; }
  }
  const m = f.mods ? 1 - f.mods.upkeep : 1;
  return { food: food * m, gold: gold * m };
}

function payUpkeep(f, dt) {
  const up = armyUpkeep(f);
  const n = f.nation;
  if (up.food > 0) n.withdraw('food', up.food * dt);
  if (up.gold > 0) {
    const want = up.gold * dt;
    const got = n.withdraw('gold', want);
    const was = f.unpaid;
    f.unpaid = got + 1e-6 < want;
    if (f.unpaid && !was && f.isPlayer) game.log('Your treasury cannot pay the army! Soldiers grumble and their spirit falters.', 'bad');
    if (f.unpaid) addMood(f, 'unpaid', 'Unpaid soldiers', -6, 30);
  }
}

// ---------- alerts ----------

// The player's alarm bell. Throttled per kind and per place, so a battle does
// not become a wall of red text; the newest alert is what Space jumps to, and
// each one pings the minimap.
function alertPlayer(x, y, text, kind = 'attack') {
  if (!game.alerts) game.alerts = [];
  const now = game.time;
  const recent = game.alerts.find(a => a.kind === kind && now - a.t < 12 && wdist(a.x, a.y, x, y) < 16);
  if (recent) { recent.t = now; recent.x = x; recent.y = y; return; }
  game.alerts.push({ x, y, t: now, text, kind });
  if (game.alerts.length > 12) game.alerts.shift();
  game.log(`${text} (Space to look)`, 'bad');
}

function latestAlert() {
  const a = game.alerts && game.alerts[game.alerts.length - 1];
  return a && game.time - a.t < 60 ? a : null;
}
