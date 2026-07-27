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
  `new Function('AT', src + 'return {GameMap, findPath}')` and a `Proxy` standing
  in for the atlas. Build a few hundred maps and assert the properties the
  generator claims rather than eyeballing one: no cliff/ramp/high tile inside a
  start zone's clearing, every start zone still floods to `MIN_START_REGION`,
  every start zone paths to every other, no walkable region made only of plateau
  top (i.e. no mesa you cannot get off), every cliff impassable and every ramp
  passable, and every ramp with footing below and top above. Flood with
  `passable()`, not `openAt()` — a wood on top of a mesa is walkable ground that
  `openAt` deliberately does not count. This is what caught both the cave sealing
  a plateau and the `carveShortestLink` hang (BUGS #29); neither showed up in a
  single-seed screenshot.
- **Synthetic terrain for judging autotiles.** For rim artwork, flatten the map
  in `page.evaluate`, stamp a shape you chose (an L is the useful one — it puts a
  concave corner in shot), set the rim/top/ramp tiles by hand, then dump an ASCII
  grid of what `cliffTile` picked alongside the magnified blit. The ASCII tells
  you the *decision* and the blit tells you whether the art lines up; a
  screenshot of generated terrain confounds the two.

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
  ways (and on `#place-bar`, which is in the list but not `.hud` itself).
- Place a wall ring with a gate on each side at zoom 4 and check the corners,
  the vertical run's width against the towers, and that the gate arches read.
- Boot at 852×393 and assert `#buildbar.scrollWidth === clientWidth` — the full
  row of 13 build buttons has to fit a landscape phone.
- Run several sim-minutes of `game.tick` with AI factions funded, confirm at
  least one climbs past tier 1 without the game crashing (`game.over` stays
  false unless the player's Town Hall actually fell — the only thing that can
  set it).
