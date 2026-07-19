'use strict';
// Nation economy: resources, population, food, housing, happiness, taxes.

const EAT_RATE = 0.05;       // food per citizen per second
const GROWTH_INTERVAL = 9;   // seconds between growth checks
const STARVE_INTERVAL = 12;  // seconds between starvation losses

class Nation {
  constructor(factionId) {
    this.factionId = factionId;
    this.res = { food: 120, wood: 90, stone: 50, gold: 40 };
    this.pop = 10;
    this.happiness = 60;
    this.tax = 0.1;            // 0..0.4 — gold per citizen, costs happiness
    this.growthTimer = 0;
    this.starveTimer = 0;
    this.warWeariness = 0;     // rises during war, decays in peace
    this.starving = false;
  }

  get faction() { return game.factions[this.factionId]; }

  workersAssigned() {
    let n = 0;
    for (const b of this.faction.buildings) n += b.workers;
    return n;
  }
  idleWorkers() { return Math.max(0, this.pop - this.workersAssigned()); }

  housingCap() {
    let cap = 10; // townhall base
    for (const b of this.faction.buildings) {
      if (!b.done) continue;
      if (b.type.housing) cap += b.type.housing;
    }
    return cap;
  }

  canAfford(cost) {
    for (const k in cost) if ((this.res[k] || 0) < cost[k]) return false;
    return true;
  }
  pay(cost) {
    for (const k in cost) this.res[k] -= cost[k];
  }

  tick(dt) {
    const f = this.faction;
    // production from worked buildings
    for (const b of f.buildings) {
      if (!b.done) {
        b.progress = Math.min(1, b.progress + dt / b.type.buildTime);
        continue;
      }
      const out = buildingProduction(game.map, b, dt);
      if (out) this.res[out.resource] += out.amount;
    }
    // taxes
    this.res.gold += this.pop * this.tax * 0.06 * dt;
    // eating
    this.res.food -= this.pop * EAT_RATE * dt;
    this.starving = this.res.food <= 0;
    if (this.res.food < 0) this.res.food = 0;

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

    // growth
    this.growthTimer += dt;
    if (this.growthTimer >= GROWTH_INTERVAL) {
      this.growthTimer = 0;
      if (!this.starving && this.res.food > this.pop * 2 && this.pop < this.housingCap() && this.happiness > 50) {
        this.pop++;
      }
    }
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

    // war weariness decay / growth handled by diplomacy
    const atWar = game.diplomacy.atWarAny(this.factionId);
    this.warWeariness = Math.max(0, Math.min(25, this.warWeariness + (atWar ? dt * 0.25 : -dt * 0.5)));
  }

  // happiness aura from churches, markets, wells relative to population size
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
