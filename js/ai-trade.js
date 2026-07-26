'use strict';
// Trade: market orders priced against marginal utility, and the decision a
// nation faces when a resource runs out under its own soil — buy it, take it,
// or go and look first.
//
// Everything about rivals here comes from ScoutMemoryMap (js/ai-perception.js).
// Market prices and the diplomacy matrices are public and read directly.

// A nation cannot claim a military advantage without an actual army. These
// floors are why the opening minutes are peaceful: at game start every nation
// has three escort units (~54 strength), so no one clears the bar, and the
// strength comparison can never be won against an empty enemy army.
const WAR_MIN_ARMY = 6;
const WAR_MIN_STRENGTH = 110;
// A captured producer keeps paying out long after the war ends — worth roughly
// this many units of its resource, now that conquest annexes instead of razing.
const CAPTURED_PRODUCER_VALUE = 45;

// Probability we win a war against a force we estimate at `theirStr`.
function aiWinProbability(myStr, theirStr) {
  const edge = myStr / Math.max(1, theirStr) - 1;
  return 1 / (1 + Math.exp(-edge * 2.2));
}

// ---------- the war-versus-trade decision ----------

// Called when marginal utility says a resource is critically short. Returns the
// nation's read on how to fix it:
//   'trade' — buy it on the market (or keep buying)
//   'war'   — the stock and the mines are worth taking, and we can win
//   'scout' — the war looks good but we do not trust what we know; go look
//   'wait'  — no route to either, keep building
//
// The 'scout' branch is the point of the whole memory system: a nation that
// cannot see its neighbour does not guess, and it does not cheat. It rides out.
function evaluateWarVersusTrade(f, r) {
  const arch = aiArchetype(f);
  const p = f.brain.perception;
  const s = p.self();
  const dip = game.diplomacy;
  const out = {
    resource: r, choice: 'wait', target: null,
    tradeScore: 0, warScore: 0, winProb: 0, confidence: 0, note: '',
  };

  const mu = calculateMarginalUtility(f, r);
  const need = arch.reserve[r](s.population) + aiPlanDemand(f)[r];
  const shortfall = Math.max(0, need - (s[r] + s.income[r] * MU_HORIZON));
  if (shortfall <= 0) return out;

  // ---- branch 1: buy it ----
  if (TRADE_RES.includes(r)) {
    const hasMarket = f.buildings.some(b => b.type.key === 'market' && b.done && b.hp > 0);
    if (!hasMarket) {
      out.note = 'no market';
    } else {
      const unitCost = game.market.buyPrice(f.nation, r);   // embargo penalty included
      const goldMu = calculateMarginalUtility(f, 'gold');
      const affordable = Math.min(shortfall, s.headroom[r], s.gold / Math.max(0.01, unitCost));
      if (affordable < 1) out.note = 'cannot afford to buy';
      else out.tradeScore = Math.max(0, mu - unitCost * goldMu) * affordable * arch.tradeBias;
    }
  }

  // ---- branch 2: take it ----
  const canCampaign = s.armySize >= WAR_MIN_ARMY && s.strength >= WAR_MIN_STRENGTH;
  let bestScore = 0, bestTarget = null, bestConf = 0, bestWin = 0;
  if (canCampaign) {
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) continue;
      const st = dip.status(f.id, o.id);
      if (st === STATUS.WAR || st === STATUS.ALLIANCE) continue;
      if (o.isPlayer && game.time < game.diff.playerGrace) continue;

      // what we believe is over there — remembered stock, and remembered mines
      let stock = 0, producers = 0;
      for (const mem of p.knownBuildings(o.id)) {
        const remembered = p.rememberedStore(o.id, mem);
        if (remembered) stock += remembered[r] || 0;
        const t = BUILDING_TYPES[mem.key];
        if (t && t.produces === r) producers++;
      }
      const prize = stock * mu + producers * mu * CAPTURED_PRODUCER_VALUE
        + p.estimatedLoot(o.id) * 0.4;
      if (prize <= 0) continue;

      const theirStr = p.threatStrength(o.id);      // stale intel reads as dangerous
      const pWin = aiWinProbability(s.strength, theirStr);
      // what losing costs: the army, the disorder, the caravans, and whoever
      // else gets dragged in on their side
      const lossCost = (1 - pWin) * (s.strength * 1.4 + 120) / Math.max(0.2, arch.riskTolerance);
      const upkeep = 60 + (st === STATUS.TRADE ? 90 : 0);
      let allyRisk = 0;
      for (const c of game.factions) {
        if (c.id === f.id || c.id === o.id || c.eliminated) continue;
        if (dip.status(o.id, c.id) === STATUS.ALLIANCE) allyRisk += p.threatStrength(c.id) * 0.5;
      }
      const score = (pWin * prize - lossCost - upkeep - allyRisk * 0.4) * arch.warBias;
      if (score > bestScore) {
        bestScore = score; bestTarget = o; bestConf = p.confidence(o.id); bestWin = pWin;
      }
    }
  } else {
    out.note = out.note || 'no army to campaign with';
  }

  out.warScore = bestScore;
  out.target = bestTarget;
  out.confidence = bestConf;
  out.winProb = bestWin;

  // ---- arbitration ----
  const fallback = out.tradeScore > 0 ? 'trade' : 'wait';
  if (!bestTarget) { out.choice = fallback; return out; }
  if (bestConf < arch.minConfidence) { out.choice = 'scout'; return out; }
  if (bestWin < arch.minWinProb) { out.choice = fallback; out.note = 'odds too long'; return out; }
  out.choice = bestScore > out.tradeScore * arch.warThreshold ? 'war' : fallback;
  return out;
}

