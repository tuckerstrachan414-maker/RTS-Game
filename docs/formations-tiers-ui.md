# Dev notes: formations, castle tiers, tap gestures, tooltips, hide-UI

Reference for whoever (human or Claude) picks this codebase up next. Covers the
feature set added on top of the M1–M5 + mobile/trade/raiding milestones: army
formations with crowd separation, castle-tier troop unlocks, double-tap
gestures, HUD resource tooltips, and the hide-UI toggle. Read alongside the
top-level `README.md` (player-facing) — this file is implementation-facing.

## Formations & crowd separation — `js/units.js`

Two independent systems that combine to keep armies looking and behaving like
armies instead of a pile of clipped sprites.

**`formationMove(units, tx, ty)`** replaces the old "spread into a grid square"
logic in `ui.js`'s `rightClick()`. Given a group and a target tile:
1. Filters to movable units (alive, no active mission, not an envoy/Prince).
2. Computes the group's centroid and the travel angle (`atan2` from centroid
   to target).
3. Sorts units so melee (`range <= 1.5`) comes before ranged, and within each
   bucket higher-HP units come first — melee/tanky units end up in the front
   ranks.
4. Lays units out in a rotated grid (`cols` scales with group size, capped at
   6): `depth` = which rank back from the point, `lateral` = position across
   that rank, both rotated by the travel angle so the formation always faces
   where it's going.
5. Each unit's ideal tile is resolved through `freeSpotNear` (spiral search,
   radius 0–2) against a `taken` set so no two units in the same order ever
   get the same destination tile. Falls back to the raw target tile if no
   spiral spot is free.

Single-unit selections skip all of this and just call `orderMove` directly.

**`separateUnits(dt)`**, called every tick from `Game.tick()` in `main.js`,
is the physical no-overlap constraint — it runs regardless of whether units
are marching in formation, standing still, or fighting. Every alive unit
across every faction is bucketed into a spatial hash (`floor(x) + floor(y) *
4096` as key, 1-tile cells) so each unit only checks its own cell and the 8
neighbors — O(n) instead of O(n²) for reasonably spread-out armies. Any pair
closer than `SEP_RADIUS` (0.45 tiles) gets pushed apart along the vector
between them, capped at `1.5 * dt` tiles/tick so it never snaps. Perfectly
stacked units (`d < 1e-4`, e.g. two units spawned on the exact same point)
get a deterministic per-unit angle (`id * 2.399963` mod 2π, the golden-angle
trick) so they separate instead of dividing by zero.

`nudgeUnit(u, mx, my)` is the shared move-with-terrain-check helper used by
separation: a nudge is allowed if the destination tile is passable, **or**
if the unit's current tile is already impassable — that second clause is the
escape hatch. Without it, a unit that ends up on an impassable tile (e.g.
spawned on a building footprint, or the map changed under it) could never be
pushed off since every candidate destination would also fail the passability
check relative to a unit that "shouldn't" be there. This was a real bug hit
during testing (see Testing section) — six units stacked directly on the town
hall footprint stayed frozen at distance 0 until this clause was added.

If you touch formation logic, keep the melee-in-front sort stable — the AI
and the player both rely on `formationMove` for group orders, so a formation
that puts archers in the front line is a regression, not a style choice.

## Castle-tier troop unlocks — `js/buildings.js`, `js/factions.js`, `js/ui.js`

Simple gated-progression system, not a tech tree — there are only two
upgrade tiers above the base castle.

- `UNIT_TIERS` (`js/units.js`, near the top) maps unit key → tier. Anything
  not listed defaults to tier 1 (always available): sword, spear, archer,
  bandit, prince. Tier 2: shield, halberd, crossbow, horseman. Tier 3: mage,
  archmage, cavalier, king.
