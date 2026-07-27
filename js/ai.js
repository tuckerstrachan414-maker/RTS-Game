'use strict';
// The AI goal brain: ambition re-evaluation, proactive diplomacy, war waves,
// expansion, and the bridge/wall engineering the new managers drive.
//
// The DECISION layer now lives in js/ai-utility.js (scoring), js/ai-trade.js
// (trade vs war) and js/ai-combat.js (scouting, war gating). This file keeps
// the executors those managers call, plus the ambition model that selects a
// nation's archetype. Mechanisms themselves stay in diplomacy.js / factions.js
// / units.js — nothing here reaches past f.brain.perception for rival facts.

// Archetype parameter sets live in js/ai-utility.js as AI_ARCHETYPES; a
// nation's f.ai.doctrine is the key into that table. The player never sees the
// name — only rumors and visible behavior hint at it.

// Which ambition a freshly rolled personality leans toward. Because the
// personality itself is drawn per match (js/factions.js rollPersonalities), the
// opening line-up of ambitions differs from game to game.
function seedDoctrine(p) {
  const score = {
    aggressor: p.aggression * 2 + p.greed * 0.4 - p.caution,
    merchant: p.mercantile * 2 + p.greed * 0.3 - p.aggression,
    turtle: p.caution * 2 - p.aggression * 0.8,
    raider: p.greed * 1.8 + p.aggression * 0.8 - p.loyalty,
    hegemon: p.loyalty * 1.8 + p.mercantile * 0.6 - p.aggression * 0.5,
  };
  let best = 'turtle';
  for (const k in score) if (score[k] > score[best]) best = k;
  return best;
}

function initFactionAI(f) {
  f.ai = {
    doctrine: seedDoctrine(f.personality),
    doctrineSince: game.time,   // seeded ambitions get the full hysteresis window

    reevalAt: game.time + 15 + game.rng() * 10,
    grudge: game.factions.map(() => 0),   // per-rival grievance, decays slowly
    provocation: 0,                       // player-directed; gates wars on 'slanted'
    hurtT: -999,                          // last time we lost a building / the king
    plunder: 0,                           // loot banked during the current raid war
    wave: null,                           // {units, state, stagePos, stageUntil, targetFid}
    consolidationUntil: 0,                // no new offensive wars while game.time < this
    expansionSite: null,                  // {x, y} anchor for a second build cluster
    expansionPickedAt: -999,
    wallBox: null,                        // frozen wall-ring bounds (turtle doctrine)
    diploAt: game.time + 8 + game.rng() * 8,
    eventCooldownUntil: 0,                // min spacing between event cards to the player
    warAt: null,                          // pending war vs the player after an ultimatum
    bridgePlan: null,                     // surveyed water crossing being built
    expansionBuilt: 0,                    // buildings raised at the current satellite
  };
  // The decision layer. Perception must exist before anything asks a question
  // about a rival, so it is built first.
  f.brain = {
    perception: new AIPerception(f),
    utility: new AIUtilityEngine(f),
    trade: new AITradeManager(f),
    combat: new AICombatManager(f),
  };
}

// Nudge a faction to rethink its ambition right now (war, losses, eliminations).
function aiPoke(fid, hurt = false) {
  const f = game.factions[fid];
  if (!f || !f.ai) return;
  f.ai.reevalAt = 0;
  if (hurt) f.ai.hurtT = game.time;
}

