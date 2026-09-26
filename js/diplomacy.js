'use strict';
// Relations, war/peace/pacts/alliances, trade routes with caravans, envoy missions.

const STATUS = { WAR: 'war', NEUTRAL: 'neutral', TRADE: 'trade', ALLIANCE: 'alliance' };
const TRUCE_TIME = 300;   // seconds after any peace before the same two may fight again

class Diplomacy {
  constructor(nFactions) {
    this.n = nFactions;
    this.rel = [];      // rel[a][b] = -100..100
    this.stat = [];     // status matrix
    this.routes = [];   // {a, b, path, caravans: [unit], t}
    this.embargo = [];  // embargo[a][b] = a refuses trade with b
    this.warSince = []; // game.time each war started (for peace-seeking)
    this.lastBlood = [];// last time a pair actually drew blood (for white peace)
    this.truce = [];    // truce[a][b] = game.time before which a and b may not go back to war
    this.driftT = 0;
    for (let a = 0; a < nFactions; a++) {
      this.rel[a] = []; this.stat[a] = []; this.embargo[a] = [];
      this.warSince[a] = []; this.lastBlood[a] = []; this.truce[a] = [];
      for (let b = 0; b < nFactions; b++) {
        this.rel[a][b] = 0;
        this.stat[a][b] = a === b ? STATUS.ALLIANCE : STATUS.NEUTRAL;
        this.embargo[a][b] = false;
        this.warSince[a][b] = 0;
        this.lastBlood[a][b] = -999;
        this.truce[a][b] = 0;
      }
    }
  }

  status(a, b) { return a === b ? STATUS.ALLIANCE : this.stat[a][b]; }
  // a's view of b: the shared mood between the two courts plus everything a's
  // leader remembers about b and holds against (or for) it (js/leaders.js).
  relation(a, b) { return Math.max(-100, Math.min(100, this.rel[a][b] + opinionMods(a, b))); }
  hostile(a, b) { return a !== b && this.stat[a][b] === STATUS.WAR; }
  allied(a, b) { return a === b || this.stat[a][b] === STATUS.ALLIANCE; }
  atWarAny(a) { return this.stat[a].some((s, b) => b !== a && s === STATUS.WAR); }
  embargoed(a, b) { return a !== b && this.embargo[a][b]; }

  // ---------- embargo / blockade ----------
  declareEmbargo(a, b) {
    if (this.embargo[a][b]) return 'Already embargoing';
    this.embargo[a][b] = true;
    this.cancelRoute(a, b);
    this.addRel(a, b, -15);
    remember(b, a, 'embargoed', 'Embargoed us', -10, 1500);
    game.log(`${game.factions[a].name} placed a trade EMBARGO on ${game.factions[b].name}.`, b === 0 ? 'bad' : '');
    // allies of the embargoing nation join the blockade
    for (let c = 0; c < this.n; c++) {
      if (c !== a && c !== b && !game.factions[c].eliminated && this.status(a, c) === STATUS.ALLIANCE && !this.embargo[c][b]) {
        this.embargo[c][b] = true;
        this.cancelRoute(c, b);
        this.addRel(c, b, -8);
        game.log(`${game.factions[c].name} joins the embargo against ${game.factions[b].name}.`);
      }
    }
    return null;
  }
  liftEmbargo(a, b) {
    if (!this.embargo[a][b]) return 'No embargo to lift';
    this.embargo[a][b] = false;
    this.addRel(a, b, 6);
    game.log(`${game.factions[a].name} lifted its embargo on ${game.factions[b].name}.`, b === 0 ? 'good' : '');
    return null;
  }

  addRel(a, b, amount) {
    this.rel[a][b] = Math.max(-100, Math.min(100, this.rel[a][b] + amount));
    this.rel[b][a] = Math.max(-100, Math.min(100, this.rel[b][a] + amount));
  }
  // Every road out of a war — bought peace, a white peace, a surrender, a
  // vassalage — ends in a truce: five minutes in which the two may not go back
  // to war. Without it an AI could declare, sue, and declare again once a
  // minute, and a war meant nothing.
  setStatus(a, b, s) {
    if (this.stat[a][b] === STATUS.WAR && s !== STATUS.WAR) {
      this.truce[a][b] = this.truce[b][a] = game.time + TRUCE_TIME;
    }
    this.stat[a][b] = s; this.stat[b][a] = s;
  }
  inTruce(a, b) { return this.truce[a][b] > game.time; }

