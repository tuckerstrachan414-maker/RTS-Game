'use strict';
// The Ledger (victory races, legacy, the chronicle), the history chart, and the
// end screen. Mixed into UI (js/ui.js).

// Series colours for charts. Each nation keeps its own hue — colour follows the
// entity — but Aurelia's banner gold is too light to sit in the lightness band
// on the dark chart surface, so charts use a deeper step of the same gold.
// Checked with the dataviz palette validator on #14161c: lightness, chroma,
// CVD and normal-vision separation and contrast all pass.
const CHART_COLORS = ['#4a90d9', '#d94a4a', '#a54ad9', '#b98a26'];
const CHART_SURFACE = '#18130d';
const CHART_GRID = '#33291d';
const CHART_INK = '#e2d5b8', CHART_MUTED = '#938671';

Object.assign(UI.prototype, {
  // ---------- the Ledger ----------
  toggleLedger(tab = null) {
    const el = document.getElementById('ledger');
    if (el.classList.contains('open') && (!tab || tab === this.ledgerTab)) return this.closeLedger();
    this.ledgerTab = tab || this.ledgerTab || (game.victoryOn ? 'victory' : 'legacy');
    el.classList.add('open');
    this.ledgerKey = null;
    this.refreshLedger(true);
  },
  closeLedger() {
    document.getElementById('ledger').classList.remove('open');
    // opened from the end screen: closing it goes back there
    if (game.over && game.endInfo) document.getElementById('gameover').style.display = 'flex';
  },
  ledgerOpen() { return document.getElementById('ledger').classList.contains('open'); },

  refreshLedger(force = false) {
    if (!this.ledgerOpen()) return;
    const el = document.getElementById('ledger');
    const key = this.ledgerTab + '|' + Math.floor(game.time / 2) + '|' + game.chronicle.length;
    if (!force && key === this.ledgerKey) return;
    this.ledgerKey = key;
    const scroll = el.querySelector('.lg-body') ? el.querySelector('.lg-body').scrollTop : 0;
    const tabs = [['victory', 'Victory'], ['legacy', 'Legacy'], ['chronicle', 'Chronicle']];
    let html = `<div class="lg-box"><div class="lg-head"><h2>${icon('trophy')} The Ledger of Nations</h2>`
      + `<div class="lg-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.ledgerTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
      + `<button id="lg-close" title="Close (V / J)">✕</button></div><div class="lg-body">`;
    if (this.ledgerTab === 'victory') html += this.victoryHTML();
    else if (this.ledgerTab === 'legacy') html += this.legacyHTML();
    else html += this.chronicleHTML();
    html += `</div></div>`;
    el.innerHTML = html;
    el.querySelector('.lg-body').scrollTop = scroll;
    el.querySelector('#lg-close').onclick = () => this.closeLedger();
    el.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { this.ledgerTab = b.dataset.tab; this.refreshLedger(true); }; });
    if (this.ledgerTab === 'legacy') this.mountChart(el.querySelector('.chart-host'), 'legacy', 'Legacy');
  },

  victoryHTML() {
    if (!game.victoryOn) {
      return `<div class="lg-note">This is an <b>endless</b> match — there is no victory, only your legacy. (Victory conditions are chosen on the setup screen.)</div>`;
    }
    const order = [...game.factions].sort((a, b) => (a.isPlayer ? -1 : b.isPlayer ? 1 : a.id - b.id));
    let html = `<div class="lg-note">The first nation to complete any one of these wins the match. Every rival is racing too — and a nation near victory becomes everyone's target.</div>`;
    for (const type of VICTORY_KEYS) {
      const V = VICTORY_TYPES[type];
      const target = type === 'economic' ? ` Target: ${economicTradeTarget().toLocaleString()} gold earned from trade, and ${economicTarget().toLocaleString()} in the treasury.`
        : type === 'culture' ? ` Target: ${cultureTarget().toLocaleString()} culture, with at least ${CULTURE_MIN_WONDERS} Wonders standing. You: +${cultureRate(game.factions[0]).toFixed(2)}/s.` : '';
      html += `<div class="vic"><div class="vic-h">${icon(V.icon)} <b>${V.name}</b> <span class="dim">${V.desc}${target}</span></div>`;
      for (const f of order) {
        const p = f.eliminated ? 0 : victoryProgress(f, type);
        const hold = victoryHoldLeft(f, type);
        const known = f.isPlayer || leaderKnown(f);
        const shown = known || type !== 'economic';
        html += `<div class="vic-row ${f.isPlayer ? 'me' : ''}"><span class="vic-n"><span class="dot" style="background:${CHART_COLORS[f.id]}"></span>${f.isPlayer ? 'Azuria (you)' : f.name}${f.eliminated ? ' — fallen' : ''}</span>`
          + `<span class="vic-bar"><span class="vic-fill" style="width:${shown ? Math.round(p * 100) : 0}%;background:${CHART_COLORS[f.id]}"></span></span>`
          + `<span class="vic-pct">${known || type !== 'economic' ? Math.round(p * 100) + '%' : '?'}${hold != null ? ` <b class="${f.isPlayer ? 'good' : 'bad'}">${fmtDuration(hold)}</b>` : ''}</span></div>`;
      }
      html += `</div>`;
    }
    return html;
  },

  legacyHTML() {
    const ranked = [...game.factions].sort((a, b) => legacyScore(b) - legacyScore(a));
    let html = `<div class="lg-note">Legacy is how history will weigh each nation: its Age and learning, its Wonders, its people and land, its trade, its conquests and vassals, the milestones it reached first — and whether its word could be trusted.</div>`;
    html += `<div class="chart-host"></div>`;
    html += `<table class="lg-table"><thead><tr><th>Nation</th><th>Legacy</th><th>Age</th><th>Techs</th><th>Wonders</th><th>People</th><th>Land</th></tr></thead><tbody>`;
    for (const f of ranked) {
      html += `<tr class="${f.isPlayer ? 'me' : ''}"><td><span class="dot" style="background:${CHART_COLORS[f.id]}"></span>${f.isPlayer ? 'Azuria (you)' : (leaderKnown(f) ? leaderShort(f) + ', ' : '') + f.name}${f.eliminated ? ' (fallen)' : ''}</td>`
        + `<td><b>${legacyScore(f).toLocaleString()}</b></td><td>${ERAS[f.era].short}</td><td>${f.techs.size}</td><td>${wondersOf(f.id).length}</td>`
        + `<td>${f.eliminated ? '—' : f.nation.pop}</td><td>${f.eliminated ? '—' : game.territory.claimCount[f.id]}</td></tr>`;
    }
    html += `</tbody></table><div class="lg-sub">Milestones</div><div class="lg-miles">`;
    for (const m of MILESTONES) {
      const got = game.victory.milestones[m.key];
      html += `<div class="row"><span>${got ? `<span class="dot" style="background:${CHART_COLORS[got.fid]}"></span>` : '<span class="dot empty"></span>'}${m.name} <span class="dim">+${m.pts}</span></span>`
        + `<span class="dim">${got ? `${game.factions[got.fid].name}, day ${Math.floor(got.t / DAY_NIGHT_CYCLE) + 1}` : 'unclaimed'}</span></div>`;
    }
    return html + `</div>`;
  },

  chronicleHTML(onlyMajor = false, limit = 0) {
    let list = game.chronicle.filter(e => !onlyMajor || e.weight === 'major');
    if (limit) list = list.slice(-limit);
    if (!list.length) return `<div class="lg-note">Nothing yet worth writing down.</div>`;
    let html = `<div class="chron">`;
    let day = -1;
    for (const e of list) {
      if (e.day !== day) { day = e.day; html += `<div class="chron-day">Day ${day}</div>`; }
      const dot = e.fid >= 0 ? `<span class="dot" style="background:${CHART_COLORS[e.fid]}"></span>` : '';
      html += `<div class="chron-e ${e.weight}">${dot}${escapeHTML(e.text)}</div>`;
    }
    return html + `</div>`;
  },

  // ---------- the history chart ----------
  // A line chart of one statistic for every nation over the match. 2px lines,
  // end dots with a surface ring, a legend above, direct labels at the line
  // ends when they do not collide, a crosshair and a tooltip listing every
  // nation at the hovered time, and a table view behind a toggle.
  mountChart(host, field, label) {
    if (!host) return;
    const samples = game.victory.samples.length ? game.victory.samples : [];
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ch-head';
    const title = document.createElement('span');
    title.className = 'ch-title';
    title.textContent = `${label} over the match`;
    head.appendChild(title);
    const legend = document.createElement('span');
    legend.className = 'ch-legend';
    for (const f of game.factions) {
      const item = document.createElement('span');
      item.className = 'ch-li';
      const key = document.createElement('span');
      key.className = 'ch-key';
      key.style.background = CHART_COLORS[f.id];
      item.appendChild(key);
      item.appendChild(document.createTextNode(f.isPlayer ? 'Azuria (you)' : f.name));
      legend.appendChild(item);
    }
    head.appendChild(legend);
    const tbtn = document.createElement('button');
    tbtn.className = 'ch-tbtn';
    tbtn.textContent = 'Table';
    head.appendChild(tbtn);
    host.appendChild(head);
    const wrap = document.createElement('div');
    wrap.className = 'ch-wrap';
    const cv = document.createElement('canvas');
    wrap.appendChild(cv);
    const tip = document.createElement('div');
    tip.className = 'ch-tip';
    wrap.appendChild(tip);
    host.appendChild(wrap);
    const table = document.createElement('div');
    table.className = 'ch-table';
    table.style.display = 'none';
    host.appendChild(table);
    tbtn.onclick = () => {
      const show = table.style.display === 'none';
      table.style.display = show ? 'block' : 'none';
      tbtn.textContent = show ? 'Chart' : 'Table';
      wrap.style.display = show ? 'none' : 'block';
      if (show) table.innerHTML = this.chartTableHTML(samples, field);
    };
    if (samples.length < 2) {
      wrap.innerHTML = `<div class="lg-note">The history is still being written — check back in a minute.</div>`;
      return;
    }
    const W = Math.max(280, Math.min(760, host.clientWidth || 640)), H = 200;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pad = { l: 46, r: 92, t: 10, b: 22 };
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    let max = 0;
    for (const s of samples) for (const v of s[field]) max = Math.max(max, v);
    const step = niceStep(max / 4);
    const top = Math.max(step, Math.ceil(max / step) * step);
    const X = t => pad.l + (t - t0) / Math.max(1, t1 - t0) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - v / top) * (H - pad.t - pad.b);
    g.fillStyle = CHART_SURFACE; g.fillRect(0, 0, W, H);
    // recessive grid: hairline, solid
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let v = 0; v <= top + 1e-6; v += step) {
      g.strokeStyle = CHART_GRID; g.lineWidth = 1;
      g.beginPath(); g.moveTo(pad.l, Math.round(Y(v)) + 0.5); g.lineTo(W - pad.r, Math.round(Y(v)) + 0.5); g.stroke();
      g.fillStyle = CHART_MUTED; g.textAlign = 'right';
      g.fillText(Math.round(v).toLocaleString(), pad.l - 6, Y(v));
    }
    // time axis: days
    g.textAlign = 'center'; g.textBaseline = 'top';
    const dayStep = Math.max(1, Math.ceil((t1 - t0) / DAY_NIGHT_CYCLE / 6));
    for (let d = Math.ceil(t0 / DAY_NIGHT_CYCLE); d * DAY_NIGHT_CYCLE <= t1; d += dayStep) {
      g.fillStyle = CHART_MUTED;
      g.fillText(`Day ${d + 1}`, X(d * DAY_NIGHT_CYCLE), H - pad.b + 5);
    }
    // lines
    const ends = [];
    for (const f of game.factions) {
      g.strokeStyle = CHART_COLORS[f.id]; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      samples.forEach((s, i) => { const x = X(s.t), y = Y(s[field][f.id]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      const last = samples[samples.length - 1];
      ends.push({ f, x: X(last.t), y: Y(last[field][f.id]), v: last[field][f.id] });
    }
    // end dots with a surface ring
    for (const e of ends) {
      g.fillStyle = CHART_SURFACE; g.beginPath(); g.arc(e.x, e.y, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = CHART_COLORS[e.f.id]; g.beginPath(); g.arc(e.x, e.y, 4, 0, Math.PI * 2); g.fill();
    }
    // direct labels at the ends, only where they do not collide (the legend
    // and tooltip carry identity otherwise)
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '11px system-ui, sans-serif';
    sorted.forEach((e, i) => {
      const prev = sorted[i - 1], next = sorted[i + 1];
      if ((prev && e.y - prev.y < 13) || (next && next.y - e.y < 13)) return;
      g.fillStyle = CHART_INK;
      g.fillText(`${e.f.isPlayer ? 'You' : e.f.name} ${Math.round(e.v).toLocaleString()}`, e.x + 9, e.y);
    });
    // crosshair + tooltip
    const base = g.getImageData(0, 0, cv.width, cv.height);
    const hover = ev => {
      const r = cv.getBoundingClientRect();
      const mx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      if (mx < pad.l - 4 || mx > W - pad.r + 4) { leave(); return; }
      let best = samples[0], bd = Infinity;
      for (const s of samples) { const d = Math.abs(X(s.t) - mx); if (d < bd) { bd = d; best = s; } }
      g.putImageData(base, 0, 0);
      const x = Math.round(X(best.t)) + 0.5;
      g.strokeStyle = '#6a7384'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke();
      for (const f of game.factions) {
        const y = Y(best[field][f.id]);
        g.fillStyle = CHART_SURFACE; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = CHART_COLORS[f.id]; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      }
      tip.innerHTML = '';
      const hd = document.createElement('div');
      hd.className = 'ch-tip-h';
      hd.textContent = `Day ${Math.floor(best.t / DAY_NIGHT_CYCLE) + 1} · ${fmtDuration(best.t)}`;
      tip.appendChild(hd);
      const rows = game.factions.map(f => ({ f, v: best[field][f.id] })).sort((a, b) => b.v - a.v);
      for (const { f, v } of rows) {
        const row = document.createElement('div');
        row.className = 'ch-tip-r';
        const k = document.createElement('span'); k.className = 'ch-tip-k'; k.style.background = CHART_COLORS[f.id];
        const val = document.createElement('b'); val.textContent = Math.round(v).toLocaleString();
        const nm = document.createElement('span'); nm.className = 'ch-tip-n'; nm.textContent = f.isPlayer ? 'Azuria (you)' : f.name;
        row.append(k, val, nm);
        tip.appendChild(row);
      }
      tip.style.display = 'block';
      tip.style.left = Math.min(W - 150, Math.max(0, x + 10)) + 'px';
      tip.style.top = pad.t + 'px';
    };
    const leave = () => { g.putImageData(base, 0, 0); tip.style.display = 'none'; };
    cv.onmousemove = hover;
    cv.onmouseleave = leave;
    cv.addEventListener('touchstart', hover, { passive: true });
    cv.addEventListener('touchmove', hover, { passive: true });
  },

  chartTableHTML(samples, field) {
    const step = Math.max(1, Math.floor(samples.length / 20));
    let html = `<table class="lg-table"><thead><tr><th>Time</th>${game.factions.map(f => `<th>${escapeHTML(f.isPlayer ? 'Azuria' : f.name)}</th>`).join('')}</tr></thead><tbody>`;
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      html += `<tr><td>${fmtDuration(s.t)}</td>${game.factions.map(f => `<td>${Math.round(s[field][f.id]).toLocaleString()}</td>`).join('')}</tr>`;
    }
    return html + `</tbody></table>`;
  },

  // ---------- the end screen ----------
  showEndScreen(info) {
    const el = document.getElementById('gameover');
    const win = info.kind === 'victory';
    const f0 = game.factions[0];
    const ranked = [...game.factions].sort((a, b) => legacyScore(b) - legacyScore(a));
    const epithet = playerEpithet();
    let html = `<div class="go-box">`
      + `<h1>${icon(win ? 'crown' : 'skull')} ${escapeHTML(info.title)}</h1>`
      + `<p>${escapeHTML(info.text)}</p>`
      + `<div class="go-epi">History will remember you as <b>the Sovereign of Azuria, ${epithet}</b>.</div>`
      + `<div class="go-meta">${fmtDuration(game.time)} · Day ${game.dayCount} · ${ERAS[f0.era].name} · Legacy ${legacyScore(f0).toLocaleString()} (${ranked.indexOf(f0) + 1} of ${ranked.length})</div>`
      + `<div class="chart-host go-chart"></div>`
      + `<table class="lg-table"><thead><tr><th>Nation</th><th>Legacy</th><th>Age</th><th>Techs</th><th>Wonders</th><th>People</th></tr></thead><tbody>`
      + ranked.map(f => `<tr class="${f.isPlayer ? 'me' : ''}"><td><span class="dot" style="background:${CHART_COLORS[f.id]}"></span>${f.isPlayer ? 'Azuria (you)' : escapeHTML(leaderFullName(f)) + ', ' + f.name}${f.eliminated ? ' (fallen)' : ''}</td>`
        + `<td><b>${legacyScore(f).toLocaleString()}</b></td><td>${ERAS[f.era].short}</td><td>${f.techs.size}</td><td>${wondersOf(f.id).length}</td><td>${f.eliminated ? '—' : f.nation.pop}</td></tr>`).join('')
      + `</tbody></table>`
      + `<div class="lg-sub">From the chronicle</div>${this.chronicleHTML(true, 14)}`
      + `<div class="go-btns">`
      + (win ? `<button id="go-continue" class="primary">Rule on (endless)</button>` : '')
      + `<button id="go-ledger">The full chronicle</button><button id="go-again">Play again</button></div></div>`;
    el.innerHTML = html;
    el.style.display = 'flex';
    this.mountChart(el.querySelector('.go-chart'), 'legacy', 'Legacy');
    el.querySelector('#go-again').onclick = () => location.reload();
    el.querySelector('#go-ledger').onclick = () => { this.ledgerTab = 'chronicle'; el.style.display = 'none'; this.toggleLedger('chronicle'); this.endHidden = true; };
    const cont = el.querySelector('#go-continue');
    if (cont) cont.onclick = () => { el.style.display = 'none'; game.continueAfterVictory(); };
  },
});

function niceStep(raw) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
