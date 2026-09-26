'use strict';
// Scouting, army sizing, home defense, and the decision to declare war.
//
// The war gate is the reason this file exists. The old brain compared
// f.strength() against a rival's live strength, which is zero for everyone at
// game start — so the first nation to finish a single swordsman "found an
// advantage" over three empty armies and declared war on the spot, every match.
// Here an advantage has to be (a) over a real army of our own, (b) measured
// against what we have actually SEEN, with unknowns treated as dangerous,
// (c) motivated by something, and (d) still true thirty seconds later.

const AI_PEACE_WINDOW = 150;   // seconds before any AI will open hostilities
const WAR_RESOLVE_TIME = 30;   // an advantage must hold this long before war
const SCOUT_LEGS = 4;          // waypoints a scout visits before riding home
const SCOUT_RANGE = 34;        // furthest a rider is sent in one leg (paths must exist)
const HOME_DEFENSE_RADIUS = 18;
const RESPONSE_MARGIN = 1.5;   // send this much more than we can see coming
const RESPONSE_TIME = 75;      // seconds a response force stays on the hunt

class AICombatManager {
  constructor(faction) {
    this.faction = faction;
    this.scouts = [];             // units currently on a scout mission
    this.scoutAt = -999;
    this.advantageSince = {};     // fid -> game.time the odds first looked good
    this.responders = [];         // soldiers sent to meet an incursion
  }

  // ---------- scouting ----------

  tickScouting() {
    const f = this.faction, arch = aiArchetype(f);
    this.scouts = this.scouts.filter(u => u.alive && u.mission && u.mission.kind === 'scout');
    for (const u of this.scouts) this.advanceScout(u);
    // Finding a neighbour for the first time outranks every scouting schedule:
    // a nation that has never met someone is guessing about them from the
    // prior, and the prior is deliberately pessimistic.
    const unknown = game.factions.some(o => o.id !== f.id && !o.eliminated && !p_everSeen(f, o.id));
    if (this.scouts.length >= (unknown ? arch.scoutBudget + 1 : arch.scoutBudget)) return;
    if (game.time - this.scoutAt < (unknown ? 10 : arch.scoutInterval)) return;
    this.dispatchScout();
  }

  advanceScout(u) {
    if (u.path.length > 0) return;                    // still riding
    const m = u.mission;
    m.legs = (m.legs || 0) + 1;
    if (m.legs >= SCOUT_LEGS) return this.retireScout(u);
    if (!this.orderScoutTo(u)) this.retireScout(u);
  }

  // Legs chain: each one is measured from where the rider currently stands, not
  // from home, so a sortie walks steadily outward instead of orbiting the
  // capital at a fixed radius. Rival capitals sit further away than any single
  // reachable leg, and this is how a scout eventually reaches one.
  scoutOrigin(u) {
    return u ? { cx: u.x, cy: u.y } : this.faction.townhall();
  }

