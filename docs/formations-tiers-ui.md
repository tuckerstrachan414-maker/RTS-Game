# Dev notes: formations, castle tiers, tap gestures, tooltips, hide-UI

Reference for whoever (human or Claude) picks this codebase up next. Covers the
feature set added on top of the M1–M5 + mobile/trade/raiding milestones: army
formations with crowd separation, castle-tier troop unlocks, double-tap
gestures, HUD resource tooltips, the hide-UI toggle, fortification
rendering/placement, and (see "Drag-preview placement + box-select buildings"
below) the drag-to-preview wall/gate/bridge placement and building box-select/
copy/paste/delete. Read alongside the top-level `README.md` (player-facing) —
this file is implementation-facing.

## Formations & crowd separation — `js/units.js`

Two independent systems that combine to keep armies looking and behaving like
armies instead of a pile of clipped sprites.

**`formationMove(units, tx, ty)`** replaces the old "spread into a grid square"
logic in `ui.js`'s `rightClick()`. Given a group and a target tile:
1. Filters to movable units (alive, no active mission, not an envoy/Prince).
2. Computes the group's centroid and the travel angle (`atan2` from centroid
   to target).
3. Sorts units by the *player's* marching order (`game.formations.order`, an
   array of unit keys, front first). A type not in the list sorts to the back.
   `Array.prototype.sort` is stable, so units of the same type keep their
   relative order between identical commands. The default order is the old
   hardcoded rule spelled out as data — melee, then ranged, tankiest first:
   `sword, spear, halberd, cavalier, king, archer, mage, bandit, prince`.
4. Asks `formationSlots(n, shape)` for `n` `[depth, lateral]` offsets in
   formation space (`-depth` = ranks back from the point, `lateral` = across),
   then rotates each by the travel angle so the formation always faces where
   it's going. Two shapes:
   - `rectangle` — the original block. `cols = clamp(ceil(sqrt(n * 1.7)), 2, 6)`,
     ranks stacked behind it.
   - `diamond` (default) — rank widths `1,2,…,W,…,2,1` where `W = ceil(sqrt(n))`.
     That sequence sums to exactly `W²  >= n`, so there is always room; a group
     too small to reach the wide rank just stops partway and marches as a wedge.
     Slots are filled front-to-back, so the head of the marching order takes the
     point.
4b. Caps every unit's speed to the group's slowest member (`Unit.formSpeed`,
   read in `followPath` *before* the terrain `moveCost` divisor, so roads and
   forest still modulate the capped pace). `formSpeed` is cleared on arrival and
   by `orderAttack`/`orderRob`/any plain `orderMove`, so it never leaks into a
   unit's next order. Without this a Cavalier (speed 3.2) reached a target 26
   tiles away 8.1 tiles ahead of a Swordsman (2.2) it set out beside; with it,
   1.2.
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

If you touch formation logic, keep the sort stable — the AI and the player
both rely on `formationMove` for group orders. The melee-in-front rule is now
a *default*, not a law: the player can deliberately put archers in the front
line from the Formations panel, and that is a choice, not a regression. What
would be a regression is the default order changing, or the sort becoming
unstable so a group reshuffles between identical commands.

**The preference is the player's, the pace cap is everyone's.** `formationMove`
only reads `game.formations` when `movers[0].faction === 0`; AI waves fall
through to the defaults. The speed cap has no such guard — an AI wave arriving
together is formation integrity, not the player's taste leaking into enemy
doctrine.

### The Formations panel — `index.html`, `js/ui.js`, `js/main.js`

`#formation-panel` is a second modal overlay layered above `#pause-menu`
(z-index 22 vs 20), opened from the `#pm-formations` button. It follows the
pause menu's pattern exactly: `.open` class toggles `display`, a click on the
backdrop closes it, and `ui.paused` stays true the whole time so the sim is
frozen underneath. Escape closes the innermost overlay first — the keydown
handler checks `#formation-panel.open` before `this.paused`, and
`closeFormations` restores `paused` from whether the pause menu is still open,
so Escape-Escape gets you back to the game.

