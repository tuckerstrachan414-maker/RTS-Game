# Known bugs & issues

Found during the 2026-07 documentation audit by reading every module; several
were fixed in the AI-overhaul batch (see Fixed). **Plans are intentionally
left blank (TBD) — to be filled in later.** When you fix one, move it to the
Fixed section at the bottom with a one-line note on the fix.

Ordered roughly by player impact.

## Open

### 38. Zoom 1 costs ~35ms a frame, and now there is much more map to look at
`js/ui.js` `render` — the terrain pass draws every visible tile individually
(base coat + decor/water/rim, 2-4 `drawImage` calls each). At zoom 1 on a
1280×720 window that is ~3600 tiles and ~35ms, i.e. under 30fps. This is
**pre-existing** — the same measurement on the 96×96 map before the world pass
is 34.8ms, so nothing here regressed it — but it used to be the corner of the
game you rarely sat in, and on a 384×192 (or 1024×512) world it is where a
player will spend real time. The fix is a chunked offscreen terrain cache: the
ground layer only changes when a tile does.
**Plan:** TBD

### 39. AI nations are slow to find each other across an ocean
`js/naval.js` `aiNavalExplore` — an AI charts the sea with a single galley
picking unexplored water at random, and `knownTownhall` needs line of sight on
a building that is usually well inland, so after 50 sim-minutes on a Standard
World the perception maps are typically still empty of rival capitals. Wars
across water do get declared (they fall back to the drawn territory borders,
which are public knowledge — see `aiEnemyAnchor`), but they are declared on
much thinner information than a land war, and the sea scout never does a
systematic coastal survey. A proper coast-following patrol, and more than one
hull, would fix both.
**Plan:** TBD

### 43. An AI invasion usually loses its war before the fleet is ready
`js/naval.js` `aiRunInvasionStage` — the campaign is verified end to end (force
a cross-ocean war open and it goes `building → fleet → loading → sailing` and
puts a dozen troops on the enemy shore), but in an unforced 50-minute soak the
AIs reached `fleet` and then aborted, because peace broke out while the
shipyard was still turning out hulls. Getting from "no dock" to "two loaded
transports" takes 20-25 sim-minutes on a Standard World, most of it waiting on
free citizens to crew the ships, and that is longer than a typical war lasts.
The gate has been loosened as far as is sensible (one transport is enough for a
small army, and a campaign sails unescorted rather than not at all after
`FLEET_PATIENCE`), so the rest of the fix is economic: the AI needs to keep a
standing transport or two in peacetime the way it keeps a standing army, rather
than starting a shipyard the day war is declared.
**Plan:** TBD

### 44. Population runs away on the big worlds
Observed on a 50-minute unattended Standard World soak: nations finished at
454-1072 population with 491-1109 units each, against 13-17 on the old 96×96
map over a comparable run. Nothing is wrong with the growth rule — a nation
grows by a fraction of its housing cap, and the big worlds simply give it four
to six thousand tiles of land to fill instead of a shared few hundred — but
nothing pushes back either, and a thousand-unit nation is both a balance
problem and the reason a long soak crawls. Wants a real ceiling: land quality,
food logistics, unrest, or an upkeep curve that bites.
**Plan:** TBD

### 40. Ships have no formation, no group role, and no place in the panels
`js/naval.js`, `js/ui.js` — `formationMove` and the Formations panel only know
the nine land types (`DEFAULT_FORMATION_ORDER`), so a selected fleet given a
move order sails as a loose crowd; `GROUP_ROLES` (defensive garrison, patrol)
assume land tiles and a post you can stand on; and a Transport's panel shows
the generic unit card rather than its manifest, so the only way to see who is
aboard is the pips over the hull.
**Plan:** TBD

### 41. A transport whose landing site is unreachable unloads wherever it is
`js/naval.js` `tickLanding` — when the sea path to the chosen berth runs out
(a bay sealed by a bridge, an island the pathfinder gives up on), the mission
falls through to `unloadShip` at the *intended* landing point regardless of
where the hull actually is. `landingSpot` then searches only 4 tiles around
that point, so in the worst case the troops stay aboard and the mission clears
itself, leaving a loaded transport idling with no orders. It never drops anyone
into the sea, but "sail somewhere impossible" fails quietly rather than
reporting.
**Plan:** TBD