  // Send a scout somewhere it can actually get to. orderMove sets `dest` even
  // when findPath finds no route at all, and `dest` is only cleared by arriving
  // — so a rider handed an unreachable target across water would sit still
  // forever, holding a scout slot and blinding the nation permanently.
  orderScoutTo(u) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const t = this.scoutTarget(this.scoutOrigin(u));
      if (!t) break;
      u.dest = null;
      u.orderMove(t.x, t.y);
      if (u.path.length > 0) return true;
    }
    u.dest = null;
    return false;
  }

  retireScout(u) {
    u.mission = null;
    u.aggressive = true;
    const th = this.faction.townhall();
    if (th) u.orderMove(Math.floor(th.cx), Math.floor(th.cy));
    this.scouts = this.scouts.filter(s => s !== u);
  }

  // Send a real rider out. Scouts carry a mission, so armyUnits() excludes them
  // and they will not stop to pick fights (js/units.js auto-acquire skips
  // mission units) — they ride, they look, they come home, and they can be
  // killed on the way, which costs the nation its intelligence.
  dispatchScout() {
    const f = this.faction;
    const atWar = game.diplomacy.atWarAny(f.id);
    const army = f.armyUnits();
    if (atWar && army.length <= WAR_MIN_ARMY) return;     // can't spare anyone
    // fastest body not currently in a fight; riders make the best scouts
    const pool = army.filter(u => !u.target);
    if (!pool.length) return;
    pool.sort((a, b) => b.type.speed - a.type.speed);
    const scout = pool[0];
    scout.mission = { kind: 'scout', legs: 0 };
    scout.aggressive = false;
    if (!this.orderScoutTo(scout)) { scout.mission = null; scout.aggressive = true; return; }
    this.scouts.push(scout);
    this.scoutAt = game.time;
  }

  // Where is it worth looking? A rival we have lost track of first, otherwise
  // the nearest ground we have never seen.
  scoutTarget(origin = null) {
    const f = this.faction, p = f.brain.perception, arch = aiArchetype(f);
    const th = origin || f.townhall();
    if (!th) return null;
    let best = null, bestScore = 0;
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) continue;
      const known = p.knownTownhall(o.id);
      if (!known || !p.stale(o.id, arch.staleTolerance)) continue;
      const d = wdist(th.cx, th.cy, known.x, known.y);
      const s = 120 / Math.max(10, d);
      if (s > bestScore) { bestScore = s; best = { x: known.x, y: known.y }; }
    }
    if (best) return best;
    return this.frontierTarget(th);
  }

  // Ride for the edge of the known world, not the nearest gap in it — scouting
  // the doorstep only ever fills in the neighbourhood, and nations meet each
  // other by pushing outward. But "farthest unexplored tile" is usually the far
  // corner of the map across open water: findPath returns nothing, the rider
  // gives up, and the nation stays blind. So candidates are drawn from a band
  // that reaches past our own territory without leaping the whole continent,
  // and each ride widens the explored area for the next one to start from.
  frontierTarget(th) {
    const f = this.faction, mem = f.brain.perception.memory;
    let best = null, bestScore = 0;
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(game.rng() * MAP_W), y = Math.floor(game.rng() * MAP_H);
      if (mem.isExplored(x, y)) continue;
      if (!game.map.passable(x, y, f.id)) continue;
      const d = wdist(th.cx, th.cy, x, y);
      if (d < 8 || d > SCOUT_RANGE) continue;
      if (d > bestScore) { bestScore = d; best = { x, y }; }
    }
    return best;
  }

  // ---------- army ----------

  trainTroops() {
    const f = this.faction, arch = aiArchetype(f), n = f.nation;
    const castle = f.buildings.find(b => b.type.key === 'castle' && b.done && b.hp > 0);
    if (!castle || castle.trainQueue.length >= 2) return;
    const want = f.brain.utility.armyTarget();
    if (f.armyUnits().length < want && n.total('food') > 60) {
      const pool = aiTroopPool(f).filter(k => UNIT_TYPES[k].tier <= f.castleTier
        && (!UNIT_TYPES[k].tech || hasTech(f, UNIT_TYPES[k].tech)));
      if (pool.length) f.trainUnit(pool[Math.floor(game.rng() * pool.length)]);
      return;
    }
    if (arch.trainsPrince && !f.units.some(u => u.alive && u.type.envoy)
        && !castle.trainQueue.some(q => q.unitKey === 'prince') && n.total('gold') > 60) {
      f.trainUnit('prince');
      return;
    }
    const atWar = game.diplomacy.atWarAny(f.id);
    const banditWant = arch.bandits || (atWar && f.personality.aggression >= 0.4 ? 2 : 0);
    if (banditWant && n.total('food') > 40) {
      const bandits = f.units.filter(u => u.alive && u.type.robber).length;
      if (bandits < banditWant && game.rng() < 0.5) f.trainUnit('bandit');
    }
  }

  // ---------- war ----------

  tickWar() {
    const f = this.faction;
    const enemies = game.factions.filter(o =>
      !o.eliminated && game.diplomacy.status(f.id, o.id) === STATUS.WAR);
    this.trackAdvantage();
    this.tickRaiders(enemies);
    this.respondToIncursions();
    if (enemies.length) {
      // Home first. A wave that marches on while the capital burns is the
      // "no reactive defense" gap the old brain had.
      const threat = this.visibleThreatNearHome();
      if (threat > f.strength() * 0.3 && f.ai.wave) {
        aiDisbandWave(f);
        game.log(`${f.name}'s army turns back to defend its heartland.`, '');
      } else {
        aiWarTick(f, enemies);
      }
    } else if (f.ai.wave) {
      aiDisbandWave(f);
    } else {
      this.rallyHome();
    }
  }

  // Enemy soldiers we can currently SEE near our own capital.
  visibleThreatNearHome() {
    const f = this.faction, p = f.brain.perception, th = f.townhall();
    if (!th) return 0;
    let v = 0;
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated || !game.diplomacy.hostile(f.id, o.id)) continue;
      for (const u of o.units) {
        if (!u.alive || u.type.civilian) continue;   // their villagers are not an assault
        if (wdist(u.x, u.y, th.cx, th.cy) > HOME_DEFENSE_RADIUS) continue;
        if (!p.visible(u.x, u.y)) continue;
        v += u.type.dmg * 2 + u.hp * 0.1;
      }
    }
    return v;
  }

  // Enemy soldiers we can SEE standing on our own land get a response: the
  // nearest soldiers not already committed to a wave or a landing, about half
  // as strong again as what is coming, attack-moving on it. Before this the
  // only reaction was to call off a wave when the capital itself was
  // threatened — an army stood in the capital while a landing party burned
  // sixty outlying buildings one at a time, and a whole 90-minute war cost
  // seventeen soldiers' lives.
  respondToIncursions() {
    const f = this.faction, p = f.brain.perception, t = game.territory;
    const th = f.townhall();
    if (!t || !th) return;
    const worth = u => u.type.dmg * 2 + u.hp * 0.1;
    // a finished hunt walks home rather than standing about in a field
    for (const u of this.responders) {
      if (u.alive && game.time > u.respondUntil && !u.target) {
        u.respondUntil = 0;
        u.orderMove(Math.floor(th.cx) + (game.rng() * 6 - 3 | 0), Math.floor(th.cy) + (game.rng() * 6 - 3 | 0));
      }
    }
    this.responders = this.responders.filter(u => u.alive && u.respondUntil > game.time);
    const seen = [];
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated || !game.diplomacy.hostile(f.id, o.id)) continue;
      for (const u of o.units) {
        if (!u.alive || u.aboard || u.type.civilian || u.type.envoy || u.type.naval) continue;
        if (t.ownerAt(u.tileX, u.tileY) !== f.id) continue;
        if (!p.visible(u.x, u.y)) continue;
        seen.push(u);
        if (seen.length >= 40) break;
      }
    }
    if (!seen.length) return;
    // answer the biggest knot of them
    let focus = null, fv = 0;
    for (const a of seen) {
      let v = 0;
      for (const b of seen) if (wdist(a.x, a.y, b.x, b.y) < 8) v += worth(b);
      if (v > fv) { fv = v; focus = a; }
    }
    const fx = focus.tileX, fy = focus.tileY;
    const where = game.map.continentAt(fx, fy);
    let sent = 0;
    for (const r of this.responders) {
      if (wdist(r.respond[0], r.respond[1], fx, fy) < 12) sent += worth(r);
    }
    if (sent >= fv * RESPONSE_MARGIN) return;
    const busy = new Set([...(f.ai.wave ? f.ai.wave.units : []), ...(f.ai.invasion ? f.ai.invasion.units : [])]);
    const pool = f.armyUnits().filter(u => u.alive && !u.aboard && !u.type.naval && !u.routing
      && !u.mission && !u.type.robber && !u.type.unique && !busy.has(u) && !this.responders.includes(u)
      && game.map.continentAt(u.tileX, u.tileY) === where)
      .sort((a, b) => wdist2(a.x, a.y, fx, fy) - wdist2(b.x, b.y, fx, fy));
    for (const u of pool) {
      if (sent >= fv * RESPONSE_MARGIN) break;
      u.orderMove(fx, fy);
      u.order = { kind: 'attackmove', x: fx, y: fy };
      u.respond = [fx, fy];
      u.respondUntil = game.time + RESPONSE_TIME;
      this.responders.push(u);
      sent += worth(u);
    }
  }

  rallyHome() {
    const f = this.faction, th = f.townhall();
    if (!th) return;
    for (const u of f.armyUnits()) {
      if (u.target || u.path.length > 0) continue;
      if (wdist(u.x, u.y, th.cx, th.cy) <= 8) continue;
      u.orderMove(Math.floor(th.cx) + (game.rng() * 6 - 3 | 0),
        Math.floor(th.cy) + (game.rng() * 6 - 3 | 0));
    }
  }

  // Send bandits at the fattest storehouse we can REMEMBER. If it has been
  // razed or moved since we saw it, the raider arrives to find nothing — which
  // is the honest outcome of acting on old intelligence.
  tickRaiders(enemies) {
    const f = this.faction, p = f.brain.perception;
    if (!enemies.length) return;
    for (const bnd of f.units) {
      if (!bnd.alive || !bnd.type.robber || bnd.mission || bnd.carryTotal() > 0) continue;
      let best = null, bv = 15;
      for (const o of enemies) {
        const mem = p.richestKnownStore(o.id);
        if (!mem) continue;
        const live = game.map.buildingAt[game.map.idx(mem.x, mem.y)];
        if (!live || live.faction !== o.id || live.hp <= 0 || !live.type.storage) continue;
        // this raider already found there is no road to it
        if (bnd.robBlocked && bnd.robBlocked.b === live && game.time < bnd.robBlocked.until) continue;
        const s = p.rememberedStore(o.id, mem);
        const v = s ? s.food + s.wood + s.stone + s.gold : 0;
        if (v > bv) { bv = v; best = live; }
      }
      if (best) bnd.orderRob(best);
    }
  }

  // Runs every brain tick: keep a running record of how long each rival has
  // looked beatable. One lucky sample is not an advantage.
  trackAdvantage() {
    const f = this.faction, p = f.brain.perception, arch = aiArchetype(f);
    const s = p.self();
    const ready = s.armySize >= WAR_MIN_ARMY && s.strength >= WAR_MIN_STRENGTH;
    for (const o of game.factions) {
      if (o.id === f.id || o.eliminated) { this.advantageSince[o.id] = 0; continue; }
      if (!ready) { this.advantageSince[o.id] = 0; continue; }
      const pWin = aiWinProbability(s.strength, p.threatStrength(o.id));
      if (pWin >= arch.minWinProb) {
        if (!this.advantageSince[o.id]) this.advantageSince[o.id] = game.time;
      } else {
        this.advantageSince[o.id] = 0;
      }
    }
  }

  advantageHeld(fid) {
    const since = this.advantageSince[fid];
    return since ? game.time - since : 0;
  }

  // Called from aiDiplomacy (js/ai.js) on its own 8-15s cadence.
  considerWar(rivals) {
    const f = this.faction, ai = f.ai, arch = aiArchetype(f), dip = game.diplomacy;
    const p = f.brain.perception;
    const snow = aiSnowballLeader();
    const pacifist = arch.warRatio === Infinity;
    // A nation about to WIN the match is everyone's enemy: past 75% of a
    // victory (as far as the world can tell — js/victory.js), even a peaceful
    // court will go to war to stop it.
    const vt = aiVictoryThreat(f);
    const stopWinner = vt && vt.level >= 0.75 ? vt.fid : -1;
    // peaceful ambitions never initiate — except joining a coalition
    if (pacifist && stopWinner < 0 && !(snow >= 0 && snow !== f.id
        && (ai.doctrine === 'hegemon' || ai.doctrine === 'turtle'))) return;
    // nobody opens a match with a war; harsher difficulties shorten the peace
    if (game.time < AI_PEACE_WINDOW / Math.max(0.5, game.diff.warAppetite)) return;
    if (game.time < ai.consolidationUntil) return;
    if (ai.warAt) return;
    if (f.nation.warWeariness > 8 || dip.atWarAny(f.id)) return;

    const s = p.self();
    if (s.armySize < WAR_MIN_ARMY || s.strength < WAR_MIN_STRENGTH) return;

    const relGate = arch.plunderGoal ? 25 : ai.doctrine === 'aggressor' ? 10 : -10;
    const verdict = f.brain.trade.verdict;
    let best = null, bestScore = 0;
    const court = game.court;
    for (const o of rivals) {
      const st = dip.status(f.id, o.id);
      if (st === STATUS.WAR || st === STATUS.ALLIANCE) continue;
      // a truce holds (js/diplomacy.js) — the AI never breaks one
      if (dip.inTruce(f.id, o.id)) continue;
      // a vassal does not war on its lord (rebellion is its own decision —
      // js/leaders.js considerRebellion), nor a lord on its vassal
      if (court && (court.overlord[f.id] === o.id || court.overlord[o.id] === f.id)) continue;
      // a declared friendship holds unless the relationship has truly soured;
      // an honorable leader will not break it at all short of hatred
      if (court && court.friend[f.id][o.id] > game.time) {
        const L = f.leader;
        const floor = L && L.traits.includes('honorable') ? -60 : L && L.traits.includes('schemer') ? -10 : -30;
        if (dip.relation(f.id, o.id) > floor) continue;
      }
      if (o.isPlayer) {
        if (game.time < game.diff.playerGrace) continue;
        if (game.diff.provokedOnly && ai.provocation < 3) continue;
      }
      const dogpile = o.id === snow || o.id === stopWinner;
      if (pacifist && !dogpile) continue;

      // (a) the odds have to have held, not just flickered
      if (!dogpile && this.advantageHeld(o.id) < WAR_RESOLVE_TIME) continue;
      // (b) we have to trust what we know about them — unless the whole world
      // can see what they are: a runaway power or a nation on the brink of
      // victory is marched on on public knowledge, not on fresh scouting
      if (!dogpile && p.confidence(o.id) < arch.minConfidence) continue;
      // (c) there has to be a reason
      const resourceMotive = verdict && verdict.choice === 'war' && verdict.target === o;
      const grudged = ai.grudge[o.id] >= 5;
      const badBlood = dip.relation(f.id, o.id) <= relGate;
      const opportunist = !pacifist && arch.warBias >= 1;
      if (!(dogpile || resourceMotive || grudged || badBlood || opportunist)) continue;

      const pWin = aiWinProbability(s.strength, p.threatStrength(o.id));
      let score = pWin + ai.grudge[o.id] * 0.02 - dip.relation(f.id, o.id) * 0.005;
      if (resourceMotive) score += 0.8;
      if (dogpile) score += 0.5;
      if (o.id === stopWinner) score += 1.5;
      // a conqueror chasing Domination looks for the next throne to take
      score += aiVictoryPush(f, 'domination') * 0.6;
      if (arch.plunderGoal) score += p.estimatedLoot(o.id) * 0.001;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (!best) return;
    // only now pay for the expensive reachability check. An ocean between us is
    // no longer a veto — it just means the war will be fought from ships
    // (js/naval.js), and only a nation that can actually mount a landing is
    // allowed to declare one.
    const reach = aiReachInfo(f, best);
    if (!reach.reachable && !reach.crossing && !aiCanInvadeBySea(f, best)) return;
    if (best.isPlayer && game.diff.ultimatums) return aiSendUltimatum(f);
    dip.declareWar(f.id, best.id);
  }

  // ---------- engineering (delegates to the existing executors) ----------

  tickEngineering() {
    const f = this.faction;
    aiBuildBridges(f);
    aiPlanWalls(f);
  }
}