  // ---------- player/AI actions ----------

  sendGift(a, b, gold) {
    const na = game.factions[a].nation;
    if (na.res.gold < gold) return 'Not enough gold';
    na.res.gold -= gold;
    game.factions[b].nation.res.gold += gold;
    this.addRel(a, b, 10 + gold * 0.1);
    leaderOnGift(a, b, gold);
    if (b === 0) game.log(`${leaderShort(game.factions[a])} of ${game.factions[a].name} sent you a gift of ${gold} gold!`, 'good');
    return null;
  }

  // Trade pacts and alliances are delivered by a Prince envoy walking to their townhall.
  propose(a, b, kind) {
    const f = game.factions[a];
    if (this.stat[a][b] === STATUS.WAR) return 'You are at war';
    if (kind === 'trade' && (this.stat[a][b] === STATUS.TRADE || this.stat[a][b] === STATUS.ALLIANCE)) return 'Already trading';
    if (kind === 'alliance' && this.stat[a][b] === STATUS.ALLIANCE) return 'Already allied';
    if (kind === 'trade' && !f.buildings.some(x => x.type.key === 'market' && x.done)) return 'You need a Market';
    if (kind === 'trade' && !game.factions[b].buildings.some(x => x.type.key === 'market' && x.done)) return `${game.factions[b].name} has no Market yet`;
    const envoy = f.units.find(u => u.alive && u.type.envoy && !u.mission && !u.aboard);
    if (!envoy) return 'Train a Prince at the Castle to carry the proposal';
    const th = game.factions[b].townhall();
    if (!th) return 'They have no Town Hall';
    const map = game.map;
    const cFrom = map.continentAt(envoy.tileX, envoy.tileY), cTo = map.continentAt(Math.floor(th.cx), Math.floor(th.cy));
    if (cFrom >= 0 && cTo >= 0 && cFrom !== cTo) return this.sendEnvoyBySea(envoy, a, b, kind);
    // orderMove clears any mission, so the route is set first and the mission
    // after it — the other way round, the mission was wiped the moment it was
    // given and the next line threw (BUGS #49).
    envoy.orderMove(Math.floor(th.cx), Math.floor(th.cy));
    envoy.mission = { kind: 'envoy', proposal: kind, to: b, dest: th };
    if (a === 0) game.log(`Your envoy rides to ${game.factions[b].name} to propose ${kind === 'trade' ? 'a trade pact' : 'an alliance'}.`);
    return null;
  }

  declareWar(a, b) {
    if (this.stat[a][b] === STATUS.WAR) return;
    const brokeTruce = this.inTruce(a, b);
    this.cancelRoute(a, b);
    this.setStatus(a, b, STATUS.WAR);
    this.rel[a][b] = Math.min(this.rel[a][b], -50);
    this.rel[b][a] = Math.min(this.rel[b][a], -50);
    this.warSince[a][b] = this.warSince[b][a] = game.time;
    this.lastBlood[a][b] = this.lastBlood[b][a] = game.time;
    game.log(`${game.factions[a].name} declared WAR on ${game.factions[b].name}!`, b === 0 || a === 0 ? 'bad' : '');
    chronicle(`${game.factions[a].name} declared war on ${game.factions[b].name}.`, a, 'major');
    // the defender holds a grudge, and both sides rethink their ambitions
    aiAddGrudge(b, a, 20);
    aiPoke(a); aiPoke(b);
    if (a === 0) { const f = game.factions[b]; if (f.ai) f.ai.provocation += 3; }
    // allies of the defender may join
    for (let c = 0; c < this.n; c++) {
      if (c !== a && c !== b && this.stat[b][c] === STATUS.ALLIANCE && this.stat[a][c] !== STATUS.WAR) {
        this.cancelRoute(a, c);
        this.setStatus(a, c, STATUS.WAR);
        this.warSince[a][c] = this.warSince[c][a] = game.time;
        this.lastBlood[a][c] = this.lastBlood[c][a] = game.time;
        game.log(`${game.factions[c].name} joins the war to defend ${game.factions[b].name}!`);
        aiPoke(c);
      }
    }
    leaderOnWar(a, b);
    if (brokeTruce) leaderOnTruceBroken(a, b);
  }

