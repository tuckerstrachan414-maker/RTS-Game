# Known bugs & issues

Found during the 2026-07 documentation audit by reading every module; several
were fixed in the AI-overhaul batch (see Fixed). **Plans are intentionally
left blank (TBD) — to be filled in later.** When you fix one, move it to the
Fixed section at the bottom with a one-line note on the fix.

Ordered roughly by player impact.

## Open

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
(20 wood) to restart production. The AI now sidesteps this by reserving the
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

### 16. AI decisions no longer use `Math.random`, but the sim still is not seeded
`js/ai.js`, `js/ai-*.js` and `js/factions.js` now draw from `game.rng`
(mulberry32 from the map seed), so personalities, ambitions and build choices
replay. Combat, projectiles and unit spawn jitter still call global
`Math.random()`, so `?seed=N` reproduces the map and the opening but not a whole
match.
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

## Fixed

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
  drawn on every tile.
- **#22 Sprites that did not match their building** — Storehouse and Lumber
  Camp shared one cell; the Quarry was a cottage; the Well was a green mound
  near-identical to the CAVE terrain tile; the Church wore two pink mushroom
  caps; the Castle stayed violet for every nation because `recolor`'s warm band
  never touched it; and Farms had **no art at all** (two GRASS_VARS tuft tiles,
  invisible against grass, with no construction feedback since
  `b.done ? Assets.tileset : null` fell through to the same sheet either way).
  All six are composited at load time now (`bakeBuildings`/`bakeFarmland`,
  `js/assets.js`) from the existing atlas — no new image assets.
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
  `js/ui.js` to `js/economy.js` (beside the production math it mirrors) and now
  runs the same read-only tree check as `buildingProduction`, so an exhausted
  Lumber Camp reports 0. This also removed the layering inversion where the AI
  brain depended on the render layer.
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
