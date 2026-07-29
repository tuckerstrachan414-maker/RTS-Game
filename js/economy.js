'use strict';
// Nation economy. Resources are stored PHYSICALLY in storage buildings (Town Hall,
// Storehouses); `nation.res` is a transparent Proxy view that reads/writes those stores.
// This is what makes robbery and raiding meaningful: lose a store, lose its goods.

const EAT_RATE = 0.05;       // food per citizen per second
const STARVE_INTERVAL = 12;  // seconds between starvation losses
const DAY_GROWTH_FRACTION = 0.3; // fraction of housing cap added each new day
const RES_KEYS = ['food', 'wood', 'stone', 'gold'];
// Tax knobs, shared by the slider, the happiness model and the AI's tax
// controller (js/ai-utility.js) — the controller INVERTS the happiness formula
// below to solve for a safe rate, so these must never be duplicated as literals.
const TAX_MAX = 0.4;
const TAX_HAPPINESS_COST = 55;
const HAPPY_GROWTH_GATE = 50;   // growForNewDay needs happiness strictly above this

class Nation {
  constructor(factionId) {
    this.factionId = factionId;
    this.pop = 10;
    this.happiness = 60;
    this.tax = 0.1;            // 0..0.4 — gold per citizen, costs happiness
    this.starveTimer = 0;
    this.warWeariness = 0;     // rises during war, decays in peace
    this.starving = false;
    this.overflowWarnT = -99;
    // resources physically held in buildings; res[...] transparently sums / distributes
    this.res = new Proxy({}, {
      get: (_, prop) => (RES_KEYS.includes(prop) ? this.total(prop) : undefined),
      set: (_, prop, value) => { this.setResource(prop, value); return true; },
      has: (_, prop) => RES_KEYS.includes(prop),
      ownKeys: () => [...RES_KEYS],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }

  get faction() { return game.factions[this.factionId]; }

  // ---------- physical storage ----------
  storageBuildings() {
    return this.faction.buildings.filter(b => b.done && b.hp > 0 && b.type.storage);
  }
  total(r) {
    if (!RES_KEYS.includes(r)) return 0;
    let s = 0;
    for (const b of this.storageBuildings()) s += b.store[r] || 0;
    return s;
  }
  capacityFor(r) {
    let c = 0;
    for (const b of this.storageBuildings()) c += b.type.storage[r] || 0;
    return c;
  }
  setResource(r, value) {
    if (!RES_KEYS.includes(r)) return;
    const delta = value - this.total(r);
    if (delta > 1e-9) this.deposit(r, delta);
    else if (delta < -1e-9) this.withdraw(r, -delta);
  }
  // Fill dedicated Storehouses before the Town Hall — concentrates the bulk into
  // buildings that make tempting (and defendable) raid targets.
  deposit(r, amt) {
    let remaining = amt;
    const stores = this.storageBuildings().sort(
      (a, b) => (a.type.key === 'townhall' ? 1 : 0) - (b.type.key === 'townhall' ? 1 : 0));
    for (const b of stores) {
      const room = (b.type.storage[r] || 0) - (b.store[r] || 0);
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      b.store[r] += add; remaining -= add;
      if (remaining <= 1e-9) break;
    }
    if (remaining > 0.5 && r !== 'gold' && this.factionId === 0 && game.time - this.overflowWarnT > 15) {
      this.overflowWarnT = game.time;
      game.log(`Your ${r} storage is full — build a Storehouse to hold more.`, 'bad');
    }
    return remaining;
  }
  // Drain the Town Hall first so Storehouses stay full (redundancy + juicier targets).
  withdraw(r, amt) {
    let remaining = amt;
    const stores = this.storageBuildings().sort(
      (a, b) => (b.type.key === 'townhall' ? 1 : 0) - (a.type.key === 'townhall' ? 1 : 0));
    for (const b of stores) {
      const take = Math.min(b.store[r] || 0, remaining);
      b.store[r] -= take; remaining -= take;
      if (remaining <= 1e-9) break;
    }
    return amt - remaining;
  }

  // ---------- workforce & housing ----------
  workersAssigned() {
    let n = 0;
    for (const b of this.faction.buildings) n += b.workers;
    return n;
  }
  idleWorkers() { return Math.max(0, this.pop - this.workersAssigned()); }

  housingCap() {
    let cap = 10; // townhall base
    for (const b of this.faction.buildings) {
      if (b.done && b.type.housing) cap += b.type.housing;
    }
    return cap;
  }

  canAfford(cost) {
    for (const k in cost) if (this.total(k) < cost[k]) return false;
    return true;
  }
  pay(cost) {
    for (const k in cost) this.withdraw(k, cost[k]);
  }

  // ---------- earmarked materials ----------
  // A construction site is a claim on goods that are still sitting in the
  // Storehouse: its builders have not fetched them yet. Without netting those
  // out, one pile of timber could be promised to five different sites and every
  // one of them would stall half-built.
  reserved(r) {
    let s = 0;
    for (const b of this.faction.buildings) if (b.site) s += siteOutstanding(b, r);
    return s;
  }
  available(r) { return this.total(r) - this.reserved(r); }
  // Affordability for STARTING something, as opposed to paying for it outright
  // (training, upgrades and market orders still use canAfford — they take the
  // goods there and then).
  canStart(cost) {
    for (const k in cost) if (this.available(k) < cost[k]) return false;
    return true;
  }

  tick(dt) {
    // Production and construction are no longer bookkeeping: both are carried out
    // by civilians walking around the map (js/civilians.js). What used to be a
    // per-building deposit here is now a gatherer banking a load at a Storehouse,
    // and what used to be `progress += dt / buildTime` is a builder standing on
    // the site with the materials already delivered.
    syncCivilians(this.faction, dt);
    // taxes
    this.deposit('gold', this.pop * this.tax * 0.06 * dt);
    // eating
    this.withdraw('food', this.pop * EAT_RATE * dt);
    this.starving = this.total('food') <= 0.0001;

    // happiness — the tax-free part is factored out (happinessTargetWithoutTax)
    // so the AI's tax controller can invert this exact formula rather than
    // copying it; a drift between the two would silently mistune every AI.
    const target = this.happinessTargetWithoutTax() - this.tax * TAX_HAPPINESS_COST;
    this.happiness += (target - this.happiness) * Math.min(1, dt * 0.15);
    this.happiness = Math.max(0, Math.min(100, this.happiness));

    // starvation deaths
    if (this.starving) {
      this.starveTimer += dt;
      if (this.starveTimer >= STARVE_INTERVAL && this.pop > 2) {
        this.starveTimer = 0;
        this.pop--;
        this.unassignExcess();
        if (this.factionId === 0) game.log('Your people are starving! A citizen has died.', 'bad');
      }
    } else this.starveTimer = 0;

    // war weariness
    const atWar = game.diplomacy.atWarAny(this.factionId);
    this.warWeariness = Math.max(0, Math.min(25, this.warWeariness + (atWar ? dt * 0.25 : -dt * 0.5)));
  }

  // Called once at dawn each day (see Game.tick). Population grows by DAY_GROWTH_FRACTION
  // of the housing cap, same conditions the old per-tick growth used, rounded to a whole
  // citizen and capped at the housing cap. Returns the number of citizens gained.
  growForNewDay() {
    const cap = this.housingCap();
    if (this.starving || this.pop >= cap || this.happiness <= HAPPY_GROWTH_GATE) return 0;
    if (this.total('food') <= this.pop * 2) return 0;
    const before = this.pop;
    this.pop = Math.min(cap, this.pop + Math.round(cap * DAY_GROWTH_FRACTION));
    return this.pop - before;
  }

  // Happiness this nation would drift toward at zero tax. Solving
  // (this - Hmin) / TAX_HAPPINESS_COST gives the highest tax rate that still
  // holds happiness at Hmin — which is how the AI decides what it can charge.
  happinessTargetWithoutTax() {
    let target = 50;
    target += this.starving ? -35 : 12;
    target += this.pop <= this.housingCap() ? 8 : -18;
    target += Math.min(20, this.auraScore());
    target -= this.warWeariness;
    if (this.faction.kingAlive === false) target -= 12;
    return target;
  }

  auraScore() {
    let pts = 0;
    for (const b of this.faction.buildings) {
      if (b.done && b.type.happyAura) pts += b.type.happyAura;
    }
    return pts * 10 / Math.max(10, this.pop);
  }

  unassignExcess() {
    let excess = this.workersAssigned() - this.pop;
    for (const b of this.faction.buildings) {
      while (excess > 0 && b.workers > 0) { b.workers--; excess--; }
      if (excess <= 0) break;
    }
  }
}

// Estimate of a faction's real income for one resource. It no longer
// re-implements the production maths — `workerYieldRate` (js/buildings.js) is the
// only copy of that now — but a nominal rate is only half the answer since
// workers started walking: a Lumber Camp on the far side of the map from any
// Storehouse genuinely earns less per worker than one built beside it. So a
// building that has actually been delivering reports what it measured
// (`b.yieldRate`, written in js/civilians.js), and only a camp with no recent
// delivery falls back to the nominal figure.
//
// The AI decides "my wood is structurally gone, so I must trade or take it" from
// this number, so an exhausted forest must still read as zero — that comes from
// workerYieldRate returning 0 when the reach holds no trees. (BUGS #6.)
const YIELD_STALE = 45;   // seconds without a delivery before measured throughput is ignored

function estimateIncome(f, res) {
  let rate = 0;
  for (const b of f.buildings) {
    if (!b.done || b.type.produces !== res || !b.workers) continue;
    const nominal = workerYieldRate(game.map, b) * b.workers;
    if (nominal <= 0) continue;   // worked-out forest: no phantom income
    // measured throughput can legitimately beat nominal (a Storehouse right next
    // door means a short walk), so it is trusted — but clamped, so one unusually
    // quick trip cannot convince a nation it has twice the income it has
    rate += (b.yieldRate != null && game.time - b.lastDeliver < YIELD_STALE)
      ? Math.min(b.yieldRate, nominal * 2) : nominal;
  }
  return rate;
}

// Has this Lumber Camp any forest left in reach? (js/ai-utility.js staffs on it.)
function lumberHasForest(map, b) { return !!findWorkTile(map, b); }