function aiAddGrudge(fid, vsFid, amount) {
  const f = game.factions[fid];
  if (!f || !f.ai || fid === vsFid) return;
  f.ai.grudge[vsFid] = Math.max(0, Math.min(60, f.ai.grudge[vsFid] + amount));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- doctrine re-evaluation ----------

// Rescore ambitions against the world AS THIS NATION UNDERSTANDS IT. Every
// rival term below comes from perception, so a nation that has scouted nobody
// scores against the neutral prior rather than against the truth.
function reevaluateDoctrine(f, silent = false) {
  const ai = f.ai, p = f.personality, per = f.brain.perception;
  ai.reevalAt = game.time + 60;
  const rivals = game.factions.filter(o => o.id !== f.id && !o.eliminated);
  if (rivals.length === 0) return;
  const myStr = f.strength();
  const believed = rivals.map(o => per.estimatedStrength(o.id).value);
  const avgStr = believed.reduce((s, v) => s + v, 0) / believed.length;
  const leaderStr = Math.max(...believed);
  const threatNorm = clamp(aiMaxThreat(f) / Math.max(20, myStr), 0, 1.5);
  // How much of that threat do we actually KNOW about? Unknown rivals are
  // treated as dangerous when picking fights — that is what stops blind
  // aggression — but a nation should not reorganise its whole ambition around
  // a neighbour it has never laid eyes on, or every nation turtles forever.
  const avgConf = rivals.reduce((s, o) => s + per.confidence(o.id), 0) / rivals.length;
  const goldNorm = clamp((estimateIncome(f, 'gold') + f.nation.pop * f.nation.tax * 0.06) / 0.6, 0, 1);
  const atPeace = !game.diplomacy.atWarAny(f.id);
  const allyCount = game.factions.filter(o => o.id !== f.id && !o.eliminated
    && game.diplomacy.status(f.id, o.id) === STATUS.ALLIANCE).length;
  const maxGrudge = Math.max(...ai.grudge);
  const recentlyHurt = game.time - ai.hurtT < 90;
  // only loot we have actually laid eyes on tempts a nation into raiding
  const richLootNorm = clamp(Math.max(0, ...rivals.map(o => per.estimatedLoot(o.id))) / 400, 0, 1);
  // a shortage we cannot fix at home pushes toward trade or toward taking it
  const shortage = aiWorstShortage(f);
  const starvedOfLand = shortage && !shortage.local ? clamp(shortage.utility / 3, 0, 1) : 0;

  const snow = aiSnowballLeader(f);
  const score = {
    aggressor: p.aggression * 2 + clamp(myStr / Math.max(1, avgStr) - 1, -1, 1.5)
      + maxGrudge * 0.02 + (game.diff.warAppetite - 1) + starvedOfLand * 0.8,
    merchant: p.mercantile * 2 + goldNorm + (atPeace ? 0.5 : -0.5) - threatNorm
      + starvedOfLand * 0.5,
    turtle: threatNorm * (0.5 + 1.5 * avgConf) + (recentlyHurt ? 1.5 : 0)
      + p.caution * 1.6 - p.aggression * 0.8,
    hegemon: p.mercantile + p.loyalty + allyCount * 0.5 + (leaderStr > myStr * 1.5 ? 1.4 : 0)
      + (snow >= 0 && snow !== f.id ? 1.2 : 0),   // a runaway power calls for coalitions
    raider: p.aggression + p.greed + (goldNorm < 0.3 ? 1 : 0) + richLootNorm,
  };
  let best = ai.doctrine;
  for (const k in score) if (score[k] > score[best]) best = k;
  if (best === ai.doctrine) return;
  // hysteresis: a new ambition must clearly beat the old one, and not flip-flop
  if (score[best] < score[ai.doctrine] * 1.25 || score[best] < score[ai.doctrine] + 0.3) return;
  if (game.time - ai.doctrineSince < 90 && !silent) return;
  ai.doctrine = best;
  ai.doctrineSince = game.time;
  if (!silent) game.log(AI_ARCHETYPES[best].rumor(f.name));
}

// ---------- build planning ----------
// Deficit scoring replaces the old fixed build ladder: targets scale with
// population and ambition forever, so AI nations never stop growing.

// Keys only, for callers that just want the shortlist.
function aiBuildWishes(f, counts) {
  return aiBuildWishesScored(f, counts).map(x => x[1]);
}

// [score, key] pairs, highest first. The scores matter: bootstrap bonuses below
// are how a nation knows a first Castle outranks a fourth storehouse, and a
// caller that re-ranks by position alone throws that information away.
function aiBuildWishesScored(f, counts) {
  const n = f.nation, prof = aiArchetype(f), pop = n.pop;
  const have = k => counts[k] || 0;
  const desired = {
    farm: Math.max(1, Math.ceil((pop * EAT_RATE * 1.3) / (BUILDING_TYPES.farm.rate * BUILDING_TYPES.farm.slots))),
    house: Math.ceil(Math.max(0, pop * 1.35 - 10) / 6),
    lumber: 1 + Math.floor(pop / 20),
    quarry: prof.desire.quarry || 1,
    mine: prof.desire.mine || 1,
    storehouse: (prof.desire.storehouse || 1)
      + ['food', 'wood', 'stone'].filter(r => n.capacityFor(r) > 0 && n.total(r) > n.capacityFor(r) * 0.7).length,
    market: prof.desire.market || 1,
    church: 1,
    well: 1,
    castle: 1 + (prof.secondCastlePop && pop >= prof.secondCastlePop ? 1 : 0),
  };
  const scored = [];
  for (const k in desired) {
    const deficit = desired[k] - have(k);
    if (deficit <= 0) continue;
    let s = deficit * (prof.buildWeights[k] || 1);
    // bootstrap: stand up the essential production chain before anything fancy
    if ((k === 'farm' || k === 'lumber') && have(k) === 0) s += 10;
    if (k === 'quarry' && have(k) === 0 && have('lumber') > 0) s += 5;
    if (k === 'house' && n.pop >= n.housingCap() - 2) s += 6;   // growth is blocked right now
    if (k === 'castle' && have('quarry') === 0) s -= 5;         // no stone income yet
    // without a castle there is no army, no envoy and no tier climb at all
    if (k === 'castle' && have(k) === 0 && pop >= 14) s += 8;
    // A resource the land has stopped giving can only come from the market or
    // from new ground. Both need wanting BEFORE the shortage strands the nation
    // — a worked-out forest otherwise leaves it unable to afford anything.
    const dry = aiStructuralShortage(f);
    if (dry) {
      if (k === 'market' && have(k) === 0 && n.total('gold') > 120) s += 9;
      if (k === EXTRACTOR_FOR[dry]) s += 4;
    }
    scored.push([s, k]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 3);
}

// Prosperity nations race for the Grand Castle as a prestige monument — it does
// not end the game, for them or for the player.
function aiPursueGrand(f) {
  const n = f.nation;
  const c = f.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0 && !b.grand && b.grandProgress === 0);
  if (!c || n.pop < 50 || n.happiness < 70 || !n.canAfford(GRAND_CASTLE_COST)) return;
  n.pay(GRAND_CASTLE_COST);
  c.grandProgress = 0.01;
  game.log(`${f.name} has begun raising a GRAND CASTLE — a monument to eclipse every other nation!`, 'bad');
}

// ---------- per-tick strategy ----------
// Called from aiTick each time it fires (~2-3s). Later phases hang proactive
// diplomacy off this.

function aiStrategy(f) {
  const ai = f.ai;
  for (let i = 0; i < ai.grudge.length; i++) ai.grudge[i] = Math.max(0, ai.grudge[i] - 0.12);
  ai.provocation = Math.max(0, ai.provocation - 0.02);
  if (game.time >= ai.reevalAt) reevaluateDoctrine(f);
  // Bridges, walls and expansion are scheduled by the utility engine now — they
  // run A* and no longer belong on every single tick (js/ai-utility.js slots).
  if (game.time >= ai.diploAt) {
    ai.diploAt = game.time + 8 + game.rng() * 7;
    aiDiplomacy(f);
  }
  // a refused/ignored ultimatum turns into a declared war after the telegraph
  if (ai.warAt && game.time >= ai.warAt) {
    ai.warAt = null;
    if (!game.factions[0].eliminated && game.diplomacy.status(f.id, 0) !== STATUS.WAR) {
      game.diplomacy.declareWar(f.id, 0);
    }
  }
}

// ---------- proactive diplomacy ----------
// AI factions drive the SAME mechanisms the player uses: envoy-borne proposals,
// gifts, embargoes, declared wars and sued peace — with the player and with
// each other. (Diplomacy.tick keeps only ambient relations drift.)

function aiDiplomacy(f) {
  const ai = f.ai, prof = aiArchetype(f), dip = game.diplomacy, n = f.nation;
  const rivals = game.factions.filter(o => o.id !== f.id && !o.eliminated);
  if (!rivals.length) return;

  // 1. ongoing wars: sue for peace when weary and losing (or the war drags),
  //    and let mutually exhausted, bloodless wars gutter out in a white peace
  for (const o of rivals) {
    if (dip.status(f.id, o.id) !== STATUS.WAR) continue;
    const dur = game.time - dip.warSince[f.id][o.id];
    const durLimit = prof.plunderGoal ? 90 : 240;   // raid wars are short by design
    const theirStr = f.brain.perception.estimatedStrength(o.id).value;
    const losing = f.strength() < theirStr * 0.8;
    const winning = f.strength() > theirStr * 1.5;
    if (n.warWeariness > prof.peaceWeariness && (losing || dur > durLimit)
        && (!winning || prof.plunderGoal)) {        // raiders quit while ahead; conquerors don't
      if (o.isPlayer) aiOfferPeaceToPlayer(f);
      else if (n.res.gold >= 100) dip.suePeace(f.id, o.id);
    } else if (n.warWeariness > 18 && o.nation.warWeariness > 18
        && game.time - dip.lastBlood[f.id][o.id] > (o.isPlayer ? 180 : 120)) {
      dip.setStatus(f.id, o.id, STATUS.NEUTRAL);
      dip.rel[f.id][o.id] = Math.max(dip.rel[f.id][o.id], -30);
      dip.rel[o.id][f.id] = Math.max(dip.rel[o.id][f.id], -30);
      game.log(`The war between ${f.name} and ${o.name} gutters out — an exhausted peace.`, o.isPlayer ? 'good' : '');
    }
  }

  // 2. peacetime initiative: court trade partners and allies, buy off threats,
  //    strangle enemies with embargoes instead of blades
  if (!dip.atWarAny(f.id)) {
    if (prof.trainsPrince) {
      const cands = rivals.filter(o => dip.status(f.id, o.id) === STATUS.NEUTRAL
        && !dip.embargoed(f.id, o.id) && !dip.embargoed(o.id, f.id)
        && dip.relation(f.id, o.id) > -5
        && dip.findMarket(f.id) && f.brain.perception.hasMarket(o.id));
      if (cands.length) {
        const best = cands.reduce((a, b) => (dip.relation(f.id, a.id) > dip.relation(f.id, b.id) ? a : b));
        dip.propose(f.id, best.id, 'trade');   // real envoy; silently skipped if none idle
      }
      const allyRel = ai.doctrine === 'hegemon' ? 35 : 55;
      const ally = rivals.find(o => dip.status(f.id, o.id) === STATUS.TRADE && dip.relation(f.id, o.id) > allyRel);
      if (ally) dip.propose(f.id, ally.id, 'alliance');
    }
    // gift a looming stronger neighbor to stay off their list
    if (n.res.gold > 200) {
      const threat = rivals.find(o => f.brain.perception.threatStrength(o.id) > f.strength() * 1.3
        && dip.status(f.id, o.id) === STATUS.NEUTRAL && dip.relation(f.id, o.id) < 20);
      if (threat) dip.sendGift(f.id, threat.id, 60);
    }
    // merchants and diplomats punish hated rivals — and runaway powers — economically
    if ((ai.doctrine === 'hegemon' || ai.doctrine === 'merchant') && game.rng() < 0.4) {
      const snow = aiSnowballLeader(f);
      const target = rivals.find(o => dip.status(f.id, o.id) !== STATUS.ALLIANCE
        && !dip.embargoed(f.id, o.id)
        && (dip.relation(f.id, o.id) < -35 || o.id === snow));
      if (target) dip.declareEmbargo(f.id, target.id);
    }
  }

  // 3. rally the player against a runaway power we're already fighting
  const snowNow = aiSnowballLeader(f);
  if (snowNow >= 0 && snowNow !== f.id && snowNow !== 0
      && dip.status(f.id, snowNow) === STATUS.WAR && dip.status(0, snowNow) !== STATUS.WAR
      && !game.factions[0].eliminated) {
    aiInviteCoalition(f, snowNow);
  }

  // 4. new wars — gated on a sustained, observed advantage (js/ai-combat.js)
  f.brain.combat.considerWar(rivals);
}

// The strongest nation becomes a "snowball leader" once it towers over the
// runner-up in strength AND holds nearly half the claimed land. Coalitions
// (paced difficulties only) then form against it.
//
// Land claims are public — the borders are drawn on everyone's map — but army
// size is not, so an observing nation judges strength through its own
// perception. Different nations can therefore disagree about who is running
// away with the game, which is exactly right.
function aiSnowballLeader(observer = null) {
  if (!game.diff.coalitions || !game.territory) return -1;
  const alive = game.factions.filter(o => !o.eliminated);
  if (alive.length < 3) return -1;
  const per = observer && observer.brain ? observer.brain.perception : null;
  const strengthOf = o => (per && o.id !== observer.id
    ? per.estimatedStrength(o.id).value : o.strength());
  const sorted = [...alive].sort((a, b) => strengthOf(b) - strengthOf(a));
  const top = sorted[0], second = sorted[1];
  const total = game.territory.claimCount.reduce(
    (s, c, fid) => (game.factions[fid].eliminated ? s : s + c), 0);
  if (total > 0 && strengthOf(top) > strengthOf(second) * 1.7
      && game.territory.claimCount[top.id] > total * 0.45) return top.id;
  return -1;
}

function aiInviteCoalition(f, leaderFid) {
  const leader = game.factions[leaderFid];
  const pushed = pushPlayerEvent({
    kind: 'coalition', from: f.id,
    title: `${f.name} calls for a coalition`,
    body: `${leader.name} towers over the continent, and ${f.name} bleeds holding them back. They beg you to join the war before ${leader.name} swallows everyone — you included.`,
    options: [
      { label: `Join the war on ${leader.name}`, cls: 'bad', apply: () => {
          game.diplomacy.declareWar(0, leaderFid);
          game.diplomacy.addRel(0, f.id, 15);
        } },
      { label: 'Send 50 gold in aid', cls: '', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < 50) return game.log('Your treasury cannot spare the aid.', 'bad');
          n.res.gold -= 50;
          f.nation.res.gold += 50;
          game.diplomacy.addRel(0, f.id, 8);
          game.log(`Your gold shores up ${f.name}'s war effort.`, 'good');
        } },
      { label: 'Stay out of it', cls: '', apply: () => {
          game.diplomacy.addRel(0, f.id, -3);
        } },
    ],
    onExpire: () => game.diplomacy.addRel(0, f.id, -3),
  });
  if (pushed) game.log(`${f.name} pleads for allies against ${leader.name}.`, 'bad');
}

