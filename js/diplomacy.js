'use strict';
// Relations, war/peace/pacts/alliances, trade routes with caravans, envoy missions.

const STATUS = { WAR: 'war', NEUTRAL: 'neutral', TRADE: 'trade', ALLIANCE: 'alliance' };

class Diplomacy {
  constructor(nFactions) {
    this.n = nFactions;
    this.rel = [];      // rel[a][b] = -100..100
    this.stat = [];     // status matrix
    this.routes = [];   // {a, b, path, caravans: [unit], t}
    this.embargo = [];  // embargo[a][b] = a refuses trade with b
    this.warSince = []; // game.time each war started (for peace-seeking)
    this.lastBlood = [];// last time a pair actually drew blood (for white peace)
    this.driftT = 0;
    for (let a = 0; a < nFactions; a++) {
      this.rel[a] = []; this.stat[a] = []; this.embargo[a] = [];
      this.warSince[a] = []; this.lastBlood[a] = [];
      for (let b = 0; b < nFactions; b++) {
        this.rel[a][b] = 0;
        this.stat[a][b] = a === b ? STATUS.ALLIANCE : STATUS.NEUTRAL;
        this.embargo[a][b] = false;
        this.warSince[a][b] = 0;
        this.lastBlood[a][b] = -999;
      }
    }
  }

  status(a, b) { return a === b ? STATUS.ALLIANCE : this.stat[a][b]; }
  relation(a, b) { return this.rel[a][b]; }
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
  setStatus(a, b, s) { this.stat[a][b] = s; this.stat[b][a] = s; }

  // ---------- player/AI actions ----------

  sendGift(a, b, gold) {
    const na = game.factions[a].nation;
    if (na.res.gold < gold) return 'Not enough gold';
    na.res.gold -= gold;
    game.factions[b].nation.res.gold += gold;
    this.addRel(a, b, 10 + gold * 0.1);
    if (b === 0) game.log(`${game.factions[a].name} sent you a gift of ${gold} gold!`, 'good');
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
    const envoy = f.units.find(u => u.alive && u.type.envoy && !u.mission);
    if (!envoy) return 'Train a Prince at the Castle to carry the proposal';
    const th = game.factions[b].townhall();
    if (!th) return 'They have no Town Hall';
    envoy.mission = { kind: 'envoy', proposal: kind, to: b };
    envoy.orderMove(Math.floor(th.cx), Math.floor(th.cy));
    envoy.mission.dest = th;
    if (a === 0) game.log(`Your envoy rides to ${game.factions[b].name} to propose ${kind === 'trade' ? 'a trade pact' : 'an alliance'}.`);
    return null;
  }

  declareWar(a, b) {
    if (this.stat[a][b] === STATUS.WAR) return;
    this.cancelRoute(a, b);
    this.setStatus(a, b, STATUS.WAR);
    this.rel[a][b] = Math.min(this.rel[a][b], -50);
    this.rel[b][a] = Math.min(this.rel[b][a], -50);
    this.warSince[a][b] = this.warSince[b][a] = game.time;
    this.lastBlood[a][b] = this.lastBlood[b][a] = game.time;
    game.log(`${game.factions[a].name} declared WAR on ${game.factions[b].name}!`, b === 0 || a === 0 ? 'bad' : '');
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
  }

  suePeace(a, b) {
    if (this.stat[a][b] !== STATUS.WAR) return 'Not at war';
    const cost = 100;
    const na = game.factions[a].nation;
    if (na.res.gold < cost) return `Peace requires ${cost} gold in reparations`;
    // AI accepts if not clearly winning
    const them = game.factions[b], us = game.factions[a];
    if (!them.isPlayer && them.strength() > us.strength() * 1.6 && them.nation.warWeariness < 15) return `${them.name} smells victory and refuses`;
    na.res.gold -= cost;
    them.nation.res.gold += cost;
    this.setStatus(a, b, STATUS.NEUTRAL);
    this.rel[a][b] = Math.max(this.rel[a][b], -20);
    this.rel[b][a] = Math.max(this.rel[b][a], -20);
    game.log(`Peace between ${us.name} and ${them.name}.`, 'good');
    return null;
  }

  // ---------- envoy arrival ----------

