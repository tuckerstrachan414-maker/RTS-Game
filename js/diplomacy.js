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
    this.driftT = 0;
    for (let a = 0; a < nFactions; a++) {
      this.rel[a] = []; this.stat[a] = []; this.embargo[a] = [];
      for (let b = 0; b < nFactions; b++) {
        this.rel[a][b] = 0;
        this.stat[a][b] = a === b ? STATUS.ALLIANCE : STATUS.NEUTRAL;
        this.embargo[a][b] = false;
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
    game.log(`${game.factions[a].name} declared WAR on ${game.factions[b].name}!`, b === 0 || a === 0 ? 'bad' : '');
    // allies of the defender may join
    for (let c = 0; c < this.n; c++) {
      if (c !== a && c !== b && this.stat[b][c] === STATUS.ALLIANCE && this.stat[a][c] !== STATUS.WAR) {
        this.cancelRoute(a, c);
        this.setStatus(a, c, STATUS.WAR);
        game.log(`${game.factions[c].name} joins the war to defend ${game.factions[b].name}!`);
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

  resolveEnvoy(envoy) {
    const m = envoy.mission;
    envoy.mission = null;
    const a = envoy.faction, b = m.to;
    const them = game.factions[b];
    const rel = this.rel[b][a];
    let accepted;
    if (them.isPlayer) {
      accepted = true;  // AI→player offers auto-accept (player benefit both ways)
    } else if (m.proposal === 'trade') {
      accepted = rel > -10 + them.personality.mercantile * -20;
    } else {
      accepted = rel > 45 - them.personality.mercantile * 15;
    }
    if (accepted) {
      if (m.proposal === 'trade') {
        this.setStatus(a, b, STATUS.TRADE);
        this.addRel(a, b, 10);
        this.createRoute(a, b);
        game.log(`${game.factions[a].name} and ${them.name} signed a TRADE PACT. Caravans are rolling!`, 'good');
      } else {
        this.setStatus(a, b, STATUS.ALLIANCE);
        this.addRel(a, b, 15);
        game.log(`${game.factions[a].name} and ${them.name} formed an ALLIANCE!`, 'good');
      }
    } else {
      this.addRel(a, b, -3);
      if (a === 0) game.log(`${them.name} rejected your ${m.proposal === 'trade' ? 'trade pact' : 'alliance'} proposal. Improve relations first.`, 'bad');
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

  // ---------- ambient AI diplomacy ----------

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
        // mercantile AIs seek trade with anyone neutral
        if (st === STATUS.NEUTRAL && f.personality.mercantile > 0.5 && Math.random() < 0.12) {
          if (this.rel[a][b] > -10 && this.findMarket(a) && this.findMarket(b)) {
            this.setStatus(a, b, STATUS.TRADE);
            this.addRel(a, b, 10);
            this.createRoute(a, b);
            game.log(`${f.name} and ${game.factions[b].name} opened a trade route.`, b === 0 ? 'good' : '');
          }
        }
        // aggressive AIs eye weak neighbors
        if (st !== STATUS.WAR && st !== STATUS.ALLIANCE && Math.random() < 0.05) {
          const target = game.factions[b];
          const tempted = f.personality.aggression > 0.5
            && this.rel[a][b] < -25
            && f.strength() > target.strength() * 1.4
            && f.nation.warWeariness < 8;
          if (tempted) this.declareWar(a, b);
        }
        // idle relations drift: friendly by default, but warlike nations covet
        // weaker neighbors — trade with them or gift them to stay off their list
        if (st === STATUS.NEUTRAL) {
          const covets = f.personality.aggression > 0.6 && f.strength() > game.factions[b].strength();
          this.addRel(a, b, covets ? -0.35 : this.rel[a][b] < 0 ? 0.15 : 0.05);
        }
      }
    }
  }
}
