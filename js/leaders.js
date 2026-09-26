'use strict';
// Leaders: the people behind the rival nations.
//
// Every AI nation is ruled by a rolled leader — a name, a face, two traits, a
// hidden agenda and a voice — and everything they do to you, and you to them,
// is REMEMBERED. Opinion is no longer one number that drifts: it is the shared
// mood between two courts (`dip.rel`) plus a ledger of reasons, each with its
// own weight and memory (`opinionOf`). "You broke your word" fades slower than
// "you sent us a gift", and a leader who values honour weighs both more.
//
// Leaders talk. They ask you questions, make requests, demand things and make
// offers — all as event cards in their own voice — and many of those answers
// are PROMISES they hold you to. Keep them and they remember it; break them and
// they, and anyone who hears of it, remember that instead.
//
// The information rule still holds: a leader's opinion of you is built from
// public facts (wars declared, pacts, embargoes, borders, Ages, Wonders) and
// from its own perception (js/ai-perception.js) — never from your live state.

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const LEADER_NAMES = {
  // Azuria is the player's nation; the pool exists so a chronicle can name it.
  1: { m: ['Harald', 'Bjorn', 'Ragnar', 'Eirik', 'Ulf', 'Sigurd', 'Leif', 'Halvard'],
       f: ['Sigrun', 'Astrid', 'Ingrid', 'Freya', 'Solveig', 'Ragnhild', 'Thyra', 'Gunnhild'] },
  2: { m: ['Valerian', 'Octavian', 'Cassius', 'Maximus', 'Lucan', 'Severus', 'Aurelian', 'Justin'],
       f: ['Livia', 'Serafina', 'Theodora', 'Irene', 'Galla', 'Placida', 'Zoe', 'Ariadne'] },
  3: { m: ['Alfonso', 'Rodrigo', 'Sancho', 'Fernando', 'Diego', 'Ramiro', 'Pelayo', 'Garcia'],
       f: ['Isabela', 'Leonor', 'Urraca', 'Beatriz', 'Catalina', 'Berenguela', 'Elvira', 'Sancha'] },
};

// Titles by Age; the first of each pair is a king's, the second a queen's.
const LEADER_TITLES = [['Chieftain', 'Chieftain'], ['Lord', 'Lady'], ['King', 'Queen'], ['Emperor', 'Empress']];

// Traits come from the rolled personality: the strongest pulls pick them.
const LEADER_TRAITS = {
  warmonger:  { name: 'Warmonger', desc: 'Respects strength, despises weakness. Quick to take offence.', voice: 'proud' },
  merchant:   { name: 'Merchant Prince', desc: 'Values trade above all. A good deal buys a lot of goodwill.', voice: 'merchant' },
  covetous:   { name: 'Covetous', desc: 'Eyes the riches of others. Gifts go a long way — so does envy.', voice: 'cunning' },
  paranoid:   { name: 'Paranoid', desc: 'Sees threats everywhere. Soldiers near the border alarm them.', voice: 'measured' },
  honorable:  { name: 'Honorable', desc: 'Keeps faith and expects the same. Broken promises are never forgotten.', voice: 'warm' },
  schemer:    { name: 'Schemer', desc: 'Loyal only to advantage. Pacts with them are worth what they are worth.', voice: 'cunning' },
  zealot:     { name: 'Zealot', desc: 'Proud and unbending. A rebuff is an insult.', voice: 'proud' },
  scholar:    { name: 'Scholar', desc: 'Prizes learning. Admires nations further along the Ages.', voice: 'measured' },
};

// Agendas are hidden until the player has had enough dealings with a leader.
const LEADER_AGENDAS = {
  warlord:     { name: 'Warlord', desc: 'Respects great armies and holds weak ones in contempt.' },
  trader:      { name: 'Trade Baron', desc: 'Loves trading partners; hates embargoes and those who will not trade.' },
  scholar:     { name: 'Seeker of Wisdom', desc: 'Admires nations ahead in the Ages and scorns the backward.' },
  territorial: { name: 'Territorial', desc: 'Cannot abide neighbours pressing on their borders.' },
  peacemaker:  { name: 'Peacemaker', desc: 'Detests warmongers — anyone who declares war earns their contempt.' },
  builder:     { name: 'Builder', desc: 'Admires great works and Wonders; hates those who raze them.' },
  collector:   { name: 'Tribute Seeker', desc: 'Expects gifts from neighbours, and rewards them handsomely.' },
};

// Epithets a leader earns over a match (and the player, in the chronicle).
function leaderEpithet(f) {
  const L = f.leader;
  if (!L) return '';
  const d = L.deeds;
  if (d.betrayals >= 2) return 'the Faithless';
  if (d.conquests >= 1) return 'the Conqueror';
  if (d.wonders >= 2) return 'the Builder';
  if (d.warsDeclared >= 3) return 'the Bold';
  if (f.era >= 3 && game.factions.every(o => o.eliminated || o.era <= f.era)) return 'the Wise';
  if (d.gifts >= 4) return 'the Generous';
  if (d.promisesKept >= 3) return 'the Just';
  return '';
}

function leaderFullName(f) {
  const L = f.leader;
  if (!L) return f.name;
  const ep = leaderEpithet(f);
  return `${leaderTitle(f)} ${L.name}${ep ? ' ' + ep : ''}`;
}
function leaderTitle(f) {
  const L = f.leader;
  return L ? LEADER_TITLES[Math.min(3, f.era || 0)][L.female ? 1 : 0] : '';
}
function leaderShort(f) { return f.leader ? `${leaderTitle(f)} ${f.leader.name}` : f.name; }

function rollLeaders(game) {
  const rng = game.rng;
  for (const f of game.factions) {
    if (f.isPlayer) {
      f.leader = { name: 'you', player: true, traits: [], agenda: null, deeds: newDeeds(), portrait: null };
      continue;
    }
    const p = f.personality;
    const female = rng() < 0.5;
    const pool = LEADER_NAMES[f.id][female ? 'f' : 'm'];
    const name = pool[Math.floor(rng() * pool.length)];
    // two traits from the two strongest pulls of the personality
    const pulls = [
      ['warmonger', p.aggression], ['merchant', p.mercantile], ['covetous', p.greed],
      ['paranoid', p.caution], ['honorable', p.loyalty], ['schemer', 1 - p.loyalty],
      ['zealot', (p.aggression + (1 - p.mercantile)) / 2], ['scholar', (p.caution + p.mercantile) / 2 - 0.1],
    ].map(([k, v]) => [k, v + rng() * 0.18]);
    pulls.sort((a, b) => b[1] - a[1]);
    const traits = [pulls[0][0]];
    // never both honorable and schemer
    const second = pulls.slice(1).find(([k]) => !(k === 'schemer' && traits.includes('honorable'))
      && !(k === 'honorable' && traits.includes('schemer')));
    if (second) traits.push(second[0]);
    const agendaKeys = Object.keys(LEADER_AGENDAS);
    // the agenda leans on personality but is not a copy of it
    const agendaWeights = {
      warlord: p.aggression, trader: p.mercantile, scholar: 0.4 + p.caution * 0.3,
      territorial: p.caution * 0.8 + p.aggression * 0.3, peacemaker: p.loyalty * (1 - p.aggression),
      builder: 0.35 + p.mercantile * 0.2, collector: p.greed,
    };
    let agenda = agendaKeys[0], best = -1;
    for (const k of agendaKeys) {
      const w = agendaWeights[k] + rng() * 0.45;
      if (w > best) { best = w; agenda = k; }
    }
    const L = {
      name, female, traits, agenda,
      age: 30 + Math.floor(rng() * 35),
      look: rollLook(rng, female),
      deeds: newDeeds(),
      cool: {},                // per-request cooldowns
      agendaKnownAt: null,     // when the player learned the agenda
      met: false,              // the player has had an audience or a card
      voice: LEADER_TRAITS[traits[0]].voice,
    };
    f.leader = L;
    L.portrait = null;         // drawn lazily in the browser (portraitFor)
  }
}

function newDeeds() {
  return { warsDeclared: 0, betrayals: 0, conquests: 0, wonders: 0, gifts: 0, promisesKept: 0, promisesBroken: 0 };
}

// ---------------------------------------------------------------------------
// Portraits — a 32x32 pixel bust, generated per leader and redrawn per Age
// ---------------------------------------------------------------------------

const SKIN_TONES = [['#f4d2b0', '#d9ae8a', '#b88767'], ['#e8b98f', '#c9956c', '#a2714f'],
  ['#c98e62', '#a8704a', '#835236'], ['#9a6440', '#7d4d2e', '#5c3620'], ['#f1c9a5', '#d6a07c', '#b07858']];
const HAIR_COLORS = [['#2a1d16', '#4a3526'], ['#5a3a1e', '#7d5530'], ['#8a3b1c', '#b3572c'],
  ['#c9a24a', '#e8c86a'], ['#1c1c22', '#35353f']];

function rollLook(rng, female) {
  return {
    skin: Math.floor(rng() * SKIN_TONES.length),
    hair: Math.floor(rng() * HAIR_COLORS.length),
    hairStyle: Math.floor(rng() * 3),        // 0 short, 1 long, 2 braided/tied
    beard: female ? 0 : Math.floor(rng() * 4),   // 0 none, 1 stubble, 2 short, 3 full
    eyes: Math.floor(rng() * 3),
    scar: rng() < 0.2,
  };
}

// A leader's face. Headwear follows the Age, hair greys with age, the cloak is
// the nation's colour. Cached per (leader, Age) — re-rolled nothing, redrawn
// only when the crown changes.
function portraitFor(f) {
  const L = f.leader;
  if (!L || L.player || typeof document === 'undefined') return null;
  const era = f.era || 0;
  if (L.portrait && L.portraitEra === era) return L.portrait;
  L.portraitEra = era;
  L.portrait = drawPortrait(L, f.color.css, era).toDataURL();
  return L.portrait;
}