// ---------- the manager ----------

class AITradeManager {
  constructor(faction) {
    this.faction = faction;
    this.verdict = null;        // last evaluateWarVersusTrade result
    this.verdictAt = -999;
    this.pactAt = -999;
  }

  tick() {
    const f = this.faction;
    this.marketOrders();
    this.reviewShortages();
    if (game.time - this.pactAt > 25) { this.pactAt = game.time; this.seekPact(); }
  }

  hasMarket() {
    return this.faction.buildings.some(b => b.type.key === 'market' && b.done && b.hp > 0);
  }

  // Buy and sell against marginal utility rather than fixed stock thresholds:
  // sell a good when the gold it fetches is worth more to us than the good is,
  // buy when it is worth less. A nation with full granaries and no stone will
  // convert one into the other on its own.
  marketOrders() {
    const f = this.faction, n = f.nation, arch = aiArchetype(f);
    if (!this.hasMarket()) return;
    const goldMu = calculateMarginalUtility(f, 'gold');
    for (const r of TRADE_RES) {
      const mu = calculateMarginalUtility(f, r);
      const sellUnit = game.market.sellPrice(n, r) * goldMu;
      const buyUnit = game.market.buyPrice(n, r) * goldMu;
      if (mu < sellUnit * 0.9) {
        const spare = n.total(r) - arch.reserve[r](n.pop);
        if (spare > 20) game.market.sell(n, r, Math.min(25, Math.floor(spare * 0.4)));
      } else if (mu > buyUnit * 1.15) {
        const room = Math.floor(n.capacityFor(r) - n.total(r));
        const qty = Math.min(20, room);
        if (qty > 0 && n.total('gold') > game.market.buyPrice(n, r) * qty) game.market.buy(n, r, qty);
      }
    }
  }

  // Keep a standing verdict on our worst shortage, refreshed a few times a
  // minute. The combat manager reads it; so does expansion.
  reviewShortages() {
    const f = this.faction;
    const shortage = aiWorstShortage(f);
    if (!shortage) { this.verdict = null; return; }
    const arch = aiArchetype(f);
    if (shortage.utility < arch.scarcityAlarm) { this.verdict = null; return; }
    // only a shortage we cannot fix at home is worth a war or a trade mission
    if (shortage.local) { this.verdict = null; return; }
    if (game.time - this.verdictAt < 12 && this.verdict && this.verdict.resource === shortage.resource) return;
    this.verdictAt = game.time;
    this.verdict = evaluateWarVersusTrade(f, shortage.resource);
  }

  // Propose a caravan pact when we have goods to move and know where a partner's
  // market is. Envoys are physical, so this is an intention, not a transaction.
  seekPact() {
    const f = this.faction, arch = aiArchetype(f), dip = game.diplomacy, p = f.brain.perception;
    if (!this.hasMarket() || !arch.trainsPrince) return;
    if (!f.units.some(u => u.alive && u.type.envoy && !u.mission)) return;
    let best = null, bestRel = -999;
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) continue;
      const st = dip.status(f.id, o.id);
      if (st === STATUS.WAR || st === STATUS.TRADE || st === STATUS.ALLIANCE) continue;
      if (!p.hasMarket(o.id)) continue;          // we have to have SEEN their market
      const rel = dip.relation(f.id, o.id);
      if (rel < -10) continue;
      if (rel > bestRel) { bestRel = rel; best = o; }
    }
    if (best) dip.propose(f.id, best.id, 'trade');
  }
}
