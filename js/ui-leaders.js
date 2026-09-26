'use strict';
// The courts of the other nations: the Diplomacy list and the Audience screen
// where you meet a leader face to face. Mixed into UI (js/ui.js).
//
// Everything a leader "says" here comes from js/leaders.js (leaderLine), and
// everything they decide comes from the same functions the AI uses between
// themselves — the screen is a window onto the court, not a second rulebook.

const RES_ORDER = ['food', 'wood', 'stone', 'gold'];

Object.assign(UI.prototype, {
  // ---------- the Diplomacy list ----------
  refreshDiplomacy() {
    const d = document.getElementById('diplomacy');
    if (d.style.display !== 'block') return;
    const dip = game.diplomacy, court = game.court;
    const f0 = game.factions[0];
    const key = game.factions.map(f => [f.eliminated, f.era, leaderKnown(f), dip.status(0, f.id), Math.round(dip.relation(f.id, 0) / 3),
      court.friend[f.id][0] > game.time, court.overlord[f.id], dip.embargoed(0, f.id), dip.embargoed(f.id, 0)].join(',')).join('|')
      + '|' + court.overlord[0];
    if (key === this.dipKey && d.innerHTML) return;
    this.dipKey = key;
    let html = `<h2>${icon('dove')} The Courts <button id="dip-close">✕</button></h2>`;
    if (court.overlord[0] >= 0) {
      const lord = game.factions[court.overlord[0]];
      html += `<div class="dip-vassal bad">Azuria is a vassal of ${lord.name}. You pay tribute every minute and cannot make war on them — until you declare independence from their court.</div>`;
    }
    for (let i = 1; i < game.factions.length; i++) {
      const f = game.factions[i];
      const st = dip.status(0, i);
      const op = Math.round(dip.relation(i, 0));
      const [word, cls] = opinionWord(op);
      const stLabel = { war: icon('sword') + ' At war', neutral: 'Neutral', trade: icon('horse') + ' Trade pact', alliance: icon('handshake') + ' Allied' }[st];
      const badges = [];
      if (court.friend[i][0] > game.time) badges.push(`<span class="badge good">Friends</span>`);
      if (court.researchPact[i][0] > game.time) badges.push(`<span class="badge">Research pact</span>`);
      if (court.overlord[i] === 0) badges.push(`<span class="badge good">Your vassal</span>`);
      else if (court.overlord[i] >= 0) badges.push(`<span class="badge">Vassal of ${game.factions[court.overlord[i]].name}</span>`);
      if (court.overlord[0] === i) badges.push(`<span class="badge bad">Your overlord</span>`);
      if (dip.embargoed(i, 0)) badges.push(`<span class="badge bad">Embargoes you</span>`);
      if (dip.embargoed(0, i)) badges.push(`<span class="badge bad">You embargo them</span>`);
      if (!leaderKnown(f) && !f.eliminated) {
        html += `<div class="nation unknown"><div class="nport qm">?</div><div class="nbody">
          <div class="nhead"><b>An unknown court</b></div>
          <div class="dim"><span class="dot" style="background:${f.color.css}"></span> ${f.name} · ${ERAS[f.era].name}</div>
          <div class="dim">You have not met their ruler. When their scouts or ships reach your lands — or yours reach theirs — they will introduce themselves.</div>
          <div class="dipbtns"><button data-act="gift" data-f="${i}" title="Send 50 gold by courier to open relations">${icon('gift')} Gift 50</button></div>
        </div></div>`;
        continue;
      }
      const portrait = portraitFor(f);
      html += `<div class="nation ${f.eliminated ? 'dead' : ''}" style="--nc:${f.color.css}">
        <img class="nport" src="${portrait}" alt="">
        <div class="nbody">
          <div class="nhead"><b>${leaderFullName(f)}</b></div>
          <div class="dim"><span class="dot" style="background:${f.color.css}"></span> ${f.name} · ${ERAS[f.era].name}${f.eliminated ? ' · ' + icon('skull') + ' fallen' : ' · ' + stLabel}</div>`;
      if (!f.eliminated) {
        const pct = (op + 100) / 2;
        html += `<div class="relbar"><div class="relfill" style="width:${pct}%;background:${op >= 0 ? '#6a5' : '#a55'}"></div></div>
          <div class="nop"><span class="${cls}">${word} (${op >= 0 ? '+' : ''}${op})</span> toward you ${badges.join(' ')}</div>
          <div class="dipbtns">
            <button data-audience="${i}" class="primary">Audience</button>
            <button data-act="gift" data-f="${i}" title="Send 50 gold. Remembered as a gift.">${icon('gift')} Gift 50</button>
          </div>`;
      }
      html += `</div></div>`;
    }
    html += `<div class="dim" style="margin-top:8px">Leaders remember what you do — gifts, promises kept and broken, wars, embargoes. Hold an Audience to see why they feel as they do, make deals, ask questions, and more.</div>`;
    d.innerHTML = html;
    document.getElementById('dip-close').onclick = () => this.closeDiplomacy();
    d.querySelectorAll('[data-audience]').forEach(b => { b.onclick = () => this.openLeader(+b.dataset.audience); });
    d.querySelectorAll('button[data-act="gift"]').forEach(btn => {
      btn.onclick = () => {
        const err = game.diplomacy.sendGift(0, +btn.dataset.f, 50);
        if (err) game.log(err, 'bad');
        this.dipKey = null; this.refreshDiplomacy();
      };
    });
  },

  // ---------- the Audience screen ----------
  openLeader(fid) {
    this.leaderFid = fid;
    this.leaderReply = null;
    this.leaderKey = null;
    const f = game.factions[fid];
    f.leader.met = true;
    const op = game.diplomacy.relation(fid, 0);
    this.leaderReply = { text: leaderLine(f, op >= 15 ? 'greet_warm' : op <= -15 ? 'greet_cold' : 'greet_neutral', { them: 0 }), cls: '' };
    document.getElementById('leader').classList.add('open');
    this.refreshLeader(true);
  },
  closeLeader() { document.getElementById('leader').classList.remove('open'); this.leaderFid = null; },
  leaderOpen() { return document.getElementById('leader').classList.contains('open'); },

  reply(f, text, cls = '') { this.leaderReply = { text, cls }; this.leaderKey = null; this.refreshLeader(true); },

  refreshLeader(force = false) {
    if (!this.leaderOpen() || this.leaderFid == null) return;
    const el = document.getElementById('leader');
    // don't rebuild under the player's fingers while they type a deal
    if (!force && document.activeElement && el.contains(document.activeElement)
        && document.activeElement.tagName === 'INPUT') return;
    const f = game.factions[this.leaderFid];
    const dip = game.diplomacy, court = game.court;
    const op = dip.relation(f.id, 0);
    const key = [Math.round(op), dip.status(0, f.id), court.friend[f.id][0] > game.time, court.researchPact[f.id][0] > game.time,
      court.overlord[f.id], court.overlord[0], f.era, f.eliminated, court.promises.length,
      court.promises.filter(p => p.done).length, f.leader.agendaKnownAt, dip.embargoed(0, f.id)].join('|');
    if (!force && key === this.leaderKey) return;
    this.leaderKey = key;
    const saved = this.readDeal(el);
    el.innerHTML = this.leaderHTML(f);
    this.writeDeal(el, saved);
    this.wireLeader(el, f);
  },

  leaderHTML(f) {
    const L = f.leader, dip = game.diplomacy, court = game.court;
    const op = Math.round(dip.relation(f.id, 0));
    const [word, wcls] = opinionWord(op);
    const st = dip.status(0, f.id);
    const agendaKnown = !!L.agendaKnownAt;
    const traits = L.traits.map(t => `<span class="trait" title="${LEADER_TRAITS[t].desc}">${LEADER_TRAITS[t].name}</span>`).join('');
    const agenda = agendaKnown
      ? `<span class="trait agenda" title="${LEADER_AGENDAS[L.agenda].desc}">${LEADER_AGENDAS[L.agenda].name}</span><div class="dim">${LEADER_AGENDAS[L.agenda].desc}</div>`
      : `<span class="trait unknown">Hidden agenda</span><div class="dim">Deal with them more to learn it (${Math.min(3, L.dealings || 0)}/3).</div>`;
    let html = `<div class="lbox">
      <div class="lhead"><button id="lead-close" title="Close">✕</button></div>
      <div class="lcols">
        <div class="lside">
          <img class="lport" src="${portraitFor(f)}" alt="">
          <div class="lname">${leaderFullName(f)}</div>
          <div class="dim"><span class="dot" style="background:${f.color.css}"></span> ${f.name} · ${ERAS[f.era].name} · age ${L.age + Math.floor(game.time / 1200)}</div>
          <div class="ltraits">${traits}</div>
          <div class="lagenda">${agenda}</div>
          <div class="lrel">${this.relationsHTML(f)}</div>
        </div>
        <div class="lmain">
          ${this.leaderReply ? `<div class="lquote ${this.leaderReply.cls}">“${this.leaderReply.text}”</div>` : ''}
          <div class="lsec"><div class="lsech">Their opinion of you: <b class="${wcls}">${word} (${op >= 0 ? '+' : ''}${op})</b></div>
            <div class="lbreak">${opinionBreakdown(f.id, 0).map(([label, v]) =>
              `<div class="row"><span>${label}</span><b class="${v > 0 ? 'good' : v < 0 ? 'bad' : ''}">${v > 0 ? '+' : ''}${v}</b></div>`).join('')}</div>
          </div>
          ${this.promisesHTML(f)}
          <div class="lsec"><div class="lsech">Diplomacy</div><div class="lacts">${this.leaderActionsHTML(f, st, op)}</div></div>
          ${dip.hostile(0, f.id) ? '' : this.dealHTML(f)}
          <div class="lsec"><div class="lsech">Ask</div><div class="lacts">${game.factions.filter(o => o.id !== 0 && o.id !== f.id && !o.eliminated)
            .map(o => `<button data-ask="${o.id}">What do you think of ${o.name}?</button>`).join('')}
            <button data-ask="self">What do you want from us?</button></div></div>
        </div>
      </div></div>`;
    return html;
  },

  relationsHTML(f) {
    const dip = game.diplomacy, court = game.court;
    const rows = game.factions.filter(o => o.id !== f.id && !o.eliminated).map(o => {
      const st = dip.status(f.id, o.id);
      const bits = [{ war: 'at war', neutral: 'neutral', trade: 'trading', alliance: 'allied' }[st]];
      if (court.friend[f.id][o.id] > game.time) bits.push('friends');
      if (court.overlord[o.id] === f.id) bits.push('their vassal');
      if (court.overlord[f.id] === o.id) bits.push('their overlord');
      if (game.time - court.denounced[f.id][o.id] < 1200) bits.push('denounced');
      return `<div class="row"><span><span class="dot" style="background:${o.color.css}"></span> ${o.isPlayer ? 'Azuria (you)' : o.name}</span><span class="dim">${bits.join(', ')}</span></div>`;
    });
    return `<div class="lsech">Their standing</div>${rows.join('')}`;
  },

  promisesHTML(f) {
    const ps = game.court.promises.filter(p => p.to === f.id && (!p.done || game.time - p.until < 300));
    if (!ps.length) return '';
    return `<div class="lsec"><div class="lsech">Your word to them</div>` + ps.map(p => {
      const state = p.broken ? `<b class="bad">broken</b>` : p.done ? `<b class="good">kept</b>`
        : `<span class="dim">${fmtDuration(Math.max(0, p.until - game.time))} left${p.calledAt ? ' — CALLED IN' : ''}</span>`;
      return `<div class="row"><span>${promiseText(p)}</span>${state}</div>`;
    }).join('') + `</div>`;
  },

  leaderActionsHTML(f, st, op) {
    const dip = game.diplomacy, court = game.court;
    const b = [];
    const friends = court.friend[f.id][0] > game.time;
    const myLord = court.overlord[0] === f.id, theirLord = court.overlord[f.id] === 0;
    b.push(`<button data-la="gift50">${icon('gift')} Gift 50 gold</button>`);
    b.push(`<button data-la="gift150">${icon('gift')} Gift 150 gold</button>`);
    if (st !== 'war') {
      if (!friends) b.push(`<button data-la="friend" title="A public 15-minute friendship: neither may declare war without betraying it">${icon('handshake')} Declare friendship</button>`);
      b.push(`<button data-la="pact" title="${RESEARCH_PACT_COST} gold each; +15% knowledge for both for 10 minutes">${icon('book')} Research pact</button>`);
      if (st === 'neutral') b.push(`<button data-la="trade" title="A Prince envoy carries the offer; both Markets earn from caravans">${icon('horse')} Propose trade pact</button>`);
      if (st !== 'alliance') b.push(`<button data-la="ally" title="A Prince envoy carries the offer">${icon('handshake')} Propose alliance</button>`);
      b.push(`<button data-la="tribute" title="Demand 50 gold. They pay only if they fear you — and resent it.">${icon('crown')} Demand tribute</button>`);
      b.push(`<button data-la="denounce" class="bad" title="Public. They will hate it; their enemies will like you for it.">Denounce</button>`);
      b.push(dip.embargoed(0, f.id) ? `<button data-la="lift">${icon('noentry')} Lift embargo</button>` : `<button data-la="embargo" class="bad">${icon('noentry')} Embargo</button>`);
    }
    if (myLord) b.push(`<button data-la="independence" class="bad" title="Throw off their rule. This is war.">Declare independence</button>`);
    else if (theirLord) b.push(`<button data-la="release" title="Free them from vassalage. They will be grateful.">Release vassal</button>`);
    else if (st === 'war') {
      b.push(`<button data-la="peace" class="good" title="Pay 100 gold in reparations">${icon('dove')} Sue for peace</button>`);
      b.push(`<button data-la="surrender" title="If they believe the war is lost, they will become your vassal">${icon('crown')} Demand surrender</button>`);
    } else if (st !== 'alliance') {
      b.push(`<button data-la="war" class="bad" title="${friends ? 'You are friends — this is a BETRAYAL the whole continent will remember' : 'No going back cheaply'}">${icon('sword')} Declare war${friends ? ' (betrayal!)' : ''}</button>`);
    }
    return b.join('');
  },

  dealHTML(f) {
    const inputs = side => RES_ORDER.map(r => `<label>${icon(r)}<input type="number" min="0" step="10" data-deal="${side}:${r}" value="0"></label>`).join('');
    return `<div class="lsec"><div class="lsech">Propose a deal</div>
      <div class="deal"><div><span class="dim">You give</span><div class="dealrow">${inputs('give')}</div></div>
      <div><span class="dim">You receive</span><div class="dealrow">${inputs('get')}</div></div>
      <button data-la="deal" class="primary">Propose</button></div></div>`;
  },

  readDeal(el) {
    const out = {};
    el.querySelectorAll('input[data-deal]').forEach(i => { out[i.dataset.deal] = i.value; });
    return out;
  },
  writeDeal(el, saved) {
    el.querySelectorAll('input[data-deal]').forEach(i => { if (saved[i.dataset.deal] != null) i.value = saved[i.dataset.deal]; });
  },

  wireLeader(el, f) {
    el.querySelector('#lead-close').onclick = () => this.closeLeader();
    const dip = game.diplomacy, court = game.court;
    const say = (key, cls = '') => this.reply(f, leaderLine(f, key, { them: 0 }), cls);
    el.querySelectorAll('[data-la]').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.la;
        const op = dip.relation(f.id, 0);
        const L = f.leader;
        noteDealing(f.id);
        let err = null;
        switch (act) {
          case 'gift50': case 'gift150': {
            err = dip.sendGift(0, f.id, act === 'gift50' ? 50 : 150);
            if (!err) say('thanks', 'good');
            break;
          }
          case 'friend': {
            const need = L.traits.includes('paranoid') ? 35 : L.traits.includes('honorable') ? 20 : 25;
            if (op >= need) { declareFriendship(0, f.id); say('accept', 'good'); }
            else { say('refuse', 'bad'); remember(f.id, 0, 'pushy', 'Presumed too much', -2, 300); }
            break;
          }
          case 'pact': {
            const pn = game.factions[0].nation;
            if (court.researchPact[f.id][0] > game.time) { err = 'You already share a research pact.'; break; }
            if (pn.res.gold < RESEARCH_PACT_COST) { err = `A research pact costs ${RESEARCH_PACT_COST} gold.`; break; }
            if (op < 5 || f.nation.res.gold < RESEARCH_PACT_COST) { say('refuse', 'bad'); break; }
            pn.res.gold -= RESEARCH_PACT_COST; f.nation.res.gold -= RESEARCH_PACT_COST;
            signResearchPact(0, f.id);
            say('accept', 'good');
            break;
          }
          case 'trade': err = dip.propose(0, f.id, 'trade'); if (!err) this.reply(f, 'We shall receive your envoy.'); break;
          case 'ally': err = dip.propose(0, f.id, 'alliance'); if (!err) this.reply(f, 'We shall receive your envoy.'); break;
          case 'tribute': {
            const per = f.brain.perception;
            const fear = per.threatStrength(0) > f.strength() * 1.5 && !L.traits.includes('zealot');
            if (fear && f.nation.res.gold >= 50) {
              f.nation.res.gold -= 50; game.factions[0].nation.res.gold += 50;
              remember(f.id, 0, 'extorted', 'Extorted tribute from us', -16, 1800);
              this.reply(f, 'Take it. And remember that we paid.', 'bad');
            } else {
              remember(f.id, 0, 'rebuff_demand', 'Made insolent demands', -8, 900);
              say('refuse', 'bad');
            }
            break;
          }
          case 'denounce': denounce(0, f.id); this.reply(f, 'You will regret those words.', 'bad'); break;
          case 'embargo': err = dip.declareEmbargo(0, f.id); break;
          case 'lift': err = dip.liftEmbargo(0, f.id); break;
          case 'war': {
            const friends = court.friend[f.id][0] > game.time;
            if (friends && !confirm(`You are declared friends with ${f.name}. Declaring war is a betrayal every court will remember. Continue?`)) return;
            dip.declareWar(0, f.id);
            this.reply(f, 'So be it. Steel will answer.', 'bad');
            break;
          }
          case 'peace': err = dip.suePeace(0, f.id); if (!err) say('accept', 'good'); break;
          case 'surrender': {
            if (wouldSubmit(f, 0)) {
              dip.setStatus(0, f.id, STATUS.NEUTRAL);
              makeVassal(f.id, 0);
              this.reply(f, leaderLine(f, 'surrender', { them: 0 }), 'good');
            } else {
              remember(f.id, 0, 'arrogant', 'Arrogant demands', -5, 600);
              this.reply(f, 'Surrender? We have barely begun.', 'bad');
            }
            break;
          }
          case 'independence': err = declareIndependence(0); break;
          case 'release': {
            freeVassal(f.id, 'released by Azuria');
            remember(f.id, 0, 'released', 'Released us from vassalage', 25, 3000);
            say('thanks', 'good');
            break;
          }
          case 'deal': {
            const deal = this.readDeal(el);
            const offer = {}, ask = {};
            for (const r of RES_ORDER) {
              offer[r] = Math.max(0, Math.floor(+deal['give:' + r] || 0));
              ask[r] = Math.max(0, Math.floor(+deal['get:' + r] || 0));
            }
            if (!RES_ORDER.some(r => offer[r] || ask[r])) { err = 'Put something on the table first.'; break; }
            const ans = considerDeal(f, offer, ask);
            if (ans.ok) {
              err = executeDeal(f, offer, ask);
              if (!err) { say('accept', 'good'); game.log(`Deal struck with ${f.name}.`, 'good'); el.querySelectorAll('input[data-deal]').forEach(i => { i.value = 0; }); }
            } else this.reply(f, ans.why, 'bad');
            break;
          }
        }
        if (err) game.log(err, 'bad');
        this.dipKey = null;
        this.leaderKey = null;
        this.refreshLeader(true);
      };
    });
    el.querySelectorAll('[data-ask]').forEach(btn => {
      btn.onclick = () => {
        noteDealing(f.id);
        if (btn.dataset.ask === 'self') return this.reply(f, this.wantsLine(f));
        const o = game.factions[+btn.dataset.ask];
        const v = game.diplomacy.relation(f.id, o.id);
        const [w] = opinionWord(v);
        const lines = {
          Devoted: `${o.name}? Our dearest friends.`, Friendly: `We think well of ${o.name}.`,
          Cordial: `${o.name} has given us no cause for complaint.`, Neutral: `${o.name}? We have no strong feelings.`,
          Wary: `We watch ${o.name} closely.`, Hostile: `${o.name} is no friend of ours.`, Hateful: `${o.name}? We would see them in ashes.`,
        };
        this.reply(f, lines[w] || lines.Neutral);
      };
    });
  },

  // What a leader tells you they want, in plain terms — a nudge toward the
  // things that would actually raise their opinion.
  wantsLine(f) {
    const L = f.leader, dip = game.diplomacy;
    const bits = [];
    if (L.agendaKnownAt) {
      bits.push({
        warlord: 'Show us strength. We respect a great army.', trader: 'Trade with us. Caravans make friends.',
        scholar: 'Learning. A nation of scholars is a nation worth knowing.', territorial: 'Keep your settlers away from our borders.',
        peacemaker: 'Peace. Do not start wars.', builder: 'Build great works — Wonders — and do not raze ours.',
        collector: 'Gifts, friend. A generous neighbour is a good neighbour.',
      }[L.agenda]);
    }
    if (dip.status(0, f.id) === STATUS.NEUTRAL) bits.push('A trade pact would please us.');
    if (dip.embargoed(0, f.id)) bits.push('Lift your embargo.');
    if (L.lastBorderSight && L.lastBorderSight[0] > game.time - 120) bits.push('And pull your soldiers back from our border.');
    if (!bits.length) bits.push('We are content, for now.');
    return bits.join(' ');
  },
});