// aiConsiderWar moved to AICombatManager.considerWar (js/ai-combat.js). The old
// version compared f.strength() against a rival's LIVE strength, which is zero
// for everyone at game start — so the first nation to finish one swordsman
// found an "advantage" over three empty armies and declared war immediately,
// every single match. The replacement needs a real army of its own, an estimate
// drawn from what it has actually seen, and an edge that survives 30 seconds.

// Wars against the player on telegraphed difficulties open with an ultimatum
// card: pay up, haggle, or refuse and face a declared war 60 seconds later.
function aiSendUltimatum(f) {
  const ai = f.ai;
  const tribute = 80;
  const pushed = pushPlayerEvent({
    kind: 'ultimatum', from: f.id,
    title: `Ultimatum from ${f.name}`,
    body: `${f.name} masses its army and demands ${tribute} gold in tribute — or face war.`,
    options: [
      { label: `Pay ${tribute} gold`, cls: '', apply: () => {
          const pn = game.factions[0].nation;
          if (pn.res.gold < tribute) {
            game.log('Your treasury cannot cover the tribute!', 'bad');
            return aiUltimatumRefused(f);
          }
          pn.res.gold -= tribute;
          f.nation.res.gold += tribute;
          game.diplomacy.addRel(f.id, 0, 8);
          ai.consolidationUntil = Math.max(ai.consolidationUntil, game.time + 180);
          game.log(`Tribute paid. ${f.name}'s army stands down — for now.`);
        } },
      { label: 'Counter-offer 40', cls: '', apply: () => {
          const pn = game.factions[0].nation;
          const odds = (game.diplomacy.relation(0, f.id) + 100) / 200;   // warmer relations, better odds
          if (pn.res.gold >= 40 && Math.random() < odds + 0.2) {
            pn.res.gold -= 40;
            f.nation.res.gold += 40;
            ai.consolidationUntil = Math.max(ai.consolidationUntil, game.time + 120);
            game.log(`${f.name} grumbles, but accepts your lesser tribute.`);
          } else {
            game.log(`${f.name} scorns your counter-offer!`, 'bad');
            aiUltimatumRefused(f);
          }
        } },
      { label: 'Refuse', cls: 'bad', apply: () => aiUltimatumRefused(f) },
    ],
    onExpire: () => aiUltimatumRefused(f),
  });
  if (pushed) game.log(`${f.name} has issued an ULTIMATUM!`, 'bad');
}