### 42. Biomes are data only — they do not affect movement, yield or combat
`js/world.js` `BIOMES` — the table carries `tree`/`rock` densities (used by the
generator) and a tint (used by the renderer), and nothing else. A desert costs
the same to cross as grassland, a wetland does not slow anyone, and no biome
changes what a Farm or a Quarry produces. This is deliberate for the
groundwork pass, and the fields the mechanics will need (`map.temp`,
`map.moist`, `map.elev`, `map.depth`, `map.biome`) are all generated and kept —
but until they are wired in, a biome is a colour.
**Plan:** TBD

### 1. Trade pact gets stuck forever if a route's Market is destroyed
`js/diplomacy.js:196` — `tickRoutes` marks a route dead when either endpoint
Market's HP hits 0, but never resets the pair's status from `trade` to
`neutral` (unlike `cancelRoute`, which does). Result: caravan income stops
permanently, no new route is ever created even after the Market is rebuilt,
and re-proposing a pact is rejected with "Already trading".
**Plan:** TBD

### 2. The player cannot manually move the Prince (envoy)
`js/units.js:406` — `formationMove` filters out envoys, so a selected Prince
(alone or in a group) ignores move orders; the attack dispatch in
`js/ui.js:461` skips envoys too. An idle Prince is completely unorderable and
just stands wherever he spawned or last returned to — including in danger.
**Plan:** TBD

### 3. Bridges cannot be clicked, only box-selected
`js/buildings.js:168` — bridges write to `map.bridge`, not `map.buildingAt`,
so `clickSelect` (single click) can never find them. **Partially worked
around**: `UI.boxSelect` now selects from `game.factions[0].buildings`
directly rather than through `map.buildingAt`, so dragging a box over a bridge
(with no units in it) does pick it up, and Copy/Delete All on it work
correctly (`demolishBuilding`/`removeBuilding` already handle the `bridge`
case). A misplaced bridge is no longer permanent — but there is still no way
to select *just* a bridge with a single click/tap, and the single-building
info panel (workers/storage/etc.) never applies to one.
**Plan:** TBD

### 9. Menu button tooltip promises "Esc" opens it, but Esc never does
`index.html:370` titles the button "Menu / Pause (Esc)", but the keydown
handler (`js/ui.js:83`) only uses Escape to close the pause menu / cancel
placement / clear selection. There is no keyboard shortcut that opens the
pause menu.
**Plan:** TBD

### 11. Trade roads persist after the route dies
`map.road` tiles are stamped at route creation (`js/diplomacy.js:177`) but
never cleared when routes are cancelled or die, so dead routes leave permanent
roads (which still grant the 1.3× road speed bonus and 0.7 path cost to
everyone). Arguably charming, but unintended.
**Plan:** TBD

### 14. Every building costs wood, so a nation can be locked out of building
`js/buildings.js:10-96` — every buildable type takes wood, **including the
Market** (30 wood), which is the only way to buy wood. A nation whose forest is
worked out before it raises a Market can never build anything again, however
much stone, food and gold it holds: no Market to trade with, no Lumber Camp
(20 wood) to restart production. Adding the Builder House (30 wood) does not change the shape of this — it is
one more wood cost on the pile — but it does add a second way to be stranded:
lose every builder with no wood to raise a Builder House and nothing can be
built even where the materials exist. The Town Hall's two builder slots are the
guard against that, since they need no building of their own.
The AI now sidesteps the original trap by reserving the
price of a Market in timber (`AIUtilityEngine.respectsWoodFloor`,
`js/ai-utility.js`), but **the player has no such guard** and can still strand
themselves. A Town Hall barter option, or a wood-free Market recipe, would fix
it properly.
**Plan:** TBD

### 15. `Unit.orderMove` sets `dest` even when no path exists
`js/units.js:59-63` — `orderMove` assigns `this.dest` unconditionally, but
`dest` is only cleared in `followPath` when the path runs out
(`js/units.js:223`). Order a unit somewhere unreachable and `findPath` returns
`[]`, so `followPath` returns immediately and the unit keeps a `dest` it will
never reach — it looks busy forever to any caller testing `!u.dest`. This
silently froze AI scouts until `AICombatManager.orderScoutTo` was written to
clear `dest` and retry; anything else issuing move orders is still exposed.
**Plan:** TBD