- `CASTLE_UPGRADES` (`js/buildings.js`, right after `BUILD_MENU`) is keyed by
  the tier it unlocks (`2`, `3`), each entry `{ name, cost, time, desc }`.
  Tier 2 = "Garrison" (100 wood / 80 stone / 60 gold, 20s). Tier 3 = "Royal
  Academy" (150/150/150, 30s).
- `Faction.castleTier` starts at 1. `Faction.trainUnit(typeKey)` rejects with
  a locked-message string (`Locked — requires the <name> castle upgrade`)
  when `type.tier > this.castleTier` — check this return value the same way
  other `trainUnit` failure strings are checked, it's not an exception.
- `Faction.startCastleUpgrade()` validates a built castle exists, the next
  tier exists (`CASTLE_UPGRADES[castleTier + 1]`), no upgrade is already in
  progress on that castle, and the nation can afford it — then pays the cost
  and sets `castle.upgrading = { tier, t: 0 }`.
- `Faction.tickTraining(dt)` advances `b.upgrading.t` alongside the existing
  unit-training queue logic, and on completion does
  `this.castleTier = Math.max(this.castleTier, b.upgrading.tier)` (a `max`
  guard in case of multiple castles/upgrades racing) and logs for the player
  faction specifically.
- AI (`aiTick` in `js/factions.js`) purchases upgrades opportunistically —
  triggered by threat level > 25, aggression ≥ 0.5, or population > 22, gated
  on affordability — and its training-pool selection is filtered by
  `UNIT_TYPES[k].tier <= f.castleTier` so it never tries to queue a locked
  unit.
- UI (`js/ui.js`, `refreshPanel()`): castle panel shows the current tier
  name, renders locked train buttons with a 🔒 and an unlock-hint tooltip
  instead of hiding them outright (so players can see what they're working
  toward), and shows an upgrade button/progress bar driven straight off
  `CASTLE_UPGRADES` and `castle.upgrading`.

Adding a tier 4 later: add an entry to `UNIT_TIERS`, add `4: {...}` to
`CASTLE_UPGRADES`, and everything else (gating, AI purchase logic, UI
lock/progress rendering) picks it up automatically — none of it is
hardcoded to two tiers except the fact that only two exist in the data.

## Double-tap gesture — `js/ui.js`

`handleTap(x, y)` (called from the touch-end handler) is the single entry
point for tap-based interaction:

- Compares against `this.lastTap` (`{x, y, t}` of the previous tap). If the
  new tap is within 350ms and 40px of the last one, it's a double-tap:
  cancels any pending deferred select, clears `lastTap`, and calls
  `rightClick(x, y)` — the same command dispatch used by desktop right-click
  and the pre-existing two-finger tap (move / attack / rob a storehouse with
  bandits selected / set castle rally, depending on what's selected and
  what's under the tap).
- Otherwise it's a potential first-tap-of-a-double-tap. If something
  order-capable is currently selected (units, or the player's own castle),
  the select-on-tap (`clickSelect`) is **deferred** 260ms via
  `this.tapTimer` rather than firing immediately — this is what stops the
  first tap of a double-tap from deselecting the army before the second tap
  arrives. If nothing order-capable is selected, there's nothing to
  preserve, so `clickSelect` fires immediately for responsiveness.
- `rightClick()` itself calls `clearTimeout(this.tapTimer)` at the top so any
  action command (from mouse, two-finger tap, or the double-tap path above)
  supersedes a still-pending deferred select.

If you change the double-tap timing, keep both constants in mind together:
350ms/40px is the *double-tap* detection window, 260ms is the *deferred
select* delay, and the deferred delay must stay shorter than the double-tap
window or a legitimate double-tap will already have fired the single-select
before the second tap lands.

## Resource tooltips — `js/ui.js`, `index.html`

Topbar stat spans in `index.html` carry `data-tip="food|wood|stone|gold|pop|
idle|happy"`. `buildHud()` wires a click handler on each that calls
`toggleTooltip(el.dataset.tip)`.

- `toggleTooltip(key)` flips `this.tooltip` between `null` and `key` (open
  panel toggling: tapping the same stat again closes it) and calls
  `refreshTooltip()`.
- `refreshTooltip()` shows/hides `#tooltip` and sets its `innerHTML` from
  `tooltipHTML(this.tooltip)`. It's also called every panel-refresh tick from
  `main.js`'s render loop so numbers stay live while the tooltip is open,
  not just at the moment it was opened.
- `tooltipHTML(key)` builds the per-resource explainer: what the resource
  is, which buildings/tiles produce it, and live income/consumption via
  `estimateIncome(f, res)`.
- **`estimateIncome(f, res)`** (bottom of `js/ui.js`) is a deliberately
  side-effect-free re-implementation of the math in `buildingProduction`
  (the real per-tick production function). It exists because the real
  function *mutates* state as a side effect (tree tiles deplete when
  harvested, etc.) — calling it just to read a number for a tooltip would
  double-harvest resources. If production math changes, update both
  functions or the tooltip numbers will drift from actual income.

Adding a new tooltip-able stat: add `data-tip="key"` to the HTML element, add
a `case 'key':` branch (or equivalent) in `tooltipHTML`.

## Hide UI toggle — `js/ui.js`, `index.html`

Pure CSS-class toggle, no state beyond `body.classList`:
- `#ui-btn` (🙈, sidebar) adds `ui-hidden` to `<body>`; `#ui-show` (👁,
  small floating button, only visible when the class is present) removes it.
  Both wired in `buildHud()`.
- The `h` key does `document.body.classList.toggle('ui-hidden')` in the
  global keydown handler.
- `index.html` CSS: `body.ui-hidden` sets `display: none` on everything
  tagged `.hud` plus a short list of extra always-on elements (see the CSS
  block near `#ui-show` styling). `#ui-show` itself is explicitly excluded
  so there's always a way back in.

New HUD elements should get the `.hud` class if they should disappear with
everything else; anything meant to stay visible while hidden (like the
restore button) needs to be added to the exclusion list explicitly, not just
left unclassed, since default CSS specificity won't save you.

## Testing this feature set

No test framework is wired into the repo (consistent with the rest of the
project — see README's "no build step" philosophy). Verification for this
batch was done with ad hoc headless Playwright scripts driving the
already-running `game`/`ui` globals via `page.evaluate`, fast-forwarding
with `game.tick(0.1)` in a loop for deterministic time control. Those
scripts were scratch files, not committed — if you need to re-verify this
area, the pattern is:

```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:PORT/index.html?seed=42');
await page.waitForFunction(() => typeof game !== 'undefined' && game && typeof ui !== 'undefined' && ui);
const result = await page.evaluate(() => { /* poke game/ui, run game.tick(0.1) in a loop, return assertions */ });
```

Note `game`/`ui` are `let`-scoped in `main.js`, not attached to `window` —
`waitForFunction` must check `typeof game !== 'undefined'`, not
`window.game`. Things worth re-checking after any change in this area:
- Stack several units on one tile, tick a few seconds, assert pairwise
  distances exceed `SEP_RADIUS`.
- Send a mixed-composition group on a formation move, assert every unit gets
  a unique `dest` tile and melee units land closer to the target than ranged.
- Train a locked unit (expect a rejection string), buy the upgrade, tick past
  its `time`, train again (expect success); repeat for tier 3.
- Simulate a tap, then a second tap at the same point within 350ms, assert
  a move/attack order was issued.
- Toggle a tooltip open, check `#tooltip` content and `display`, toggle
  closed.
- Toggle hide-UI, check computed `display` on a `.hud` element flips both
  ways.
- Run several sim-minutes of `game.tick` with AI factions funded, confirm at
  least one climbs past tier 1 without the game crashing (`game.over` stays
  false unless an actual win/loss condition was met).