// The mix a nation drills, weighted by what it can field and what it faces.
// Duplicates are weights. Newer arms displace older ones as they arrive, and a
// nation that has seen walls on the other side brings siege engines.
function aiTroopPool(f) {
  const pool = ['sword', 'spear', 'archer', 'sword', 'spear', 'halberd', 'cavalier', 'mage'];
  if (hasTech(f, 'iron')) pool.push('shield', 'shield');
  if (hasTech(f, 'crossbows')) pool.push('crossbow', 'crossbow'), pool.splice(pool.indexOf('archer'), 1);
  if (hasTech(f, 'arcana')) pool.push('archmage');
  if (hasTech(f, 'engineering')) {
    const army = f.armyUnits();
    const siege = army.filter(u => u.type.siege).length;
    // one engine per eight soldiers, and only if there is a fortified enemy to
    // use it on — and every capital is a keep now, so any rival whose Town
    // Hall or Castle we have seen counts
    const walls = game.factions.some(o => o !== f && !o.eliminated
      && f.brain.perception.knownBuildings(o.id).some(m => ['wall', 'watchtower', 'gate', 'townhall', 'castle'].includes(m.key)));
    if ((walls || f.era >= 3) && siege < Math.max(1, Math.floor(army.length / 8))) pool.push('catapult', 'catapult', 'catapult');
  }
  return pool;
}