### 34. Remote expansion is very slow now that materials have to be carried
`js/ai.js` `aiPlanExpansion` picks satellite sites up to ~45 tiles from the
town, which cost nothing to raise when construction was a timer. Builders now
walk it: one 15-material load per ~90s round trip, so a four-building satellite
can take many minutes and ties up builders the home town wants.
`aiCanBreakGround` stops the queue from running away, but nothing makes a
nation build a Storehouse at the satellite *first*, which is the actual fix
(builders fetch from the nearest store to themselves, so one store on site
would collapse the round trip).
**Plan:** TBD

### 36. A full storehouse leaves gatherers standing still holding their load
`js/civilians.js` `gatherDeliver` — `Nation.deposit` returns what would not fit,
and the worker keeps it rather than letting it evaporate, so with every store
full a worker walks to the Storehouse and then stands there retrying every tick
until room appears. That is the intended behaviour (goods are not destroyed) but
there is no visible signal beyond the existing "storage is full" log line, and a
player with full stores sees idle workers with no explanation on their panel.
**Plan:** TBD

### 37. The civilian sheets are reconstructed from screenshots, not originals
`assets/units/Civ*.png` — the art was delivered as five JPEG screenshots of a
sprite viewer rather than as PNGs, so `tools/import-civilians.py` recovers the
sheets by undoing the viewer's magnification (which is anisotropic: 4.7325×
across, 5.1425× down) and snapping what is left to a clustered palette. The
recovered geometry is exact — 32px frames in both axes, feet on row 30, the
frame counts the artist drew — but the colours are within about 8% of the
originals rather than equal to them, and the sheets demonstrably share the
MinifolksHumans palette, so the tans in particular are a shade off from the
soldiers standing next to them. Nobody will see it at 16 pixels; it is worth
knowing before anyone edits these by hand. If the source PNGs ever turn up,
drop them in and delete the tool.
**Plan:** TBD

### 17. Units end up standing inside their own solid Town Hall
`js/factions.js:33` `spawnPointNear` / `js/units.js:397` `nudgeUnit` — after a
600s soak on `?seed=42&difficulty=ruthless`, six units were sitting on tiles
their own faction cannot path through: the Town Hall footprint (a `solid`
building, so `map.passable` is false there). They are drawn on top of the
building sprite and rely on `nudgeUnit`'s "escape if already stuck" clause to
get out. Pre-existing — trees and rocks being walkable didn't cause it, and the
same soak shows no unit stranded on any terrain tile.
**Plan:** TBD

### 13. Peace-offer / dispute cards can pile up against an idle player
`js/events.js` `pushPlayerEvent` — the queue caps at 3 and per-faction
politeness cooldowns apply, but three different factions can still each keep a
card up more or less permanently if the player never answers. Mostly cosmetic;
expiry consequences (relations drops) do apply.
**Plan:** TBD

### 33. Pasting a copied bridge always lays it horizontal
`js/ui.js:672` — `copySelected` records only `{key, dx, dy}` per building, so a
copied bridge's orientation (`map.bridge[i]`, 1 or 2) is thrown away.
`pasteBuffer` (`js/ui.js:690`) then calls `placeBuilding` with no `orient`
argument, which defaults to 1 (horizontal) regardless of what was copied.
Pasting a copied vertical span silently lays a horizontal one instead — and,
since bridges can no longer touch a perpendicular span (`canPlace`), that
wrong-orientation tile can now also fail to place at all next to the rest of
a vertical run it was meant to extend, where before this change it would
merely have looked wrong.
**Plan:** TBD

### 28. The Archer's attack animation is the wrong row on its sheet
`describeSheet` (`js/assets.js`) picks `attack` as `rows - 3`, which is right
for the 6-row sheets (Swordsman, Spearman, Halberdier, Prince) and lands on a
plausible swing for the 7-row cavalry, but `MiniArcherMan.png` is 11×7 with the
**bow draw on row 3** (11 frames, arrow visible) and a second, melee-looking
action on row 4 — so an archer loosing arrows plays the wrong animation. Same
shape of problem is possible on the Mage/Archmage 8- and 9-row sheets. Fixing
it properly means a per-sheet animation table instead of the row-count
heuristic.
**Plan:** TBD

## Design quirks (intentional-ish, documented so nobody "fixes" them blind)

- **Where you put a Storehouse changes how much a camp earns** — production is
  a round trip now (`js/civilians.js`), so a Lumber Camp beside a Storehouse
  delivers ~1.8× what the same camp delivers hauling twenty tiles. That is the
  feature, not drift: `gatherWorkTime` centres the curve on a reference 8-tile
  round trip, where a worker earns what it always did.