function drawPortrait(L, css, era) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const px = (col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const lk = L.look;
  const [skin, skinMid, skinDark] = SKIN_TONES[lk.skin];
  const grey = L.age > 55;
  const [hair, hairLit] = grey ? ['#8d8a86', '#bdbab4'] : HAIR_COLORS[lk.hair];
  const dark = shade(css, -0.45), mid = shade(css, -0.15), lit = shade(css, 0.25);
  // backdrop: a banner in the nation's colour with a darker border
  px(shade(css, -0.65), 0, 0, 32, 32);
  px(shade(css, -0.5), 1, 1, 30, 30);
  for (let y = 1; y < 31; y += 2) px(shade(css, -0.55), 1, y, 30, 1);
  // shoulders and cloak
  px(dark, 4, 24, 24, 8);
  px(mid, 5, 25, 22, 7);
  px(lit, 6, 25, 20, 1);
  // fur or gold collar by Age
  const collar = era >= 2 ? '#e8c96a' : era === 1 ? '#c9b98f' : '#8a6a4a';
  px(collar, 9, 23, 14, 2);
  px(shade(collar, -0.3), 9, 24, 14, 1);
  // neck
  px(skinMid, 13, 20, 6, 4);
  // long hair falls behind the head
  if (lk.hairStyle === 1 || (L.female && lk.hairStyle !== 0)) px(hair, 8, 9, 16, 14);
  // head
  px(skinDark, 9, 7, 14, 15);
  px(skin, 10, 7, 12, 14);
  px(skinMid, 10, 19, 12, 2);
  // ears
  px(skinMid, 8, 13, 2, 3); px(skinMid, 22, 13, 2, 3);
  // eyes and brows
  const eye = ['#2a3a5a', '#3a2a1a', '#2a4a2a'][lk.eyes];
  px('#ffffff', 12, 13, 3, 2); px('#ffffff', 17, 13, 3, 2);
  px(eye, 13, 13, 2, 2); px(eye, 18, 13, 2, 2);
  px(hair, 12, 11, 3, 1); px(hair, 17, 11, 3, 1);
  // nose and mouth
  px(skinDark, 15, 15, 2, 3); px(skinMid, 16, 15, 1, 2);
  px('#8a4a3a', 14, 19, 4, 1);
  if (L.age > 50) { px(skinDark, 11, 16, 1, 1); px(skinDark, 20, 16, 1, 1); }   // lines
  if (lk.scar) { px('#b85a4a', 19, 12, 1, 4); px('#d27a6a', 20, 13, 1, 1); }
  // beard
  if (lk.beard === 1) { px(shade(hair, 0.1) + '99', 11, 17, 10, 4); }
  if (lk.beard >= 2) { px(hair, 10, 17, 12, 3); px(hair, 12, 20, 8, lk.beard === 3 ? 4 : 2); px(hairLit, 13, 17, 2, 1); }
  if (lk.beard >= 2) px('#8a4a3a', 14, 18, 4, 1);
  // hair on top
  px(hair, 9, 5, 14, 4); px(hair, 9, 8, 2, 5); px(hair, 21, 8, 2, 5);
  px(hairLit, 11, 5, 6, 1);
  if (lk.hairStyle === 2) { px(hair, 22, 13, 2, 9); px(hairLit, 22, 16, 2, 1); }
  // headwear by Age
  if (era === 0) {                                  // a leather band and a feather
    px('#6b4a2a', 9, 8, 14, 2); px('#8a6238', 9, 8, 14, 1);
    px('#e8e0d0', 22, 3, 1, 6); px('#c9b98f', 23, 2, 1, 4);
  } else if (era === 1) {                           // a plain circlet
    px('#a0a0a8', 9, 6, 14, 2); px('#d0d0d8', 9, 6, 14, 1); px(css, 15, 6, 2, 2);
  } else if (era === 2) {                           // a crown
    px('#c9962e', 9, 5, 14, 3); px('#ffd24a', 9, 5, 14, 1);
    for (const x of [9, 13, 18, 22]) px('#ffd24a', x, 2, 1, 3);
    px('#ffd24a', 15, 1, 2, 4); px('#c95a4a', 15, 6, 2, 1); px('#4a90d9', 11, 6, 1, 1); px('#4a90d9', 20, 6, 1, 1);
  } else {                                          // an imperial crown
    px('#c9962e', 8, 4, 16, 4); px('#ffd24a', 8, 4, 16, 1);
    px('#c9962e', 10, 0, 12, 4); px('#ffd24a', 11, 0, 10, 1);
    px('#ffffff', 15, 0, 2, 2); px('#c95a4a', 12, 5, 2, 2); px('#4aa04a', 18, 5, 2, 2);
    px(css, 15, 5, 2, 2);
  }
  return c;
}

function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1, 7), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); gg = Math.round((t - gg) * p + gg); b = Math.round((t - b) * p + b);
  return '#' + ((1 << 24) + (r << 16) + (gg << 8) + b).toString(16).slice(1);
}

// ---------------------------------------------------------------------------
// Voice — what a leader says, in their own register
// ---------------------------------------------------------------------------

