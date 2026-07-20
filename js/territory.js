'use strict';
// Territory: a per-tile influence field computed from each nation's buildings.
// Ownership drives border rendering on the map/minimap, AI expansion targeting,
// and border DISPUTES when claims overlap or someone builds on foreign ground.

class Territory {
  constructor(nFactions) {
    this.n = nFactions;
    this.owner = new Int8Array(MAP_W * MAP_H).fill(-1);   // -1 unclaimed, else fid
    this.contested = new Uint8Array(MAP_W * MAP_H);
    this.inf = new Float32Array(nFactions * MAP_W * MAP_H);
    this.claimCount = new Array(nFactions).fill(0);
    this.contestPairs = new Map();       // pairKey -> contested tile count
    this.disputeCooldown = [];           // per-pair: no new dispute before game.time
    for (let a = 0; a < nFactions; a++) this.disputeCooldown[a] = new Array(nFactions).fill(0);
    this.recomputeT = 0;
  }

  pairKey(a, b) { return a < b ? a * this.n + b : b * this.n + a; }
  ownerAt(x, y) { return this.owner[y * MAP_W + x]; }

  // Influence radiates from completed buildings with linear falloff; the
  // strongest nation owns the tile, and a close runner-up marks it contested.
  recompute() {
    this.inf.fill(0);
    const stride = MAP_W * MAP_H;
    for (const f of game.factions) {
      if (f.eliminated) continue;
      const base = f.id * stride;
      for (const b of f.buildings) {
        if (!b.done || b.hp <= 0 || b.type.key === 'bridge') continue;
        const isKeep = b.type.key === 'townhall', isCastle = b.type.key === 'castle';
        const isWall = b.type.key === 'wall' || b.type.key === 'gate';
        const w = isKeep ? 20 : isCastle ? 14 : isWall ? 6 : 8;
        const r = isKeep ? 12 : isCastle ? 10 : isWall ? 4 : 6;
        const x0 = Math.max(0, Math.floor(b.cx - r)), x1 = Math.min(MAP_W - 1, Math.ceil(b.cx + r));
        const y0 = Math.max(0, Math.floor(b.cy - r)), y1 = Math.min(MAP_H - 1, Math.ceil(b.cy + r));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const d = Math.hypot(x + 0.5 - b.cx, y + 0.5 - b.cy);
            if (d < r) this.inf[base + y * MAP_W + x] += w * (1 - d / r);
          }
        }
      }
    }
    this.claimCount.fill(0);
    this.contestPairs.clear();
    for (let i = 0; i < stride; i++) {
      let best = -1, bv = 0, second = -1, sv = 0;
      for (let fid = 0; fid < this.n; fid++) {
        const v = this.inf[fid * stride + i];
        if (v > bv) { second = best; sv = bv; best = fid; bv = v; }
        else if (v > sv) { second = fid; sv = v; }
      }
      if (bv < 0.5) { best = -1; second = -1; }
      this.owner[i] = best;
      let cont = 0;
      if (best >= 0 && second >= 0 && sv >= bv * 0.6
          && game.diplomacy.status(best, second) !== STATUS.ALLIANCE) {
        cont = 1;
        const k = this.pairKey(best, second);
        this.contestPairs.set(k, (this.contestPairs.get(k) || 0) + 1);
      }
      this.contested[i] = cont;
      if (best >= 0) this.claimCount[best]++;
    }
  }

  tick(dt) {
    this.recomputeT -= dt;
    if (this.recomputeT > 0) return;
    this.recomputeT = 5;
    this.recompute();
    // creeping frontiers: sustained overlap sours relations and sparks disputes
    for (const [k, count] of this.contestPairs) {
      const a = Math.floor(k / this.n), b = k % this.n;
      if (game.factions[a].eliminated || game.factions[b].eliminated) continue;
      if (game.diplomacy.status(a, b) === STATUS.WAR) continue;   // already fighting over it
      if (count > 25) game.diplomacy.addRel(a, b, -1);
      if (count > 40 && game.time > this.disputeCooldown[a][b]) {
        this.disputeCooldown[a][b] = this.disputeCooldown[b][a] = game.time + 90;
        triggerDispute(a, b);
      }
    }
  }
}

// A finished building standing on another nation's claim starts a dispute
// (called from Nation.tick via onBuildingCompleted).
function onBuildingCompleted(b) {
  const t = game.territory;
  if (!t || ['bridge', 'wall', 'gate'].includes(b.type.key)) return;
  const owner = t.ownerAt(Math.floor(b.cx), Math.floor(b.cy));
  if (owner < 0 || owner === b.faction || game.factions[owner].eliminated) return;
  const st = game.diplomacy.status(b.faction, owner);
  if (st === STATUS.WAR || st === STATUS.ALLIANCE) return;
  if (game.time <= t.disputeCooldown[b.faction][owner]) return;
  t.disputeCooldown[b.faction][owner] = t.disputeCooldown[owner][b.faction] = game.time + 90;
  triggerDispute(b.faction, owner);
}