- `UI.refreshFormations()` rebuilds both controls from `game.formations`;
  every edit goes through `UI.moveFormationRank(from, to)` or a shape button
  and then `UI.commitFormations()`, which writes to `localStorage` immediately.
  Nothing is buffered until "Done", so a closed tab never loses a setting.
- Reordering is available two ways on purpose: HTML5 `draggable` for mouse,
  and ▲/▼ buttons for touch, where drag events never fire at all. If you
  replace the drag implementation, keep the buttons.
- Persistence lives in `js/main.js`, not the UI: `loadFormations(name)` /
  `saveFormations(name, cfg)` / `sanitizeFormations(raw)`, keyed
  `nations_formation_<nation name>`. **Sanitize on load, always** — a save
  written against an older roster still names units that no longer exist, and
  an unknown key in `order` would silently sink every real unit's rank by one.
  `sanitizeFormations` drops unknown keys, de-duplicates, appends any unit type
  the save predates, and falls back to `diamond` for an unrecognized shape.
  It is also the reason `localStorage` access is inside a `try` — storage can
  be blocked outright, and the game must still boot.

## Targeting priorities — `js/units.js`, `js/ui.js`

`Unit.targetPriority` (default `'any'`) names one of `TARGET_PRIORITIES`, and
`matchesPriority(priority, target)` is the single predicate — `units`,
`structures`, or a literal `BUILDING_TYPES` key (`townhall`, `storehouse`,
`farm`, `house`). Adding a new priority is one entry in that array plus, for a
building type, nothing at all: the fallthrough case compares `t.type.key`.

**The filter belongs in `findEnemyNear` and nowhere else.** That is the design,
not an oversight, and there are three separate paths that could each have taken
the filter and deliberately do not:

- `Unit.orderAttack` — a direct order from the player. Standing orders never
  override a specific one.
- `Unit.takeDamage`'s fight-back clause. It only fires when the unit has no
  target at all, so a group already busy on a building is not diverted by
  taking fire, but a genuinely idle unit is never a statue. Both halves of that
  matter: filter it and a Storehouses-only group stands and dies; drop the
  `!this.target` guard and "Buildings only" stops working as a siege order.
- The AI. `f.brain.combat` never sets a priority, so AI units sit at `any` and
  behave exactly as before.

Two smaller things worth knowing:

- The 0.8 distance bias that leans acquisition toward troops over buildings
  only applies when `priority === 'any'`. With buildings the sole eligible
  target there is nothing to lean away from, and leaving the bias in made a
  Storehouses-only group refuse targets it was standing next to.
- `refreshPanel` runs twice a second off the frame loop and rebuilds the panel's
  `innerHTML`, which would tear an open `<select>` out from under the player
  mid-choice — and on touch, dismiss the OS picker. It now returns early while a
  `<select>` inside `#panel` holds focus. Anything else interactive and stateful
  added to that panel needs the same treatment (or `sel.blur()` before an
  explicit refresh, which is what the change handler does).

## Group roles — `js/units.js`, `js/territory.js`, `js/ui.js`

`Unit.groupRole` is `null | 'offensive' | 'defensive'`. Only `defensive` has
behaviour of its own; `offensive` and `null` are both "the way units have always
worked", kept as separate values so the panel can distinguish *set to
offensive* from *never assigned*.

`setGroupRole(role)` is the only place `defensivePost` is written on
assignment, and it plants the post on the tile the unit is standing on right
then — that is what makes "select a group, mark it Defensive" read as "hold this
ground" rather than needing a second click to say where.

Three separate mechanisms keep a garrison on its post, and all three are load
bearing — remove any one and it wanders:

1. **Acquisition is anchored to the post, not the unit.** `findEnemyNear` grew
   optional `ox`/`oy` origin arguments; a garrison passes its post. Sweeping
   from the unit instead would let the watched circle creep forward one step at
   a time as the unit walks toward whatever it found — a garrison would inch
   across the map behind a retreating enemy without ever technically chasing.