// {them} the nation addressed, {me} the speaker's nation, {x} a third party,
// {n} an amount. One line is chosen per use from the speaker's register.
const LEADER_LINES = {
  greet_warm: {
    proud: ['{them}. Speak, and be brief.', 'We see you, {them}. What would you have of {me}?'],
    warm: ['Well met, friend of {me}! Our hall is open to you.', 'Ah, {them}! Always a pleasure.'],
    cunning: ['{them}, dear neighbour. What a happy surprise.', 'Come, come — {me} has always valued {them}.'],
    measured: ['Greetings, {them}. We are listening.', '{me} receives you. State your purpose.'],
    merchant: ['{them}! Have you come to do business?', 'Welcome — every friend is a customer, and every customer a friend.'],
  },
  first_contact: {
    proud: ['So. Another people on this world. I am {name}, and {me} bows to no one. Remember that.'],
    warm: ['Strangers, and welcome ones! I am {name} of {me}. Let us be friends, you and I.'],
    cunning: ['How delightful — new neighbours. I am {name} of {me}. I am sure we will be… very useful to each other.'],
    measured: ['Our scouts report your people, {them}. I am {name}, ruler of {me}. We will watch how you conduct yourselves.'],
    merchant: ['New neighbours mean new markets! {name} of {me} greets you, {them}.'],
  },
  greet_neutral: {
    proud: ['{them}. You have our attention — for now.', '{me} hears you, {them}.'],
    warm: ['Welcome, {them}. What brings you to our hall?', 'Ah, {them}. Sit, speak.'],
    cunning: ['{them}! We were hoping you would call.', 'What an interesting visit, {them}.'],
    measured: ['{me} receives you, {them}.', 'Speak, {them}. We are listening.'],
    merchant: ['{them}! Something to trade, perhaps?', 'Every visit is an opportunity, {them}.'],
  },
  greet_cold: {
    proud: ['You dare show your face in {me}?', 'Say what you came to say, {them}, and go.'],
    warm: ['{them}. We had hoped for better from you.', 'Our patience with {them} is not endless.'],
    cunning: ['{them}. How… unexpected.', 'Ah. {them}. We were just speaking of you.'],
    measured: ['{them}. We have not forgotten.', 'We receive you, {them} — coldly.'],
    merchant: ['Business with {them} has been poor of late.', 'State your offer. Quickly.'],
  },
  border_troops: {
    proud: ['Your soldiers stand on {me}\'s threshold. Explain yourself — or be answered with steel.'],
    warm: ['Friend, your soldiers gather close to our border, and our people are afraid. What is your purpose?'],
    cunning: ['We notice your soldiers taking a stroll near our lands. Such a pretty stretch of road. Surely you mean nothing by it?'],
    measured: ['Our scouts count your soldiers at our border. We would know why, before we must assume the worst.'],
    merchant: ['Armies at the border are bad for trade, {them}. Tell us you have a reason.'],
  },
  settle_near: {
    proud: ['You build within sight of our walls. That land is ours by right. Stop.'],
    warm: ['Your settlers creep close to our fields. We ask you, as a friend, to build no closer.'],
    cunning: ['Such ambitious builders, {them}. We would hate for our borders to become… crowded.'],
    measured: ['Your new works press on our frontier. We ask that you build no closer to {me}.'],
    merchant: ['Crowded borders spoil good land, {them}. Keep your builders back, and we both prosper.'],
  },
  famine: {
    proud: ['{me} does not beg. But {me} asks: our granaries are empty. Will you send grain?'],
    warm: ['Our children go hungry, {them}. If you can spare food, {me} will never forget it.'],
    cunning: ['A small favour, {them} — some grain for our hungry people. We remember our friends.'],
    measured: ['The harvest has failed us. {me} asks for {n} food, and will repay the kindness.'],
    merchant: ['Our stores are bare. Send {n} food now, and our markets will remember your generosity.'],
  },
  war_aid: {
    proud: ['{x} dares to march on {me}. Stand with us, {them}, or stand aside.'],
    warm: ['{x} is at our gates. We beg you — send gold, or send soldiers.'],
    cunning: ['{x} grows bold, and after us they will come for you. Help us now, while it is cheap.'],
    measured: ['The war with {x} goes against us. Aid now would be remembered.'],
    merchant: ['{x} is ruining our trade — and soon yours. Gold for our armies is an investment, {them}.'],
  },
  joint_war: {
    proud: ['{x} has grown fat and weak. Join {me} and we will carve them up together.'],
    warm: ['{x} threatens us both. Let us face them side by side.'],
    cunning: ['{x} sits on riches neither of us can reach alone. Together, {them}? The spoils would be… generous.'],
    measured: ['{x} is a danger to the whole continent. {me} asks you to join the war against them.'],
    merchant: ['{x} stands between us and a great deal of wealth. Shall we remove them?'],
  },
  friendship: {
    proud: ['{me} names few nations friend. We would name {them}. Do you accept?'],
    warm: ['Let the world know that {me} and {them} stand as friends!'],
    cunning: ['Friends, {them}? Publicly? It would be so good for us both.'],
    measured: ['{me} proposes a declaration of friendship. It would steady the continent.'],
    merchant: ['A public friendship would be very good for business. Shall we?'],
  },
  trade_offer: {
    proud: ['We have {give} to spare and need {get}. Take the deal or leave it.'],
    warm: ['Our {give} for your {get}, friend? A fair trade, we think.'],
    cunning: ['We could part with {give} — for {get}. A bargain, really.'],
    measured: ['{me} offers {give} in exchange for {get}.'],
    merchant: ['A proposition! {give} from us, {get} from you. Everyone profits.'],
  },
  research_pact: {
    proud: ['Our scholars would share their learning with yours — if yours are worth it.'],
    warm: ['Let our scholars study together, {them}. Knowledge shared is knowledge doubled.'],
    cunning: ['Our libraries, your libraries… a pact would profit us both, and cost so little.'],
    measured: ['{me} proposes a research pact: {n} gold each, and both our scholars work faster.'],
    merchant: ['An investment in learning, {them}: {n} gold each, and returns for years.'],
  },
  gossip: {
    proud: ['Tell me plainly, {them}: which of our neighbours do you trust least?'],
    warm: ['Between friends — which of the other courts troubles you most?'],
    cunning: ['A little bird tells us you have opinions about our neighbours. Share one?'],
    measured: ['We would know your mind. Whom among our neighbours do you distrust?'],
    merchant: ['Whose word is worth the least on this continent, in your experience?'],
  },
  stand_with_us: {
    proud: ['If {x} comes for {me}, will you stand with us? Answer as a friend.'],
    warm: ['We fear {x}. If they march on us, will you come?'],
    cunning: ['Should {x} ever grow… impulsive, can we count on {them}?'],
    measured: ['{x} masses its strength. If they attack us, will {them} join the war?'],
    merchant: ['{x} is bad for business. If they attack us, will you help protect our common trade?'],
  },
  surrender: {
    proud: ['Enough. {me} yields. Take our fealty, and let our people live.'],
    warm: ['We cannot go on. {me} will kneel, if you will spare us.'],
    cunning: ['Let us be sensible, {them}. We will pay you tribute. Isn\'t that better than rubble?'],
    measured: ['{me} sues for terms. We offer our fealty and our tribute.'],
    merchant: ['Let us end this ruinous war: {me} will become your vassal, and pay you tribute.'],
  },
  demand_submission: {
    proud: ['Your armies are broken, {them}. Kneel before {me}, or be erased.'],
    warm: ['This war has gone far enough. Yield to {me}, and your people will be spared.'],
    cunning: ['Why die for pride, {them}? Swear fealty to {me}, and keep your city.'],
    measured: ['You cannot win. Submit to {me} as a vassal, and the killing stops.'],
    merchant: ['Let us be practical. Pay us tribute as our vassal, and we both stop losing money.'],
  },
  kept: {
    any: ['{them} kept their word. {me} will remember it.'],
  },
  broken: {
    any: ['{them} broke their word to {me}. We will not forget.'],
  },
  thanks: {
    proud: ['{me} accepts your help.'], warm: ['Thank you, friend. We will not forget this.'],
    cunning: ['How kind. How very kind.'], measured: ['Your help is noted, and appreciated.'],
    merchant: ['A fine gesture — and good for us both.'],
  },
  refuse: {
    proud: ['No. Do not ask again.'], warm: ['We cannot, friend. Forgive us.'],
    cunning: ['Oh, we think not.'], measured: ['{me} declines.'], merchant: ['That is not a good deal for us.'],
  },
  accept: {
    proud: ['So be it.'], warm: ['Gladly!'], cunning: ['Done — and a pleasure.'],
    measured: ['{me} agrees.'], merchant: ['A deal!'],
  },
  denounce: {
    any: ['{me} denounces {them} before the whole continent!'],
  },
  ultimatum: {
    proud: ['{me} demands tribute, {them}. {n} gold — or we come and take everything.'],
    warm: ['It grieves us, {them}, but our generals demand {n} gold, or war.'],
    cunning: ['Such a lovely treasury you have. {n} gold of it would keep our soldiers home.'],
    measured: ['Pay {n} gold in tribute, or {me} will consider itself at war with you.'],
    merchant: ['Think of it as a fee, {them}: {n} gold, and our armies stay home.'],
  },
  peace_offer: {
    proud: ['Enough blood. {me} will accept peace — and {n} gold for your trouble.'],
    warm: ['Let this war end, {them}. Take {n} gold, and let our peoples heal.'],
    cunning: ['A truce, {them}? We will even pay {n} gold. Everyone wins.'],
    measured: ['{me} offers peace, and {n} gold in reparations.'],
    merchant: ['This war is bad for business. {n} gold, and we call it even?'],
  },
  coalition: {
    proud: ['{x} grows too mighty. Join {me}, or kneel to them later.'],
    warm: ['{x} will swallow us all. Stand with us, {them}, while there is time.'],
    cunning: ['{x} towers over us both. Surely you see where this ends?'],
    measured: ['{x} threatens the balance of the continent. {me} calls for a coalition.'],
    merchant: ['A single power controlling the continent is terrible for trade. Join us against {x}.'],
  },
  proposal_trade: {
    proud: ['{me} will trade with {them}. Do you accept?'], warm: ['Let our caravans ride between us, friend!'],
    cunning: ['A trade route, {them}. Think of the profits.'], measured: ['{me} proposes a trade pact.'],
    merchant: ['Caravans, markets, gold for both of us — shall we?'],
  },
  proposal_alliance: {
    proud: ['{me} offers {them} an alliance. It is an honour few receive.'], warm: ['Stand with us, {them}, in peace and in war!'],
    cunning: ['An alliance, {them}. Together, who could stand against us?'], measured: ['{me} proposes a formal alliance.'],
    merchant: ['An alliance protects our investments — yours and ours.'],
  },
  dispute: {
    proud: ['Your works stand on land that belongs to {me}. Answer for it.'],
    warm: ['Your builders have crossed into our land, {them}. Let us settle this as friends.'],
    cunning: ['Someone has been building on our side of the line. Careless, surely?'],
    measured: ['{me} disputes your new works on our claimed land.'],
    merchant: ['Border quarrels are expensive, {them}. Let us settle this one.'],
  },
  praise_era: {
    proud: ['So {them} has entered the {x}. Books will not stop swords.'],
    warm: ['Congratulations, {them}, on entering the {x}!'],
    cunning: ['The {x}! How very impressive. We must learn your secrets.'],
    measured: ['{them} has entered the {x}. We take note.'],
    merchant: ['The {x}! New markets, new goods — splendid.'],
  },
};

// Which line is said is cosmetic, so it must never draw on `game.rng`: a panel
// that re-renders a greeting twice a second would otherwise pull numbers out of
// the stream every AI decision is made from, and simply looking at a leader
// would change what the world does. A hash of who is speaking, about what, and
// roughly when, picks the line instead.
function leaderLine(f, key, vars = {}) {
  const L = f.leader;
  const set = LEADER_LINES[key];
  if (!set) return '';
  const opts = set[L && set[L.voice] ? L.voice : 'any'] || set.measured || set.any || Object.values(set)[0];
  const seed = strHash(`${f.id}:${key}:${Math.floor((game ? game.time : 0) / 45)}:${vars.x != null ? vars.x : ''}`);
  const pick = opts[seed % opts.length];
  const them = vars.them != null ? game.factions[vars.them].name : 'friend';
  return pick.replace(/\{me\}/g, f.name).replace(/\{them\}/g, them)
    .replace(/\{x\}/g, vars.x != null ? (typeof vars.x === 'number' ? game.factions[vars.x].name : vars.x) : '')
    .replace(/\{n\}/g, vars.n != null ? vars.n : '')
    .replace(/\{give\}/g, vars.give || '').replace(/\{get\}/g, vars.get || '')
    .replace(/\{name\}/g, L && !L.player ? leaderShort(f) : f.name);
}

// ---------------------------------------------------------------------------
// Opinion: base mood + remembered reasons + live reasons
// ---------------------------------------------------------------------------

class LeaderCourt {
  constructor(n) {
    this.n = n;
    this.mem = [];          // mem[a][b] = [{key, label, v, t, half, stack}]
    this.cache = [];        // cached memory + live modifier sum, a's opinion of b
    this.friend = [];       // friend[a][b] = game.time friendship expires (0 = none)
    this.denounced = [];    // denounced[a][b] = game.time a denounced b
    this.researchPact = []; // researchPact[a][b] = game.time pact expires
    this.overlord = new Array(n).fill(-1);
    this.promises = [];     // player promises being tracked
    this.tickT = 0;
    this.tributeT = 0;
    this.warsDeclaredAt = [];   // per nation, times it declared a war (public)
    for (let a = 0; a < n; a++) {
      this.mem[a] = []; this.cache[a] = []; this.friend[a] = []; this.denounced[a] = []; this.researchPact[a] = [];
      this.warsDeclaredAt[a] = [];
      for (let b = 0; b < n; b++) {
        this.mem[a][b] = []; this.cache[a][b] = 0; this.friend[a][b] = 0; this.denounced[a][b] = -1e9;
        this.researchPact[a][b] = 0;
      }
    }
  }
}

// Remember something `b` did to `a`. `half` is the half-life in seconds (null =
// for the rest of the match). A `key` that is already remembered is refreshed
// (and, if `stack`, added to, up to `cap`).
function remember(a, b, key, label, v, half = 600, opts = {}) {
  if (a === b || !game.court) return;
  const fa = game.factions[a];
  if (!fa || fa.isPlayer) return;           // the player keeps their own counsel
  const L = fa.leader;
  // traits colour how hard something lands
  let w = v;
  if (L) {
    if (L.traits.includes('honorable') && (key === 'promise_broken' || key === 'promise_kept' || key === 'betrayal')) w *= 1.5;
    if (L.traits.includes('zealot') && key.startsWith('rebuff')) w *= 2;
    if (L.traits.includes('covetous') && key === 'gift') w *= 1.5;
    if (L.agenda === 'collector' && key === 'gift') w *= 1.5;
    if (L.agenda === 'builder' && key === 'razed') w *= 2;
    if (L.agenda === 'peacemaker' && key === 'warmonger') w *= 2;
    if (L.traits.includes('schemer') && (key === 'promise_kept' || key === 'friendship_kept')) w *= 0.6;
  }
  const list = game.court.mem[a][b];
  const now = game.time;
  const old = list.find(m => m.key === key);
  if (old) {
    const cur = memValue(old, now);
    old.v = opts.stack ? Math.max(-(opts.cap || 60), Math.min(opts.cap || 60, cur + w)) : (Math.abs(w) > Math.abs(cur) ? w : cur + w * 0.25);
    old.t = now; old.half = half; old.label = label;
  } else {
    list.push({ key, label, v: w, t: now, half });
  }
  refreshOpinion(a, b);
}