  suePeace(a, b) {
    if (this.stat[a][b] !== STATUS.WAR) return 'Not at war';
    const cost = 100;
    const na = game.factions[a].nation;
    if (na.res.gold < cost) return `Peace requires ${cost} gold in reparations`;
    // AI accepts if not clearly winning
    const them = game.factions[b], us = game.factions[a];
    const seenUs = them.brain ? them.brain.perception.estimatedStrength(a).value : us.strength();
    if (!them.isPlayer && them.strength() > seenUs * 1.6 && them.nation.warWeariness < 15) return `${them.name} smells victory and refuses`;
    na.res.gold -= cost;
    them.nation.res.gold += cost;
    this.setStatus(a, b, STATUS.NEUTRAL);
    this.rel[a][b] = Math.max(this.rel[a][b], -20);
    this.rel[b][a] = Math.max(this.rel[b][a], -20);
    game.log(`Peace between ${us.name} and ${them.name}.`, 'good');
    chronicle(`${us.name} bought peace with ${them.name}.`, a, 'major');
    return null;
  }

  // ---------- envoy arrival ----------

  // Seal an accepted pact (shared by AI acceptance and the player's event card).
  acceptProposal(a, b, kind) {
    if (this.stat[a][b] === STATUS.WAR) return;   // the moment has passed
    noteDealing(a); noteDealing(b);
    if (kind === 'trade') {
      this.setStatus(a, b, STATUS.TRADE);
      this.addRel(a, b, 10);
      this.createRoute(a, b);
      game.log(`${game.factions[a].name} and ${game.factions[b].name} signed a TRADE PACT. Caravans are rolling!`, 'good');
      chronicle(`${game.factions[a].name} and ${game.factions[b].name} signed a trade pact.`, a, 'minor');
    } else {
      this.setStatus(a, b, STATUS.ALLIANCE);
      this.addRel(a, b, 15);
      game.log(`${game.factions[a].name} and ${game.factions[b].name} formed an ALLIANCE!`, 'good');
      chronicle(`${game.factions[a].name} and ${game.factions[b].name} formed an alliance.`, a, 'major');
    }
  }

  resolveEnvoy(envoy) {
    const m = envoy.mission;
    envoy.mission = null;
    this.deliverProposal(envoy.faction, m.to, m.proposal);
    // envoy walks home
    const th = game.factions[envoy.faction].townhall();
    if (th) envoy.orderMove(Math.floor(th.cx), Math.floor(th.cy));
  }

