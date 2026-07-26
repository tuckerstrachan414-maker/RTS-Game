# Dev notes: formations, castle tiers, tap gestures, tooltips, hide-UI

Reference for whoever (human or Claude) picks this codebase up next. Covers the
feature set added on top of the M1–M5 + mobile/trade/raiding milestones: army
formations with crowd separation, castle-tier troop unlocks, double-tap
gestures, HUD resource tooltips, the hide-UI toggle, and fortification
rendering/placement. Read alongside the top-level `README.md` (player-facing)
— this file is implementation-facing.

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

   Since forest and rock became walkable rough ground (`map.moveCost`,
   `js/map.js`), "passable" is no longer the same as "good standing room":
   `freeSpotNear` now takes the nearest tile with `moveCost === 1` and keeps the
   first rough tile it saw only as a fallback. Without that, a rank ordered to
   the edge of a wood forms up *inside* it and straggles in at 40% speed.
   `Faction.spawnPointNear` (`js/factions.js`) does the same two-pass search for
   the same reason — new recruits should muster on open ground.

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

`#gameover` is the same kind of exception as `#difficulty`: not `.hud`, because
it belongs to the frame around the game rather than the game's HUD. Its buttons
now live in a `.go-btns` flex row — **Keep playing** (`#keep-playing`, styled as
the primary action and shown only on a win) and Play again. `Game.end` toggles
the button's visibility and binds its handler; `Game.resume` hides the overlay
and unfreezes the sim. See "Victory & defeat" in `docs/FEATURES.md`.

## Fortification rendering & drag-build placement — `js/assets.js`, `js/ui.js`

Walls used to draw as procedural rectangles, then as one of two whole sprites
per tile (wall sprite for straight runs, tower sprite for everything else).
Neither connected: the atlas art is a side elevation drawn as standalone tiles
with grass baked into the margins and the parapet stopping short of the tile
edge, so consecutive segments never met. There was no vertical art in use at
all — a north–south run stacked the *horizontal* sprite — and gates went
through `drawBuilding`, joining nothing.

**The rampart set (`bakeRamparts` in `js/assets.js`)** is five pieces baked per
faction at load time, each the same atlas sprite edited only enough that its
tile edges match its neighbours':

| Piece | Source | Edit |
|---|---|---|
| `wallH` | `AT.WALL` | grass margin (cols 12–15) refilled from the parapet band at col 1, so the band reaches both edges. Pillar untouched |
| `wallV` | `AT.WALL_V` (`[1,3]`, previously the unused `AT.ROAD`) | flattened to one repeated row; the column is already uniform, this just drops stray pixels that repeated into studs |
| `tower` | `AT.WALL_TOWER` | grass stripped only |
| `gateH` | `AT.GATE` | grass stripped only — its parapet already spans the full width on the same rows as `wallH`'s band |
| `gateV` | `wallV` + `AT.GATE`'s arch | a 6×6 block of the arch, exactly the column's width, composited into the middle. The vertical gate the tileset never had |

The art cooperates more than it looks: `wallV`'s column is pixel-for-pixel the
base `WALL_TOWER` already trails downward, and `GATE`'s parapet sits on exactly
`WALL`'s band rows. All the seams are asserted in the verification script (see
Testing below) by comparing edge rows/columns of the baked canvases.

**`drawRampart` (`js/ui.js`)** assembles each tile. A clean straight run draws
the matching connector whole; anything else — corner, T, cross, end, lone post,
diagonal — draws a *half* connector toward each neighbour it actually has
(`drawTileSlice`) and then a tower over the join. Half, because a full
connector at a corner sprouts a length of wall into empty ground. Gates take
the same stubs and cover the middle with the arch, choosing `gateV` when the
run through them has more vertical neighbours than horizontal. The owner
marker sits high on the parapet rather than at the tile centre, which is where
a gate's archway is.

**Sprite baking (`bakeTile` in `js/assets.js`)** extracts a single 16×16
atlas tile into its own canvas and cleans it up, via four independent options:
- `stripGreen` — knocks out the grass baked into a sprite's corners (opaque
  green pixels become transparent). Used for every rampart piece.
- `replicateMid: [a, b]` — rebuilds every row from the clamped `[a..b]` band,
  erasing the sprite's top/bottom end-caps. Used for `wallV`/`gateV` and for
  the vertical bridge (`Assets.bridgeVmid`) so a north–south span reads as one
  continuous run instead of broken segments at each tile boundary; the
  horizontal bridge doesn't need this and still draws straight from the atlas.
- `fillCols: [x0, x1, src]` — overwrites columns `x0..x1` with a copy of column
  `src`, extending a band that stopped short of the tile edge. Used for `wallH`.
- `overlay: {at, sx, sy, w, h, dx, dy}` — composites a rect from another atlas
  tile on top. Used to put `GATE`'s arch into `gateV`.

`drawTileCanvas(canvas, x, y)` is the shared helper that blits one of these
baked canvases at a tile position (every rampart piece, the vertical bridge
mid, and the wall/gate/bridge placement ghosts all go through it instead of
`tile()`, which draws straight from the shared atlas image).
`drawTileSlice(canvas, x, y, px, py, pw, ph)` is its partial form — it maps a
source rect to the same fraction of the tile's screen rect, using the same
maths at the extremes, so a half-tile stub lines up exactly with a full-tile
draw of the same sprite.