- **Food is more abundant than it used to be** — farms work their own field and
  are built near the granary, so they sit at the short-haul end of that same
  curve (~1.9× nominal) while lumber camps sit below it. `CIV_WORK_FLOOR` caps
  how far the bonus can run; the remaining surplus is the honest consequence of
  farming being close-in work. Population growth is gated by housing and
  happiness, not food, so the surplus mostly piles up or gets sold.
- **A citizen killed is a citizen gone** — civilians have no combat value and
  no unit picks a fight with one on its own, but they are killable by direct
  order and by splash, and each death decrements `nation.pop`. Killing a
  nation's workers is a legitimate (and slow) way to strangle it.
- **The Town Hall quarters two builders it did not have to be given** — without
  them the Builder House could never be built, and a nation that lost its last
  builder could never build another. It is a bootstrap, and it is why the Town
  Hall has `slots` at all.
- **Civilians take no orders** — they are selectable for information only.
  Directing the economy is done by choosing what to build and who staffs it,
  not by driving individual villagers around.

- **Dev mode writes past storage capacity on purpose** — `Game.devTopOff`
  (`js/main.js`) sets the player's Town Hall `store` values directly to
  `DEV_RESOURCE_FLOOR` (9999), which is well past the Town Hall's declared
  caps (300 food/wood/stone). `capacityFor`/`deposit` are deliberately not
  involved — this is a cheat, not a storage-system change, and it only ever
  touches the player's own Town Hall.
- **Training always leaves 1 citizen free** — `trainUnit` requires
  `pop > workersAssigned + 1`, so the last two citizens can never both become
  soldiers. Prevents pop-0 soft locks.
- **Market never runs dry** — the stock floor of 5 means goods are always
  purchasable at the 3.5×-capped price. Infinite (expensive) supply is a
  deliberate anti-frustration valve.
- **No tree regrowth** — wood is globally finite outside the market; the
  SAPLING tile exists in the atlas but is unused. May become a feature later.
- **Bandits look like horsemen** — `spriteKey: 'horseman'`; only behavior
  distinguishes them. Caravans at least get a yellow marker.
- **2×2 buildings have chunkier pixels than 1×1 ones** — `drawBuilding` scales
  one 16×16 atlas cell across the whole footprint, so a Castle's pixels are
  twice the size of a House's. Deliberate (the alternative is a 2×2 building
  drawn at one tile, floating in its own footprint), but it is visible.
- **Day/night indicator is an emoji** — `☀`/`🌙` in the topbar, the only glyphs
  left outside the `icons16x16.png` sprite sheet, because the sheet has no
  sun or moon. Renders differently per platform.
- **A cliff can be breached, but only by the map generator** — `T_CLIFF` is
  impassable to everything in the game, and `lineCost` refuses a track through
  one outright. `carveShortestLink` is the exception: it is the pass that *has*
  to succeed in linking every start zone into one landmass, so a cliff costs it
  9 (against grass 0.1, water 6) rather than being refused. It goes round in
  essentially every case, but on a seed where a mesa genuinely walls the map in
  two it will cut through, clearing `high` along the carved tiles. The result is
  a gap in a rock face with no stair drawn in it. Rare, always passable, and
  preferable to the alternative of a nation nobody can ever reach.
- **Plateau tops have no grass tufts** — `generatePlateaus` clears `decor` on
  raised grass. The `GRASS_VARS` tuft tiles have low-ground turf baked into
  them, so leaving them on would punch patches of valley colour into the darker
  plateau surface. Trees and boulders on top are kept; only the tufts go.
- **There is no way to win** — a 2026-07 design change. Prosperity (Grand
  Castle), Conquest (all rivals eliminated) and Diplomatic (every survivor
  allied) victories were removed from `Game.checkDefeat` (formerly
  `checkVictory`); the only end state left is the player's own Town Hall
  falling. The Grand Castle upgrade is unchanged mechanically — AI nations
  with `pursuesGrand` still race for one, the player can still build one — it
  is now a prestige monument with no effect on whether the game continues,
  for either side. Everything downstream of "a won game can be continued" went
  with it: `Game.resume`, `wonText`, `endless`, `claimed`, and the *Keep
  playing* button.

## Fixed

