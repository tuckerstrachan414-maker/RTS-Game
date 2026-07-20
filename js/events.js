'use strict';
// Player-facing choice events ("event cards"). AI-initiated interactions —
// proposals, ultimatums, peace offers, border disputes — arrive as non-pausing
// cards with 2-3 response buttons and an expiry timer. Ignoring a card has
// consequences (onExpire). Rendering lives in ui.js (refreshEventCard).

let nextEventId = 1;

// ev: { kind, from, title, body, options: [{label, cls, apply}], expires?, onExpire? }
// Returns false (and drops the event) if a same-kind card from that faction is
// already up, or the sender is inside its politeness cooldown — the player is
// never spammed.
function pushPlayerEvent(ev) {
  if (game.events.some(e => e.kind === ev.kind && e.from === ev.from)) return false;
  const f = game.factions[ev.from];
  if (f && f.ai) {
    if (game.time < f.ai.eventCooldownUntil) return false;
    f.ai.eventCooldownUntil = game.time + 45;
  }
  ev.id = nextEventId++;
  if (!ev.expires) ev.expires = game.time + 45;
  ev.span = ev.expires - game.time;
  game.events.push(ev);
  if (game.events.length > 3) {           // queue full: oldest expires early
    const old = game.events.shift();
    if (old.onExpire) old.onExpire();
  }
  return true;
}

function resolveEvent(ev, optionIndex) {
  const at = game.events.indexOf(ev);
  if (at < 0) return;
  game.events.splice(at, 1);
  const opt = ev.options[optionIndex];
  if (opt && opt.apply) opt.apply();
}

function tickEvents() {
  for (const ev of [...game.events]) {
    if (game.time >= ev.expires) {
      game.events.splice(game.events.indexOf(ev), 1);
      if (ev.onExpire) ev.onExpire();
    }
  }
}