function aiUltimatumRefused(f) {
  f.ai.warAt = game.time + 60;
  game.log(`${f.name} begins final preparations for war…`, 'bad');
}

function aiOfferPeaceToPlayer(f) {
  if (game.time < (f.ai.peaceOfferAt || 0)) return;   // don't beg every card cycle
  f.ai.peaceOfferAt = game.time + 120;
  const pushed = pushPlayerEvent({
    kind: 'peace', from: f.id,
    title: `Peace offer from ${f.name}`,
    body: `${f.name} is weary of war and offers peace, with 100 gold in reparations.`,
    options: [
      { label: 'Accept peace', cls: 'good', apply: () => {
          const dip = game.diplomacy;
          if (dip.status(0, f.id) !== STATUS.WAR) return;
          const pay = Math.min(100, f.nation.res.gold);
          f.nation.res.gold -= pay;
          game.factions[0].nation.res.gold += pay;
          dip.setStatus(0, f.id, STATUS.NEUTRAL);
          dip.rel[0][f.id] = Math.max(dip.rel[0][f.id], -20);
          dip.rel[f.id][0] = Math.max(dip.rel[f.id][0], -20);
          game.log(`Peace with ${f.name} — ${Math.round(pay)} gold in reparations paid to you.`, 'good');
        } },
      { label: 'Fight on', cls: 'bad', apply: () => {
          game.log(`You reject ${f.name}'s plea. The war continues.`, 'bad');
        } },
    ],
    onExpire: null,   // war simply continues
  });
  if (pushed) game.log(`${f.name} sues for peace.`, 'good');
}