- **#35 Civilians were drawn with soldiers' art** — `js/assets.js`,
  `js/civilians.js`. The worker and builder borrowed `MiniShieldMan` and
  `MiniCrossBowMan`, so a citizen was a figure holding a shield or a crossbow,
  muted by a `drab` desaturation pass to disguise it. Replaced with five
  purpose-drawn sheets (`assets/units/Civ*.png`) and a per-job sprite:
  `civSpriteFor` puts the scythe on the farm, the axe in the treeline, the pick
  on rock and gold, the hammer on the scaffold, and empty hands on anyone
  unemployed. `drab` is gone with the placeholder it was hiding — the art is
  drawn as townsfolk, so it does not need to be washed out to read as them.
  Note the art was delivered as screenshots rather than PNGs, so the sheets are
  reconstructed by `tools/import-civilians.py` rather than copied; see #37.

- **#16 `?seed=N` did not actually replay a match** — `js/factions.js:196`,
  `js/territory.js:200`, `js/ai.js:388`. Three `Math.random()` calls survived the
  AI overhaul in decision paths — the spiral search in `findBuildSpot` (i.e.
  *where every AI building goes*), the border-dispute merchant branch, and an
  ultimatum roll — so two runs of the same seed diverged within a minute and no
  A/B comparison of an AI change meant anything. All three now draw from
  `game.rng`. Verified by running the same seed twice for 10 sim-minutes and
  diffing every faction's population, buildings, units, stores and castle tier:
  identical after, divergent before. (This entry previously claimed the AI was
  already clean and blamed combat jitter; combat never called `Math.random` —
  the only remaining call in the codebase is the seed fallback in `boot`.)

- **#32 The pause menu was taller than a landscape phone and clipped its own
  buttons** — `index.html`. `#pause-menu .menu-box` had no `max-height` and no
  `overflow`, so on an 852×393 viewport its 467px button stack ran off both
  ends of the screen with no way to scroll to what was cut off. Found while
  adding the Formations entry, which made it 52px worse — but it was already
  74px over before that. Fixed with `max-height: 94vh; overflow-y: auto` (plus
  `flex-shrink: 0` on the children, or the flex column would compress the
  buttons instead of scrolling). Measured after the fix: box 369px on a 393px
  viewport, scrollable.

- **#29 `carveShortestLink` could hang the whole game on load** —
  `js/map.js`. The link pass stored distances in a `Float32Array` while computing
  each candidate distance in double precision. Storing rounds, and when it rounds
  *up* the guard `nd < dist[j]` is still true on the next visit, so the node is
  pushed again with a distance it never actually improves on — an infinite loop,
  not a slow one. Grass's 0.1 step hits it readily (`nd` 1.6000002384185792
  against a stored 1.600000262260437); one seed reached 36M pushes on a
  9216-tile grid before being killed. Latent for as long as the function has
  existed and almost never reached, because it only runs when start zones land on
  separate landmasses; adding plateaus fragments the map, so it started running
  on ordinary seeds and the game hung at startup. Fixed by moving `dist` to
  `Float64Array` (the comparison is now exact) and adding a `settled` guard so
  each node is expanded once — with non-negative costs a node's distance is final
  the first time it is popped, which is both correct and what stops stale heap
  entries from re-relaxing the graph. Verified across 400 seeds.
- **#30 Start-zone connectivity carving could silently shrink a plateau** —
  `js/map.js`, `carveLine`/`carveShortestLink`. Both cut a corridor between
  landmasses by converting whatever they cross to plain grass, and neither
  distinguishes low ground from a plateau's own top — so a corridor that
  happened to cross a top tile still carrying its original tree or boulder
  would clear it to grass *and* reset `high[i]` to 0 in the same assignment,
  since that reset had always been unconditional. That doesn't just tidy the
  tile, it silently ejects it from the plateau: same terrain either side,
  suddenly no longer part of the mesa, and — if it was the specific tile a
  ramp's `d` vector pointed onto — the ramp now "leads nowhere" and the
  invariant harness catches it (a hole cut clean through supposedly-sealed
  rock is exactly the kind of "missing texture" a corner-clipping check is
  for). First fix attempt overcorrected the other way: skipping every `high`
  tile outright stopped the mutation, but also stopped the corridor from ever
  becoming clear ground there, which starved `openAt` (grass-and-ramps-only
  connectivity) of a tile it needed and dropped one start zone's reachable
  region from 3885 tiles to 59 on seed 374. Landed on the actual fix: still
  clear the tile's terrain/decor/treeWood like anywhere else, just never touch
  `high` — a plateau-top tile crossed by a corridor becomes ordinary top
  grass (which most of a top already is), not a breach. Verified across 600
  seeds plus the seed-374 case specifically.