function forget(a, b, key) {
  if (!game.court) return;
  game.court.mem[a][b] = game.court.mem[a][b].filter(m => m.key !== key);
  refreshOpinion(a, b);
}

function memValue(m, now) {
  if (m.half == null) return m.v;
  return m.v * Math.pow(0.5, (now - m.t) / m.half);
}

// Live reasons: public facts and this leader's own perception, recomputed every
// couple of seconds (tickLeaders) and cached with the memories.
function liveReasons(a, b) {
  const out = [];
  const dip = game.diplomacy, court = game.court;
  const fa = game.factions[a], fb = game.factions[b];
  if (!fa || !fb || fb.eliminated || fa.isPlayer) return out;
  const L = fa.leader;
  const st = dip.status(a, b);
  if (st === STATUS.TRADE) out.push(['Trading partners', L.agenda === 'trader' ? 16 : 8]);
  if (st === STATUS.ALLIANCE) out.push(['Allies', 15]);
  if (court.friend[a][b] > game.time) out.push(['Declared friends', 12]);
  if (court.researchPact[a][b] > game.time) out.push(['Research pact', 6]);
  if (court.overlord[b] === a) out.push(['Our loyal vassal', 6]);
  if (court.overlord[a] === b) out.push([L.traits.includes('honorable') ? 'Our overlord' : 'Chafes under your rule', L.traits.includes('honorable') ? 0 : -14]);
  if (dip.embargoed(b, a)) out.push(['Embargoes us', L.agenda === 'trader' ? -30 : -15]);
  // common enemies and enemies of friends
  for (const c of game.factions) {
    if (c.id === a || c.id === b || c.eliminated) continue;
    if (dip.hostile(a, c.id) && dip.hostile(b, c.id)) out.push([`Common enemy: ${c.name}`, 8]);
    const friendOfA = dip.status(a, c.id) === STATUS.ALLIANCE || court.friend[a][c.id] > game.time;
    if (friendOfA && dip.hostile(b, c.id)) out.push([`At war with our friend ${c.name}`, -12]);
  }
  // agendas — each reads only public facts or the leader's own perception
  const per = fa.brain ? fa.brain.perception : null;
  switch (L.agenda) {
    case 'warlord': {
      if (!per) break;
      const theirs = per.estimatedStrength(b).value, mine = fa.strength();
      if (per.confidence(b) > 0.2) {
        if (theirs > mine * 1.2) out.push(['Respects your army', 10]);
        else if (theirs < mine * 0.5) out.push(['Despises your weak army', -10]);
      }
      break;
    }
    case 'trader':
      if (st !== STATUS.TRADE && st !== STATUS.ALLIANCE && per && !per.hasMarket(b)) out.push(['You do not trade', -6]);
      break;
    case 'scholar':
      if (fb.era > fa.era) out.push(['Admires your learning', 12]);
      else if (fb.era < fa.era) out.push(['Thinks you backward', -8]);
      break;
    case 'territorial': {
      const t = game.territory;
      const c = t ? (t.contestPairs.get(t.pairKey(a, b)) || 0) : 0;
      if (c > 10) out.push(['Your borders press on theirs', -Math.min(20, 6 + c * 0.2)]);
      break;
    }
    case 'peacemaker': {
      const wars = court.warsDeclaredAt[b].filter(t => game.time - t < 1200).length;
      if (wars) out.push(['Warmonger', -Math.min(24, wars * 10)]);
      else out.push(['A peaceful nation', 4]);
      break;
    }
    case 'builder': {
      const w = typeof wondersOf === 'function' ? wondersOf(b).length : 0;
      if (w) out.push(['Admires your Wonders', Math.min(20, w * 7)]);
      break;
    }
    case 'collector':
      out.push(['Expects tribute from neighbours', -4]);
      break;
  }
  if (L.traits.includes('paranoid') && fa.leader.lastBorderSight && fa.leader.lastBorderSight[b] > game.time - 90) {
    out.push(['Soldiers near our border', -8]);
  }
  if (L.traits.includes('warmonger') && st === STATUS.WAR) out.push(['At war with us', -10]);
  return out;
}

function refreshOpinion(a, b) {
  const court = game.court;
  if (!court) return;
  const now = game.time;
  const list = court.mem[a][b];
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const v = memValue(list[i], now);
    if (list[i].half != null && Math.abs(v) < 0.5) { list.splice(i, 1); continue; }
    sum += v;
  }
  for (const [, v] of liveReasons(a, b)) sum += v;
  court.cache[a][b] = sum;
}

// a's opinion of b, less the shared mood: what the ledger adds. Diplomacy's
// `relation(a, b)` is `rel[a][b] + opinionMods(a, b)`, clamped.
function opinionMods(a, b) {
  const c = game.court;
  return c && c.cache[a] ? c.cache[a][b] || 0 : 0;
}

// The breakdown the Leader screen shows: every reason with its current weight.
function opinionBreakdown(a, b) {
  const rows = [];
  const dip = game.diplomacy;
  rows.push(['Mood between our courts', Math.round(dip.rel[a][b])]);
  const now = game.time;
  for (const m of game.court.mem[a][b]) {
    const v = Math.round(memValue(m, now));
    if (v) rows.push([m.label, v]);
  }
  for (const [label, v] of liveReasons(a, b)) rows.push([label, Math.round(v)]);
  return rows;
}

function opinionWord(v) {
  if (v >= 60) return ['Devoted', 'good'];
  if (v >= 30) return ['Friendly', 'good'];
  if (v >= 10) return ['Cordial', ''];
  if (v > -10) return ['Neutral', ''];
  if (v > -30) return ['Wary', 'bad'];
  if (v > -60) return ['Hostile', 'bad'];
  return ['Hateful', 'bad'];
}

// ---------------------------------------------------------------------------
// Promises the player makes
// ---------------------------------------------------------------------------

// kind: 'withdraw' (no soldiers in/near their land by the deadline),
//       'nosettle' (no buildings finished near their land until the deadline),
//       'defend'   (if `x` attacks them before the deadline, join the war within 60s)
function makePromise(to, kind, secs, extra = {}) {
  const p = { to, kind, made: game.time, until: game.time + secs, ...extra };
  game.court.promises.push(p);
  const f = game.factions[to];
  game.log(`You gave your word to ${leaderShort(f)} of ${f.name}: ${promiseText(p)}.`);
  if (typeof chronicle === 'function') chronicle(`Azuria gave its word to ${f.name}: ${promiseText(p)}.`, 0, 'minor');
  return p;
}

function promiseText(p) {
  const f = game.factions[p.to];
  if (p.kind === 'withdraw') return `withdraw all soldiers from ${f.name}'s border`;
  if (p.kind === 'nosettle') return `build no closer to ${f.name}`;
  if (p.kind === 'defend') return `come to ${f.name}'s aid if ${game.factions[p.x].name} attacks`;
  return p.kind;
}

// Soldiers of `fid` inside `owner`'s claim or within `pad` tiles of it.
function soldiersNearClaim(fid, owner, pad = 3, onlySeenBy = null) {
  const t = game.territory;
  const f = game.factions[fid];
  let n = 0;
  const per = onlySeenBy && onlySeenBy.brain ? onlySeenBy.brain.perception : null;
  for (const u of f.units) {
    if (!u.alive || u.aboard || u.type.civilian || u.type.envoy || u.mission) continue;
    let near = false;
    const x = u.tileX, y = u.tileY;
    for (let dy = -pad; dy <= pad && !near; dy += pad) {
      for (let dx = -pad; dx <= pad && !near; dx += pad) {
        if (t.controls(owner, x + dx, y + dy)) near = true;
      }
    }
    if (!near) continue;
    if (per && !per.visible(u.x, u.y)) continue;
    n++;
  }
  return n;
}

function keepPromise(p) {
  const f = game.factions[p.to];
  p.done = true;
  remember(p.to, 0, 'promise_kept', 'Kept their word', 14, 1200);
  game.factions[0].leader.deeds.promisesKept++;
  game.log(`${leaderShort(f)}: "${leaderLine(f, 'kept', { them: 0 })}"`, 'good');
}

function breakPromise(p, why) {
  const f = game.factions[p.to];
  p.done = true;
  p.broken = true;
  remember(p.to, 0, 'promise_broken', 'Broke their word to us', -32, 2400);
  game.factions[0].leader.deeds.promisesBroken++;
  aiAddGrudge(p.to, 0, 12);
  // word gets around — other honorable courts think less of you too
  for (const o of game.factions) {
    if (o.isPlayer || o.eliminated || o.id === p.to) continue;
    if (o.leader && o.leader.traits.includes('honorable')) remember(o.id, 0, 'untrustworthy', 'Broke their word to others', -8, 1800);
  }
  game.log(`${leaderShort(f)}: "${leaderLine(f, 'broken', { them: 0 })}" (${why})`, 'bad');
  if (typeof chronicle === 'function') chronicle(`Azuria broke its word to ${f.name}.`, 0, 'major');
}

function tickPromises() {
  const court = game.court;
  for (const p of court.promises) {
    if (p.done) continue;
    const f = game.factions[p.to];
    if (f.eliminated) { p.done = true; continue; }
    if (p.kind === 'withdraw') {
      if (game.time >= p.until) {
        if (soldiersNearClaim(0, p.to, 3, f) > 0) breakPromise(p, 'your soldiers are still at their border');
        else keepPromise(p);
      }
    } else if (p.kind === 'nosettle') {
      if (game.time >= p.until) keepPromise(p);
    } else if (p.kind === 'defend') {
      if (p.calledAt) {
        if (game.diplomacy.hostile(0, p.x)) keepPromise(p);
        else if (game.time > p.calledAt + 60) breakPromise(p, `you did not join the war against ${game.factions[p.x].name}`);
      } else if (game.time >= p.until) {
        p.done = true;           // never called on: quietly lapses
      }
    }
  }
  court.promises = court.promises.filter(p => !p.done || game.time - p.until < 600);
}