2. **The leash drops targets.** Anything more than `DEFENSE_LEASH + 1` (11)
   tiles from the post is released rather than pursued. The `+ 1` is
   hysteresis; without it a target sitting exactly on the boundary is acquired
   and dropped on alternating ticks, and the unit judders in place.
3. **Patrol pulls it home.** `tickPatrol` runs only when the unit is idle with
   no target and no path (the last `else if` in `Unit.tick`, ahead of the plain
   idle case). Past the leash it walks straight back to the post; inside it, it
   takes a new patrol leg every 5–11s. `setGroupRole` seeds `patrolT` from
   `game.rng()` so a squad assigned together does not step off in lockstep.

Verified by lure test rather than by reading: a 4000 HP decoy retreating one
tile per second out to 42 tiles from the post never pulled the garrison past
10.7 tiles, and tick-by-tick sampling over 90s found a patrolling garrison
outside its own claim on 0% of ticks.

Patrol legs come from `patrolTileNear` in `js/territory.js` (next to
`Territory.controls`, the bounds-safe claim test) — territory knowledge belongs
with territory. It draws from `game.rng`, not `Math.random`, so seeds replay;
it filters to open ground (`moveCost === 1`) as well as passable, same reason
`freeSpotNear` does; and it returns null rather than falling back to any
passable tile, so a garrison posted outside its own claim holds position
instead of hunting for friendly soil.

`UI.rightClick` re-posts a defensive group at its move destination. Without
that, ordering a garrison to move produces a unit that walks there, goes idle,
notices it is past the leash, and walks all the way back — which looks exactly
like a bug.

### Split Group — `js/ui.js`

`ui.splitMode` is `null` or `{picked: Set<unitId>}`. When set, `refreshPanel`
renders the chip list (`splitHTML`/`wireSplit`) instead of the normal unit
panel, and `clickSelect`, `boxSelect` and `rightClick` all return early — the
chips are the only input, so a stray tap on the map cannot silently discard a
half-finished pick. `clearSelection` clears the mode, since the selection the
pick refers to is gone.

Confirming replaces `selection.units` with the picked troops, which is the whole
point: the role and priority controls that reappear then act on the new group
alone. Confirm is disabled at 0 picks and at all of them — neither is a split.
The chip list is capped at `34vh` with `overflow-y: auto`, because a
select-army on a large army puts 30+ chips in a panel that already has to fit
above the build bar on a landscape phone.

Note the chips are rebuilt on every click (the whole panel is `innerHTML`), so
anything holding a reference to a chip element across a click is holding a
detached node — it caught the test harness before it caught a user.

## Castle-tier troop unlocks — `js/buildings.js`, `js/factions.js`, `js/ui.js`

Simple gated-progression system, not a tech tree — there are only two
upgrade tiers above the base castle.

- `UNIT_TIERS` (`js/units.js`, near the top) maps unit key → tier. Anything
  not listed defaults to tier 1 (always available): sword, spear, archer,
  bandit, prince. Tier 2: halberd, cavalier. Tier 3: mage, king. (The roster
  is nine units now — shield, crossbow, archmage and horseman were cut, and
  cavalier dropped from tier 3 to tier 2 to keep the Garrison worth buying.)
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
it belongs to the frame around the game rather than the game's HUD. There is
no way to win, so its `.go-btns` row holds one button — Play again — and
`Game.end` always renders the skull icon and "Defeat"; there used to be a won
branch (trophy icon, a *Keep playing* button, a `Game.resume` that unfroze the
sim past a banked win) but nothing in the game can reach it any more. See
"Defeat" in `docs/FEATURES.md`.

## HUD layout & stacking — `index.html`

The floating panels used to derive their offsets independently and collided on
every viewport that was not a wide desktop. Four rules now hold the whole thing
together; break any of them and something will overlap again.