- **#31 Plateau rims had holes in them: gaps, floating stairs, and a staircase
  of disconnected rock** — `js/map.js`, `js/ui.js`, `tools/splice-cliffs.py`.
  Six separate defects, all with the same signature: raised plateau turf drawn
  directly against low grass with no rock between it, which is what the rim art
  exists to prevent. In order of how much they showed:
  1. **Diagonal edges.** `high` is 4-connected (all four *sides* raised), the
     right rule for an orthogonal pathfinder but silent about corners. Wherever
     a plateau's edge ran diagonally, the tile inside each step had four raised
     sides and open ground off one corner, and painted flat turf. The claim in
     the original commit that 4-connectivity "guarantees every rim tile has an
     open side for its artwork to face, so the set never needs its
     concave-corner pieces" was simply wrong — that is exactly what those
     pieces are for. `plateauTopTile` now hands such a tile one of four concave
     corners.
  2. **Stairs floating in a gap.** The jamb either side of a ramp *replaced* the
     tile's rim piece. A jamb is a narrow rock post meant to frame a stair
     against a rim that is already drawn, so using it as the whole tile broke
     the rim run at every single ramp. It is an overlay now (`rampJamb`), drawn
     on top of the ordinary rim piece.
  3. **Turf baked into the jambs.** Each jamb carries a strip of plateau turf
     down its inner edge — harmless in the pack's native south-facing
     orientation, but facing open ground once rotated to a north rim. Stripped
     at splice time; the rim piece underneath supplies the turf.
  4. **Two concave corners did not exist.** The pack has NW and NE notches only;
     see the note in docs/FEATURES.md for why SW/SE are 180° rotations rather
     than quadrant composites (the composite left a seam of its own).
  5. **One-tile-thick rock.** Three open sides is a finger, two *opposite* open
     sides is a wall one tile thick; the set has a piece for neither, so both
     fell through to the tall south face, whose turf lip then met open grass.
     `generatePlateaus` erodes both before classifying the mass.
  6. **Rims that reverse direction.** A south face beside a north lip, where the
     edge steps outward between adjacent rows: the south face is the only fully
     opaque piece in the set, so its lip met the grass showing through its
     neighbour. `cliffTile` reads the far diagonal on single-open-side tiles and
     resolves them as the corner they really are.
  Found and driven to zero with a pixel scanner rather than by eye — render at
  1 screen px per texel, suppress the day/night tint, and count turf pixels
  orthogonally touching grass pixels (see docs/formations-tiers-ui.md). 1789 bad
  pixels across three seeds at the start; 0 across 65 seeds now, with the
  scanner still reporting ~600/seed when the concave-corner fix is disabled, so
  it is known to be able to fail.
- **#19 Trees, units and buildings drew in fixed passes, not by depth** —
  `render` (`js/ui.js`) ran forest → buildings → walls → units as separate
  passes, so a tree standing *in front* of a building was painted over by it
  and a unit standing *behind* a building was painted over it. Replaced with
  one Y-sorted pass (`collectDepthLayers` + a sort keyed on each thing's base:
  `y + TREE_BASE`, `y + size`, `y + UNIT_FOOT`). Farms carry a new `flat` flag
  and are painted with the terrain instead, since a crop field is ground.
  Measured no slower than the multi-pass version at any zoom.
- **#20 Unit health bars and faction flashes floated above their units** — the
  markers hung off the top edge of the 32px animation frame, but a foot
  soldier's art starts about 15 rows into it, so at zoom 3 everything sat ~42px
  clear of his head. `describeSheet` (`js/assets.js`) now measures the opaque
  bounds of the idle/walk poses (ignoring 1–2px lances and staves) and
  `drawUnit` stacks the flash, health bar, caravan/envoy badge and plunder sack
  upward from the figure's real top; the selection ring moved onto its foot
  line.