// ---------- war waves ----------
// Two-stage attacks replace the old "dump 70% at their townhall" behavior:
// the army first MASSES at a staging point near the border (the player-visible
// telegraph), holds, then assaults doctrine-picked objectives.

function aiWarTick(f, enemies) {
  const ai = f.ai, prof = aiArchetype(f);
  if (ai.wave) return aiTickWave(f);
  if (prof.waveFraction <= 0) return;   // defensive doctrines hold their ground
  const army = f.armyUnits();
  if (army.length < 6) return;
  const per = f.brain.perception;
  // We can only march on somewhere we know about. Raiders go for the richest
  // remembered hoard, everyone else for whoever we believe is weakest.
  const reachable = enemies.filter(o => per.knownTownhall(o.id));
  if (!reachable.length) return;                        // nothing scouted yet — go look
  let target = reachable.reduce((a, b) =>
    (per.threatStrength(a.id) < per.threatStrength(b.id) ? a : b));
  if (prof.plunderGoal) {
    target = reachable.reduce((a, b) =>
      (per.estimatedLoot(a.id) > per.estimatedLoot(b.id) ? a : b));
  }
  // outmatched by what we believe is over there: defend, don't suicide
  if (f.strength() < per.threatStrength(target.id) * 0.9) return;
  const th = per.knownTownhall(target.id), myTh = f.townhall();
  if (!th || !myTh) return;
  // water in the way? engineer a bridge first, march later
  const reach = aiReachInfo(f, target);
  if (!reach.reachable) {
    if (reach.crossing && !ai.bridgePlan) ai.bridgePlan = { tiles: reach.crossing, i: 0 };
    return;
  }
  const waveUnits = army.slice(0, Math.max(4, Math.floor(army.length * prof.waveFraction)));
  const dx = myTh.cx - th.x, dy = myTh.cy - th.y;
  const d = Math.hypot(dx, dy) || 1;
  const sx = clamp(Math.round(th.x + dx / d * 10), 1, MAP_W - 2);
  const sy = clamp(Math.round(th.y + dy / d * 10), 1, MAP_H - 2);
  ai.wave = { units: waveUnits, size: waveUnits.length, state: 'staging',
    stagePos: [sx, sy], stageUntil: game.time + 20, targetFid: target.id,
    objective: null, deadline: game.time + 300 };
  formationMove(waveUnits, sx, sy);
}

function aiTickWave(f) {
  const w = f.ai.wave;
  w.units = w.units.filter(u => u.alive);
  const target = game.factions[w.targetFid];
  if (w.units.length < Math.max(2, w.size * 0.3) || target.eliminated
      || game.diplomacy.status(f.id, w.targetFid) !== 'war'
      || game.time > w.deadline) {   // stuck campaigns go home instead of milling forever
    return aiDisbandWave(f);
  }
  if (w.state === 'staging') {
    if (game.time < w.stageUntil) return;
    w.state = 'assault';
    w.objective = aiPickAssaultTarget(f, target);
    if (!w.objective) return aiDisbandWave(f);
    for (const u of w.units) u.orderAttack(w.objective);
  } else if (!w.objective || w.objective.hp <= 0) {
    w.objective = aiPickAssaultTarget(f, target);
    if (!w.objective) return aiDisbandWave(f);
    for (const u of w.units) if (!u.target || targetDead(u.target)) u.orderAttack(w.objective);
  }
}

