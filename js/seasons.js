'use strict';
// The seasons. Two days (ten minutes) each, four to a year, so a two-hour
// match lives through three winters.
//
//   Spring  — the fields wake (+10% farms); people are glad of it (+2 happiness)
//   Summer  — the long days (+20% farms)
//   Autumn  — the harvest (+35% farms): the time to fill the granaries
//   Winter  — the fields sleep (−55% farms), people feel the cold (−3), an army
//             marching through foreign land slows, and one camped in enemy
//             territory wears down (attrition wounds but does not kill)
//
// Everything here is a pure function of `game.dayCount`, so it replays exactly
// and the AI may plan around it — the calendar is public knowledge.

const SEASON_DAYS = 2;
const SEASONS = [
  { key: 'spring', name: 'Spring', farm: 1.10, happy: 2 },
  { key: 'summer', name: 'Summer', farm: 1.20, happy: 0 },
  { key: 'autumn', name: 'Autumn', farm: 1.35, happy: 0 },
  { key: 'winter', name: 'Winter', farm: 0.45, happy: -3 },
];
// Winter attrition: fraction of max HP per second for a soldier inside a
// hostile nation's claim.
const WINTER_ATTRITION = 0.0015;
const WINTER_MARCH = 0.88;

function seasonIndex() {
  if (typeof game === 'undefined' || !game) return 0;
  return Math.floor((game.dayCount - 1) / SEASON_DAYS) % 4;
}
function season() { return SEASONS[seasonIndex()]; }
function isWinter() { return seasonIndex() === 3; }
function yearOf() { return typeof game !== 'undefined' && game ? Math.floor((game.dayCount - 1) / (SEASON_DAYS * 4)) + 1 : 1; }
// Seconds until the next season turns.
function secondsToNextSeason() {
  const dayInSeason = (game.dayCount - 1) % SEASON_DAYS;
  const intoDay = game.time % DAY_NIGHT_CYCLE;
  return (SEASON_DAYS - dayInSeason) * DAY_NIGHT_CYCLE - intoDay;
}

function seasonFarmMul() { return season().farm; }
function seasonHappiness() { return season().happy; }

// Marching through foreign land in winter is slow going.
function seasonSpeedMul(u) {
  if (!isWinter() || u.type.naval || u.type.civilian) return 1;
  const t = game.territory;
  if (!t) return 1;
  return t.controls(u.faction, u.tileX, u.tileY) ? 1 : WINTER_MARCH;
}

// Winter attrition for a soldier inside a hostile nation's claim.
function attritionRate(u) {
  if (!isWinter()) return 0;
  const t = game.territory;
  if (!t) return 0;
  const own = t.ownerAt(u.tileX, u.tileY);
  if (own < 0 || own === u.faction || !game.diplomacy.hostile(own, u.faction)) return 0;
  return WINTER_ATTRITION;
}

// Called at dawn: announce a turning season to the player.
let lastSeasonAnnounced = -1;
function onNewDaySeason() {
  const idx = seasonIndex();
  const stamp = (game.dayCount - 1) / SEASON_DAYS;
  if (stamp !== Math.floor(stamp) || stamp === lastSeasonAnnounced) return;
  lastSeasonAnnounced = stamp;
  const s = SEASONS[idx];
  const lines = {
    spring: 'Spring comes: the fields wake and the people take heart.',
    summer: 'Summer: long days and full fields.',
    autumn: 'Autumn: the harvest is in — fill the granaries before winter.',
    winter: 'Winter falls: the fields sleep, and any army in enemy land will suffer.',
  };
  game.log(`${s.name} of Year ${yearOf()}. ${lines[s.key]}`, s.key === 'winter' ? 'bad' : 'good');
  if (s.key === 'winter' || s.key === 'spring') {
    if (typeof ui !== 'undefined' && ui) ui.announce(`${s.name}, Year ${yearOf()}`, lines[s.key], s.key === 'winter' ? 'bad' : '');
  }
}

// How much food a nation should hold going into winter: the AI's granary target.
function winterFoodReserve(f) {
  const idx = seasonIndex();
  if (idx !== 2 && idx !== 3) return 0;
  const n = f.nation;
  const eat = n.pop * EAT_RATE + (typeof armyUpkeep === 'function' ? armyUpkeep(f).food : 0);
  return eat * SEASON_DAYS * DAY_NIGHT_CYCLE * 0.5;
}