- **#21 North–south wall runs looked like fence posts** — `bakeRamparts` built
  `wallV` from `AT.WALL_V`, a 6px-wide column, against a 16px-wide horizontal
  parapet, and 2px narrower than the tower's own body so every tower in a
  vertical run stepped in and out. It now comes off `WALL_TOWER`'s body row, so
  wall and tower match by construction. The tower's empty top row (a 1px
  transparent seam against a wall above it) is filled from the crenellation
  below via a new `fillRows` bake option. The owner marker also stopped being
  drawn on every tile. *(Superseded: the whole rampart set now comes off
  `assets/punyworld-overworld-tileset.png`, whose wall art was drawn to tile —
  `bakeTile` and its `fillRows`/`replicateMid`/`fillCols`/`stripGreen` options
  are gone with it. See `docs/formations-tiers-ui.md`.)*
- **#22 Sprites that did not match their building** — Storehouse and Lumber
  Camp shared one cell; the Quarry was a cottage; the Well was a green mound
  near-identical to the CAVE terrain tile; the Church wore two pink mushroom
  caps; the Castle stayed violet for every nation because `recolor`'s warm band
  never touched it; and Farms had **no art at all** (two GRASS_VARS tuft tiles,
  invisible against grass, with no construction feedback since
  `b.done ? Assets.tileset : null` fell through to the same sheet either way).
  All six are composited at load time now (`bakeBuildings`/`bakeFarmland`,
  `js/assets.js`) from the existing atlas — no new image assets. *(The Well has
  since been replaced again, by a roofed wellhead taken whole off the punyworld
  sheet; the hand-drawn one is gone.)*
- **#23 Azuria's buildings were orange while every rival's matched its banner**
  — `FACTION_COLORS[0].hue` was `null`, which is right for the unit sheets (the
  art is already blue) but also skipped the tileset recolor. Split into `hue`
  (units) and `roofHue` (masonry), and widened the warm band to wrap through
  red (345°–42°) so the Lumber Camp, which straddles that seam and used to
  half-recolor, tints cleanly with everything else.
- **#24 The build bar clipped its last buttons on every screen size** —
  `#buildbar` was `position:absolute; left:50%`, and an abspos box anchored only
  by `left` is shrink-to-fit against the space to its *right*, so it never
  exceeded ~half the viewport whatever `max-width: 96vw` said. Gate and Bridge
  were off the end even at 1440px. Now `left:0; right:0; margin:0 auto;
  width:max-content`, which fits the full row down to a 852px-wide phone.
- **#25 Placement buttons sat on top of the resource readouts** — Cancel,
  Rotate and Paste were pinned at `top:8px; left:8/112/220px`, i.e. directly
  over `#topbar`, every time you picked a building. Moved into a centred
  `#place-bar` row above the build bar.