// Objective priority: loot-rich storehouses, then the castle, then the kill
// move on the townhall — which conquerors take straight away once the defender
// is broken.
function aiPickAssaultTarget(f, target) {
  const prof = aiArchetype(f), per = f.brain.perception;
  // resolve a remembered position to the building actually standing there;
  // acting on stale intel means sometimes finding rubble
  const live = mem => {
    const b = game.map.buildingAt[game.map.idx(mem.x, mem.y)];
    return b && b.faction === target.id && b.hp > 0 ? b : null;
  };
  if (prof.warRatio !== Infinity && per.threatStrength(target.id) < f.strength() * 0.4) {
    const known = per.knownTownhall(target.id);
    const th = known && live(known);
    if (th) return th;
  }
  let best = null, bv = 20;
  for (const mem of per.knownBuildings(target.id)) {
    if (mem.key === 'townhall') continue;
    const b = live(mem);
    if (!b || !b.done || !b.type.storage) continue;
    const s = per.rememberedStore(target.id, mem);
    const v = s ? s.food + s.wood + s.stone + s.gold : 0;
    if (v > bv) { bv = v; best = b; }
  }
  if (best) return best;
  for (const mem of per.knownBuildings(target.id, 'castle')) {
    const b = live(mem);
    if (b) return b;
  }
  const known = per.knownTownhall(target.id);
  return (known && live(known)) || null;
}

function aiDisbandWave(f) {
  const w = f.ai.wave;
  f.ai.wave = null;
  if (!w) return;
  const th = f.townhall();
  const survivors = w.units.filter(u => u.alive);
  for (const u of survivors) u.target = null;
  if (th && survivors.length) formationMove(survivors, Math.floor(th.cx), Math.floor(th.cy));
}

// ---------- expansion ----------
// Nations spread out to find resources. A satellite is founded when the ground
// at home stops providing — a forest worked out, no rock in reach, no cave for
// a mine — and it is a real settlement: the extraction building that fixes the
// shortage, a storehouse to hold the output, and housing for the workers.
//
// Siting only ever considers ground the nation has SEEN (ScoutMemoryMap), so
// expansion is a reason to scout rather than a reason to read the map.

// Which building pulls a given resource out of the ground.
const EXTRACTOR_FOR = { wood: 'lumber', stone: 'quarry', gold: 'mine', food: 'farm' };
const SATELLITE_RADIUS = 9;      // how far from the anchor a satellite may sprawl
const SATELLITE_PLAN = ['storehouse', 'house'];

// How much of `r` the ground around (x, y) can still yield. Depleted forests
// score zero — that is the whole point of moving.
function aiGroundRichness(x, y, r) {
  const map = game.map;
  let rich = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const tt = map.t(tx, ty);
      if (tt === T_CAVE) rich += r === 'gold' ? 12 : 3;
      else if (tt === T_ROCK) rich += r === 'stone' ? 4 : 1;
      else if (tt === T_TREE && map.treeWood[map.idx(tx, ty)] > 0) rich += r === 'wood' ? 4 : 1;
      else if (tt === T_WATER && r === 'food') rich += 1.5;
    }
  }
  return rich;
}

// Buildings of `key` this nation already has within reach of an anchor.
function aiCountNearSite(f, site, key) {
  let n = 0;
  for (const b of f.buildings) {
    if (b.type.key !== key) continue;
    if (Math.hypot(b.cx - site.x, b.cy - site.y) <= SATELLITE_RADIUS) n++;
  }
  return n;
}

function aiFindSpotNearSite(f, typeKey, site) {
  for (let r = 1; r <= SATELLITE_RADIUS; r++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = game.rng() * Math.PI * 2;
      const x = Math.round(site.x + Math.cos(a) * r), y = Math.round(site.y + Math.sin(a) * r);
      if (canPlace(game.map, typeKey, x, y, f.id)) return [x, y];
    }
  }
  return null;
}

// Returns true when it actually spent resources this tick, so the utility
// engine can fall through to its next-best investment when it did not.
function aiPlanExpansion(f, shortage = null) {
  const ai = f.ai, prof = aiArchetype(f);
  if (prof.expansionAppetite <= 0.05) return false;
  if (f.nation.pop < 14) return false;                        // grow roots first
  const want = shortage && shortage.resource !== 'gold' ? shortage.resource : null;

  const stale = ai.expansionSite && game.time > ai.expansionPickedAt + 180;
  const dry = ai.expansionSite && want
    && aiGroundRichness(ai.expansionSite.x, ai.expansionSite.y, want) < 4;
  if (!ai.expansionSite || stale || dry) {
    const site = aiPickExpansionSite(f, want);
    if (site) {
      ai.expansionSite = site;
      ai.expansionPickedAt = game.time;
      ai.expansionBuilt = 0;
    }
  }
  if (!ai.expansionSite) return false;
  return aiDevelopSatellite(f, ai.expansionSite, want);
}

