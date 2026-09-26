'use strict';
// The Research screen, the Age banner, and the knowledge readout on the topbar.
// Mixed into UI (js/ui.js) so it shares the panel conventions: rebuilt from
// game state on the half-second HUD refresh, wired with onclick after each
// rebuild, and never holding state the sim does not also hold.

Object.assign(UI.prototype, {
  toggleResearch() {
    const el = document.getElementById('research');
    if (el.classList.contains('open')) return this.closeResearch();
    el.classList.add('open');
    this.researchKey = null;
    this.refreshResearch(true);
  },
  closeResearch() { document.getElementById('research').classList.remove('open'); },
  researchOpen() { return document.getElementById('research').classList.contains('open'); },

  // Rebuilding the whole tree twice a second would fight the player's scroll
  // position and hover, so the tree is only rebuilt when something in it
  // changed state; the progress readouts are patched in place every refresh.
  refreshResearch(force = false) {
    if (!this.researchOpen()) return;
    const f = game.factions[0];
    const stateKey = [f.era, [...f.techs].join(','), f.research ? f.research.key : '-',
      f.researchQueue.join(','), !eraBlocker(f)].join('|');
    const el = document.getElementById('research');
    if (force || stateKey !== this.researchKey || this.researchDirty) {
      this.researchKey = stateKey;
      this.researchDirty = false;
      const scroll = el.querySelector('.rs-tree') ? el.querySelector('.rs-tree').scrollLeft : 0;
      el.innerHTML = this.researchHTML(f);
      const tree = el.querySelector('.rs-tree');
      if (tree) tree.scrollLeft = scroll;
      this.wireResearch(el, f);
    }
    this.patchResearchProgress(el, f);
  },

  researchHTML(f) {
    const rate = f.knowledgeRate;
    let html = `<div class="rs-head"><h2>${icon('book')} Research</h2>`
      + `<span class="rs-era">${icon('pillar')} ${ERAS[f.era].name}</span>`
      + `<span class="rs-rate">${icon('book')} <b>${rate.toFixed(2)}</b> knowledge/s`
      + (f.knowledgeBank >= 1 ? ` · <span class="dim">${Math.floor(f.knowledgeBank)} banked</span>` : '')
      + `</span><button id="rs-close" title="Close (T)">✕</button></div>`;

    // what is being studied right now
    if (f.research) {
      const k = f.research.key;
      html += `<div class="rs-now"><span>Studying <b>${researchName(k)}</b></span>`
        + `<div class="rs-bar"><div class="rs-fill" id="rs-fill"></div></div>`
        + `<span id="rs-eta" class="dim"></span>`
        + `<button class="rs-cancel" data-cancel="${k}" title="Stop — the knowledge is banked, not lost">Stop</button></div>`;
    } else {
      html += `<div class="rs-now idle">Nothing is being studied — knowledge is being banked. Pick a technology below.</div>`;
    }
    if (f.researchQueue.length) {
      html += `<div class="rs-queue"><span class="dim">Queued:</span> ` + f.researchQueue.map(k =>
        `<span class="rs-q">${TECHS[k].name}<button data-cancel="${k}" title="Remove from the queue">✕</button></span>`).join(' → ') + `</div>`;
    }

    // the next Age
    const next = ERAS[f.era + 1];
    if (next) {
      const err = eraBlocker(f);
      const have = techsOfEra(f, f.era);
      html += `<div class="rs-age ${err ? '' : 'ready'}"><div><b>${icon('pillar')} ${next.name}</b> — ${next.desc}</div>`
        + `<div class="dim">Needs ${have}/${next.needTechs} ${ERAS[f.era].short} technologies · ${eraKnowledgeCost(f.era + 1)} knowledge · ${costText(next.cost)}</div>`
        + (f.research && f.research.key === 'era:' + (f.era + 1)
          ? `<div class="good">Your nation is advancing…</div>`
          : `<button id="rs-age" ${err ? 'disabled' : ''} title="${err || 'Begin the advance'}">Advance to the ${next.name}</button>`
            // the tech count is already on the line above; only say what else is missing
            + (err && have >= next.needTechs ? ` <span class="dim">${err}</span>` : ''))
        + `</div>`;
    } else {
      html += `<div class="rs-age ready"><b>${icon('pillar')} ${ERAS[f.era].name}</b> — the final Age. ${hasTech(f, 'enlightenment') ? 'Your nation is Enlightened.' : 'The Enlightenment awaits.'}</div>`;
    }

    // the tree: one column per Age
    html += `<div class="rs-tree">`;
    for (let e = 0; e < ERAS.length; e++) {
      const locked = e > f.era;
      html += `<div class="rs-col ${locked ? 'locked' : ''}"><div class="rs-colhead">${ERAS[e].name}${locked ? ' ' + icon('lock') : ''}</div>`;
      for (const b of ['economy', 'military', 'civic']) {
        const keys = TECH_KEYS.filter(k => TECHS[k].era === e && TECHS[k].branch === b);
        for (const k of keys) html += this.techCardHTML(f, k);
      }
      html += `</div>`;
    }
    html += `</div><div class="dim rs-foot">Click a technology to study it — or a later one to queue the whole path to it. Scholars in Libraries and Universities make knowledge; so do Churches. Press T to close.</div>`;
    return html;
  },

  techCardHTML(f, k) {
    const t = TECHS[k];
    const known = f.techs.has(k);
    const studying = f.research && f.research.key === k;
    const queued = f.researchQueue.includes(k);
    const block = techBlocker(f, k);
    const state = known ? 'known' : studying ? 'studying' : queued ? 'queued' : !block ? 'avail' : 'blocked';
    const req = t.req.length ? `<div class="rs-req">${t.req.map(r =>
      `<span class="${f.techs.has(r) ? 'good' : ''}">${TECHS[r].name}</span>`).join(', ')}</div>` : '';
    const tag = known ? '✓' : studying ? '…' : queued ? `#${f.researchQueue.indexOf(k) + 1}` : `${techCost(k)}`;
    return `<div class="tcard ${state}${t.project ? ' project' : ''}" data-tech="${k}" style="--branch:${TECH_BRANCHES[t.branch].css}" title="${techSummary(k)}${block && !known ? '\n' + block : ''}">`
      + `<div class="tc-top"><b>${t.name}</b><span class="tc-cost">${known || studying || queued ? tag : icon('book') + tag}</span></div>`
      + `<div class="tc-desc">${t.desc}</div>${req}</div>`;
  },

  wireResearch(el, f) {
    el.querySelector('#rs-close').onclick = () => this.closeResearch();
    el.querySelectorAll('[data-cancel]').forEach(b => {
      b.onclick = e => { e.stopPropagation(); cancelResearch(f, b.dataset.cancel); this.refreshResearch(true); };
    });
    const age = el.querySelector('#rs-age');
    if (age) age.onclick = () => {
      const err = startEraAdvance(f);
      if (err) game.log(err, 'bad');
      this.refreshResearch(true);
    };
    el.querySelectorAll('.tcard').forEach(c => {
      c.onclick = () => {
        const k = c.dataset.tech;
        if (f.techs.has(k) || (f.research && f.research.key === k)) return;
        const err = techBlocker(f, k) ? queueResearchPath(f, k) : startResearch(f, k);
        if (err) game.log(err, 'bad');
        this.refreshResearch(true);
      };
    });
  },

  patchResearchProgress(el, f) {
    const fill = el.querySelector('#rs-fill');
    if (!fill || !f.research) return;
    const cost = researchCost(f.research.key);
    fill.style.width = `${Math.min(100, f.research.progress / cost * 100)}%`;
    const eta = el.querySelector('#rs-eta');
    const left = cost - f.research.progress;
    if (eta) eta.textContent = `${Math.floor(f.research.progress)}/${cost}` + (f.knowledgeRate > 0.01 ? ` · ~${fmtDuration(left / f.knowledgeRate)}` : '');
  },

  // The knowledge readout on the topbar: rate, and what is being studied.
  refreshKnowledgeStat() {
    const f = game.factions[0];
    const k = document.getElementById('r-know');
    if (!k) return;
    k.textContent = `+${f.knowledgeRate.toFixed(1)}`;
    const st = document.getElementById('r-study');
    if (f.research) {
      const pct = Math.floor(f.research.progress / researchCost(f.research.key) * 100);
      st.textContent = `${researchName(f.research.key)} ${pct}%`;
      st.className = 'study';
    } else {
      st.textContent = 'Choose research';
      st.className = 'study idle';
    }
    const era = document.getElementById('r-era');
    if (era) era.innerHTML = `${icon('pillar')} ${ERAS[f.era].short}`;
  },

  // A title card across the middle of the screen for the big moments — a new
  // Age, a Wonder, a victory race tightening. Queued, so two never overlap.
  announce(title, sub = '', cls = '') {
    this.announceQ = this.announceQ || [];
    this.announceQ.push({ title, sub, cls });
    if (!this.announcing) this.nextAnnounce();
  },
  nextAnnounce() {
    const el = document.getElementById('announce');
    const a = this.announceQ.shift();
    if (!a) { this.announcing = false; el.classList.remove('show'); return; }
    this.announcing = true;
    el.className = 'hud show ' + a.cls;
    el.innerHTML = `<div class="an-title">${a.title}</div>` + (a.sub ? `<div class="an-sub">${a.sub}</div>` : '');
    clearTimeout(this.announceT);
    this.announceT = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => this.nextAnnounce(), 700);
    }, 4200);
  },

  // Build-bar buttons for things this nation cannot build yet carry a lock and
  // say why. Recomputed when research or the Age changes, not every frame.
  refreshBuildLocks() {
    const f = game.factions[0];
    const key = [f.era, f.techs.size].join('|') + (typeof wonderStateKey === 'function' ? wonderStateKey() : '');
    if (key === this.buildLockKey) return;
    this.buildLockKey = key;
    document.querySelectorAll('#buildbar .bbtn[data-key]').forEach(btn => {
      const k = btn.dataset.key;
      const why = buildingBlocker(f, k);
      btn.classList.toggle('locked', !!why);
      const t = BUILDING_TYPES[k];
      btn.title = why ? `${t.name} — ${why}` : t.desc + (t.reqText ? ` (${t.reqText})` : '');
    });
  },
});

function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s.toString().padStart(2, '0')}s`;
}