**Forest canopy (`drawForest` / `drawTreeClump` / `spriteAt` in `js/ui.js`)**
is the other place tiles stopped drawing one-to-one. `T_TREE` tiles draw only
their grass (and a tuft) in the terrain loop; the trees themselves come in a
second pass right after it, so a canopy can spill over the tiles around it
instead of being clipped by the next row of grass. Each tree tile draws 2–4
copies of the *same* `AT.TREES` sprites — no new art — at ~`TREE_CANOPY` (2)
tiles across, bottom-centre anchored via `spriteAt` so they grow upward out of
their tile, jittered in both axes and drawn undergrowth-first. Clump size
follows `countAdjacent(x, y, T_TREE)` so the interior of a wood is dense and the
fringe still shows individual trees, and drops to two sprites at zoom 1 where
the detail is sub-pixel anyway. All offsets come from `tileNoise(x, y)`, a pure
hash of the tile coordinates — using `Math.random` here would make the forest
crawl every frame. Draw order is terrain → canopy → borders → buildings →
units, so units crossing a wood stay visible on top of it.

**Building on rough terrain + the placement ghost (`canPlace`/`placeBuilding`
in `js/buildings.js`, `drawGhost`/`placementFootprint`/`drawForest` in
`js/ui.js`)** — BUGS #18. `canPlace` used to require `T_GRASS`, so a wall ring
stopped dead at the treeline even after forest became walkable rough ground;
`placeBuilding` now clears whatever `T_TREE`/`T_ROCK` a footprint lands on
(terrain → grass, decor cleared, `treeWood` zeroed — the same treatment
`GameMap.carveLine` gives a cut track), and since the AI's own wall placement
(`aiRingTileConnected`) already calls `canPlace`, rings close on their own with
no AI-side change. Caves are deliberately excluded — a resource mouth, not
buildable ground.

The ghost's feedback changed to match: `drawGhost` fills the hovered footprint
white when `canPlace` (+ affordability) passes and red when it doesn't, instead
of the old outline-only green/red, so validity reads at a glance even over
terrain. `placementFootprint()` turns the hovered tile + `type.size` into a Set
of `map.idx` values (bounds-checked — an out-of-bounds index would alias a real
tile through the `y*w+x` formula, so unchecked reuse of it elsewhere would be a
bug); `drawForest` accepts that same set as a fade list and renders any tree
inside it at ~32% opacity, so a canopy about to be cleared doesn't visually
fight the white/red wash. Both draws read the *same* footprint each frame, so
they can't disagree about which tiles are in play.

**Diagonal wall drag (`paintTo` in `js/ui.js`)** snaps a build-drag to
whichever axis it's closest to — horizontal, vertical, or, for walls only, a
45° diagonal (Clash-of-Clans style: `adx`/`ady` within a 2.5:1 ratio of each
other picks the diagonal). Gates and bridges never go diagonal; bridge
orientation still comes from whichever of horizontal/vertical the drag
resolved to.

## 2026-07 AI-overhaul touchpoints (formations & hide-UI)

The enemy-AI overhaul reuses two systems documented here:

- **`formationMove` is now also the AI's marching order.** Attack waves
  (`aiWarTick`/`aiTickWave` in `js/ai.js`) stage by calling
  `formationMove(waveUnits, sx, sy)` toward a border staging point, and
  survivors formation-move home on disband. The melee-in-front sort must stay
  stable — both the player and every AI wave depend on it.
- **Scouts deliberately bypass `formationMove`.** A scout carries
  `mission = {kind: 'scout'}`, and `formationMove` filters mission units out
  (`js/units.js:405`), so `AICombatManager` issues `u.orderMove` directly. The
  mission also excludes the rider from `armyUnits()` and from the auto-acquire
  branch in `Unit.tick`, which is exactly what a scout wants: it rides, it
  looks, it does not stop to fight. Two consequences worth remembering before
  touching this: an unknown `mission.kind` falls through both the `rob`/`haul`
  branches in `Unit.tick` and the `caravan`/`envoy` branches in
  `Diplomacy.tick`, which is why a new mission kind was safe to add; and
  `orderMove` sets `dest` even when `findPath` finds no route, so anything
  driving units by "has it arrived?" must clear `dest` itself and retry
  (`AICombatManager.orderScoutTo`; see BUGS #15).
- **Hide-UI list gained `#eventcard`** (the AI choice-card element) in
  `index.html`'s `body.ui-hidden` CSS list. The pre-game `#difficulty` overlay
  is deliberately NOT `.hud` — it exists before the game does, styled like
  `#gameover`, and is also hidden by the portrait-rotate prompt rules.

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
`window.game`. A verification suite for the AI rework lives in that same pattern — it boots
`?seed=N&difficulty=…`, drives `game.tick(0.1)` loops, and asserts: no war
inside the opening ~150s across four seeds; the archetype line-up differs by
seed; war does not fire on the first tick of an advantage but does once fresh
intel and a held edge exist; marginal utility spikes when a quarry is removed
and `evaluateWarVersusTrade` splits by archetype; memory is empty before contact
and confidence decays (while the *threat* estimate rises) after it; taxes dip
before dawn and happiness clears the growth gate; conquest annexes buildings
with stores intact; and 10 sim-minutes on each difficulty run crash-free with a
nation climbing past castle tier 1.

Things worth re-checking after any change in this area:
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