function aiPickExpansionSite(f, want) {
  const prof = aiArchetype(f), th = f.townhall();
  if (!th) return null;
  const t = game.territory, mem = f.brain.perception.memory, map = game.map;
  let best = null, bestScore = 2;
  for (let tries = 0; tries < 70; tries++) {
    const x = 2 + Math.floor(game.rng() * (MAP_W - 4));
    const y = 2 + Math.floor(game.rng() * (MAP_H - 4));
    if (!mem.isExplored(x, y)) continue;                      // we have never been there
    if (map.terrain[map.idx(x, y)] !== T_GRASS) continue;
    const owner = t ? t.ownerAt(x, y) : -1;
    if (owner === f.id) continue;                             // already ours
    if (owner >= 0 && game.diplomacy.allied(f.id, owner)) continue;   // don't crowd allies
    const dist = Math.hypot(x - th.cx, y - th.cy);
    if (dist < 10 || dist > 45) continue;
    // ground is scored for what we came looking for, with a general-purpose
    // richness term so nations without a specific shortage still spread sensibly
    let score = aiGroundRichness(x, y, want) * (want ? 1 : 0.7)
      - Math.abs(dist - 20) * 0.15;
    // the bold covet contested frontiers; the cautious keep their distance
    if (owner >= 0) score += prof.expansionAppetite > 0.5 ? 3 : -4 - f.personality.caution * 4;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

// Raise one building per call, cheapest-first through the settlement plan.
function aiDevelopSatellite(f, site, want) {
  const n = f.nation;
  const order = [];
  if (want && EXTRACTOR_FOR[want]) order.push(EXTRACTOR_FOR[want]);
  order.push(...SATELLITE_PLAN);
  for (const key of order) {
    const type = BUILDING_TYPES[key];
    if (!type || !n.canAfford(type.cost)) continue;
    if (!f.brain.utility.respectsWoodFloor(key)) continue;
    const cap = key === 'house' ? 2 : 1;
    if (aiCountNearSite(f, site, key) >= cap) continue;
    const spot = aiFindSpotNearSite(f, key, site);
    if (!spot) continue;
    n.pay(type.cost);
    placeBuilding(game, key, spot[0], spot[1], f.id);
    f.ai.expansionBuilt = (f.ai.expansionBuilt || 0) + 1;
    if (f.ai.expansionBuilt === 1) {
      game.log(`Settlers from ${f.name} are breaking ground on new land.`);
    }
    return true;
  }
  return false;
}

// ---------- turtle wall rings ----------
// Isolationists wall their settlement in, one affordable segment per tick,
// leaving a gate toward the map's heart and one near their market.

function aiPlanWalls(f) {
  const prof = aiArchetype(f);
  if (!prof.wallRing) return;
  // fortify nothing until there is a garrison to hold it — a turtle that spends
  // its stone on a wall ring before building a Castle can never train a soldier
  if (!f.buildings.some(b => b.type.key === 'castle' && b.done && b.hp > 0)) return;
  const n = f.nation;
  if (!n.canAfford(BUILDING_TYPES.gate.cost)) return;   // afford the priciest piece
  // core bounding box; freeze the ring so it stays coherent, expanding only
  // when the town outgrows it
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, core = 0;
  for (const b of f.buildings) {
    if (!b.done || ['wall', 'gate', 'bridge'].includes(b.type.key)) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.type.size - 1); y1 = Math.max(y1, b.y + b.type.size - 1);
    core++;
  }
  if (core < 5) return;                                 // wall up once there's a town
  const want = { x0: Math.max(1, x0 - 2), y0: Math.max(1, y0 - 2),
    x1: Math.min(MAP_W - 2, x1 + 2), y1: Math.min(MAP_H - 2, y1 + 2) };
  if (!f.ai.wallBox || want.x0 < f.ai.wallBox.x0 || want.y0 < f.ai.wallBox.y0
      || want.x1 > f.ai.wallBox.x1 || want.y1 > f.ai.wallBox.y1) {
    f.ai.wallBox = want;
    f.ai.wallSkip = new Set();   // re-test reachability against the new ring
  }
  const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = f.ai.wallBox;
  const per = [];
  for (let x = bx0; x <= bx1; x++) { per.push([x, by0]); per.push([x, by1]); }
  for (let y = by0 + 1; y < by1; y++) { per.push([bx0, y]); per.push([bx1, y]); }
  const onRing = b => b.x === bx0 || b.x === bx1 ? (b.y >= by0 && b.y <= by1)
    : (b.y === by0 || b.y === by1) && b.x >= bx0 && b.x <= bx1;
  // GATES FIRST — a ring is never sealed without a way out: one gate toward
  // the map's heart, one by the market for caravans
  const market = f.buildings.find(b => b.type.key === 'market' && b.done);
  const targets = [[MAP_W / 2, MAP_H / 2]];
  if (market) targets.push([market.cx, market.cy]);
  const gatesOnRing = f.buildings.filter(b => b.type.key === 'gate' && onRing(b)).length;
  if (gatesOnRing < targets.length) {
    const cand = per.filter(([x, y]) => canPlace(game.map, 'gate', x, y, f.id));
    if (!cand.length) return;                           // can't take a gate: no walls either
    const [tx, ty] = targets[gatesOnRing];
    cand.sort((p, q) => Math.hypot(p[0] - tx, p[1] - ty) - Math.hypot(q[0] - tx, q[1] - ty));
    const spot = cand.find(([x, y]) => aiRingTileConnected(f, x, y));
    if (!spot) return;
    n.pay(BUILDING_TYPES.gate.cost);
    placeBuilding(game, 'gate', spot[0], spot[1], f.id);
    return;
  }
  for (const [x, y] of per) {
    if (!canPlace(game.map, 'wall', x, y, f.id)) continue;   // occupied or natural barrier
    if (!aiRingTileConnected(f, x, y)) continue;             // e.g. across a channel
    n.pay(BUILDING_TYPES.wall.cost);
    placeBuilding(game, 'wall', x, y, f.id);
    return;                                             // one segment per tick
  }
}

// A ring tile only counts if it's path-connected to the town — water can put
// perimeter tiles on a different shore entirely, and walls there are wasted
// stone (or worse, someone else's shore). Failed tiles are cached per ring.
function aiRingTileConnected(f, x, y) {
  const key = x + ',' + y;
  if (f.ai.wallSkip && f.ai.wallSkip.has(key)) return false;
  const th = f.townhall();
  if (!th) return false;
  const [sx, sy] = f.spawnPointNear(th);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ax = x + dx, ay = y + dy;
    if (!game.map.inBounds(ax, ay) || !game.map.passable(ax, ay, f.id)) continue;
    const p = findPath(game.map, sx, sy, ax, ay, f.id, 3000);
    const end = p.length ? p[p.length - 1] : null;
    if (end && end[0] === ax && end[1] === ay) return true;
  }
  if (!f.ai.wallSkip) f.ai.wallSkip = new Set();
  f.ai.wallSkip.add(key);
  return false;
}