**1. Anchors come from CSS variables, not per-panel arithmetic.** `:root`
defines `--hud-inset-t/r/b/l` (8px plus the matching `env(safe-area-inset-*)`),
`--hud-row2` (the first free row *under* the resource bar:
`inset-t + --topbar-h + 8px`) and `--hud-bottom2` (the first free row *above*
the build bar). `--topbar-h`/`--sidebar-w`/`--buildbar-h` are kept live by
`UI.watchLayout`'s `ResizeObserver`s, so collapsing a panel frees its space for
its neighbours automatically. Panels that hung off `var(--topbar-h) + 8px`
without adding the topbar's *own* 8px inset sat flush against it (or 2px under
it, for `#diplomacy`).

**2. A centred absolutely-positioned box uses `left:0; right:0; margin:0 auto`,
never `left:50%` + `translateX(-50%)`.** An abspos box anchored only by `left`
is shrink-to-fit against the space to its *right*, so `#buildbar` was capped at
roughly half the viewport and clipped its last build buttons even at 1440px
wide, `max-width: 96vw` notwithstanding. With `left:0; right:0; width:max-content`
it centres at its natural width and only scrolls when it genuinely cannot fit
(which on a 667px-wide phone it cannot — that is what `overflow-x:auto` is for).

**3. Each panel owns one slot.** Top-left: log. Top-centre: tooltip. Top-right
(left of the sidebar): diplomacy. Bottom-left: build panel. Bottom-centre:
`#place-bar`. Bottom-right: event card. `#eventcard` and `#diplomacy` were both
pinned to `top: topbar` / `right: sidebar + 16px`, i.e. the identical rectangle,
so opening Diplomacy buried a pending card. On coarse pointers the diplomacy
panel becomes a centred sheet and the event card moves to the top row, because
the bottom strip only has room for one panel on a 390px-tall screen.