- **#26 The event card and the diplomacy panel occupied the same rectangle** —
  both were `top: topbar+8px; right: sidebar+16px`. Opening Diplomacy buried a
  pending timed card (or the card covered the panel's header). The card moved
  to the bottom-right on desktop and the top row on touch. The diplomacy panel
  also gained a `z-index`, because as an `auto` element it was painted *over* by
  the build bar and the message log on touch, where it is a centred modal.
- **#27 The end screen could be covered by a HUD panel, and the pre-game screen
  clipped on short phones** — `#gameover` had no `z-index` and lost to the
  panels that now have one; both full-screen overlays were
  `justify-content: center` with no `overflow`, which on a 375px-tall screen put
  the first difficulty card above the viewport where it could not be scrolled
  to. `safe center` + `overflow-y: auto` on both, plus smaller type under
  `max-height: 430px`.
- **#12 Dead code: unit mirror ternary** — `u.facing < 0 ? drawX : drawX` gone.
  The mirror path also rounds `sx` *before* the transform now: flooring the
  destination and then reflecting it around a fractional `sx` left a left-facing
  unit half a pixel off a right-facing one, so a unit shimmered when it turned.
- **Grid artefacts in terrain and on the minimap** — boulders were stamped dead
  centre in their tile and lined up into a visible lattice (now jittered from
  `tileNoise`, like tree clumps, in their own terrain sub-pass so a boulder
  leaning right is not clipped by the next tile's grass); `renderMinimap`
  painted every building `size + 1` tiles across, a tile wider and taller than
  it really is; and the building owner dot was a fixed 4px square that swallowed
  a quarter of a house at zoom 1 and vanished at zoom 4 (it scales now, like the
  rampart's).

- **#18 AI wall rings left permanent gaps at forest and rock tiles** —
  `canPlace` (`js/buildings.js`) now accepts `T_TREE`/`T_ROCK` for any
  non-water building (caves still refused: a resource mouth, not ground).
  `placeBuilding` clears whatever rough terrain a footprint lands on
  (terrain → grass, decor cleared, `treeWood` zeroed), the same way
  `GameMap.carveLine` clears a track. Since AI wall placement
  (`aiRingTileConnected`, `js/ai.js`) already calls `canPlace`, a defensive
  ring now closes across a wooded or rocky perimeter with no code change
  there. The placement ghost (`drawGhost`, `js/ui.js`) reflects the new rule:
  a legal tile washes white, a blocked one washes red, and any tree inside the
  footprint fades (`drawForest`'s new `fadeSet` param) so the wash reads
  clearly instead of competing with a solid canopy.
- **Walls and gates did not visually connect** — `drawWall` stamped one of two
  whole sprites per tile (`wallSprite` for straight runs, `towerSprite` for
  everything else), and the atlas art has grass baked into its margins with the
  parapet stopping short of the tile edge, so consecutive segments never met.
  There was no vertical art at all: a north–south run drew the *horizontal*
  sprite stacked, and gates rendered through `drawBuilding` as loose tiles that
  joined nothing. Replaced with the baked rampart set (`bakeRamparts`,
  `js/assets.js`) plus `drawRampart` (`js/ui.js`), which assembles each tile
  from connector pieces whose edges match pixel for pixel in both axes.
- **#4 Wars between AI nations never end** — `aiDiplomacy` (`js/ai.js`) now
  sues for peace when weary and losing (or the war drags), and mutually
  exhausted bloodless wars end in an automatic white peace.
- **#5 AI signs trade pacts with the player without consent** — the
  instant-flip block was removed from `Diplomacy.tick`; all AI pacts now
  travel by Prince envoy, and AI→player proposals arrive as an
  Accept/Decline/Rebuff event card (`resolveEnvoy`, `js/diplomacy.js`).
- **#7 Farm-priority worker logic was a no-op** — `aiTick` now staffs farms
  first when the food rate is negative and pulls a worker off a non-farm
  building when starving with full employment (`js/factions.js`).
- **#8 Envoy death silently loses the proposal** — `onUnitDeath`
  (`js/main.js`) logs when a mission-carrying Prince is slain.
- **#10 Loot log spam from wars the player isn't in** — `dropLoot`
  (`js/main.js`) only logs when the player is a belligerent or has living
  troops within 20 tiles of the spill.
- **#6 Resource income ignored forest depletion** — `estimateIncome` moved from
  `js/ui.js` to `js/economy.js` and gained the tree check, so an exhausted Lumber
  Camp reports 0. This also removed the layering inversion where the AI brain
  depended on the render layer. The duplication that caused the drift is gone
  entirely now: production is defined once, by `workerYieldRate`
  (`js/buildings.js`), and nothing mutates state to report a rate, because
  gathering is done by civilians rather than by the function that measures it.
- **Every AI declared war seconds into the match** — `aiConsiderWar` gated on
  `f.strength() <= o.strength() * ratio`, and `strength()` is 0 for everyone at
  game start, so the first nation to finish a single swordsman "found an
  advantage" over three empty armies. The relation gate was dead too (relations
  start at 0, conquest's threshold was 10, so `0 > 10` never blocked). Replaced
  by `AICombatManager.considerWar` (`js/ai-combat.js`): absolute army floors, an
  estimate drawn from observed intel with unknowns treated as dangerous, a
  required motive, and an advantage that must hold 30 seconds — plus a ~150s
  opening peace for everyone, not just the player.
- **Every match played out identically** — `AI_PERSONALITIES` was a fixed array
  and the doctrine was derived straight from it, so Crimson was always the
  warlord and Violeta always the trader. Personalities are now rolled per match
  from the map seed (`rollPersonalities`, `js/factions.js`).
- **Start zones could be completely sealed** — the generator stamps a 7×7
  clearing at each quadrant centre and then plants trees and rocks in the ring
  outside it, which on wooded ground closed the ring, and on water left a grass
  island. Affected nations had ~46 walkable tiles and could never scout, expand,
  trade overland, attack or be attacked for the entire match (2 of 4 nations on
  seed 42). `connectStartZones`/`linkStartZones` (`js/map.js`) now cut a track
  out and link every start into one landmass.
- **Conquest erased the map** — `checkVictory` called `removeBuilding` on every
  building a fallen nation owned. Survivors' farms, mines, markets and
  storehouses are now annexed by the conqueror with their goods intact
  (`annexBuildings`, `js/buildings.js`).
