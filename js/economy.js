'use strict';
// Nation economy. Resources are stored PHYSICALLY in storage buildings (Town Hall,
// Storehouses); `nation.res` is a transparent Proxy view that reads/writes those stores.
// This is what makes robbery and raiding meaningful: lose a store, lose its goods.

const EAT_RATE = 0.05;       // food per citizen per second
const STARVE_INTERVAL = 12;  // seconds between starvation losses
const DAY_GROWTH_FRACTION = 0.3; // fraction of housing cap added each new day
const RES_KEYS = ['food', 'wood', 'stone', 'gold'];

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

  tick(dt) {
    const f = this.faction;
    // production from worked buildings; construction progress
    for (const b of f.buildings) {
      if (!b.done) {
        b.progress = Math.min(1, b.progress + dt / b.type.buildTime);
        if (b.done) onBuildingCompleted(b);   // may spark a border dispute (js/territory.js)
        continue;
      }
      const out = buildingProduction(game.map, b, dt);
      if (out) this.deposit(out.resource, out.amount);
    }
    // taxes
    this.deposit('gold', this.pop * this.tax * 0.06 * dt);
    // eating
    this.withdraw('food', this.pop * EAT_RATE * dt);
    this.starving = this.total('food') <= 0.0001;

    // happiness
    const housed = this.pop <= this.housingCap();
    let target = 50;
    target += this.starving ? -35 : 12;
    target += housed ? 8 : -18;
    target += Math.min(20, this.auraScore());
    target -= this.warWeariness;
    target -= this.tax * 55;
    if (f.kingAlive === false) target -= 12;
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
    if (this.starving || this.pop >= cap || this.happiness <= 50) return 0;
    if (this.total('food') <= this.pop * 2) return 0;
    const before = this.pop;
    this.pop = Math.min(cap, this.pop + Math.round(cap * DAY_GROWTH_FRACTION));
    return this.pop - before;
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
