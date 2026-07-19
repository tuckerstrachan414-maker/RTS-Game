'use strict';
// Global commodity market: prices for food/wood/stone move with supply & demand.
// Selling floods supply → price falls; buying drains it → price rises; prices
// mean-revert toward a baseline, and nations running short spike demand (and price).
// Embargoed nations get worse terms. Gold is the currency, not a traded good.

const TRADE_RES = ['food', 'wood', 'stone'];

class Market {
  constructor() {
    this.base = { food: 1.0, wood: 1.5, stone: 2.0 };
    this.equil = { food: 220, wood: 160, stone: 130 };   // mean-revert target
    this.stock = { food: 220, wood: 160, stone: 130 };   // market liquidity pool
    this.spread = 0.1;                                    // buy/sell margin
  }

  // mid price: scarce (low stock) → dear; glut (high stock) → cheap
  price(r) {
    const s = Math.max(5, this.stock[r]);
    const p = this.base[r] * (this.equil[r] / s);
    return Math.max(this.base[r] * 0.35, Math.min(this.base[r] * 3.5, p));
  }
  accessPenalty(fid) {
    let n = 0;
    for (let a = 0; a < game.factions.length; a++) {
      if (a !== fid && !game.factions[a].eliminated && game.diplomacy.embargoed(a, fid)) n++;
    }
    return Math.min(0.6, n * 0.2);
  }
  buyPrice(nation, r) { return this.price(r) * (1 + this.spread) * (1 + this.accessPenalty(nation.factionId)); }
  sellPrice(nation, r) { return this.price(r) * (1 - this.spread) * (1 - this.accessPenalty(nation.factionId)); }

  // ---------- transactions ----------
  sell(nation, r, qty) {
    if (!TRADE_RES.includes(r)) return 'Not tradeable';
    qty = Math.min(qty, Math.floor(nation.total(r)));
    if (qty <= 0) return `No ${r} to sell`;
    const gold = this.sellPrice(nation, r) * qty;
    nation.withdraw(r, qty);
    nation.deposit('gold', gold);
    this.stock[r] += qty;
    if (nation.factionId === 0) game.tradeGold += gold;
    return null;
  }
  buy(nation, r, qty) {
    if (!TRADE_RES.includes(r)) return 'Not tradeable';
    const cost = this.buyPrice(nation, r) * qty;
    if (nation.total('gold') < cost) return 'Not enough gold';
    if (nation.capacityFor(r) - nation.total(r) < qty - 0.5) return `No room to store ${r}`;
    nation.withdraw('gold', cost);
    nation.deposit(r, qty);
    this.stock[r] = Math.max(5, this.stock[r] - qty);
    return null;
  }
  // resource-for-resource barter at market-implied rates
  barter(nation, giveR, qty, getR) {
    if (giveR === getR) return 'Pick two different goods';
    qty = Math.min(qty, Math.floor(nation.total(giveR)));
    if (qty <= 0) return `No ${giveR} to trade`;
    const value = this.sellPrice(nation, giveR) * qty;
    const getQty = value / this.buyPrice(nation, getR);
    if (getQty < 0.5) return 'Not worth trading';
    if (nation.capacityFor(getR) - nation.total(getR) < getQty - 0.5) return `No room to store ${getR}`;
    nation.withdraw(giveR, qty);
    nation.deposit(getR, getQty);
    this.stock[giveR] += qty;
    this.stock[getR] = Math.max(5, this.stock[getR] - getQty);
    return { gave: qty, got: getQty };
  }

  // barter output preview (units of getR for `qty` of giveR), for the UI
  barterRate(nation, giveR, qty, getR) {
    const value = this.sellPrice(nation, giveR) * qty;
    return value / this.buyPrice(nation, getR);
  }

  tick(dt) {
    for (const r of TRADE_RES) {
      // mean-revert toward equilibrium (prices ease back to baseline)
      this.stock[r] += (this.equil[r] - this.stock[r]) * Math.min(1, dt * 0.02);
      // shortage-driven demand: nations short of r pull stock down → price spikes
      let shortage = 0;
      for (const f of game.factions) {
        if (f.eliminated) continue;
        const need = r === 'food' ? f.nation.pop * 2 : f.nation.pop * 0.5 + 20;
        const have = f.nation.total(r);
        if (have < need) shortage += (need - have);
      }
      this.stock[r] -= shortage * dt * 0.0025;
      this.stock[r] = Math.max(5, this.stock[r]);
    }
  }
}