  // The proposal reaches the other court, however the envoy got there.
  deliverProposal(a, b, proposal) {
    const m = { proposal };
    const them = game.factions[b];
    const rel = this.relation(b, a);
    if (them.isPlayer) {
      // AI→player offers are the player's call: a choice card, not an auto-accept
      const fromF = game.factions[a];
      const kindName = m.proposal === 'trade' ? 'a trade pact' : 'an alliance';
      noteDealing(a);
      const pushed = pushPlayerEvent({
        kind: 'proposal', from: a, portrait: true,
        title: `Envoy from ${leaderShort(fromF)} of ${fromF.name}`,
        quote: leaderLine(fromF, m.proposal === 'trade' ? 'proposal_trade' : 'proposal_alliance', { them: 0 }),
        body: `${fromF.name} proposes ${kindName}. ${m.proposal === 'trade'
          ? 'Caravans would earn both nations gold with every run.'
          : 'Allies defend each other when war comes.'}`,
        options: [
          { label: 'Accept', cls: 'good', apply: () => this.acceptProposal(a, 0, m.proposal) },
          { label: 'Decline politely', cls: '', apply: () => {
              this.addRel(a, 0, -3);
              game.log(`You declined ${fromF.name}'s offer.`);
            } },
          { label: 'Rebuff', cls: 'bad', apply: () => {
              this.addRel(a, 0, -10);
              remember(a, 0, 'rebuff_envoy', 'Rebuffed our envoy', -10, 1200);
              game.log(`Your court rebuffed ${fromF.name}'s envoy. They will remember it.`, 'bad');
            } },
        ],
        onExpire: () => {
          this.addRel(a, 0, -3);
          game.log(`Your silence was answer enough for ${fromF.name}'s envoy.`);
        },
      });
      if (pushed) game.log(`An envoy from ${fromF.name} has arrived with ${kindName} proposal.`, 'good');
    } else {
      let accepted;
      if (m.proposal === 'trade') accepted = rel > -10 + them.personality.mercantile * -20;
      else accepted = rel > 45 - them.personality.mercantile * 15;
      if (accepted) {
        this.acceptProposal(a, b, m.proposal);
        if (a === 0) game.log(`${leaderShort(them)}: "${leaderLine(them, 'accept', {})}"`, 'good');
      } else {
        this.addRel(a, b, -3);
        if (a === 0) game.log(`${leaderShort(them)} of ${them.name} rejected your ${m.proposal === 'trade' ? 'trade pact' : 'alliance'}: "${leaderLine(them, 'refuse', {})}" Improve relations first.`, 'bad');
      }
    }
  }

  // ---------- trade routes & caravans ----------

  findMarket(fid) {
    return game.factions[fid].buildings.find(b => b.type.key === 'market' && b.done && b.hp > 0);
  }

  // A trade route runs between the two nations' Markets over land, or — when
  // the two Markets stand on different continents — between their Docks by
  // sea, carried by merchant ships (js/naval.js). A sea route waits ("pending")
  // until both nations have a Dock, and goes back to waiting if one is burned.
  createRoute(a, b) {
    const ma = this.findMarket(a), mb = this.findMarket(b);
    if (!ma || !mb) return;
    const map = game.map;
    const ca = map.continentAt(Math.floor(ma.cx), Math.floor(ma.cy));
    const cb = map.continentAt(Math.floor(mb.cx), Math.floor(mb.cy));
    const route = { a, b, ma, mb, path: [], caravans: [], spawnT: 0, sea: ca >= 0 && cb >= 0 && ca !== cb };
    if (route.sea) {
      this.routes.push(route);
      this.openSeaLane(route);
      return;
    }
    route.path = findPath(map, Math.floor(ma.cx), Math.floor(ma.cy), Math.floor(mb.cx), Math.floor(mb.cy), undefined, 20000);
    // stamp a dirt trail on the map
    for (const [x, y] of route.path) {
      const i = map.idx(x, y);
      if (map.terrain[i] === T_GRASS) map.road[i] = 1;
    }
    this.routes.push(route);
  }

  // Chart the lane between the two Docks once; merchant ships then follow it
  // rather than re-running an ocean-wide A* every couple of seconds.
  openSeaLane(r) {
    const da = game.factions[r.a].buildings.find(b => b.type.key === 'dock' && b.done && b.hp > 0);
    const db = game.factions[r.b].buildings.find(b => b.type.key === 'dock' && b.done && b.hp > 0);
    r.pending = true;
    if (!da || !db) {
      if ((r.a === 0 || r.b === 0) && !r.warned) {
        r.warned = true;
        game.log(`Trade with ${game.factions[r.a === 0 ? r.b : r.a].name} lies across the sea: it will sail once both nations have a Dock.`, '');
      }
      return false;
    }
    const sa = shipSpawnNear(da), sb = shipSpawnNear(db);
    if (!sa || !sb) return false;
    const lane = findPath(game.map, sa[0], sa[1], sb[0], sb[1], undefined, 60000, 'sea');
    const end = lane[lane.length - 1];
    if (!end || end[0] !== wrapX(sb[0]) || end[1] !== sb[1]) { r.laneFailT = game.time; return false; }
    r.da = da; r.db = db; r.lane = [[sa[0], sa[1]], ...lane];
    r.pending = false;
    if (r.a === 0 || r.b === 0) game.log(`Merchant ships set sail between Azuria and ${game.factions[r.a === 0 ? r.b : r.a].name}.`, 'good');
    return true;
  }

