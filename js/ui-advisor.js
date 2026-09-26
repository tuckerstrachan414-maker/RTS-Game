'use strict';
// The Royal Steward: counsel for a player finding their way through the
// systems — once per situation, at the moment it matters. Reads the game and
// changes nothing. At most one piece of advice every ADVISOR_GAP seconds; most
// are said once a match, a few (hunger, crowding, war) again after a long
// quiet. The pause menu turns the Steward off, and the choice is remembered in
// this browser.
//
// Each entry's `when(f, n)` returns false, or the words to say (so the advice
// can name the nation, the number, the season). Order is priority: the first
// that applies is the one spoken.

const ADVISOR_GAP = 40;       // seconds of game time between two pieces of counsel

// How to reach a screen, in the player's own terms: a key on a keyboard, the
// menu on a touch screen.
const how = (key, touch) => (typeof ui !== 'undefined' && ui && ui.isTouch ? touch : key);

const ADVICE = [
  { key: 'research', repeat: 420, when: f => game.time > 20 && !f.research
    && `Your scholars sit idle. ${how('Press T', 'Tap the knowledge readout on the top bar')} to choose what they study — knowledge is what carries your people through the Ages.` },
  { key: 'hunger', repeat: 240, when: (f, n) => game.time > 60 && estimateFoodRate(f) < -0.05 && n.total('food') < n.pop * 25
    && 'The granaries are emptying faster than they fill. Build Farms — beside water or a Well they yield more — and put farmhands in them.' },
  { key: 'crowded', repeat: 300, when: (f, n) => game.time > 45 && n.pop >= n.housingCap() - 1
    && !f.buildings.some(b => b.type.housing && !b.done)
    && 'Every house is full. Build Houses: with no room, no children are born at dawn.' },
  { key: 'war', repeat: 600, when: f => {
    const foe = game.factions.find(o => o.id !== f.id && !o.eliminated && game.diplomacy.status(f.id, o.id) === 'war');
    return foe && `${foe.name} is at war with you. Your Town Hall and Castle shoot back and shrug off swords — but only an army lifts a siege.${how(' Space jumps to the latest attack.', ' The minimap pings where you are hit.')}`;
  } },
  { key: 'castle', when: f => game.time > 420 && !f.buildings.some(b => b.type.key === 'castle')
    && 'You have no Castle, and without one you cannot raise a single soldier. Build one before a neighbour notices.' },
  { key: 'library', when: f => game.time > 360 && !f.buildings.some(b => b.type.produces === 'knowledge')
    && 'Build a Library. Scholars read there, and a nation that does not study stays in the Tribal Age while its neighbours move on.' },
  { key: 'idle', repeat: 360, when: (f, n) => game.time > 90 && n.idleWorkers() >= 4
    && `${n.idleWorkers()} of your people stand idle. Select a building and press + to put them to work.` },
  { key: 'contact', when: f => game.factions.some(o => o.id !== f.id && !o.eliminated && leaderKnown(o))
    && `A foreign ruler knows your name now. ${how('Press L', 'Open Menu → The Courts')} to see the Courts — every gift, promise and slight is remembered.` },
  { key: 'feudal', when: f => f.era >= 1
    && `The Feudal Age. Iron Working and Crossbows, the first castle upgrade and the first Wonders are open to you — ${how('press T', 'see Research')}.` },
  { key: 'levels', when: f => f.mods && f.mods.level >= 2
    && 'Heavy Plough: your buildings can be raised a level now. Select a Farm, Library or House and press Upgrade — each level is 40% more.' },
  { key: 'autumn', repeat: 2000, when: () => seasonIndex() === 2
    && 'Autumn, and the harvest is at its richest. Fill the granaries: winter halves what the fields give.' },
  { key: 'rival', repeat: 900, when: f => {
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) continue;
      for (const k of Object.keys(VICTORY_TYPES)) {
        if (publicVictoryProgress(f, o, k) >= 0.5) return `${o.name} is halfway to ${aVictory(VICTORY_TYPES[k].name)}. ${how('Press V', 'Open Menu → Victory & Legacy')} to see the races — and think on how to stop them.`;
      }
    }
    return false;
  } },
  { key: 'repair', when: f => f.buildings.some(b => b.done && b.hp < b.maxHp * 0.6)
    && 'A building of yours is damaged. Builders will mend it once the fighting has been quiet for ten seconds — at a share of its price in timber and stone.' },
  { key: 'market', when: f => game.time > 900 && !f.buildings.some(b => b.type.key === 'market')
    && 'You have no Market. It buys what you lack, sells what you hoard, and every trade route needs one at each end.' },
  { key: 'fog', when: f => { const th = f.townhall(); return th && weatherAt(th.cx, th.cy).key === 'fog'
    && 'Fog. Every lookout sees less — a good hour to move an army unseen, and to keep your own watch close.'; } },
  { key: 'storm', when: f => { const th = f.townhall(); return th && weatherAt(th.cx, th.cy).key === 'storm'
    && 'A storm: arrows fly wild and ships labour. If you must fight today, close in with swords.'; } },
  { key: 'snow', when: f => { const th = f.townhall(); return th && weatherAt(th.cx, th.cy).key === 'snow'
    && 'Snow on the roads: troops march slower, and any army camped in enemy land this winter will suffer.'; } },
];

function advisorStored() {
  try { return localStorage.getItem('nations.advisor') !== 'off'; } catch (e) { return true; }
}

Object.assign(UI.prototype, {
  tickAdvisor() {
    if (this.advisorOn === undefined) this.advisorOn = advisorStored();
    if (!this.advisorOn || !game || game.over) return;
    const f = game.factions[0];
    if (f.eliminated) return;
    this.adviceGiven = this.adviceGiven || {};
    if (game.time - (this.adviceAt === undefined ? -ADVISOR_GAP : this.adviceAt) < ADVISOR_GAP) return;
    for (const a of ADVICE) {
      const last = this.adviceGiven[a.key];
      if (last !== undefined && (!a.repeat || game.time - last < a.repeat)) continue;
      let text = false;
      try { text = a.when(f, f.nation); } catch (e) { text = false; }
      if (!text) continue;
      this.adviceGiven[a.key] = game.time;
      this.adviceAt = game.time;
      game.log(text, 'advice', 16000);
      return;
    }
  },

  toggleAdvisor() {
    this.advisorOn = !(this.advisorOn === undefined ? advisorStored() : this.advisorOn);
    try { localStorage.setItem('nations.advisor', this.advisorOn ? 'on' : 'off'); } catch (e) { /* private window */ }
    const v = document.getElementById('advisor-val');
    if (v) v.textContent = this.advisorOn ? 'ON' : 'OFF';
  },
});