  // Seal an accepted pact (shared by AI acceptance and the player's event card).
  acceptProposal(a, b, kind) {
    if (this.stat[a][b] === STATUS.WAR) return;   // the moment has passed
    if (kind === 'trade') {
      this.setStatus(a, b, STATUS.TRADE);
      this.addRel(a, b, 10);
      this.createRoute(a, b);
      game.log(`${game.factions[a].name} and ${game.factions[b].name} signed a TRADE PACT. Caravans are rolling!`, 'good');
    } else {
      this.setStatus(a, b, STATUS.ALLIANCE);
      this.addRel(a, b, 15);
      game.log(`${game.factions[a].name} and ${game.factions[b].name} formed an ALLIANCE!`, 'good');
    }
  }

  resolveEnvoy(envoy) {
    const m = envoy.mission;
    envoy.mission = null;
    const a = envoy.faction, b = m.to;
    const them = game.factions[b];
    const rel = this.rel[b][a];
    if (them.isPlayer) {
      // AI→player offers are the player's call: a choice card, not an auto-accept
      const fromF = game.factions[a];
      const kindName = m.proposal === 'trade' ? 'a trade pact' : 'an alliance';
      const pushed = pushPlayerEvent({
        kind: 'proposal', from: a,
        title: `Envoy from ${fromF.name}`,
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
      } else {
        this.addRel(a, b, -3);
        if (a === 0) game.log(`${them.name} rejected your ${m.proposal === 'trade' ? 'trade pact' : 'alliance'} proposal. Improve relations first.`, 'bad');
      }
    }
    // envoy walks home
    const th = game.factions[a].townhall();
    if (th) envoy.orderMove(Math.floor(th.cx), Math.floor(th.cy));
  }

  // ---------- trade routes & caravans ----------

  findMarket(fid) {
    return game.factions[fid].buildings.find(b => b.type.key === 'market' && b.done && b.hp > 0);
  }

  createRoute(a, b) {
    const ma = this.findMarket(a), mb = this.findMarket(b);
    if (!ma || !mb) return;
    const path = findPath(game.map, Math.floor(ma.cx), Math.floor(ma.cy), Math.floor(mb.cx), Math.floor(mb.cy), undefined, 20000);
    // stamp a dirt trail on the map
    for (const [x, y] of path) {
      const i = game.map.idx(x, y);
      if (game.map.terrain[i] === T_GRASS) game.map.road[i] = 1;
    }
    const route = { a, b, ma, mb, path, caravans: [], spawnT: 0 };
    this.routes.push(route);
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
      r.spawnT -= dt;
      if (r.caravans.length < 2 && r.spawnT <= 0) {
        r.spawnT = 12;
        const fromA = r.caravans.length % 2 === 0;
        const start = fromA ? r.ma : r.mb;
        const dest = fromA ? r.mb : r.ma;
        const owner = fromA ? r.a : r.b;
        const c = new Unit('horseman', owner, Math.floor(start.cx), Math.floor(start.cy));
        c.mission = { kind: 'caravan', route: r, dest, home: start };
        c.aggressive = false;
        c.hp = 40;
        game.factions[owner].units.push(c);
        r.caravans.push(c);
        c.orderMove(Math.floor(dest.cx), Math.floor(dest.cy));
      }
    }
    this.routes = this.routes.filter(r => !r.dead);
  }

  tickMission(u, dt) {
    const m = u.mission;
    if (m.kind === 'caravan') {
      if (u.path.length === 0 && !u.dest) {
        // arrived: pay both sides, turn around
        game.factions[m.route.a].nation.res.gold += 8;
        game.factions[m.route.b].nation.res.gold += 8;
        if (m.route.a === 0 || m.route.b === 0) game.tradeGold += 16;
        const next = m.dest === m.route.ma ? m.route.mb : m.route.ma;
        m.home = m.dest; m.dest = next;
        u.orderMove(Math.floor(next.cx), Math.floor(next.cy));
      }
    } else if (m.kind === 'envoy') {
      if (u.path.length === 0 && !u.dest) this.resolveEnvoy(u);
    }
  }

  // ---------- ambient relations drift ----------
  // Pure atmosphere: pacts warm relations, covetous nations cool them. All AI
  // *initiative* — proposals, gifts, embargoes, wars, peace — lives in js/ai.js
  // (aiDiplomacy), which uses real envoys and the same mechanisms the player does.

  tick(dt) {
    this.tickRoutes(dt);
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
            || (f.ai && (f.ai.doctrine === 'conquest' || f.ai.doctrine === 'raider'));
          const covets = hungry && f.strength() > game.factions[b].strength();
          this.addRel(a, b, covets ? -0.35 : this.rel[a][b] < 0 ? 0.15 : 0.05);
        }
      }
    }
  }
}
