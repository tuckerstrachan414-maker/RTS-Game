'use strict';
// Buildings that grow: upgrade levels, repair, and neighbours that help.
//
// LEVELS. Productive buildings, houses, storehouses, churches, libraries and
// watchtowers can be raised to level 2 (Heavy Plough) and level 3 (Guilds).
// An upgrade is real construction: it stakes out an upgrade site on the
// standing building (`b.site.upgrade`), builders carry its materials there a
// load at a time and then work it, and the building keeps working throughout.
// Each level: +40% output, housing and storage (`levelYieldMul`), +35% hit
// points (`buildingMaxHp`).
//
// REPAIR. A builder with nothing to build mends the nearest damaged building of
// its nation that has been out of the fight for a while, paying for the
// timber and stone as it goes.
//
// ADJACENCY. Farms beside farms make a field system; a Market among houses
// does more trade; a Library by a Church or University reads better. Computed
// in `adjacencyBonus`, applied in `workerYieldRate`, shown in the panel and in
// the placement ghost.

const UPGRADEABLE = ['farm', 'lumber', 'quarry', 'mine', 'market', 'library', 'university', 'house',
  'storehouse', 'church', 'watchtower', 'builderhouse'];
const MAX_LEVEL = 3;
const UPGRADE_COST_MUL = [0, 0, 1.5, 2.5];     // × the base cost, per target level
const UPGRADE_TIME_MUL = [0, 0, 1.2, 1.8];     // × the base build time

function upgradeCost(b) {
  const next = (b.level || 1) + 1;
  const out = {};
  for (const [r, v] of Object.entries(b.type.cost || {})) out[r] = Math.round(v * UPGRADE_COST_MUL[next]);
  // a building that costs only wood still needs stone for a second storey
  if (!out.stone) out.stone = Math.round(10 * UPGRADE_COST_MUL[next]);
  return out;
}

// Why this building cannot be upgraded right now, or null.
function upgradeBlocker(b) {
  const f = game.factions[b.faction];
  if (!UPGRADEABLE.includes(b.type.key)) return 'This building cannot be upgraded';
  if (!b.done) return 'Finish building it first';
  if (b.site) return 'An upgrade is already under way';
  const next = (b.level || 1) + 1;
  if (next > MAX_LEVEL) return 'Already at the highest level';
  if (f.mods.level < next) return next === 2 ? 'Research Heavy Plough to unlock level 2' : 'Research Guilds to unlock level 3';
  if (!f.nation.canStart(upgradeCost(b))) return 'Not enough unreserved resources';
  return null;
}

function startUpgrade(b) {
  const err = upgradeBlocker(b);
  if (err) return err;
  const cost = upgradeCost(b);
  b.site = { needs: { ...cost }, delivered: {}, inbound: {}, wait: 0, upgrade: true, progress: 0, to: (b.level || 1) + 1 };
  for (const r of RES_KEYS) { b.site.delivered[r] = 0; b.site.inbound[r] = 0; }
  return null;
}

function upgradeTime(b) {
  return Math.max(4, b.type.buildTime * UPGRADE_TIME_MUL[b.site ? b.site.to : 2]);
}

// Builders work an upgrade site with the same hands they raise a new one.
function advanceUpgrade(b, amount) {
  if (!b.site || !b.site.upgrade || !siteReady(b)) return;
  b.site.progress = Math.min(1, b.site.progress + amount);
  if (b.site.progress < 1) return;
  const oldMax = b.maxHp;
  b.level = b.site.to;
  b.site = null;
  b.hp = Math.min(b.maxHp, b.hp + (b.maxHp - oldMax));
  if (b.faction === 0) game.log(`Your ${b.type.name} is now level ${b.level}.`, 'good');
}

// ---------- repair ----------

const REPAIR_QUIET = 10;          // seconds since the last blow before anyone repairs
const REPAIR_RATE = 0.02;         // of max HP per second, per builder
const REPAIR_COST = 0.3;          // of the build cost, for a full repair