**4. Placement controls live in `#place-bar`.** `#cancel-place`,
`#rotate-place` and `#paste-place` used to be three separately positioned
buttons at `top: 8px; left: 8/112/220px` — directly on top of the resource
readouts, every time you picked a building, with hardcoded x offsets that would
re-collide the moment a label's width changed. They are now flex children of
one centred row above the build bar (`#place-bar .hud { position: static }`
overrides `.hud`'s `position:absolute`). `UI.render` still toggles each
button's own `display`; the wrapper collapses to zero width when they are all
hidden. The hide-UI list carries `#place-bar` instead of the three ids.

**Stacking order**, highest last: event card 6 · place bar 7 · diplomacy 8 ·
tooltip 9 · game over 15 · pause menu 20 · difficulty 30 · rotate prompt 999.
Everything else is `z-index: auto` and therefore in document order, which is
what put the build bar and the message log *over* the touch diplomacy sheet.
The tooltip outranks diplomacy because it is opened deliberately and closes on
a tap; `#gameover` outranks every HUD panel because a game that has ended
should not have a diplomacy panel floating on top of the result.

Both full-screen overlays (`#difficulty`, `#gameover`) are
`justify-content: safe center` with `overflow-y: auto`. Plain `center`
overflows in *both* directions and the part above the viewport cannot be
scrolled to, which clipped the first difficulty card on a 375px-tall phone.

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
| `wallV` | `AT.WALL_TOWER` row 10 | that one row repeated down the tile |
| `tower` | `AT.WALL_TOWER` | grass stripped; the empty top row filled from the crenellation below it |
| `gateH` | `AT.GATE` | grass stripped only — its parapet already spans the full width on the same rows as `wallH`'s band |
| `gateV` | `wallV` + `AT.GATE`'s arch | a 6×6 block of the arch composited into the middle. The vertical gate the tileset never had |

`wallV` was originally `AT.WALL_V` (`[1,3]`) flattened to one row, which is a
**6px-wide column** (cols 5–10) with no shading. Beside `wallH`'s full-width
parapet a north–south run read as a line of fence posts rather than a wall, and
because the tower's body is 8px (cols 4–11) every tower in a vertical run
stepped out a pixel on each side and back in again. Taking the row straight off
`WALL_TOWER`'s own body makes wall and tower identical by construction — same
width, same shading, no step. The tower's crown had the matching problem in the
other axis: its row 0 is empty, so a wall coming down from the tile above met a
one-pixel transparent seam; `fillRows` copies row 1 up into it.

`GATE`'s parapet sits on exactly `WALL`'s band rows, so a gate drops into a
horizontal run untouched. All the seams are asserted in the verification script
(see Testing below) by comparing edge rows/columns of the baked canvases.

**`drawRampart` (`js/ui.js`)** assembles each tile. A clean straight run draws
the matching connector whole; anything else — corner, T, cross, end, lone post,
diagonal — draws a *half* connector toward each neighbour it actually has
(`drawTileSlice`) and then a tower over the join. Half, because a full
connector at a corner sprouts a length of wall into empty ground. Gates take
the same stubs and cover the middle with the arch, choosing `gateV` when the
run through them has more vertical neighbours than horizontal. The owner
marker sits high on the parapet rather than at the tile centre, which is where
a gate's archway is — and only on towers, gates and every third plain segment
(`(b.x + b.y) % 3`), because one per tile turned a long wall into a dotted line
of faction-coloured squares marching across the map.

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
- `fillRows: [y0, y1, src]` — the same for rows. Used to close the tower's crown.
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

**Forest canopy (`collectDepthLayers` / `drawTreeClump` / `spriteAt` in
`js/ui.js`)** is the other place tiles stopped drawing one-to-one. `T_TREE`
tiles draw only their grass (and a tuft) in the terrain loop; the trees
themselves come from the depth pass below, so a canopy can spill over the tiles
around it instead of being clipped by the next row of grass. Each tree tile
draws 2–4 copies of the *same* `AT.TREES` sprites — no new art — at
~`TREE_CANOPY` (2) tiles across, bottom-centre anchored via `spriteAt` so they
grow upward out of their tile, jittered in both axes and drawn
undergrowth-first. Clump size follows `countAdjacent(x, y, T_TREE)` so the
interior of a wood is dense and the fringe still shows individual trees, and
drops to two sprites at zoom 1 where the detail is sub-pixel anyway. All offsets
come from `tileNoise(x, y)`, a pure hash of the tile coordinates — using
`Math.random` here would make the forest crawl every frame. Boulders get the
same jitter treatment in their own sub-pass of the terrain loop (stamped dead
centre they lined up into a visible lattice), but stay under the depth pass —
they are low enough that nothing needs to pass in front of them.

**One depth pass for everything with height (`collectDepthLayers` + the sort in
`render`).** Trees, buildings, ramparts, units and loot piles used to be five
separate passes in a fixed order, which meant a building always painted over
the tree standing *in front* of it and a unit always painted over the building
it was standing *behind*. They now go into one list keyed by the world Y of
each thing's base — `y + TREE_BASE` for a clump, `y + size` for a building,
`y + UNIT_FOOT` for a unit (`drawUnit` hangs the 32px frame 0.72 of its height
above the position and every sheet bottoms out on frame row 30, so the soles
land 0.44 of a tile lower than `u.y`) — sorted ascending and drawn back to
front. Farms are the exception: `type.flat` marks a building whose art lies on
the ground, and those are painted with the terrain, because a crop field
scrubbing out the bottom of a canopy in front of it is the same bug in reverse.
Cost is ~1000 entries a frame at zoom 1, which measures as no change against
the old multi-pass render.

**Building on rough terrain + the placement ghost (`canPlace`/`placeBuilding`
in `js/buildings.js`, `drawGhost`/`placementFootprint`/`collectDepthLayers` in
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
bug); `collectDepthLayers` accepts that same set as a fade list and renders any tree
inside it at ~32% opacity, so a canopy about to be cleared doesn't visually
fight the white/red wash. Both draws read the *same* footprint each frame, so
they can't disagree about which tiles are in play.

**Diagonal wall drag (`paintTo` in `js/ui.js`)** snaps a build-drag to
whichever axis it's closest to — horizontal, vertical, or, for walls only, a
45° diagonal (Clash-of-Clans style: `adx`/`ady` within a 2.5:1 ratio of each
other picks the diagonal). Gates and bridges never go diagonal; bridge
orientation still comes from whichever of horizontal/vertical the drag
resolved to.

## Drag-preview placement + box-select buildings — `js/ui.js`, `index.html`

**Line placement used to place live, tile by tile, during the drag itself**
(the old `paintPlace`, called straight out of `paintTo`) — resources were spent
and buildings created mid-gesture, and letting go just stopped the spree.
That's now a true preview: `beginPaint` seeds `ui.paint = {anchor, line,
horizontal}`, and every `mousemove`/touch-move while dragging just recomputes
`paint.line` (the same axis/diagonal-snap math as before) — no `canPlace`
check, no payment, no `placeBuilding` call happens until release. `drawGhost`
grew a paint branch that walks `paint.line` and draws each tile through the
shared `drawGhostTile` helper (factored out of the old single-tile `drawGhost`
body so the hover ghost, the drag-line preview, and the paste preview below all
render identically), tracking a running cost total per resource so the wash
goes red once the *run so far* would outspend the nation, not just when one
tile is individually unaffordable. `endPaint` (mouseup / touch-end) is the only
place that now calls `canPlace`/`pay`/`placeBuilding`, walking the previewed
line once and skipping (not aborting) blocked or unaffordable tiles.
`placementFootprint()` (used by `drawForest` to fade trees under the ghost)
follows `paint.line` instead of just the hovered tile while a drag is live, so
the canopy-fade and the wash never disagree mid-drag either.

**Box-select now falls through to buildings.** `UI.boxSelect` still selects
units first if the box catches any (troops always win); only when it catches
*zero* units does it filter `game.factions[0].buildings` by AABB overlap into
`ui.selection.buildings` (a new array alongside the pre-existing single
`ui.selection.building`/`ui.selection.units`). A one-building result also sets
`selection.building` so the existing single-building panel (workers, storage,
castle controls, Demolish) needs no changes; a multi-building result renders a
new summary panel (`refreshPanel`, the `bs.length > 1` branch) with a type
breakdown and **Copy**/**Delete All** buttons. `drawBuilding`/`drawRampart`
check `selection.buildings.includes(b)` in addition to `selection.building ===
b` so every box-picked building gets the white selection outline, not just a
lone one.

**Copy/paste (`ui.copyBuffer`, `copySelected`/`pasteBuffer`/
`drawPastePreview`).** Copy captures each selected building's type key and its
tile offset from the group's top-left corner (`{key, dx, dy}` per part) — not
live references — so the source buildings can be deleted or moved without
corrupting the buffer. Unlike normal placement, the preview is **locked to the
tile at the center of the screen**, not the cursor: `drawPastePreview` computes
`screenToTile(canvas.width/2, canvas.height/2)` every frame and draws each part
at that anchor plus its stored offset (through the same `drawGhostTile`,
running the same cumulative-cost check as the line preview). The player pans
the camera to line the group up with the target ground, then clicks the
**Paste** button (`#paste-place`, shown/hidden in `render()` alongside
`#cancel-place`) — or presses it again for another copy; the buffer persists
until Cancel/Escape/right-click, deliberately mirroring shift-held repeat
placement. `pasteBuffer` places every part whose tile is legal and affordable
and silently skips the rest, same skip-don't-abort convention as `endPaint`.
Town Halls are excluded from `copySelected`'s source filter (there's no
in-game path to place a second one). Ctrl+C and Delete/Backspace are the
desktop keyboard equivalents of the panel's Copy and Delete All/Demolish
buttons, guarded against firing while an `<input>` (the tax slider) has focus.

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
  `index.html`'s `body.ui-hidden` CSS list, and `#cancel-place`/`#rotate-place`/
  `#paste-place` were replaced in it by their wrapper `#place-bar`. The pre-game `#difficulty` overlay
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