// A finished building near a leader's land breaks a 'nosettle' promise, and may
// prompt the warning card (called from onBuildingCompleted).
function leaderOnBuilding(b) {
  if (!game.court || b.faction !== 0) return;
  if (['bridge', 'wall', 'gate'].includes(b.type.key)) return;
  const t = game.territory;
  for (const f of game.factions) {
    if (f.isPlayer || f.eliminated) continue;
    let near = false;
    const cx = Math.floor(b.cx), cy = Math.floor(b.cy);
    for (let dy = -5; dy <= 5 && !near; dy++)
      for (let dx = -5; dx <= 5 && !near; dx++)
        if (t.controls(f.id, cx + dx, cy + dy)) near = true;
    if (!near) continue;
    const pr = game.court.promises.find(p => !p.done && p.kind === 'nosettle' && p.to === f.id);
    if (pr) { breakPromise(pr, `you built a ${b.type.name} at their border`); continue; }
    f.leader.pendingSettle = game.time;   // leaderInitiative raises it as a card
  }
}

// ---------------------------------------------------------------------------
// The per-tick bookkeeping
// ---------------------------------------------------------------------------

function tickLeaders(dt) {
  const court = game.court;
  if (!court) return;
  court.tickT -= dt;
  if (court.tickT <= 0) {
    court.tickT = 2;
    for (const f of game.factions) {
      if (f.isPlayer || f.eliminated) continue;
      // every court keeps track of foreign soldiers it can see near its borders
      // (the paranoid take it personally — see liveReasons)
      f.leader.lastBorderSight = f.leader.lastBorderSight || {};
      for (const o of game.factions) {
        if (o.id === f.id || o.eliminated) continue;
        if (game.diplomacy.hostile(f.id, o.id)) continue;
        if (soldiersNearClaim(o.id, f.id, 2, f) >= 2) f.leader.lastBorderSight[o.id] = game.time;
      }
      for (const o of game.factions) if (o.id !== f.id) refreshOpinion(f.id, o.id);
      // first contact: the moment a court first lays eyes on Azuria
      const L = f.leader;
      if (!L.contact && f.brain && p_everSeen(f, 0) && !game.factions[0].eliminated) {
        // the card may be refused by the politeness cooldown; try again next pass
        if (cardFirstContact(f)) L.contact = game.time;
      }
      // the agenda becomes known after enough dealings
      if (!L.agendaKnownAt && L.dealings >= 3) {
        L.agendaKnownAt = game.time;
        game.log(`You have come to understand ${leaderShort(f)} of ${f.name}: a ${LEADER_AGENDAS[L.agenda].name}. ${LEADER_AGENDAS[L.agenda].desc}`, 'good');
      }
    }
    tickPromises();
  }
  // vassals pay tribute once a minute
  court.tributeT -= dt;
  if (court.tributeT <= 0) {
    court.tributeT = 60;
    for (const f of game.factions) {
      const lord = court.overlord[f.id];
      if (lord < 0 || f.eliminated) continue;
      const over = game.factions[lord];
      if (over.eliminated) { freeVassal(f.id, 'their overlord has fallen'); continue; }
      const pay = Math.floor(Math.min(150, f.nation.res.gold * 0.2) * (1 + (over.mods ? over.mods.tribute : 0)));
      if (pay > 0) {
        f.nation.res.gold -= pay;
        over.nation.res.gold += pay;
        if (lord === 0) game.log(`${f.name} pays you ${pay} gold in tribute.`, 'good');
        else if (f.id === 0) game.log(`You pay ${pay} gold in tribute to ${over.name}.`, 'bad');
      }
      if (!f.isPlayer) considerRebellion(f);
    }
  }
}

// A bookkeeping hook for everything in the game that counts as dealing with a
// leader; three dealings reveal the agenda.
function noteDealing(fid) {
  const f = game.factions[fid];
  if (f && f.leader && !f.leader.player) f.leader.dealings = (f.leader.dealings || 0) + 1;
}

// ---------------------------------------------------------------------------
// Diplomatic acts (both the player and the AI use these)
// ---------------------------------------------------------------------------

function declareFriendship(a, b) {
  const court = game.court;
  court.friend[a][b] = court.friend[b][a] = game.time + 900;
  game.diplomacy.addRel(a, b, 6);
  refreshOpinion(a, b); refreshOpinion(b, a);
  const fa = game.factions[a], fb = game.factions[b];
  game.log(`${fa.name} and ${fb.name} declare their FRIENDSHIP before the world.`, a === 0 || b === 0 ? 'good' : '');
  if (typeof chronicle === 'function') chronicle(`${fa.name} and ${fb.name} declared friendship.`, a, 'minor');
  // their enemies notice
  for (const c of game.factions) {
    if (c.isPlayer || c.eliminated || c.id === a || c.id === b) continue;
    if (game.diplomacy.relation(c.id, b) < -30) remember(c.id, a, 'friend_of_enemy', `Befriended ${fb.name}`, -8, 900);
    if (game.diplomacy.relation(c.id, a) < -30) remember(c.id, b, 'friend_of_enemy', `Befriended ${fa.name}`, -8, 900);
  }
}

function denounce(a, b) {
  const court = game.court;
  court.denounced[a][b] = game.time;
  court.friend[a][b] = court.friend[b][a] = 0;
  game.diplomacy.addRel(a, b, -10);
  remember(b, a, 'denounced', 'Denounced us', -22, 1200);
  const fa = game.factions[a], fb = game.factions[b];
  game.log(`${fa.name} DENOUNCES ${fb.name}!`, b === 0 ? 'bad' : '');
  if (typeof chronicle === 'function') chronicle(`${fa.name} denounced ${fb.name}.`, a, 'minor');
  // enemies of the denounced warm to the denouncer; friends cool
  for (const c of game.factions) {
    if (c.isPlayer || c.eliminated || c.id === a || c.id === b) continue;
    const v = game.diplomacy.relation(c.id, b);
    if (v < -20) remember(c.id, a, 'denounced_enemy', `Denounced ${fb.name}`, 8, 900);
    else if (v > 30) remember(c.id, a, 'denounced_friend', `Denounced our friend ${fb.name}`, -8, 900);
  }
}

// Called from Diplomacy.declareWar: wars are public, and remembered.
function leaderOnWar(a, b) {
  const court = game.court;
  if (!court) return;
  court.warsDeclaredAt[a].push(game.time);
  const fa = game.factions[a];
  if (fa.leader) fa.leader.deeds.warsDeclared++;
  remember(b, a, 'declared_war', 'Declared war on us', -30, 1800);
  // breaking a friendship is a betrayal the whole continent hears about
  if (court.friend[a][b] > game.time) {
    court.friend[a][b] = court.friend[b][a] = 0;
    if (fa.leader) fa.leader.deeds.betrayals++;
    remember(b, a, 'betrayal', 'Betrayed our friendship', -40, 3600);
    for (const c of game.factions) {
      if (c.eliminated || c.id === a || c.id === b) continue;
      remember(c.id, a, 'backstabber', 'Betrayed a friend', -15, 2400);
    }
    game.log(`${fa.name} has BETRAYED its friendship with ${game.factions[b].name}!`, b === 0 ? 'bad' : '');
    if (typeof chronicle === 'function') chronicle(`${fa.name} betrayed its friendship with ${game.factions[b].name}.`, a, 'major');
  }
  // anyone who asked for a 'defend' promise against `a` calls it in
  for (const p of court.promises) {
    if (!p.done && p.kind === 'defend' && p.to === b && p.x === a && !p.calledAt) {
      p.calledAt = game.time;
      const fb = game.factions[b];
      game.log(`${leaderShort(fb)} calls on your promise: ${fa.name} has attacked ${fb.name}! Join the war within 60 seconds.`, 'bad');
    }
  }
  // peacemakers everywhere note the aggressor
  for (const c of game.factions) {
    if (c.isPlayer || c.eliminated || c.id === a || c.id === b) continue;
    if (c.leader.agenda === 'peacemaker') remember(c.id, a, 'warmonger', 'Started a war', -6, 1200);
  }
  // vassals follow their overlord into war
  for (const v of game.factions) {
    if (v.eliminated || court.overlord[v.id] !== a || v.id === b) continue;
    if (game.diplomacy.status(v.id, b) !== STATUS.WAR) {
      game.diplomacy.setStatus(v.id, b, STATUS.WAR);
      game.diplomacy.warSince[v.id][b] = game.diplomacy.warSince[b][v.id] = game.time;
      game.log(`${v.name}, vassal of ${fa.name}, marches to war against ${game.factions[b].name}.`);
    }
  }
}

// Breaking a truce is treachery the whole continent hears of.
function leaderOnTruceBroken(a, b) {
  const fa = game.factions[a];
  if (fa.leader) fa.leader.deeds.betrayals++;
  remember(b, a, 'truce_broken', 'Broke the truce', -30, 2400);
  for (const c of game.factions) {
    if (c.eliminated || c.id === a || c.id === b) continue;
    remember(c.id, a, 'truce_breaker', 'Broke a truce', -10, 1800);
  }
  game.log(`${fa.name} broke its truce with ${game.factions[b].name}!`, b === 0 ? 'bad' : a === 0 ? 'bad' : '');
  if (typeof chronicle === 'function') chronicle(`${fa.name} broke its truce with ${game.factions[b].name}.`, a, 'major');
}

function leaderOnGift(a, b, gold) {
  if (a === 0 && game.factions[b].leader && !game.factions[b].leader.player) game.factions[b].leader.met = true;
  remember(b, a, 'gift', 'Sent us gifts', Math.min(25, 6 + gold * 0.12), 600, { stack: true, cap: 30 });
  const fa = game.factions[a];
  if (fa.leader) fa.leader.deeds.gifts++;
  noteDealing(b);
}