function findRepair(u, f) {
  let best = null, bd = 40;
  for (const b of f.buildings) {
    if (!b.done || b.hp <= 0 || b.site || b.type.key === 'bridge') continue;
    if (b.hp >= b.maxHp - 0.5) continue;
    if (game.time - (b.lastHurtT || -99) < REPAIR_QUIET) continue;
    const d = wdist(u.x, u.y, b.cx, b.cy);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// One builder's repair work for this tick; returns false when it cannot go on.
function builderRepair(u, dt, b) {
  if (!b || b.hp <= 0 || b.hp >= b.maxHp - 0.5 || b.site || game.time - (b.lastHurtT || -99) < REPAIR_QUIET) return false;
  if (u.distTo(b) > 1.2) {
    walkTo(u, dt, Math.floor(b.cx), Math.floor(b.cy), () => { u.repair = null; });
    return true;
  }
  u.path = [];
  u.setAnim('attack');
  const n = game.factions[u.faction].nation;
  const heal = Math.min(b.maxHp - b.hp, b.maxHp * REPAIR_RATE * dt);
  // pay for the fraction of the building mended
  const frac = heal / b.maxHp;
  for (const [r, v] of Object.entries(b.type.cost || {})) {
    const owe = v * REPAIR_COST * frac;
    if (n.total(r) < owe) return false;         // out of materials: stop
    n.withdraw(r, owe);
  }
  b.hp += heal;
  return true;
}

// ---------- adjacency ----------

const ADJ_TTL = 8;   // seconds a computed bonus is trusted

// The yield bonus this building earns from its neighbours (a fraction, e.g.
// 0.15), and why. Cached per building.
function adjacencyBonus(b) {
  if (b.adjAt != null && game.time - b.adjAt < ADJ_TTL) return b.adj;
  b.adjAt = game.time;
  b.adj = computeAdjacency(game.map, b.type.key, b.x, b.y, b.faction, b);
  return b.adj;
}

// Shared with the placement ghost, which asks the same question of a building
// that does not exist yet (`self` null).
function computeAdjacency(map, key, x, y, fid, self = null) {
  const size = BUILDING_TYPES[key].size;
  const seen = new Set();
  const count = (radius, keys) => {
    let n = 0;
    for (let dy = -radius; dy < size + radius; dy++) {
      for (let dx = -radius; dx < size + radius; dx++) {
        const tx = x + dx, ty = y + dy;
        if (!map.inBounds(tx, ty)) continue;
        const o = map.buildingAt[map.idx(tx, ty)];
        if (!o || o === self || o.faction !== fid || !o.done || !keys.includes(o.type.key) || seen.has(o)) continue;
        seen.add(o);
        n++;
      }
    }
    return n;
  };
  if (key === 'farm') {
    const n = count(1, ['farm']);
    return { v: Math.min(0.15, n * 0.05), why: n ? `${n} neighbouring farm${n > 1 ? 's' : ''} — a field system` : 'no farms beside it' };
  }
  if (key === 'market') {
    const n = count(3, ['house']);
    return { v: Math.min(0.4, n * 0.08), why: n ? `${n} house${n > 1 ? 's' : ''} within 3 tiles — customers` : 'no houses nearby' };
  }
  if (key === 'library' || key === 'university') {
    const n = count(3, ['church', 'library', 'university', 'cathedral', 'greatlibrary']);
    return { v: Math.min(0.3, n * 0.15), why: n ? `${n} seat${n > 1 ? 's' : ''} of learning or worship nearby` : 'no church or library nearby' };
  }
  if (key === 'lumber' || key === 'quarry' || key === 'mine') {
    const n = count(3, ['storehouse']);
    return { v: 0, why: n ? 'a Storehouse close by — short hauls' : 'no Storehouse close by — long hauls' };
  }
  return { v: 0, why: '' };
}

// ---------- the AI ----------

// Which building a nation should upgrade next, as an investment candidate.
function aiScoreBuildingUpgrade(f) {
  if (f.mods.level < 2 || !aiCanBreakGround(f)) return null;
  const n = f.nation;
  if (f.buildings.some(b => b.site && b.site.upgrade)) return null;    // one at a time
  let best = null, bs = 0;
  for (const b of f.buildings) {
    if (upgradeBlocker(b)) continue;
    let s = 0;
    const res = b.type.produces;
    if (res === 'knowledge') s = 3 * (1 + aiKnowledgeAppetite(f));
    else if (res) s = 3 * (1 + calculateMarginalUtility(f, res)) * (b.workers / Math.max(1, b.type.slots));
    else if (b.type.housing) s = n.pop >= n.housingCap() - 3 ? 5 : 1;
    else if (b.type.storage) s = 2 * (1 + f.brain.utility.storagePressure() * 2);
    else if (b.type.key === 'watchtower') s = game.diplomacy.atWarAny(f.id) ? 4 : 0.5;
    else s = 1;
    if (s > bs) { bs = s; best = b; }
  }
  if (!best) return null;
  return { id: 'upgrade:' + best.type.key, score: bs * 1.2, run: () => !startUpgrade(best) };
}