The 2026-07 visual pass added two more ad hoc harnesses on top of that, worth
rebuilding if you touch the renderer or the HUD layout:

- **Layout audit.** Open the page at a list of viewports (1440×900, 1280×720,
  1024×600, iPhone 15 landscape 852×393, iPhone SE landscape 667×375, portrait
  393×852), force every panel visible at once, then read
  `getBoundingClientRect` + `scrollWidth`/`clientWidth` for each HUD id and
  report: boxes past the viewport edge, boxes that scroll when they should not,
  and every pairwise rectangle intersection. Overlaps are only acceptable where
  the higher `z-index` is deliberately a modal (see "HUD layout & stacking").
- **Magnified canvas diffs.** Build a fixed scene in `page.evaluate` (flatten a
  patch of terrain, place one of each building, plant trees north and south of
  them, put units on both sides), call `ui.render()`, then blit a region of
  `#game` into a full-screen overlay canvas with
  `imageSmoothingEnabled = false` before screenshotting. Screenshotting the
  canvas directly at zoom 4 is not enough to judge a one-pixel seam.

A third harness came with the plateaus, and is the one to rebuild if you touch
map generation:

- **Generation invariants over many seeds.** `js/map.js` has no browser
  dependency beyond `AT`, so it can be loaded straight into node with
  `new Function('AT', src + 'return {GameMap, findPath, RAMP_DIRS, ...}')`.
  Load the *real* `AT` the same way from `js/assets.js` rather than stubbing it
  with a `Proxy` — once a check needs to compare which array element
  `cliffTile` picked (e.g. is this jamb `AT.RAMP_JAMB_POS[rot]` or
  `AT.RAMP_JAMB_NEG[rot]`?), a stub that returns a distinct token per key
  can't tell rotations apart, only real array identity can. Build a few
  hundred maps and assert the properties the generator claims rather than
  eyeballing one: no cliff/ramp/high tile inside a start zone's clearing,
  every start zone still floods to `MIN_START_REGION`, every start zone paths
  to every other, no walkable region made only of plateau top (i.e. no mesa
  you cannot get off), every cliff impassable and every ramp passable, and —
  reading each ramp's own direction out of `RAMP_DIRS[m.rampDir[i]]`, not
  assuming north — every ramp has footing on the outside, plateau top on the
  inside, and a cliff jamb on both perpendicular sides. Flood with
  `passable()`, not `openAt()` — a wood on top of a mesa is walkable ground
  that `openAt` deliberately does not count. This is what caught the cave
  sealing a plateau, the `carveShortestLink` hang (BUGS #29), and — after
  ramps grew a direction — a still-hardcoded south-facing footing check in the
  cave-placement guard and a connectivity corridor quietly stripping a
  plateau top tile's `high` flag while simplifying its terrain (BUGS #30);
  none of the four showed up in a single-seed screenshot. When a check like
  this fails, don't just patch it and move on — reproduce the exact seed in
  isolation (stub the suspect function to a no-op, or instrument it to log
  before/after state) until you have the actual mechanism, the way BUGS #30
  went through a wrong first fix (skip `high` tiles entirely) before the
  region-size regression it caused pointed at the real one (clear the tile,
  just never touch `high`).
- **Pixel scan for missing rim art.** The one that actually works for "are there
  holes in the cliffs". Eyeballing a screenshot found maybe two of the six
  defects in BUGS #31; this found all six and proved them gone. Render at zoom 1
  (16 screen px per tile, so 1:1 with the atlas and no filtering), stub out
  `ui.drawDayNightOverlay` — it tints every pixel off its atlas value and will
  otherwise silently match nothing — then walk the canvas for pixels of plateau
  turf `(133,166,67)` orthogonally touching low grass `(182,213,60)`. Rock is
  what belongs between those two, so every such pair is a hole. Two things must
  be controlled for or it reports noise: several unrelated sprites (the cave
  mound especially) are painted in the very same green, so check the pixel's
  TILE, not just its colour; and group the hits by tile and print each tile's
  terrain, because the *pattern* is the diagnosis — a uniform 6px in every
  `high` tile is a seam inside one atlas tile, 13px in `T_CLIFF` tiles is a
  shape the rim set has no piece for, and pairs of tiles two apart on one row
  are the jambs either side of a ramp. Always run it once with the fix disabled
  (`game.map.plateauTopTile = () => AT.CLIFF_TOP`) and confirm it lights up: an
  early version of this scan reported a clean sheet on *both* the fixed and the
  broken build, because of the day/night tint.
- **Synthetic terrain for judging autotiles.** For rim artwork, flatten the map
  in `page.evaluate`, stamp a shape you chose (an L is the useful one — it puts a
  concave corner in shot), set the rim/top/ramp tiles by hand — a ramp needs
  both `m.terrain[i] = T_RAMP` and `m.rampDir[i]` set, or `cliffTile`/
  `rampTopHere` throw — then dump an ASCII grid of what `cliffTile` picked
  alongside the magnified blit. The ASCII tells you the *decision* and the
  blit tells you whether the art lines up; a screenshot of generated terrain
  confounds the two. For the ramp set specifically, stamp one plateau with a
  stair centred on each of its four sides (one per `RAMP_DIRS` entry) — the
  four rotated art sets only get exercised together on a shape like that, and
  a single generated map usually only shows one or two directions in one shot.

Things worth re-checking after any change in this area:
- Stack several units on one tile, tick a few seconds, assert pairwise
  distances exceed `SEP_RADIUS`.
- Send a mixed-composition group on a formation move, assert every unit gets
  a unique `dest` tile and melee units land closer to the target than ranged.
- **Start a formation march from open ground, not from the town hall tile.**
  Teleporting a test squad to `[round(th.cx), round(th.cy)]` puts it inside the
  Town Hall footprint, where `findPath` starts on an impassable tile — a third
  of the group then never arrives and the run looks like a formation bug. Use
  `Faction.spawnPointNear(th)` and spread the units over passable tiles.
  Two separate formation "failures" were this and nothing else.
- Compare capped against uncapped pace on *two units with different speeds over
  a long march* (a Cavalier and a Swordsman, 25+ tiles), measuring the distance
  between them. Whole-group spread measured from a scattered start is dominated
  by the starting scatter and by formation depth, and shows nothing.
- For a defensive garrison, sample the post distance **every tick**, not once at
  the end — an end-state reading catches the unit mid-patrol-leg and says
  nothing about whether the leash held. And bait it: a high-HP decoy that
  retreats a tile per second is the test that actually exercises the leash,
  because a stationary enemy inside it never asks the question.
- Train a locked unit (expect a rejection string), buy the upgrade, tick past
  its `time`, train again (expect success); repeat for tier 3.
- Simulate a tap, then a second tap at the same point within 350ms, assert
  a move/attack order was issued.
- Toggle a tooltip open, check `#tooltip` content and `display`, toggle
  closed.
- Toggle hide-UI, check computed `display` on a `.hud` element flips both
  ways (and on `#place-bar`, which is in the list but not `.hud` itself).
- Place a wall ring with a gate on each side at zoom 4 and check the corners,
  the vertical run's width against the towers, and that the gate arches read.
- Boot at 852×393 and assert `#buildbar.scrollWidth === clientWidth` — the full
  row of 13 build buttons has to fit a landscape phone.
- Run several sim-minutes of `game.tick` with AI factions funded, confirm at
  least one climbs past tier 1 without the game crashing (`game.over` stays
  false unless the player's Town Hall actually fell — the only thing that can
  set it).