function leaderOnRaze(owner, attacker) {
  remember(owner, attacker, 'razed', 'Razed our buildings', -3, 900, { stack: true, cap: 30 });
  const f = game.factions[owner];
  if (f && f.leader) {
    f.leader.lossesTo = f.leader.lossesTo || {};
    f.leader.lossesTo[attacker] = (f.leader.lossesTo[attacker] || 0) + 1;
  }
}

function leaderOnConquest(victor, fallen) {
  const fv = victor >= 0 ? game.factions[victor] : null;
  if (fv) {
    if (fv.leader) fv.leader.deeds.conquests++;
    for (const c of game.factions) {
      if (c.isPlayer || c.eliminated || c.id === victor) continue;
      remember(c.id, victor, 'conqueror', `Destroyed ${game.factions[fallen].name}`, -10, 2400);
    }
  }
  // a fallen overlord frees its vassals; a fallen vassal is simply gone
  for (const v of game.factions) if (game.court.overlord[v.id] === fallen) freeVassal(v.id, 'their overlord has fallen');
  game.court.overlord[fallen] = -1;
}

function leaderReactEra(f, era) {
  if (!game.court) return;
  // rivals react to the player's new Age, in character (log only — no card)
  if (f.isPlayer) {
    for (const o of game.factions) {
      if (o.isPlayer || o.eliminated || !o.leader) continue;
      const L = o.leader;
      if (L.agenda === 'scholar' || L.traits.includes('warmonger') || game.rng() < 0.3) {
        game.log(`${leaderShort(o)} of ${o.name}: "${leaderLine(o, 'praise_era', { them: 0, x: ERAS[era].name })}"`);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Vassals
// ---------------------------------------------------------------------------

function makeVassal(vassal, lord) {
  const court = game.court, dip = game.diplomacy;
  court.overlord[vassal] = lord;
  // peace between them, and an alliance of convenience
  dip.setStatus(vassal, lord, STATUS.ALLIANCE);
  dip.rel[vassal][lord] = dip.rel[lord][vassal] = Math.max(dip.rel[vassal][lord], 0);
  // the vassal takes up its lord's wars and sets down its own against the lord's friends
  for (const c of game.factions) {
    if (c.eliminated || c.id === vassal || c.id === lord) continue;
    if (dip.hostile(lord, c.id) && !dip.hostile(vassal, c.id)) {
      dip.setStatus(vassal, c.id, STATUS.WAR);
      dip.warSince[vassal][c.id] = dip.warSince[c.id][vassal] = game.time;
    } else if (dip.hostile(vassal, c.id) && dip.status(lord, c.id) === STATUS.ALLIANCE) {
      dip.setStatus(vassal, c.id, STATUS.NEUTRAL);
    }
  }
  const fv = game.factions[vassal], fl = game.factions[lord];
  if (fv.ai) { fv.ai.wave = null; fv.ai.warAt = null; }
  if (fl.ai) fl.ai.wave = null;
  game.log(`${fv.name} bends the knee: it is now a VASSAL of ${fl.name}.`, vassal === 0 ? 'bad' : lord === 0 ? 'good' : '');
  if (typeof chronicle === 'function') chronicle(`${fv.name} became a vassal of ${fl.name}.`, lord, 'major');
  if (typeof aiPoke === 'function') { aiPoke(vassal); aiPoke(lord); }
}

function freeVassal(vassal, why) {
  const court = game.court;
  const lord = court.overlord[vassal];
  if (lord < 0) return;
  court.overlord[vassal] = -1;
  const fv = game.factions[vassal];
  game.log(`${fv.name} is free of ${game.factions[lord].name} — ${why}.`, vassal === 0 ? 'good' : '');
  if (typeof chronicle === 'function') chronicle(`${fv.name} threw off the rule of ${game.factions[lord].name}.`, vassal, 'major');
}

// Declaring independence is a war.
function declareIndependence(vassal) {
  const lord = game.court.overlord[vassal];
  if (lord < 0) return 'You are no one\'s vassal';
  freeVassal(vassal, 'it declares its independence');
  game.diplomacy.setStatus(vassal, lord, STATUS.NEUTRAL);
  game.diplomacy.declareWar(vassal, lord);
  return null;
}

function considerRebellion(f) {
  const lord = game.court.overlord[f.id];
  if (lord < 0) return;
  const per = f.brain ? f.brain.perception : null;
  const lordStr = per ? per.threatStrength(lord) : game.factions[lord].strength();
  const op = game.diplomacy.relation(f.id, lord);
  const honorable = f.leader.traits.includes('honorable');
  if (f.strength() > lordStr * (honorable ? 1.8 : 1.3) && op < (honorable ? -40 : -5) && game.rng() < 0.35) {
    game.log(`${leaderShort(f)} of ${f.name}: "No longer will we kneel!"`, lord === 0 ? 'bad' : '');
    declareIndependence(f.id);
  }
}

// Would this leader accept becoming `lord`'s vassal? (Surrender terms.)
// A nation kneels only after a real war: long enough to be sure of the odds,
// with real losses behind it — its buildings burned or its seat of government
// under the ram — and an enemy it believes it cannot beat. Pride (the zealot)
// raises the bar; fear (the paranoid) lowers it a little.
function wouldSubmit(f, lord) {
  const dip = game.diplomacy;
  if (!dip.hostile(f.id, lord)) return false;
  if (game.time - dip.warSince[f.id][lord] < 240) return false;
  const per = f.brain ? f.brain.perception : null;
  const theirs = per ? per.threatStrength(lord) : game.factions[lord].strength();
  const mine = f.strength();
  const th = f.townhall();
  const battered = th && th.hp < th.maxHp * 0.6;
  const losses = (f.leader.lossesTo && f.leader.lossesTo[lord]) || 0;
  const T = f.leader.traits;
  const bar = T.includes('zealot') ? 3.5 : T.includes('paranoid') ? 1.8 : 2.2;
  const ratio = theirs / Math.max(20, mine);
  if (battered && ratio > bar * 0.7) return true;
  return ratio > bar && losses >= 3 && f.nation.warWeariness > 12;
}

// ---------------------------------------------------------------------------
// Deals: resources for resources
// ---------------------------------------------------------------------------

// How much a deal is worth to `f`, in gold-equivalent: what it gets minus what
// it gives, each priced by its own marginal utility (js/ai-utility.js).
function dealValue(f, give, get) {
  let v = 0;
  for (const r in get) v += (get[r] || 0) * calculateMarginalUtility(f, r);
  for (const r in give) v -= (give[r] || 0) * calculateMarginalUtility(f, r);
  return v;
}

// The AI's answer to a deal the player proposes. `offer` is what the player
// gives, `ask` is what the player wants. Returns {ok, why}.
function considerDeal(f, offer, ask) {
  const n = f.nation;
  for (const r in ask) if ((ask[r] || 0) > 0 && n.total(r) < ask[r]) return { ok: false, why: `${f.name} does not have ${ask[r]} ${r} to give.` };
  const v = dealValue(f, ask, offer);
  const op = game.diplomacy.relation(f.id, 0);
  const merchantBias = f.leader.traits.includes('merchant') ? 10 : 0;
  // friends accept a slightly unfavourable deal; enemies want a sweetener
  const need = Math.max(-25, 18 - op * 0.35 - merchantBias);
  if (game.diplomacy.hostile(f.id, 0)) return { ok: false, why: 'We do not trade with enemies.' };
  return { ok: v >= need, why: v >= need ? '' : 'That is not a good deal for us.' };
}

function executeDeal(f, offer, ask) {
  const pn = game.factions[0].nation, n = f.nation;
  for (const r in offer) if ((offer[r] || 0) > pn.total(r) + 0.01) return `You do not have ${offer[r]} ${r}.`;
  for (const r in offer) if (offer[r] > 0) { pn.withdraw(r, offer[r]); n.deposit(r, offer[r]); }
  for (const r in ask) if (ask[r] > 0) { n.withdraw(r, ask[r]); pn.deposit(r, ask[r]); }
  remember(f.id, 0, 'good_deal', 'Fair dealing', 5, 900, { stack: true, cap: 15 });
  noteDealing(f.id);
  return null;
}

// Research pact: both pay; both study faster for ten minutes.
const RESEARCH_PACT_COST = 60;
const RESEARCH_PACT_TIME = 600;
function researchPactBonus(f) {
  if (!game.court) return 0;
  let bonus = 0;
  for (const o of game.factions) if (o.id !== f.id && game.court.researchPact[f.id][o.id] > game.time) bonus += 0.15;
  return bonus;
}
function signResearchPact(a, b) {
  const court = game.court;
  court.researchPact[a][b] = court.researchPact[b][a] = game.time + RESEARCH_PACT_TIME;
  game.log(`${game.factions[a].name} and ${game.factions[b].name} sign a RESEARCH PACT — their scholars work together.`, a === 0 || b === 0 ? 'good' : '');
}

// ---------------------------------------------------------------------------
// Leader initiative: questions, requests and offers to the player, and the
// courtly business between AI nations. Called from aiDiplomacy.
// ---------------------------------------------------------------------------

function leaderCool(f, kind, secs) {
  const L = f.leader;
  if ((L.cool[kind] || 0) > game.time) return false;
  L.cool[kind] = game.time + secs;
  return true;
}
function leaderReady(f, kind) { return (f.leader.cool[kind] || 0) <= game.time; }

// Push a card spoken by this leader. `quote` is their words; `body` explains.
function leaderCard(f, kind, title, quote, body, options, extra = {}) {
  const ok = pushPlayerEvent({ kind, from: f.id, title, quote, body, options, portrait: true, ...extra });
  if (ok) { f.leader.met = true; noteDealing(f.id); }
  return ok;
}

function leaderInitiative(f) {
  if (!game.court || f.isPlayer || !f.leader) return;
  aiCourtBusiness(f);
  const player = game.factions[0];
  if (player.eliminated) return;
  const dip = game.diplomacy;
  const op = dip.relation(f.id, 0);
  const atWar = dip.hostile(f.id, 0);
  // you cannot petition a court you have never met, and the introduction comes first
  if (!f.leader.contact && !atWar) return;
  if (game.events.some(e => e.from === f.id)) return;   // one card per court at a time

  // --- war: surrender offers and demands ---
  if (atWar) {
    if (leaderReady(f, 'surrender') && wouldSubmit(f, 0)) { leaderCool(f, 'surrender', 180); return cardSurrender(f); }
    const per = f.brain.perception;
    const pth = player.townhall();
    if (leaderReady(f, 'demand_sub') && pth && per.threatStrength(0) * 2.6 < f.strength()
        && pth.hp < pth.maxHp * 0.75 && game.court.overlord[0] < 0) {
      leaderCool(f, 'demand_sub', 240);
      return cardDemandSubmission(f);
    }
    return;
  }

  // --- peace: requests, questions and offers, most urgent first ---
  const L = f.leader;
  if (L.lastBorderSight && L.lastBorderSight[0] > game.time - 6 && leaderReady(f, 'border')
      && soldiersNearClaim(0, f.id, 2, f) >= (L.traits.includes('paranoid') ? 1 : 3)) {
    leaderCool(f, 'border', 200); return cardBorderTroops(f);
  }
  if (L.pendingSettle && game.time - L.pendingSettle < 30 && leaderReady(f, 'settle')) {
    L.pendingSettle = 0;
    leaderCool(f, 'settle', 300); return cardSettleNear(f);
  }
  const n = f.nation;
  if (n.total('food') < n.pop * 1 && estimateFoodRate(f) < 0 && op > -30 && leaderReady(f, 'famine')) {
    leaderCool(f, 'famine', 300); return cardFamine(f);
  }
  const foe = game.factions.find(o => o.id !== 0 && o.id !== f.id && !o.eliminated && dip.hostile(f.id, o.id));
  if (foe && op > 0 && leaderReady(f, 'war_aid') && f.strength() < f.brain.perception.threatStrength(foe.id)) {
    leaderCool(f, 'war_aid', 300); return cardWarAid(f, foe);
  }
  // the rest are optional; one roll per consideration so they come at a human pace
  if (game.rng() > 0.35) return;
  const options = [];
  if (op > 35 && game.court.friend[f.id][0] <= game.time && dip.status(f.id, 0) !== STATUS.ALLIANCE && leaderReady(f, 'friend')) options.push('friend');
  if (op > 15 && leaderReady(f, 'pact') && game.court.researchPact[f.id][0] <= game.time
      && (L.agenda === 'scholar' || L.traits.includes('scholar') || f.ai.doctrine === 'merchant' || f.ai.doctrine === 'hegemon')
      && n.total('gold') > RESEARCH_PACT_COST * 2) options.push('pact');
  if (op > -10 && leaderReady(f, 'trade') && tradeOfferFor(f)) options.push('trade');
  if (op > 10 && leaderReady(f, 'gossip') && game.factions.filter(o => o.id !== 0 && o.id !== f.id && !o.eliminated).length) options.push('gossip');
  const threat = mostFeared(f);
  if (op > 25 && threat && leaderReady(f, 'stand')) options.push('stand');
  const target = f.ai && aiArchetype(f).warBias >= 1 ? jointWarTarget(f) : null;
  if (op > 20 && target && leaderReady(f, 'joint')) options.push('joint');
  if (!options.length) return;
  const pick = options[Math.floor(game.rng() * options.length)];
  if (pick === 'friend') { leaderCool(f, 'friend', 420); return cardFriendship(f); }
  if (pick === 'pact') { leaderCool(f, 'pact', 600); return cardResearchPact(f); }
  if (pick === 'trade') { leaderCool(f, 'trade', 240); return cardTradeOffer(f); }
  if (pick === 'gossip') { leaderCool(f, 'gossip', 600); return cardGossip(f); }
  if (pick === 'stand') { leaderCool(f, 'stand', 720); return cardStandWithUs(f, threat); }
  if (pick === 'joint') { leaderCool(f, 'joint', 480); return cardJointWar(f, target); }
}

function mostFeared(f) {
  const per = f.brain.perception;
  let best = null, bv = f.strength() * 1.1;
  for (const o of game.factions) {
    if (o.id === 0 || o.id === f.id || o.eliminated) continue;
    if (game.diplomacy.relation(f.id, o.id) > 0) continue;
    const v = per.threatStrength(o.id);
    if (v > bv) { bv = v; best = o; }
  }
  return best;
}

function jointWarTarget(f) {
  const dip = game.diplomacy;
  let best = null, bv = -20;
  for (const o of game.factions) {
    if (o.id === 0 || o.id === f.id || o.eliminated) continue;
    if (dip.hostile(0, o.id) || dip.status(0, o.id) === STATUS.ALLIANCE) continue;
    const v = -dip.relation(f.id, o.id) + (f.ai.grudge[o.id] || 0);
    if (v > bv && dip.relation(f.id, o.id) < -20) { bv = v; best = o; }
  }
  return best;
}

// What this nation would offer and ask for in a resource trade: its most
// plentiful good against its scarcest. Null when nothing is worth swapping.
function tradeOfferFor(f) {
  const n = f.nation;
  let give = null, gv = Infinity, get = null, gtv = 0;
  for (const r of ['food', 'wood', 'stone']) {
    const mu = calculateMarginalUtility(f, r);
    const spare = n.total(r) - aiArchetype(f).reserve[r](n.pop);
    if (spare > 100 && mu < gv) { gv = mu; give = r; }
    if (mu > gtv) { gtv = mu; get = r; }
  }
  if (!give || !get || give === get || gtv < gv * 1.8) return null;
  const qty = 60;
  // priced at market so the offer is fair, sweetened by how badly it wants it
  const back = Math.max(20, Math.round(qty * game.market.price(give) / game.market.price(get) * 0.9));
  return { give: { [give]: qty }, get: { [get]: back } };
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

const resText = o => Object.entries(o).filter(([, v]) => v > 0).map(([r, v]) => `${v} ${r}`).join(' + ');

function cardFirstContact(f) {
  const L = f.leader;
  const traits = L.traits.map(t => LEADER_TRAITS[t].name).join(' and ');
  const ok = leaderCard(f, 'contact', `First contact: ${f.name}`, leaderLine(f, 'first_contact', { them: 0 }),
    `${leaderShort(f)} rules ${f.name}. Word is they are ${traits.toLowerCase()}. First impressions last.`, [
      { label: 'Greet them as friends', cls: 'good', apply: () => remember(f.id, 0, 'first_words', 'A warm first meeting', 8, 1800) },
      { label: 'Send 30 gold as a welcome gift', cls: '', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < 30) return game.log('Your treasury cannot spare it.', 'bad');
          n.res.gold -= 30; f.nation.res.gold += 30;
          remember(f.id, 0, 'first_words', 'A generous first meeting', 14, 2400);
        } },
      { label: 'Stay out of our way', cls: 'bad', apply: () => {
          remember(f.id, 0, 'first_words', 'A hostile first meeting', L.traits.includes('warmonger') ? 2 : -10, 1800);
        } },
    ], { expires: game.time + 60 });
  if (ok && typeof chronicle === 'function') chronicle(`Azuria made contact with ${f.name}, ruled by ${leaderShort(f)}.`, f.id, 'minor');
  return ok;
}

// Whether the player has met this leader: first contact, any card from them,
// or any formal relationship (a war, a pact) between the two nations.
function leaderKnown(f) {
  const L = f.leader;
  if (!L || L.player) return true;
  if (L.contact || L.met) return true;
  return game.diplomacy.status(0, f.id) !== STATUS.NEUTRAL;
}

function cardBorderTroops(f) {
  const dip = game.diplomacy;
  leaderCard(f, 'border', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'border_troops', { them: 0 }),
    `${f.name} has seen your soldiers at its border.`, [
      { label: 'Just passing — we will withdraw', cls: 'good', hint: 'A promise: no soldiers at their border in 45 seconds', apply: () => {
          makePromise(f.id, 'withdraw', 45);
          remember(f.id, 0, 'reassured', 'Answered our concerns', 4, 300);
        } },
      { label: 'Apologise (30 gold) and withdraw', cls: '', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold >= 30) { n.res.gold -= 30; f.nation.res.gold += 30; remember(f.id, 0, 'apology', 'Apologised for the incident', 10, 900); }
          makePromise(f.id, 'withdraw', 45);
        } },
      { label: 'Our soldiers go where they please', cls: 'bad', apply: () => {
          remember(f.id, 0, 'rebuff_border', 'Insolent about the border', -14, 900);
          aiAddGrudge(f.id, 0, 6);
          if (f.ai) f.ai.provocation += 1;
          dip.addRel(0, f.id, -4);
        } },
    ], { onExpire: () => remember(f.id, 0, 'rebuff_silence', 'Ignored our concerns', -8, 600) });
}