  cancelRoute(a, b) {
    for (const r of this.routes) {
      if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) {
        for (const c of r.caravans) c.dead = true;
        r.dead = true;
      }
    }
    this.routes = this.routes.filter(r => !r.dead);
    if (this.stat[a][b] === STATUS.TRADE) this.setStatus(a, b, STATUS.NEUTRAL);
  }

  tickRoutes(dt) {
    for (const r of this.routes) {
      if (r.ma.hp <= 0 || r.mb.hp <= 0) { r.dead = true; continue; }
      r.caravans = r.caravans.filter(c => c.alive);
      if (r.sea) {
        // a burned shipyard closes the lane until a new one stands
        if (!r.pending && (r.da.hp <= 0 || r.db.hp <= 0)) {
          for (const c of r.caravans) c.dead = true;
          r.caravans = []; r.pending = true;
        }
        if (r.pending) {
          r.retryT = (r.retryT || 0) - dt;
          if (r.retryT <= 0) { r.retryT = 20; this.openSeaLane(r); }
          continue;
        }
      }
      r.spawnT -= dt;
      if (r.caravans.length < 2 && r.spawnT <= 0) {
        r.spawnT = 12;
        const fromA = r.caravans.length % 2 === 0;
        const owner = fromA ? r.a : r.b;
        let c;
        if (r.sea) {
          const [x, y] = fromA ? r.lane[0] : r.lane[r.lane.length - 1];
          c = new Unit('merchant', owner, x, y);
          c.aggressive = false;
          game.factions[owner].units.push(c);
          r.caravans.push(c);
          this.sendCaravan(c, r, fromA);
        } else {
          const start = fromA ? r.ma : r.mb;
          // Caravans ride the mounted sheet (the Bandit's, which is the only
          // horse art left in the roster) but are traders, not raiders: no
          // aggression and no cargo hold, so a passing cart never scoops up
          // battlefield plunder and wanders off with it.
          c = new Unit('bandit', owner, Math.floor(start.cx), Math.floor(start.cy));
          c.aggressive = false;
          c.carryCap = 0;
          c.hp = c.maxHp = 40;
          game.factions[owner].units.push(c);
          r.caravans.push(c);
          this.sendCaravan(c, r, fromA);
        }
      }
    }
    this.routes = this.routes.filter(r => !r.dead);
  }

  // Send a caravan (or merchant ship) toward the far end of its route. The
  // order is given FIRST and the mission set after it: `orderMove` clears any
  // mission, and doing it the other way round wiped every caravan's mission
  // the moment it was given — so for as long as trade pacts existed, caravans
  // walked to the far market once, stood there, and never paid anyone (BUGS #51).
  sendCaravan(c, r, towardB) {
    const dest = towardB ? r.mb : r.ma;
    if (r.sea) {
      // follow the charted lane rather than searching the ocean again
      c.target = null; c.formSpeed = 0;
      c.dest = towardB ? r.lane[r.lane.length - 1] : r.lane[0];
      c.path = (towardB ? r.lane : [...r.lane].reverse()).slice(1).map(p => [p[0], p[1]]);
    } else {
      c.orderMove(Math.floor(dest.cx), Math.floor(dest.cy));
    }
    c.mission = { kind: 'caravan', route: r, towardB, dest };
  }

  tickMission(u, dt) {
    const m = u.mission;
    if (m.kind === 'caravan') {
      if (u.path.length === 0) {
        // arrived: pay both sides, turn around. A sea voyage pays more the
        // longer it is — the goods are rarer for having crossed an ocean.
        const r = m.route;
        const base = r.sea ? 8 * (1 + Math.min(3, r.lane.length / 80)) : 8;
        const payA = base * (1 + game.factions[r.a].mods.trade), payB = base * (1 + game.factions[r.b].mods.trade);
        game.factions[r.a].nation.res.gold += payA;
        game.factions[r.b].nation.res.gold += payB;
        if (r.a === 0) game.tradeGold += payA;
        if (r.b === 0) game.tradeGold += payB;
        for (const side of [r.a, r.b]) {
          const fs = game.factions[side];
          fs.tradeEarned = (fs.tradeEarned || 0) + (side === r.a ? payA : payB);
        }
        this.sendCaravan(u, r, !m.towardB);
      }
    } else if (m.kind === 'envoy') {
      if (u.path.length === 0 && !u.dest) this.resolveEnvoy(u);
    }
  }

  // ---------- envoys across the sea ----------
  // An envoy cannot walk to a Town Hall on another continent, so it takes ship
  // from its nation's Dock: it leaves the map for the length of the voyage,
  // delivers its proposal on arrival, and comes home the same way.
  sendEnvoyBySea(envoy, a, b, kind) {
    const dock = game.factions[a].buildings.find(x => x.type.key === 'dock' && x.done && x.hp > 0);
    const th = game.factions[b].townhall();
    if (!dock) return 'Their court is across the sea — build a Dock so your envoy can sail';
    const secs = 20 + wdist(dock.cx, dock.cy, th.cx, th.cy) / 2.5;
    envoy.orderMove(envoy.tileX, envoy.tileY);
    envoy.path = [];
    envoy.mission = { kind: 'envoy', proposal: kind, to: b, voyage: true };
    envoy.aboard = { voyage: true };
    this.voyages = this.voyages || [];
    this.voyages.push({ envoy, a, b, kind, arriveAt: game.time + secs, returnAt: game.time + secs * 2 });
    if (a === 0) game.log(`Your envoy takes ship for ${game.factions[b].name} — a voyage of about ${Math.round(secs)}s.`);
    return null;
  }

  tickVoyages() {
    if (!this.voyages || !this.voyages.length) return;
    for (const v of this.voyages) {
      if (!v.delivered && game.time >= v.arriveAt) {
        v.delivered = true;
        if (!game.factions[v.b].eliminated && v.envoy.alive) this.deliverProposal(v.a, v.b, v.kind);
      }
      if (game.time >= v.returnAt) {
        v.done = true;
        const home = game.factions[v.a].townhall();
        const u = v.envoy;
        u.aboard = null; u.mission = null;
        if (!home || game.factions[v.a].eliminated) { u.dead = true; u.hp = 0; continue; }
        const [x, y] = game.factions[v.a].spawnPointNear(home);
        u.x = x + 0.5; u.y = y + 0.5; u.path = []; u.dest = null;
      }
    }
    this.voyages = this.voyages.filter(v => !v.done);
  }

  // ---------- ambient relations drift ----------
  // Pure atmosphere: pacts warm relations, covetous nations cool them. All AI
  // *initiative* — proposals, gifts, embargoes, wars, peace — lives in js/ai.js
  // (aiDiplomacy), which uses real envoys and the same mechanisms the player does.

  tick(dt) {
    this.tickRoutes(dt);
    this.tickVoyages();
    this.driftT += dt;
    if (this.driftT < 5) return;
    this.driftT = 0;
    for (let a = 1; a < this.n; a++) {
      const f = game.factions[a];
      if (f.eliminated) continue;
      for (let b = 0; b < this.n; b++) {
        if (a === b || game.factions[b].eliminated) continue;
        const st = this.stat[a][b];
        // trading & alliance slowly warm relations; wars cool them
        if (st === STATUS.TRADE) this.addRel(a, b, 0.4);
        if (st === STATUS.ALLIANCE) this.addRel(a, b, 0.2);
        // idle relations drift: friendly by default, but nations whose current
        // ambition is conquest or plunder covet weaker neighbors — trade with
        // them or gift them to stay off their list
        if (st === STATUS.NEUTRAL) {
          const hungry = f.personality.aggression > 0.6
            || (f.ai && (f.ai.doctrine === 'aggressor' || f.ai.doctrine === 'raider'));
          const seen = f.brain ? f.brain.perception.estimatedStrength(b).value
            : game.factions[b].strength();
          const covets = hungry && f.strength() > seen;
          this.addRel(a, b, covets ? -0.35 : this.rel[a][b] < 0 ? 0.15 : 0.05);
        }
      }
    }
  }
}