// a = the side pushing in, b = the claimant. Player disputes become choice
// cards; AI-vs-AI disputes resolve from strength, ambition and relations.
function triggerDispute(a, b) {
  if (a !== 0 && b !== 0) return resolveAIDispute(a, b);
  const aiFid = a === 0 ? b : a;
  const f = game.factions[aiFid];
  const playerIntruded = a === 0;
  const dip = game.diplomacy;
  const pushed = pushPlayerEvent({
    kind: 'dispute', from: aiFid,
    title: `Border dispute with ${f.name}`,
    body: playerIntruded
      ? `${f.name} protests: your new works stand on land they claim, and their court demands an answer.`
      : `${f.name}'s settlers are pushing into lands you claim. Your border guards await orders.`,
    options: [
      { label: playerIntruded ? 'Concede the ground' : 'Let them settle', cls: '', apply: () => {
          dip.addRel(0, aiFid, 8);
          game.log(playerIntruded
            ? `You yield the disputed ground to ${f.name}.`
            : `You cede the frontier to ${f.name}'s settlers.`);
        } },
      { label: 'Negotiate (40 gold)', cls: 'good', apply: () => {
          const n = game.factions[0].nation;
          if (n.res.gold < 40) { game.log('You cannot afford the settlement — the dispute festers.', 'bad'); dip.addRel(0, aiFid, -6); return; }
          n.res.gold -= 40;
          f.nation.res.gold += 40;
          dip.addRel(0, aiFid, 3);
          game.territory.disputeCooldown[0][aiFid] = game.territory.disputeCooldown[aiFid][0] = game.time + 240;
          game.log(`Gold changes hands and surveyors mark a boundary with ${f.name}.`, 'good');
        } },
      { label: 'Stand firm', cls: 'bad', apply: () => {
          dip.addRel(0, aiFid, -20);
          aiAddGrudge(aiFid, 0, 15);
          if (f.ai) f.ai.provocation += 1;
          game.log(`You defy ${f.name}'s claim. Their court seethes.`, 'bad');
        } },
    ],
    onExpire: () => {
      dip.addRel(0, aiFid, -10);
      aiAddGrudge(aiFid, 0, 8);
      game.log(`Ignored, ${f.name}'s border grievance festers.`, 'bad');
    },
  });
  if (pushed) game.log(`A border dispute flares with ${f.name}!`, 'bad');
}

function resolveAIDispute(a, b) {
  const fa = game.factions[a], fb = game.factions[b], dip = game.diplomacy;
  const expA = fa.ai ? DOCTRINES[fa.ai.doctrine].expansionAppetite : 0.5;
  const expB = fb.ai ? DOCTRINES[fb.ai.doctrine].expansionAppetite : 0.5;
  if (expA > 0.5 && expB > 0.5 && dip.relation(a, b) < 0) {
    // two expansionists with bad blood: the frontier hardens toward war
    dip.addRel(a, b, -15);
    aiAddGrudge(a, b, 10);
    aiAddGrudge(b, a, 10);
    game.log(`${fa.name} and ${fb.name} troops face off along their frontier.`);
  } else if (fa.strength() < fb.strength() * 0.7) {
    dip.addRel(a, b, -5);
    aiAddGrudge(a, b, 10);
    if (fa.ai) fa.ai.expansionSite = null;   // the weaker side backs down
    game.log(`${fa.name}'s settlers withdraw from the disputed valley.`);
  } else if (fb.strength() < fa.strength() * 0.7) {
    dip.addRel(a, b, -5);
    aiAddGrudge(b, a, 10);
    if (fb.ai) fb.ai.expansionSite = null;
    game.log(`${fb.name}'s settlers withdraw from the disputed valley.`);
  } else {
    dip.addRel(a, b, 3);
    game.log(`Envoys from ${fa.name} and ${fb.name} settle the boundary.`);
    // merchants may turn a settled border into a trade pact
    const merchant = [fa, fb].find(x => x.ai && (x.ai.doctrine === 'prosperity' || x.ai.doctrine === 'hegemon'));
    if (merchant && Math.random() < 0.3) {
      const other = merchant === fa ? b : a;
      dip.propose(merchant.id, other, 'trade');
    }
  }
}