// ---------- military engineering ----------
// Seeded maps can leave nations separated by water. AI factions survey the
// route to a war target and, when blocked, span the water with bridges —
// paid for tile by tile, and a loud hint to anyone watching the map.

function aiReachInfo(f, o) {
  const a = f.townhall(), b = o.townhall();
  if (!a || !b) return { reachable: false, crossing: null };
  const bx = Math.floor(b.cx), by = Math.floor(b.cy);
  const path = findPath(game.map, Math.floor(a.cx), Math.floor(a.cy), bx, by, f.id, 12000);
  const end = path.length ? path[path.length - 1] : [Math.floor(a.cx), Math.floor(a.cy)];
  if (Math.abs(end[0] - bx) + Math.abs(end[1] - by) <= 4) return { reachable: true, crossing: null };
  return { reachable: false, crossing: aiFindCrossing(end, [bx, by]) };
}

// Bridges run straight and never bend or meet at a junction (see canPlace),
// so the only legal crossing shape is a single-axis run. Sweep rows near the
// shore looking for a horizontal span first, then columns for a vertical one,
// and keep whichever candidate sits closest to the reachable shore point.
function aiFindCrossing(from, to) {
  return straightCrossingSearch(1, from, to) || straightCrossingSearch(2, from, to);
}

function straightCrossingSearch(orient, from, to) {
  const maxWidth = 16, band = 20;
  const fp = orient === 1 ? from[1] : from[0];        // shore's row/column
  const fs = orient === 1 ? from[0] : from[1];
  const secLo = Math.min(from[orient === 1 ? 0 : 1], to[orient === 1 ? 0 : 1]) - 2;
  const secHi = Math.max(from[orient === 1 ? 0 : 1], to[orient === 1 ? 0 : 1]) + 2;
  let best = null;
  for (let p = fp - band; p <= fp + band; p++) {
    let runStart = -1;
    for (let s = secLo; s <= secHi + 1; s++) {
      const [x, y] = orient === 1 ? [s, p] : [p, s];
      const inWater = game.map.inBounds(x, y) && game.map.terrain[game.map.idx(x, y)] === T_WATER
        && !game.map.bridge[game.map.idx(x, y)];
      if (inWater) { if (runStart < 0) runStart = s; continue; }
      if (runStart >= 0) {
        const runEnd = s - 1, width = runEnd - runStart + 1;
        if (width > 0 && width <= maxWidth) {
          const [lx, ly] = orient === 1 ? [runStart - 1, p] : [p, runStart - 1];
          const [rx, ry] = orient === 1 ? [runEnd + 1, p] : [p, runEnd + 1];
          const leftOpen = game.map.inBounds(lx, ly) && game.map.terrain[game.map.idx(lx, ly)] !== T_WATER;
          const rightOpen = game.map.inBounds(rx, ry) && game.map.terrain[game.map.idx(rx, ry)] !== T_WATER;
          if (leftOpen && rightOpen) {
            const dist = Math.abs(p - fp) + Math.min(Math.abs(runStart - fs), Math.abs(runEnd - fs));
            if (!best || dist < best.dist) {
              const tiles = [];
              for (let k = runStart; k <= runEnd; k++) tiles.push(orient === 1 ? [k, p, orient] : [p, k, orient]);
              best = { dist, tiles };
            }
          }
        }
        runStart = -1;
      }
    }
  }
  return best ? best.tiles : null;
}

// Lay one affordable bridge segment per AI tick from the surveyed plan.
function aiBuildBridges(f) {
  const bp = f.ai.bridgePlan;
  if (!bp) return;
  if (bp.i >= bp.tiles.length) { f.ai.bridgePlan = null; return; }
  const [x, y, orient] = bp.tiles[bp.i];
  const i = game.map.idx(x, y);
  if (game.map.bridge[i] || game.map.terrain[i] !== T_WATER
      || !canPlace(game.map, 'bridge', x, y, f.id, orient)) { bp.i++; return; }
  if (!f.nation.canAfford(BUILDING_TYPES.bridge.cost)) return;   // wait for wood
  f.nation.pay(BUILDING_TYPES.bridge.cost);
  placeBuilding(game, 'bridge', x, y, f.id, orient);
  bp.i++;
  if (bp.i >= bp.tiles.length) {
    f.ai.bridgePlan = null;
    game.log(`${f.name} has bridged the water — a road across now lies open.`, 'bad');
  }
}