function cardSettleNear(f) {
  leaderCard(f, 'settle', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'settle_near', { them: 0 }),
    'Your new buildings stand close to their land.', [
      { label: 'We will build no closer', cls: 'good', hint: 'A promise for 6 minutes: no new buildings near their border', apply: () => {
          makePromise(f.id, 'nosettle', 360);
        } },
      { label: 'The land belongs to whoever works it', cls: 'bad', apply: () => {
          remember(f.id, 0, 'rebuff_land', 'Scorned our claim', -14, 1200);
          aiAddGrudge(f.id, 0, 8);
        } },
    ], { onExpire: () => remember(f.id, 0, 'rebuff_silence', 'Ignored our concerns', -8, 600) });
}

function cardFamine(f) {
  const want = 60;
  leaderCard(f, 'famine', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'famine', { them: 0, n: want }),
    `${f.name} is starving and asks for ${want} food.`, [
      { label: `Send ${want} food`, cls: 'good', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.food < want) return game.log('Your granaries cannot spare it.', 'bad');
          n.res.food -= want; f.nation.res.food += want;
          remember(f.id, 0, 'fed_us', 'Fed our people in famine', 22, 2400);
          game.log(`${leaderShort(f)}: "${leaderLine(f, 'thanks', {})}"`, 'good');
        } },
      { label: 'Send 30 gold instead', cls: '', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < 30) return game.log('Your treasury cannot spare it.', 'bad');
          n.res.gold -= 30; f.nation.res.gold += 30;
          remember(f.id, 0, 'helped_famine', 'Helped in our famine', 9, 1200);
        } },
      { label: 'We have none to spare', cls: '', apply: () => remember(f.id, 0, 'rebuff_famine', 'Let us starve', -6, 900) },
    ], { onExpire: () => remember(f.id, 0, 'rebuff_famine', 'Let us starve', -6, 900) });
}

function cardWarAid(f, foe) {
  leaderCard(f, 'war_aid', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'war_aid', { them: 0, x: foe.id }),
    `${f.name} is losing its war against ${foe.name}.`, [
      { label: `Join the war on ${foe.name}`, cls: 'bad', apply: () => {
          game.diplomacy.declareWar(0, foe.id);
          remember(f.id, 0, 'fought_beside', 'Fought beside us', 30, 3000);
        } },
      { label: 'Send 60 gold', cls: '', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < 60) return game.log('Your treasury cannot spare it.', 'bad');
          n.res.gold -= 60; f.nation.res.gold += 60;
          remember(f.id, 0, 'war_aid', 'Aided our war', 14, 1500);
        } },
      { label: 'This is not our war', cls: '', apply: () => remember(f.id, 0, 'rebuff_aid', 'Abandoned us in war', -6, 900) },
    ]);
}

function cardFriendship(f) {
  leaderCard(f, 'friend', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'friendship', { them: 0 }),
    'A declared friendship lasts 15 minutes and is public. Neither side may declare war without betraying it — and the whole continent would know.', [
      { label: 'Accept friendship', cls: 'good', apply: () => declareFriendship(f.id, 0) },
      { label: 'Decline', cls: '', apply: () => remember(f.id, 0, 'rebuff_friend', 'Spurned our friendship', -9, 1200) },
    ], { onExpire: () => remember(f.id, 0, 'rebuff_friend', 'Spurned our friendship', -6, 900) });
}

function cardResearchPact(f) {
  leaderCard(f, 'pact', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'research_pact', { them: 0, n: RESEARCH_PACT_COST }),
    `Both nations pay ${RESEARCH_PACT_COST} gold; both gain +15% knowledge for 10 minutes.`, [
      { label: `Sign (${RESEARCH_PACT_COST} gold)`, cls: 'good', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < RESEARCH_PACT_COST) return game.log('Your treasury cannot cover it.', 'bad');
          n.res.gold -= RESEARCH_PACT_COST; f.nation.res.gold -= Math.min(f.nation.res.gold, RESEARCH_PACT_COST);
          signResearchPact(f.id, 0);
          remember(f.id, 0, 'pact_signed', 'Shared our learning', 6, 900);
        } },
      { label: 'Decline', cls: '', apply: () => remember(f.id, 0, 'rebuff_pact', 'Declined our pact', -3, 600) },
    ]);
}

function cardTradeOffer(f) {
  const deal = tradeOfferFor(f);
  if (!deal) return;
  const give = resText(deal.give), get = resText(deal.get);
  leaderCard(f, 'trade_offer', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'trade_offer', { them: 0, give, get }),
    `They give ${give}; you give ${get}.`, [
      { label: 'Accept the trade', cls: 'good', apply: () => {
          const err = executeDeal(f, deal.get, deal.give);
          if (err) game.log(err, 'bad'); else game.log(`Trade with ${f.name}: you received ${give} for ${get}.`, 'good');
        } },
      { label: 'Decline', cls: '', apply: () => {} },
    ]);
}

function cardGossip(f) {
  const others = game.factions.filter(o => o.id !== 0 && o.id !== f.id && !o.eliminated);
  const opts = others.slice(0, 2).map(o => ({
    label: `${o.name}`, cls: '', apply: () => {
      remember(f.id, o.id, 'warned_by_azuria', 'Azuria warned us about them', -8, 1200);
      remember(f.id, 0, 'confided', 'Confided in us', 5, 900);
      game.log(`You confide your distrust of ${o.name} to ${f.name}.`);
    },
  }));
  opts.push({ label: 'I trust them all', cls: '', apply: () => remember(f.id, 0, 'evasive', 'Evasive', -1, 300) });
  leaderCard(f, 'gossip', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'gossip', { them: 0 }),
    'Your answer will colour how they see that nation.', opts);
}

function cardStandWithUs(f, threat) {
  leaderCard(f, 'stand', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'stand_with_us', { them: 0, x: threat.id }),
    `A promise for 10 minutes: if ${threat.name} declares war on ${f.name}, you must join the war within 60 seconds.`, [
      { label: 'You have my word', cls: 'good', apply: () => {
          makePromise(f.id, 'defend', 600, { x: threat.id });
          remember(f.id, 0, 'pledged', 'Pledged to defend us', 10, 900);
        } },
      { label: 'We cannot promise that', cls: '', apply: () => remember(f.id, 0, 'no_pledge', 'Would not pledge support', -4, 600) },
    ]);
}

function cardJointWar(f, target) {
  const dip = game.diplomacy;
  leaderCard(f, 'joint', `${leaderShort(f)} of ${f.name}`, leaderLine(f, 'joint_war', { them: 0, x: target.id }),
    `${f.name} proposes a joint war on ${target.name}.`, [
      { label: `Join the war on ${target.name}`, cls: 'bad', apply: () => {
          if (!dip.hostile(f.id, target.id)) dip.declareWar(f.id, target.id);
          if (!dip.hostile(0, target.id)) dip.declareWar(0, target.id);
          remember(f.id, 0, 'brothers', 'Brothers in arms', 24, 2400);
        } },
      { label: 'Decline', cls: '', apply: () => remember(f.id, 0, 'rebuff_joint', 'Refused our war', -4, 600) },
    ]);
}

function cardSurrender(f) {
  const dip = game.diplomacy;
  leaderCard(f, 'surrender', `${leaderShort(f)} of ${f.name} yields`, leaderLine(f, 'surrender', { them: 0 }),
    `Accept, and ${f.name} becomes your vassal: it pays you a fifth of its treasury every minute, joins your wars, and counts toward a Domination victory.`, [
      { label: 'Accept their fealty', cls: 'good', apply: () => {
          if (!dip.hostile(0, f.id)) return;
          dip.setStatus(0, f.id, STATUS.NEUTRAL);
          makeVassal(f.id, 0);
        } },
      { label: 'Demand 150 gold and peace', cls: '', apply: () => {
          if (!dip.hostile(0, f.id)) return;
          const pay = Math.min(150, Math.floor(f.nation.res.gold));
          f.nation.res.gold -= pay; game.factions[0].nation.res.gold += pay;
          dip.setStatus(0, f.id, STATUS.NEUTRAL);
          dip.rel[0][f.id] = dip.rel[f.id][0] = Math.max(dip.rel[0][f.id], -25);
          remember(f.id, 0, 'harsh_peace', 'Imposed a harsh peace', -12, 1800);
          game.log(`${f.name} pays ${pay} gold for peace.`, 'good');
        } },
      { label: 'No mercy', cls: 'bad', apply: () => {
          remember(f.id, 0, 'no_mercy', 'Refused our surrender', -20, 2400);
          game.log(`You refuse ${f.name}'s surrender. The war goes on.`, 'bad');
        } },
    ]);
}

function cardDemandSubmission(f) {
  const dip = game.diplomacy;
  leaderCard(f, 'demand_sub', `${leaderShort(f)} of ${f.name} demands your submission`, leaderLine(f, 'demand_submission', { them: 0 }),
    `Submit, and Azuria becomes ${f.name}'s vassal: the war ends, but you pay a fifth of your treasury in tribute every minute and cannot make war on them — until you are strong enough to declare independence.`, [
      { label: 'Submit', cls: 'bad', apply: () => {
          if (!dip.hostile(0, f.id)) return;
          dip.setStatus(0, f.id, STATUS.NEUTRAL);
          makeVassal(0, f.id);
        } },
      { label: 'Never!', cls: 'good', apply: () => {
          remember(f.id, 0, 'defiant', 'Defiant to the last', game.rng() < 0.5 ? 4 : -4, 900);
          game.log('Azuria will never kneel!', 'good');
        } },
    ]);
}

// ---------------------------------------------------------------------------
// Between AI courts: friendships, denouncements, surrender
// ---------------------------------------------------------------------------

function aiCourtBusiness(f) {
  const dip = game.diplomacy, court = game.court;
  if (game.rng() > 0.25) return;
  for (const o of game.factions) {
    if (o.id === f.id || o.isPlayer || o.eliminated) continue;
    const ab = dip.relation(f.id, o.id), ba = dip.relation(o.id, f.id);
    // AI-AI surrender: the loser offers, the winner takes it if it profits
    if (dip.hostile(f.id, o.id) && court.overlord[f.id] < 0 && wouldSubmit(f, o.id)) {
      const arch = aiArchetype(o);
      if (arch.label === 'Aggressor' || arch.label === 'Hegemon' || game.rng() < 0.5) {
        dip.setStatus(f.id, o.id, STATUS.NEUTRAL);
        makeVassal(f.id, o.id);
        return;
      }
    }
    if (dip.hostile(f.id, o.id)) continue;
    if (ab > 40 && ba > 40 && court.friend[f.id][o.id] <= game.time && game.rng() < 0.3) {
      declareFriendship(f.id, o.id);
      return;
    }
    if (ab < -45 && game.time - court.denounced[f.id][o.id] > 900 && game.rng() < 0.25) {
      denounce(f.id, o.id);
      return;
    }
  }
}

// Temporary moods (celebrations, mourning) on a nation's happiness; also the
// hook js/economy.js reads.
function addMood(f, key, label, value, secs) {
  f.moods = (f.moods || []).filter(m => m.key !== key);
  f.moods.push({ key, label, value, until: game.time + secs });
}
function nationMoodBonus(f) {
  if (!f.moods || !f.moods.length) return 0;
  let s = 0;
  f.moods = f.moods.filter(m => m.until > game.time);
  for (const m of f.moods) s += m.value;
  return s;
}
