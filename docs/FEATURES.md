# Feature inventory — current state

An audit of every system in the game as it exists in the code today, with a
depth rating for each. Depth scale:

- **Deep** — multiple interacting mechanics, edge cases handled, AI participates
- **Moderate** — works well, one or two layers of mechanics, some gaps
- **Basic** — functional but simple; the obvious next candidate for expansion

Player-facing behavior is described in `README.md`; implementation notes for the
formations/tiers/gestures batch are in `docs/formations-tiers-ui.md`. Known bugs
are tracked in `docs/BUGS.md`.

## The world — Deep

`js/world.js`. **The map is a configuration, not a constant.** `MAP_W`/`MAP_H`
are `let` globals published by `configureWorld`, which runs from `boot()`
before anything sizes an array off them; every consumer reads them at call
time. Five presets ship (`WORLD_PRESETS`): **Duel Island** 96×96 non-wrapping
one-landmass (the historical map), **Small World** 256×128, **Standard World**
384×192, **Large World** 768×384, **Planet** 1024×512. Each carries sea level,
target continent count, river density and plateau density, and every one of
those is individually overridable — `configureWorld({preset:'large',
seaLevel:0.55})` is a valid world nobody had to add a preset for. The pre-game
screen has a **world picker** (`buildWorldPicker`, `js/main.js`) that re-runs
`configureWorld` with a preset name; `?world=large`, `?mapw=`, `?maph=`,
`?sea=`, `?continents=`, `?rivers=` do the same from the URL, and the chosen
preset round-trips into the replay URL beside the seed. That split — a form
over `configureWorld` on one side, one generator on the other — is the
groundwork for a fuller world-creator screen: it should grow controls, not a
second code path.

**The world is a cylinder.** East-west it wraps: walk west far enough and you
arrive from the east. North-south it does not — the poles are ice and the ends
of the world. Wrapping is not a rendering trick; it goes all the way down.
`map.idx` folds x, so every "for each of my four neighbours" loop in the game
wraps for free; `wrapX`, `wdx`, `wdist`, `wmanhattan` and `wrapPos`
(`js/world.js`, `js/units.js`) are the wrap-aware primitives, and A*, crowd
separation, territory influence, scout memory, target acquisition, civilian
job assignment, loot pickup and the camera all go through them. `WORLD_WRAP`
is false on Duel Island and every one of those helpers degrades to plain
arithmetic, so the old map behaves exactly as it did.

## Map generation — Deep

`js/map.js`. A pipeline, each stage writing a layer the next one reads:
tectonics → sea → depth → rivers → climate → beaches → biomes → vegetation →
homelands → plateaus → caves.

**Tectonics.** Continents come from plates, not from thresholded noise. A
handful of soft elliptical blobs (`seedPlates`, rejection-sampled so two
continents cannot land on top of each other, each with its own skew so they
are not all ovals) set *where* land is; four octaves of value noise
(`makeFbm`) decide what its coastline looks like, eating bays and throwing
islands off the shelf. Weighting the plate more heavily than the noise is what
keeps a continent one continent rather than an archipelago. A latitude term
pulls the caps under water so no landmass runs off the top of the world, which
would look wrong the moment the globe is drawn. **The noise grid closes on
itself in x** (`makeNoise` picks a cell count that divides `MAP_W` exactly and
wraps the lookup modulo it) — without that, the seam shows as a straight
north-south cliff of mismatched terrain running the height of the planet.

**Depth.** One BFS from the whole coastline at once gives every water tile its
distance from land (`map.depth`). It drives the deep-water shading, the
ocean/coast biome split, the moisture field, and where beaches go.

**Rivers.** A river is a walk downhill from a source in the hills
(`traceRiver`): steepest descent with a little noise so it meanders, and when
it walks into a hollow it floods the hollow and keeps going, which is how
lakes get made. A course that neither reaches the sea nor grows long enough to
be a lake chain is rolled back — a watercourse that simply stops in a field
reads as a bug. Count scales with land area × `riverDensity`.

**Climate.** Two fields, both the obvious physics: `map.temp` falls with
latitude (cosine — broad tropics, a fast drop through the temperate band, a
long cold tail) and with altitude; `map.moist` falls with distance from water
(a second BFS) and rises with temperature. Fractal noise on top of each stops
the bands reading as stripes.

**Beaches.** Every shore gets sand (`T_SAND`, walkable, `SAND_MOVE_COST` 1.15,
buildable). Doing it *everywhere* rather than only on gentle coasts is a
rendering decision as much as a terrain one: with sand always between grass and
sea, the water only ever has to draw one kind of edge, and the atlas's water
set already has a sand-coloured lip baked into it, so the two meet with no new
art. Width follows the land — a flat warm coast gets a second rank of strand, a
steep or cold one gets a single tile of shingle.

**Homelands.** `chooseHomelands` labels the continents (`labelContinents`,
4-connected components of walkable land, kept on `map.continent` /
`map.continentSize`), ranks them by usable size, and seats **one nation per
continent**, each capital sited well inland by a sampled search that weights
distance from the sea, from the other capitals, and away from the peaks. If the
world did not produce four big enough continents the leftovers double up on the
largest. `connectStartZones` still guarantees no capital is marooned on a
sandbar — but it no longer joins the nations to each other. On a world of
continents they are *supposed* to start apart; crossing the ocean is what the
navy is for. Only Duel Island, which declares `oneContinent`, keeps the old
"every nation must be able to walk to every other" guarantee.

Plateaus, ramps, caves, water autotiling, `openAt` connectivity and the A*
pathfinder are unchanged in substance from the pre-world version and are
described below; the differences are that the plateau field is now biased by
elevation (so mesas cluster in continental interiors rather than scattering
over farmland and beach alike), that its passes run right round the seam on a
wrapping world, that beach and sand count as open ground everywhere
connectivity is tested, and that `findPath` takes a `mode` — `'land'` or
`'sea'` (see Naval).

**Plateaus.** A second noise field (`generatePlateaus`, `PLATEAU_LEVEL` 0.63,
divided by `plateauDensity`) raises masses of high ground, majority-smoothed
three passes so they settle into shapes with an outline rather than fraying
into single-tile spurs. Each mass is split into a rim of `T_CLIFF` —
impassable, unbridgeable, uncuttable, the only terrain with no way through it
at all — and a top of ordinary ground flagged in `map.high`, which builds,
harvests and fights exactly like low ground. The way up is `T_RAMP`, one to
three stairs per mass, cut into *any* of its four rims (`RAMP_DIRS`: each entry
is a climb direction `d` and a perpendicular `p` for the jambs, plus how many
90°-clockwise turns the tileset's one staircase sprite needs to face that way —
the pack only drew a south-facing stair, so the other three orientations are
that same art rotated losslessly by `tools/splice-cliffs.py`, not a runtime
transform). A candidate tile needs open ground on the outside, plateau top on
the inside, and rim either side for the jambs, in whichever of the 4 directions
satisfies that; `map.rampDir` records which one so the renderer (`cliffTile`,
`rampTopHere`) and generation (`pickRamps`) agree on which rotated art and
which neighbour tiles apply. Crossed at `RAMP_MOVE_COST` 1.7×. That makes every
mesa a chokepoint approachable from more than one side. Rim membership is
decided by 4-connectivity, not 8 — a tile whose four sides are all plateau is
inside it however its corners fall — which matches the orthogonal pathfinder.
That rule governs *movement*; it does **not** mean the eight outer rim pieces
are enough to draw with, which was assumed once and was wrong. A 4-connected
interior tile can still touch open ground at a corner, and every rim piece is
transparent on its outward side by design, so wherever a plateau's edge ran
diagonally the tile inside the step painted flat turf against grass with
nothing between: a staircase of disconnected rim fragments (BUGS #31).
`plateauTopTile` fixes it by giving such a tile one of the four concave corners
instead, and `cliffTile` reads the far diagonal too, so a rim that reverses
direction mid-run resolves as the corner it really is rather than as the one
fully-opaque piece in the set. Generation also erodes anything one tile thick —
three open sides is a finger of rock, two *opposite* open sides is a wall one
tile thick, and the set has a piece for neither.

Four invariants are enforced at generation time rather than hoped for: no
plateau within `PLATEAU_START_CLEAR` (12 tiles) of a start zone, every top tile
walkable from a stair (`rampsReachAll`, else the mass is abandoned whole), no
cave placed on a top or at any ramp's footing in any direction — a cave is a
hole in a rock face, not ground, and is the one thing placed after the plateaus
that could strand ground behind them — and nothing one tile thick anywhere in
the mask. A forced connectivity corridor must never touch `map.high`: clearing
a top tile *and* clobbering its `high` flag together would quietly shrink the
plateau by one tile rather than just tidy its ground (BUGS #30) — `high` is
plateau membership, decided once by `generatePlateaus` and never revisited.

**Terrain and movement.** Water autotiling picks from a 9-slice + strip set by
neighbour inspection. A* (4-directional, min-heap, capped iterations,
partial-path fallback, wrap-aware heuristic) with road tiles costing 0.7 to
steer traffic onto trade roads; per-faction passability (gates open for owner +
allies, walls/keeps solid, other buildings walkable). **A bridge tile only
admits movement along its own axis** — `findPath` refuses to enter a horizontal
(orient 1) span except moving east/west, and a vertical (orient 2) one except
north/south — so a unit can never turn from one span onto a perpendicular one,
even where two independently-built bridges happen to touch. `canPlace`
(`js/buildings.js`) backs this up at build time. **Forest and rock are rough
ground, not walls**: troops push through both, at `TREE_MOVE_COST` 2.4× /
`ROCK_MOVE_COST` 1.9× the time (`map.moveCost`, which divides unit speed in
`followPath` and multiplies the A* step cost). Only water without a bridge,
caves, cliffs, walls and keeps still block outright. **Buildings can be placed
on forest, rock and sand** — the footprint clears whatever it lands on — so a
wall ring can seal all the way around a wooded perimeter and a Dock can stand
on a beach; unit muster/formation slots still prefer `moveCost === 1` tiles so
ranks don't form up inside a thicket.

Notably absent: tree regrowth (the `SAPLING` atlas entry is unused).

## Biomes — Moderate

`js/world.js` (`BIOMES`, `classifyBiome`) and `js/map.js` (`classifyBiomes`).
Fourteen biomes — ocean, coastal waters, beach, grassland, woodland,
rainforest, savanna, desert, steppe, taiga, tundra, ice cap, highlands,
wetland — classified per tile from the three climate layers and stored in
`map.biome`. Every one of them is generated today and does two things: it sets
how densely the generator plants trees and boulders (`b.tree` / `b.rock`
scaling `plantVegetation`, so a rainforest is dense because its row says 2.2,
not because of a special case), and it tints its ground.

This is **groundwork, and honest about being groundwork.** What is deliberately
not here yet is per-biome *art*: there are no dunes, no jungle canopy, no snow,
so a desert is sand-toned grassland rather than a different-looking place. The
tint (`b.wash`, drawn as one `fillRect` over the ground coat, skipped entirely
where a biome declares 0) is the hook that art will replace. The intended shape
of adding a real biome later is: add a row to `BIOMES`, adjust `classifyBiome`,
add an art hook in `js/assets.js` — and touch nothing in the generator. The
climate layers `map.temp`, `map.moist`, `map.elev` and `map.depth` are kept on
the map after generation for exactly that reason. Biomes do **not** yet affect
movement cost, yields, or unit behaviour; `PUNY.PALM` is catalogued for the
tropical biomes and unused.

## Civilians & labour — Deep

`js/civilians.js`. **Every citizen in `nation.pop` is a body on the map.** There
is no abstract workforce left: a citizen is either a worker at a building, a
builder, or an unemployed townsperson wandering the settlement, and the count of
civilian units alive is exactly the population. `syncCivilians` (run twice a
second from `Nation.tick`) enforces that in both directions — dawn growth walks
new people out of the Town Hall, and starvation, conscription into the army, or
an enemy blade takes one away. Killing a civilian costs the nation the citizen
(`onCivilianDeath`) and frees the slot they held.

**`building.workers` is still the source of truth.** The panel's `+`/`−`, the
AI's `staffWorkers` pass and `unassignExcess` all still just move an integer;
`reconcileJobs` then moves bodies to match it, nearest free citizen first, and
retypes them (worker ↔ builder) for the kind of slot they are filling. Nothing
that used to set `workers` had to learn anything new.

**Gathering is a journey.** A worker walks to a real tile (`findWorkTile`, in
`js/buildings.js`: a tree with `treeWood` left anywhere in `LUMBER_RADIUS`, a
rock within `QUARRY_RADIUS`, a cave mouth within `MINE_RADIUS`, its own crop
field, its own Market), works there until it is carrying **5**, and walks the
load to the nearest Town Hall or Storehouse to deposit it. Wood is still cut out
of the tile itself, so forests still deplete and still turn to grass. A load is
accumulated into `unit.carry` *as it is gathered*, so a worker killed at the
tree face spills a partial load exactly like a laden Bandit. Nothing is
deposited anywhere else, by anyone: `buildingProduction` and the per-tick
deposit loop in `Nation.tick` are gone.

The consequence is the point: **distance to storage is now an economic
decision.** Measured over 400s with one worker, a Lumber Camp delivers 1.84× its
old flat rate with a Storehouse 2 tiles away, 0.97× at 8 tiles, and 0.62× at 20.
`gatherWorkTime` is what centres that curve — it solves for the time at the face
that makes a full cycle deliver the building's historical per-worker rate over a
reference 8-tile round trip (`CIV_TRIP_BUDGET`), with a floor at
`CIV_WORK_FLOOR` (0.35) of the old cycle so that a building whose load fills
faster than the reference walk — a farm with both the water and well bonuses —
cannot be handed an unbounded bonus by a short haul. Farms sit near the granary
by nature and so run around 1.9× their nominal rate; camps out at the treeline
run under it. Food is meaningfully more abundant than before this change, which
is the honest result of farms being close-in work.

**Unemployed citizens wander** (`tickIdler`) between the buildings of their own
settlement on a 4–11s cycle, drawn from `game.rng` so seeds replay. **Civilians
flee** rather than fight: `civThreatNear` (checked only when the nation is
actually at war, since otherwise it is the most-called test in the game) sends
them to the nearest friendly building. They have `dmg: 0`, never fight back, and
`findEnemyNear` skips them entirely — an army walks past the lumberjacks and
goes for the soldiers — but a **direct attack order still kills them**, and
splash still catches them. They are excluded from `armyUnits`, `strength`,
formations, Select Army, box-select and AI perception's army estimates.

**Player control: none, deliberately.** Clicking one opens an information card
(`UI.civilianHTML`) saying what that citizen is doing right now — "Hauling
materials to the Church site", "Carrying wood to the nearest store" — and right
click does nothing. You direct the economy by deciding what to build and who
staffs it.

Art: **five sheets of townsfolk, and the sprite follows the job rather than the
unit type.** `civSpriteFor` (js/civilians.js) reads `u.job` and picks the
scythe for a farm or a well, the axe for a Lumber Camp, the pick for a Quarry
or a Gold Mine, the hammer for anyone quartered as a builder, and empty hands
for the unemployed; the choice is written to `u.spriteKey`, which `drawUnit`
prefers over the type's. So a nation's economy can be read straight off the
map — where the axes are is where the wood is coming from, and a town full of
empty hands is a town with work going undone. All five are drawn at 0.85 scale
and keep their nation's hue, so whose lumberjacks those are is still legible.
The sheets are reconstructed from the design team's screenshots by
`tools/import-civilians.py` (see BUGS #37).

## Construction & builders — Deep

`js/buildings.js` (`startConstruction`, the `site` ledger, `advanceConstruction`),
`js/civilians.js` (`tickBuilder`). **Placing a building stakes out a site and
pays nothing.** The site records `needs` (the type's cost), `delivered` and
`inbound`; builders fetch from a store that actually holds the good, **15 at a
time** (`CIV_BUILD_LOAD`), and the withdrawal happens on arrival at the store,
not on setting out. Progress cannot move until `siteReady` — every material
physically on site — after which each builder present adds `dt / buildTime`, up
to `MAX_BUILDERS_PER_SITE` (3) of them.

Because goods only leave a Storehouse when somebody picks them up, materials in
transit are literally on a builder's back: kill the builder and the load spills
as loot, and the site stops counting it as inbound (`releaseBuilderLoad`) so
another builder re-fetches it. Razing a half-built site spills everything
carried there (`siteMaterials` → `game.loot`), and calling a site off refunds
the delivered materials **in full** rather than the 75% a finished building's
demolition returns — nothing has been built to lose value.

**Reservations** stop one pile of timber being promised to five sites:
`Nation.reserved(r)` sums every site's outstanding need, `available(r)` nets it
off, and `canStart(cost)` — not `canAfford` — is what every placement path now
checks (player single/line-drag/paste, and all four AI paths). Verified: with 70
wood in store, exactly 3 house sites (20 each) can be started.

**Builders come from slots like any other job.** The Town Hall has 2
(`builders: true`), staffed at game start, because otherwise no nation could
build the Builder House that makes builders. A **Builder House** (30 wood, 3
slots) is the way to more.

**Bridges are built from the bank outward.** `map.bridge` — the terrain flag
that makes water walkable — is only stamped by `completeBuilding`, so a planned
span is a row of pilings that nothing can walk on and `canPlace` reads pending
spans through `map.bridgeAt` for both occupancy and the no-perpendicular rule. A
builder works a site from an adjacent tile, so each finished deck tile makes the
next one reachable; `siteReachable` skips a bridge tile with no passable
neighbour instead of pacing at the water's edge, and `blockSite` parks any site
that has defeated the pathfinder three times for 15s.

The AI plays by all of it. `aiCanBreakGround` (`js/ai.js`) caps a nation's open
sites at its builder count (min 2) across every path it can place from —
without it, turtles queued 14 wall segments they had no hands for, and every one
held a reservation against the stone.

**Sites can be marked urgent.** Builders take the nearest site with work, which
is right almost always and catastrophic in one case: a building the nation
genuinely needs but which has to be sited far from the town centre never
attracts a single builder, because there is always something nearer, so it sits
at zero delivered for as long as the town keeps building. `b.urgent` multiplies
the distance a builder sees by `URGENT_SITE_BIAS` (0.2), so an urgent site three
times as far away wins and one twenty times as far still does not — it moves up
the queue rather than stopping everything else. The AI's invasion shipyard is
the case that forced it (a Dock must be on the coast; see Naval), and it is the
only thing that sets the flag today.

## Economy & population — Deep

`js/economy.js`. Citizens eat continuously; population grows once per dawn
(see Day/night cycle below) by 30% of the housing cap (rounded, capped at the
cap), gated on surplus food (> 2× pop), free housing, and happiness > 50;
starvation kills a citizen every 12s (floor of 2) and weakens the army (−30%
damage). Happiness is a drift toward a computed target: base 50, fed/starving,
housed/overcrowded, building auras (church/well/market, diminishing with pop),
war weariness (0–25), taxes (slider, 0–40%), −12 while the nation's King is
dead. Tax slider converts happiness into gold income; `TAX_MAX` and
`TAX_HAPPINESS_COST` are shared constants, and `happinessTargetWithoutTax()`
factors out the tax term so the AI's tax controller inverts the real formula
instead of duplicating it. Worker assignment is still manual per building (+/−) with
idle-worker accounting and auto-unassignment after deaths — but the number now
commands actual people (see Civilians & labour): `Nation.tick` no longer
produces or builds anything itself, it calls `syncCivilians` and leaves both to
the citizenry.
`estimateIncome(f, res)` lives here too (moved from `js/ui.js`). It no longer
re-implements the production maths — `workerYieldRate` (`js/buildings.js`) is
the only copy — and prefers what a building has **measured** itself delivering
(`b.yieldRate`, a fixed 25-second window sampled in `sampleYields`) over its
nominal rate, because with hauling a building's real output depends on how far
its workers walk. It falls back to nominal for a building with no delivery in
the last 45 seconds, and still reports zero for an exhausted Lumber Camp — the
signal the AI uses to decide a shortage is structural. `estimateFoodRate`
(`js/factions.js`) goes through it too, so the AI cannot think it is fed on
farms whose harvest never arrives.

The rate has to be a windowed average and not the gap between one delivery and
the next: a building's workers walk home together, so two deliveries can land in
the same tick and the implied rate comes out 6–9× the truth. That version
existed long enough to make the first balance run unreadable.

## Day/night cycle — Basic

`js/main.js` (`Game.lightLevel()`, `Game.tick`), `js/ui.js`
(`drawDayNightOverlay`, `drawHouseGlow`). A 5-minute cycle — 2.5 minutes of
day, 2.5 of night (`DAY_LENGTH`/`NIGHT_LENGTH`) — driven by a single cosine
over `game.time % DAY_NIGHT_CYCLE`, so brightness shifts continuously with no
visible jump between day and night (peak brightness at midday, darkest at
midnight, dawn/dusk sit at the halfway point). `game.dayCount` increments and
each nation's `growForNewDay()` fires once at every dawn — this is what drives
the 30%-of-housing-cap population growth. Rendered as a translucent
deep-blue overlay across the whole canvas (`drawDayNightOverlay`) plus a warm
radial-gradient glow over each house's door/window area at night
(`drawHouseGlow`, faded in with darkness — there's no distinct window sprite
in the tileset, so this lights the same spot on every house sprite). Topbar
shows `Day N` with a sun/moon glyph. **AI nations now play to the clock**: their
tax controller (`solveTaxPolicy`, `js/ai-utility.js`) raises taxes through the
night and eases them before dawn so happiness clears the growth gate, making the
cycle a visible economic rhythm you can disrupt by dragging them into a war.
Notably absent: no vision or stealth changes at night, no seasons.

## Physical resource storage — Deep

`js/economy.js`. The signature system: `nation.res` is a Proxy over per-building
`store` objects — goods exist physically in the Town Hall (300 each) and
Storehouses (500 each; gold uncapped). Deposits fill Storehouses first (juicy
raid targets), withdrawals drain the Town Hall first. Storage is finite, an
overflow warning fires for the player, and everything in a store is robbable
or spillable as loot. This underpins the entire raiding design.

## Buildings — Moderate

`js/buildings.js` (+ the Dock, added by `js/naval.js`). 15 types: Town Hall,
Storehouse, House, Builder House
(3 builder slots — see Construction & builders), Farm (2×2 crop
field, +50% near water, +25% near a Well), Lumber Camp (consumes real tree
tiles anywhere in a 25-tile square — up/down/left/right — around it; idles only
once that whole reach is exhausted), Quarry, Gold Mine (needs a cave), Market,
Church, Well, Castle, Wall/Gate (line-drag placement including 45° diagonals;
rendered as one connected structure in both axes — see the renderer entry),
Bridge (water-only, rotatable, drag to lay a span, one plank-deck sprite that
tiles seamlessly in both axes; straight runs only — a horizontal and a vertical bridge can never touch or
join, see Map generation and Units & combat), Dock (2×2, must have open water
against its footprint, builds Transports and War Galleys — see Naval).
Placement validation with per-type requirements, construction time, HP/damage,
demolish with 75% refund (except Town Hall — and except an unfinished site,
which refunds its delivered materials in full instead). **Placement no longer
builds anything**: every path now calls `startConstruction`, which stakes out a
site for builders to supply and raise (see Construction & builders). The only
direct `placeBuilding` caller left is the founding Town Hall, which has no build
time and is laid down before the `game` global exists. **Any non-water building can be
placed on forest or rock** — the footprint clears it, same as cutting a track
(caves are still off-limits); the placement ghost fills the tile white when
legal and red when blocked, and a tree inside the footprint fades so the wash
doesn't have to fight a solid canopy (`drawGhost`/`collectDepthLayers`,
`js/ui.js`). **Every building reads as what it does.** No building is a raw
atlas lookup any more: four come whole off the punyworld sheet
(`bakePuny`) — the Town Hall (a 2×2 stone keep, so it fills its footprint at
native resolution instead of one 16×16 cell blown up 2×), the Lumber Camp
(log cabin), the Gold Mine (a mossy mound with a timber-framed adit) and the
Well (a roofed wellhead) — and four more whose atlas cell said the wrong thing
are composited at load time (`bakeBuildings`, `js/assets.js`): the Storehouse
no longer shares the Lumber Camp's log cabin, the Quarry is a worked rock face
rather than a cottage, the Church has a belfry and cross in place of two pink
mushroom caps, and the Castle takes its nation's colour instead of staying
violet for everyone.
Farms had no art at all — they drew as two grass-tuft tiles, i.e. invisible —
and now draw ploughed soil while under construction and a crop field once
finished (`bakeFarmland`; `type.flat` marks them as ground art, painted with
the terrain rather than in the depth pass).
**Line placement is a true preview, not a live paint**: `beginPaint`/`paintTo`
only recompute the previewed run (`ui.paint.line`) as the drag moves — every
tile in it renders as an opaque ghost (`drawGhost`'s paint branch, sharing
`drawGhostTile` with the single-tile ghost and the paste preview) — and nothing
is checked, paid for, or placed until the mouse/touch releases, when `endPaint`
commits the whole run in one pass, skipping blocked or unaffordable tiles.
**Box-select doubles as a building picker**: dragging a selection box that
catches no units (troops always win the box) instead selects every one of the
player's buildings inside it (`UI.boxSelect`). With buildings selected — via
box or a single click — the panel offers **Copy** (captures each building's
type and relative layout into `ui.copyBuffer`) and **Demolish**/**Delete All**
(same 75% refund as solo demolish). Copying arms a **Paste** button and a ghost
preview locked to the center of the current view rather than the cursor — pan
the camera to line it up, then Paste (repeatable until Cancel/Escape) to stamp
the group via `pasteBuffer`. Ctrl+C and Delete/Backspace mirror the buttons on
desktop. And **capture**
(`captureBuilding`/`annexBuildings`): a conquered nation's completed civilian
buildings and bridges change hands with their stored goods intact, at 40% HP,
unstaffed and with queues cleared, while walls, gates and the fallen Town Hall
come down. AI nations now build walls/gates
(turtle doctrine rings) and bridges — always a straight single-axis span now,
never the old L-shaped dogleg, since a bend would touch two orientations at
the corner and `canPlace` would refuse it (`aiFindCrossing`/
`straightCrossingSearch`, `js/ai.js`) — for war-route engineering too. Gaps: no
building upgrades outside the Castle, no repair, and pasted layouts don't
rotate/mirror (a copied bridge always pastes horizontal, regardless of the
orientation it was copied from — see BUGS).

## Naval — docks, ships, invasions — Moderate

`js/naval.js`. A world of continents is unplayable without a way across the
water, so this is the minimum viable navy: a place to build hulls, a hull that
carries troops, a hull that fights, and an AI that will mount a landing.

**Dock** (2×2, 70 wood / 20 stone). `placeReq` demands open water against the
footprint — not merely nearby, or you get shipyards two tiles inland with no
way for a hull to reach them. It queues ships exactly the way a Castle queues
troops: `Faction.tickTraining` now runs for docks as well as castles, and the
only difference is where the finished unit is put down. `shipSpawnNear` finds
the nearest navigable tile; if the berth has silted up (a bridge thrown across
the harbour mouth) the order waits rather than launching a ship onto dry land.

**Ships** are ordinary `Unit`s with `naval: true`, merged into `UNIT_TYPES` at
load. **Transport** (130hp, unarmed, carries 6) and **War Galley** (160hp,
pierce 11 at range 4, no capacity). They path with `findPath(..., 'sea')` —
same A*, same wrap handling, `map.navigable` instead of `map.passable`, and a
bridge deck blocks a hull exactly as a river blocks an army. They fight with
the ordinary combat code and die the ordinary way. `Unit.pathTo` is the single
seam: every repath in `js/units.js` goes through it, so a hull can never be
handed a route over land nor an army one over water.

**Boarding.** A land unit ordered aboard walks to the shore beside the hull and
steps on; from then it is `u.aboard` and off the map entirely — not ticked, not
drawn, not separated, not targetable, not counted by the minimap — while still
sitting in its faction's roster, so it still counts as army strength. Unloading
picks dry tiles outward from the landing point and leaves anyone with nowhere
to stand aboard rather than dropping them in the sea. **A hull going down takes
everyone below decks with it** (`onUnitDeath`, `js/main.js`) — they are not on
the map to be killed individually, so the sinking is the only thing that can.

**Orders.** With troops selected, right-click a friendly transport to send them
aboard. With ships selected, right-click dry land to make a landing and open
water to sail. The point given is an *objective*, not a beach: `orderUnload`
finds the nearest water to it (`nearestBerth`, searching out to 120 tiles) and
lands on the shore beside that berth, so a fleet aimed at an inland capital
puts its troops on the nearest coast and marches.

**Cross-domain targeting.** A ship and a soldier live in different domains and
neither can walk to the other, so `canEngage` (`js/units.js`) only lets them
pick each other as *proactive* targets when one is already within weapon reach
— a galley rakes the shore it is passing, archers shoot at the hull off their
beach, and neither spends the rest of the match wading toward something
unreachable. A direct order still lands whatever it was aimed at.

**The AI's navy** (`aiNavalTick`, called from `aiTick` alongside the utility
brain, because getting an army across an ocean is a campaign rather than a
marginal-utility choice). Two jobs:

- **Exploration.** A nation on its own continent cannot scout its way to
  knowing anybody, and an AI that knows nobody never does anything. So the
  navy's first job is discovery: once the nation is on its feet, build a dock,
  build a galley, and keep it working outward through water it has never seen
  (`aiSeaScoutTarget`, biased to a middle distance so it works away from home
  rather than circling its own harbour). Everything it learns it learns by
  looking — a ship is in `f.units` and so observes exactly like any other unit
  (`AIPerception.gatherObservers`), so no rule about reading rival state is
  bent to make this work.
- **Invasion.** A small state machine on `f.ai.invasion`: `building` (waiting
  on a Dock) → `fleet` (waiting on hulls) → `loading` (army walking aboard) →
  `sailing`, and it dissolves the moment the war does. On landing it hands the
  party to `formationMove` and the ordinary war machinery, which presses an
  attack far better than this does.

  Three things about it are the way they are because a soak said so. **The
  fleet it waits for is small** — one transport for a small army, two for a
  big one, and it sails unescorted after `FLEET_PATIENCE` rather than not at
  all: holding out for a proper fleet meant every campaign was still counting
  hulls when its war ended (BUGS #43). **The stage clock is refreshed on
  progress** (`aiInvasionStep`, and again whenever a hull joins), and is
  checked *after* the stage has had its chance to advance rather than before —
  checking it first binned campaigns whose last transport arrived inside the
  same six seconds the clock ran out in. **And the shipyard is staked
  `urgent`**: a Dock has to go where the coast is, which on a real continent is
  twenty-odd tiles from the capital, and builders take the nearest site with
  work, so an invasion's dock sat at zero delivered indefinitely while the town
  put up houses. `URGENT_SITE_BIAS` (`js/civilians.js`) makes a marked site
  behave as though it were five times nearer — enough to move it up the queue,
  not enough to stop everything else.

  **And the campaign holds the peace off while it runs.** This is the one that
  actually mattered. A war across water draws no blood until the transports
  land, so from the diplomacy layer's point of view it is indistinguishable
  from a stalemate — and `aiDiplomacy`'s bloodless "exhausted peace" clause
  ended every overseas war two to three minutes after it was declared, long
  before any fleet existed. Both peace paths now skip a pair with a live
  campaign between them (`aiCampaignAgainst`, `js/naval.js`). It cannot deadlock
  a war open: a campaign that stops making progress times out by itself, and on
  a single-landmass world no campaign is ever created, so land wars behave
  exactly as they always did.

Where does an AI think a rival *is*, if it has never scouted one? Scouted
memory first. Failing that, **the drawn territory borders** — which
`CLAUDE.md` lists as public knowledge alongside the diplomacy matrices:
you can see from your own coast that somebody has claimed the land over there,
even if you have never counted their soldiers. `aiTerritoryAnchor` reservoir-
samples one tile of their claim off the seeded stream. Threat and confidence
still come only from observation, so a nation that has seen nothing still
hesitates. `considerWar`'s reachability gate was relaxed to match: an ocean is
no longer a veto, but only a nation that could actually mount a landing
(`aiCanInvadeBySea` — have we a coast, have they a coast, is there sea between)
is allowed to declare across one.

Not here: blockades, naval supply, boarding actions, coastal forts, fishing,
ferrying civilians, or a player-facing "load these and go there" one-click
order. Ships are also not yet part of `estimateIncome`, event cards or the
Formations panel.

## Orbit view — the globe — Moderate

`js/globe.js`. Zoom out past the widest tile zoom and the world stops being a
rectangle and becomes what it has been since `js/world.js`: a cylinder wrapped
round a sphere. The planet is drawn as a real orthographic projection, spinnable,
with lambert shading, an atmosphere rim, capitals marked, and stars behind it.

The projection is inverted per pixel — screen (x, y) → surface normal →
latitude/longitude → texel — which is far too much trigonometry to do every
frame. The trick that makes it cheap: **with the camera fixed and the planet
spinning about its own axis, the mapping from a screen pixel to a texture ROW
and a longitude OFFSET never changes.** Spinning only adds a constant to the
longitude. So `buildProjection` computes the row, the column and the shading
once per (radius, tilt) and caches them; each frame is then an add, a compare
and three multiplies per pixel. Only the disc's bounding box is projected,
buffered and blitted — walking the rest of the canvas to write transparent
pixels was most of the cost of the view. Measured ~5ms for the projection pass
at a 614px disc.

The world texture is one texel per tile — biome tint, depth-shaded water,
elevation hill-shading, territory blended in, capitals stamped brighter than
their surroundings so a town does not vanish at planetary scale — rebuilt on a
2.5s clock rather than per frame. The globe is composited over the starfield
through an offscreen buffer, because `putImageData` ignores what is underneath
it and would punch a black square out of the sky.

Entering and leaving are continuous with the tile map. Zooming out from zoom 1
lifts off *at the longitude the camera was looking at*, tilted to put that
latitude near the middle of the disc, so it does not teleport you round the
world. Drag (or one finger) spins and tips it; a pixel of drag turns the globe
by the angle that pixel subtends, so the ground follows the cursor. Wheel or
pinch pulls the planet closer until it fills the view and then hands back to
the tiles at the point you were looking at; a click or tap that did not spin
anything drops you straight onto that spot. WASD works too. The HUD, minimap
and panels stay live throughout, and the sim keeps running.

The globe is only offered on wrapping worlds — Duel Island has no far side.

## Market & commodity trading — Deep

`js/market.js`. A global supply/demand exchange for food/wood/stone with gold
as currency: price = base × (equilibrium ÷ stock), clamped 0.35×–3.5×, 10%
buy/sell spread. Player selling floods the stock (price falls); buying drains
it (price rises); stock mean-reverts 2%/s; nations running short of a good pull
stock down so shortages spike prices. Direct barter at market-implied rates.
Embargoes impose up to a 60% access penalty on the target's trade terms
(20% per embargoing nation). AI factions with a Market trade against **marginal
utility** rather than fixed stock thresholds — they sell a good when the gold it
fetches is worth more to them than the good is, and buy when it is worth less —
so a nation with full granaries and no stone converts one into the other on its
own, and prices genuinely move. Exploit note: the stock floor of 5
means a capped-price market never truly runs out of goods.

## Raiding & plunder — Deep

`js/units.js`, `js/main.js`. Two paths, and **the Bandit is the only unit
involved in either** — every other troop has `carry: 0` and physically cannot
pick plunder up. Bandits (fast, fragile, `robber`) are sent onto an enemy
storage building, siphon 30/s prioritizing gold → stone → wood → food up to a
45 carry cap, then auto-haul home and bank the take. Razing a storage building
spills its entire stock as a ground loot pile; a Bandit picks it up by standing
on it, an idle Bandit within 5 tiles is auto-drawn to it, laden Bandits show a
sack sprite and spill their cargo when killed, and piles decay after 120s (with
a blink warning). The AI trains bandits in wartime and targets the richest
enemy storehouse. The design consequence is deliberate: an army that sacks a
storehouse without a raider along watches the spoils rot on the ground.

## Units & combat — Deep

`js/units.js`. **Nine** unit types across 3 castle tiers, with three damage
types (melee/pierce/magic), armor (Halberdier, ignored by magic), an
anti-cavalry bonus (Spearman ×2.2 vs Cavalier), projectiles (arrows, fireballs
with splash), the unique King (aura: +15% damage in 4 tiles; morale penalty on
death), and the Prince envoy. The roster was cut from 13 to 9 (Shieldman,
Crossbowman, Archmage and Horseman are gone) so that no unit is a strictly
better version of another: tier 1 is Swordsman / Spearman / Archer / Bandit /
Prince, tier 2 is Halberdier (the armoured tank, which inherited the
Shieldman's armor at 2) and Cavalier (shock cavalry, promoted down from tier
3), tier 3 is Mage and King. Real-time combat with cooldowns, auto-acquire
within 5 tiles, fight-back when hit, periodic repathing toward moving targets,
building attack/destruction. Training consumes a citizen (requires 2 free) and
runs through a per-castle queue with rally points.

**Bridges are destructible, and one hit takes the whole span.** A bridge is
never picked up by passive auto-acquire (`findEnemyNear` explicitly skips
`type.key === 'bridge'`, same as territory scoring and AI perception) — the
only way to hit one is a deliberate right-click attack order, which now
resolves against `map.bridgeAt` as well as `map.buildingAt` (`UI.rightClick`,
`js/ui.js`). Each tile of a span is its own `Building` with its own HP, but
knocking any one tile's HP to 0 collapses every tile of the straight run it
belongs to (`collapseBridgeSpan`, `js/buildings.js`) — a unit standing on
either bank, within range of the nearest end tile, brings the whole crossing
down without ever having to fight its way onto the water. A damaged-but-not-
yet-destroyed span shows the ordinary green HP bar over the tile under
attack (`render`, `js/ui.js`), same as any other building.

Note that armor is what gives the three damage types their teeth — magic
ignores it, melee and pierce do not — so the Halberdier carrying armor is
load-bearing for the whole damage-type system, not flavour.

### Targeting priorities

`Unit.targetPriority`, `TARGET_PRIORITIES` and `matchesPriority` in
`js/units.js`; the dropdown in `UI.targetPriorityHTML` (`js/ui.js`). Every
selected group can be told what to go looking for a fight with: **Anything**
(default), **Troops only**, **Buildings only**, or one specific building type —
Town Halls, Storehouses, Farms, Houses. Set it on the unit selection panel and
it applies to every non-envoy unit in the selection; a selection whose members
disagree shows a non-selectable "Mixed" entry until one is chosen for all.

The priority filters **proactive acquisition only** — `findEnemyNear`, the
5-tile auto-target sweep — and deliberately nothing else:

- A direct attack order from the player always lands whatever it was aimed at.
  The priority is standing orders, not a restraining order.
- A unit that is *idle* when something hits it still fights back
  (`Unit.takeDamage`), so a Storehouses-only group is never a row of statues
  being shot to pieces.
- A unit that already has a target is not diverted by either mechanism, which
  is what makes "Buildings only" work as a siege order: the group walks past
  the defenders, latches onto the works, and stays on them.

A priority that matches nothing within 5 tiles finds nothing, which is the
point — that is the difference between a group that grinds through the garrison
and one that goes straight for the granaries. Set on units, not on the
selection, so it survives deselecting and reselecting. AI units leave it at
`any`.

### Group roles — offensive & defensive

`Unit.groupRole` / `defensivePost` / `setGroupRole` / `tickPatrol` and
`GROUP_ROLES` in `js/units.js`; `Territory.controls` and `patrolTileNear` in
`js/territory.js`; the radio row and Split Group flow in `js/ui.js`. A selected
group can be given a standing posture:

- **Offensive** — never moves on its own; goes where it is sent, however far.
  This is the historical default behaviour written down, not new behaviour.
- **Defensive** — plants a `defensivePost` on the tile each unit is standing on
  when the role is assigned, then garrisons it. An idle garrison patrols on a
  5–11s cycle (de-phased per unit so a squad doesn't step off in lockstep) to a
  random open tile inside **its own nation's territory** within 7 tiles of the
  post, and walks straight back the moment it is more than `DEFENSE_LEASH` (10)
  tiles out.
- **None** — the un-assigned state. Behaves exactly like offensive; kept
  distinct so the panel can say "no role" honestly.

A garrison sweeps for targets **from its post rather than from itself**
(`findEnemyNear`'s `ox`/`oy` arguments), so its reach is pinned to the ground it
holds instead of creeping forward every time it takes a step toward something,
and it drops any target that gets more than `DEFENSE_LEASH + 1` tiles from the
post rather than giving chase. That +1 is hysteresis — without it a target
hovering on the boundary is acquired and dropped on alternating ticks. The
result is a garrison that cannot be baited: in a headless test a 4000 HP decoy
retreating one tile per second out to 42 tiles from the post never pulled the
garrison past 10.7 tiles.

Ordering a defensive group to move **re-posts it** at the destination
(`UI.rightClick`) — "defend there instead", rather than marching over and then
walking all the way home again.

**Unit selection panel** shows each unit type with a `−` count `+` row so you
can type a number or click the buttons to set exactly how many of each type are
in the selection. The pool covers all alive non-envoy player units (including
defensive), so you can add or remove from the selection without re-box-selecting.
Reducing a type to 0 deselects those units; clearing the last unit closes the
panel entirely.

**Split Group** (panel button, shown for selections of 2+ fighters) peels part
of a selection into a group of its own: it opens the same type-based `−` count `+`
interface for the current selection, you set how many of each type move to the
new group, and confirming makes the picked troops the new selection — so the role
and priority controls that reappear act on the new group alone. Map clicks are
inert while the mode is open, so a stray tap cannot silently discard the pick.
Selected garrisons draw a dashed tether to their post on the map.

**Select Army** (pause menu) selects all alive, non-envoy, non-defensive player
units. Defensive (garrisoned) troops are excluded so the button always targets
the field army.

Roles are player-facing only; AI units never set one.

## Formations & crowd separation — Deep

`js/units.js` (`formationMove`, `formationSlots`, `separateUnits`), `js/main.js`
(persistence), `js/ui.js` (the panel). Group orders arrange units in rotated
ranks facing travel direction, one unique destination tile per unit via spiral
search — and both halves of that arrangement are now **player-configurable**
from Menu → Formations:

- **Shape** — `diamond` (default: a point that widens to a middle rank and
  narrows again; a group of n fits inside a diamond `ceil(sqrt(n))` ranks wide,
  and a group too small to fill it marches as the leading wedge) or
  `rectangle` (the old block, up to 6 columns wide).
- **Marching order** — a drag-reorderable list of all nine unit types, front of
  the formation first. It replaces the old hardcoded melee-then-ranged sort;
  that sort survives as the default order. Units of a type not in the list fall
  to the back, and the sort is stable, so identical orders always produce
  identical ranks.
- **Group pace** — a formation now marches at the speed of its *slowest*
  member (`Unit.formSpeed`, cleared by any non-formation order and on arrival),
  so cavalry no longer arrives alone several seconds ahead of the shield wall.
  Measured over a 26-tile march, a Cavalier and a Swordsman end up 1.2 tiles
  apart with the cap and 8.1 without.

Settings are saved to `localStorage` under `nations_formation_<nation name>`
and reloaded by the `Game` constructor, so a doctrine persists across
playthroughs. Loading is defensive (`sanitizeFormations` in `js/main.js`): an
unknown shape falls back to the default, and unit keys that no longer exist —
a save written before the roster was cut to nine — are dropped, deduplicated,
and any newly added type is appended.

The pace cap applies to every nation (it is formation integrity, not taste),
but the shape and order preference applies to **the player's groups only** —
AI waves call the same `formationMove` and form up on the defaults, because a
toggle in the player's menu should not reshape enemy armies.

Every tick, a spatial hash pushes overlapping units apart (0.45-tile radius,
capped nudge, golden-angle split for perfectly stacked pairs), with an escape
hatch for units stranded on impassable tiles. Full detail in
`docs/formations-tiers-ui.md`.

## Castle tiers — Moderate

`js/buildings.js` (`CASTLE_UPGRADES`), `js/factions.js`. Two purchasable
upgrades: Garrison (tier 2: Halberdier/Cavalier) and
Royal Academy (tier 3: Mage/King). Locked units render with
a lock icon and unlock hint. The AI buys upgrades under threat/doctrine/
population triggers (conquest and prosperity upgrade eagerly) and filters its
training pool by tier. Data-driven — a tier 4 needs only data entries. The
separate Grand Castle upgrade (`GRAND_CASTLE_COST` in `js/buildings.js`:
300g/200w/200s, 50 pop + 70% happiness gates) is a prestige monument, not a win
condition — prosperity-doctrine AI nations race for one same as before, but
completing it (yours or a rival's) has no effect on whether the game continues.
See "Defeat" below.

## Diplomacy — Deep

`js/diplomacy.js` (mechanisms) + `js/ai.js` (`aiDiplomacy`, AI initiative).
Symmetric relations (−100…+100) and a status matrix (war/neutral/trade/
alliance) per pair, plus `warSince`/`lastBlood` matrices for peace-seeking.
Gifts buy relations. Trade pacts and alliances require a Prince envoy who
physically rides to the target's Town Hall — for the player AND for every AI
nation (the old instant AI pact flips are gone). AI→player proposals arrive as
an Accept/Decline/Rebuff event card. Pacts spawn caravan pairs on a real
pathfound route, stamped as road tiles (speed bonus), paying both sides 8 gold
per arrival; caravans are killable and routes die with their markets. War
declaration drags in the defender's allies; peace costs 100 gold reparations
and can be refused by a winning AI. Embargoes cascade to the embargoer's
allies and worsen the target's market terms. AI factions proactively drive all
of it per their current ambition — but now on what they have actually seen: a
pact proposal needs a rival Market the nation has laid eyes on, gifts go to
neighbours it *believes* are stronger, and peace offers weigh a remembered
enemy, not a true one. Envoy proposals, gifts to looming powers, embargoes on
hated rivals and runaway leaders, war declarations gated on a sustained observed
advantage, suing for peace when weary and losing, and automatic white peace for
mutually exhausted bloodless wars.
`Diplomacy.tick` itself keeps only ambient relations drift (pacts warm,
covetous ambitions cool).

## AI opponents — Deep

A utility-based decision engine on a staggered 2-second tick, split across four
files: `js/ai-perception.js` (what a nation knows), `js/ai-utility.js` (scoring,
archetypes, marginal utility, tax policy), `js/ai-trade.js` (market orders and
the war-versus-trade call), `js/ai-combat.js` (scouting, army, war gating).
`js/ai.js` keeps the ambition model and the executors those managers drive —
war waves, bridge and wall engineering, coalitions, event cards. `aiTick`
(`js/factions.js`) is now a thin dispatcher; ticks are phase-staggered by
faction id rather than randomly, so nations never tick together and a seed
replays identically. `js/naval.js` (`aiNavalTick`) hangs off the same
dispatcher for sea exploration and amphibious invasion — see Naval for why it
sits beside the utility brain rather than inside it.

**Nothing is read from global state.** Civilians are invisible to all of it —
seeing a rival's farmhands says nothing about their army, so `observe` and
`visibleThreatNearHome` skip them, though a nation's own workers do count as
observers (a lumberjack at the treeline is a real pair of eyes). Each nation
keeps a `ScoutMemoryMap`:
rival positions, rough army sizes and storehouse contents, written only by real
line of sight (7 tiles per soldier, 9 per building, 12 for a town hall or
castle), combat contact, or diplomacy. Memories decay, and — the important part
— **low confidence inflates a threat rather than shrinking it**, so a nation
that has lost track of a neighbour treats it as dangerous and sends a rider
instead of guessing. Scouts are real units carrying a `scout` mission: they ride
outward in chained legs, do not stop to fight, and can be killed, which costs
the nation its intelligence. Public knowledge stays public: war declarations,
the diplomacy matrices, market prices and drawn territory borders.

**Ambitions (archetypes)** are the parameter sets in `AI_ARCHETYPES`. The three
primary ones are **Aggressor** (army targets to 34, eager tier upgrades, wars on
a sustained edge), **Merchant** (token army, double markets, buys what it lacks,
races the Grand Castle) and **Defensive Turtle** (wall rings, stockpiles, stone
economy, fights only intruders); **Raider** (bandit stables, short plunder wars)
and **Hegemon** (alliance webs, coalitions against runaway powers) round out the
set. Each carries utility weights per action family, per-resource bias and
reserves, a scarcity curve, happiness floor and tax appetite, war-versus-trade
thresholds, risk tolerance and scouting budget. Nations re-score their ambition
against the world *as they understand it* every 60s (and instantly on shocks),
with triple-gated hysteresis.

**Personalities are rolled per match** from the map seed (`AI_TEMPERAMENTS`,
`rollPersonalities` in `js/factions.js`): five traits — aggression, mercantile,
greed, caution, loyalty — drawn without replacement from six temperaments and
jittered. The warlord next door in one game is a walled-up trader in the next.
`?seed=N` still reproduces the whole setup.

**Investment is arbitrated, not scripted.** Each tick the engine scores
building, castle upgrade, expansion and Grand Castle against each other and runs
the best affordable one, with a small stickiness bonus so it does not dither.
Building scores fold in the marginal utility of whatever the building produces,
storage pressure and blocked population growth.

**War has to be earned.** A declaration needs a real army of its own (6 units
and 110 strength — floors that make a 30-vs-0 comparison impossible), an
advantage measured against remembered intel with unknowns treated as dangerous,
a motive (grudge, bad blood, a resource the market cannot supply, or a runaway
power), a route the army can actually walk, and odds that have **held for 30
seconds** rather than flickered once. Nothing opens hostilities inside the first
~150 seconds (scaled by difficulty). Defence is reactive: a wave is recalled
when enemy soldiers are visible near the capital.

**Economy.** Deficit-scored build planning; farms staffed first when food is
negative; a lumber camp on a worked-out forest is unstaffed so the shortage
surfaces; recruits are held back from the workforce when the army is under
strength (capped at a third of the population). Staffing now moves real people
without knowing it — `staffWorkers` sets `b.workers` exactly as before and
`reconcileJobs` (js/civilians.js) walks citizens to match, including the Town
Hall's and Builder Houses' builder slots, which come first in the building list
and so are filled first. A nation wants `1 + floor(pop/25)` Builder Houses and
will not break ground on more sites than it has builders (`aiCanBreakGround`). Marginal utility per resource is
demand-derived — a nation wants stone because the quarry it is trying to build
costs stone — and drives market orders, trade pacts, expansion and, at the
extreme, war. The AI keeps back the price of a Market in timber so it can never
be locked out of building (see BUGS, fixed).

**Tax policy follows the day/night cycle.** The controller inverts the real
happiness formula (`Nation.happinessTargetWithoutTax`) to solve for the highest
rate that still holds a target happiness, then scales it by how much the nation
actually needs gold. When dawn growth is available it raises the floor above the
50% gate about 35-60 seconds ahead of dawn — so nations tax hard through the
night and ease off before dawn to let their people multiply.

Gaps: no naval anything; scouts do not deliberately probe defences before an
assault; the memory map is not visualised for the player.

## Territory & borders — Moderate

`js/territory.js`. A per-tile influence field radiating from completed
buildings (townhall 20/r12, castle 14/r10, walls 6/r4, others 8/r6),
recomputed every 5s; the strongest nation owns each tile, a runner-up within
60% marks it contested. Rendered as dashed frontier lines on the main map and
an ownership tint on the minimap. Sustained contested frontiers sour relations
and spark **border disputes**; so does completing a building on another
nation's claim. Player disputes arrive as event cards (Concede / Negotiate
40g / Stand firm — ignoring one is worse); AI–AI disputes resolve from
strength, ambition and relations, and can harden into wars or soften into
trade pacts. Two helpers hang off the same field for defensive garrisons
(see "Group roles" above): `Territory.controls(fid, x, y)` is the bounds-safe
"is this tile inside that nation's claim?" (`ownerAt` alone reads off the end
of the array on an off-map tile), and `patrolTileNear(fid, cx, cy, radius)`
draws a patrol leg — a random open tile inside the nation's own claim within
`radius` of the post, from `game.rng` so a seed replays the same routes. It
returns null when the post sits outside its own territory, and a garrison
posted on foreign ground then simply holds position rather than wandering off
looking for friendly soil. Gaps: territory has no direct economic effect (no
tile tribute), walls don't project claims far.

## Event cards — Moderate

`js/events.js` (queue + resolution) + `ui.refreshEventCard` (`js/ui.js`,
`#eventcard` HUD element). AI-initiated interactions reach the player as
non-pausing choice cards: envoy proposals, border disputes, ultimatums
(tribute / counter-offer / refuse, with war 60s after refusal), peace offers
with reparations, and coalition invites against runaway powers. One card
shown at a time (queue capped at 3, "+N more" badge), a draining timer bar,
per-faction politeness cooldowns (45s), and expiry consequences — silence is
an answer. Hidden by Hide UI like every HUD element.

## Difficulty modes — Moderate

`js/main.js` (`DIFFICULTIES`, `#difficulty` overlay in `index.html`). Chosen
on a pre-game screen before the Game is constructed (or via `?difficulty=`,
which round-trips in the URL with `?seed=`): **Measured March** (ramped — wars
telegraphed by ultimatums, 5-minute player grace, victors consolidate 180s
after conquests, coalitions form against snowballing powers), **Quiet
Frontier** (AI wars each other freely but only marches on the player after
real provocation — declared wars, embargoes, robbery, killings, stand-firm
disputes), and **Iron Age** (ruthless — attacks on advantage from the start,
no ultimatums, no consolidation, bigger armies). Knobs: `warAppetite`,
`ultimatums`, `consolidation`, `coalitions`, `armyMul`, `playerGrace`,
`provokedOnly`.

## Defeat — Moderate

`js/main.js` (`Game.checkDefeat`/`Game.end`). **There is no way to win.**
Rival nations can be conquered, eliminate each other, race a Grand Castle, or
end up allied with every survivor — none of it ends the game, for the player
or for them. The only end state is the player's own Town Hall falling
(`Your Town Hall lies in ruins. The nation is lost.`), which freezes the sim
and shows the end screen (skull icon, "Defeat", *Play again*). There is no
"keep playing" — defeat is the only way to arrive at the end screen, so there
is nothing to play on past.

Elimination (any nation's, not just the player's) still kills the faction's
units and cancels its trade routes, and its buildings are **annexed** by
whoever felled its Town Hall (`conqueredBy` → `annexBuildings`) rather than
erased — so taking a rival's mining town is worth more than burning it, and the
map consolidates into real empires either way. Every survivor rethinks its
ambition on any nation's fall; on paced difficulties the victor rests
(consolidation) before its next war. The map keeps consolidating with or
without the player watching — an unwatched corner of the continent can end up
one giant empire, or the player can outlast every rival and simply keep ruling
alone; neither stops the sim. No score screen or stats beyond lifetime trade
gold.

## Dev mode — Basic

`game.devMode` (`js/main.js`), `Game.devTopOff`/`Game.toggleDevMode`; the
"Dev Mode" toggle in the pause menu (`js/ui.js`, `index.html`). A cheat for
testing, player-only:

- **Infinite resources.** Every tick while devMode is on, `devTopOff` writes
  `DEV_RESOURCE_FLOOR` (9999) directly into the player's Town Hall's `store`
  for each resource if it's below that — bypassing normal storage capacity
  (`capacityFor`) entirely, since the Town Hall's declared caps (300 food/
  wood/stone) are far below the floor. This is a deliberate bypass, not a
  change to how storage capacity normally works for anyone else, including
  AI nations. It runs every tick rather than once on toggle, so ordinary
  consumption (eating, upkeep, training/building costs) never drains it for
  more than an instant.
- **Unlimited troops.** `Faction.trainUnit` skips the "No free citizens"
  population gate and the cost/pay step entirely when `this.isPlayer &&
  game.devMode` — necessary because, unlike resources, population is never
  topped off, so training would still consume it and eventually hit the gate
  even with infinite gold sitting in the bank.
- Castle-tier locks, the one-King rule, and the Grand Castle's population/
  happiness gates are untouched — those are progression rules, not resource
  constraints, and stay in effect even in dev mode. (Costs for the castle
  upgrades and the Grand Castle are trivially affordable once resources are
  topped off, so tier progression is still fast — just not instant.)
- A red "DEV" badge appears in the topbar the whole time it's on, so it's
  never accidentally left running unnoticed. Not persisted — resets to off on
  reload/new game, since it's a debug aid, not a game setting.

## Desktop UI/HUD — Deep

`js/ui.js`, `index.html`. Canvas renderer (pixelated, 4 zoom steps, wheel-zoom
to cursor, WASD/arrow pan with Shift boost, camera clamp), y-sorted units,
health/construction bars, selection rings/outlines, drag box-select (troops
first, buildings only when the box has none — see the Buildings entry).
**Placement ghost** (`drawGhost`/`drawGhostTile`): the hovered footprint washes
white when `canPlace` (and affordability) allows it and red when it doesn't —
a filled tile, not just an outline, so it reads clearly at a glance. While a
wall/gate/bridge line is being dragged, `drawGhost` instead washes every tile
of the previewed run (`ui.paint.line`), each checked against a running
cost total so the wash goes red once the run would outspend the nation, not
just when a single tile is blocked. `placementFootprint()` follows the same
line (or just the hovered tile outside a drag) into the tile-index set
`collectDepthLayers` uses to fade any tree inside it, so a forest placement's
canopy doesn't visually fight the wash. The copy/paste preview (`drawPastePreview`)
reuses `drawGhostTile` too, but anchors to the screen's center tile instead of
the cursor. **Ramparts** (`bakeRamparts` in `js/assets.js`,
`drawRampart`/`drawTileSlice` in `js/ui.js`): walls and gates are assembled per
tile from five baked connector pieces rather than stamped as whole sprites, so
runs join seamlessly **horizontally and vertically** and gates sit inside a run
instead of interrupting it. Straight runs draw the connector whole; corners,
junctions, ends, lone posts and diagonals draw a half connector toward each
neighbour they actually have and a tower over the join. Gates pick a vertical
arch when the run through them is north–south. Four of the five pieces are one
punyworld cell taken as-is — that pack's castle-wall set was drawn to tile, so
none of the edge repair the old atlas art needed applies; only `gateV` is
composed, by dropping the horizontal gate's door into the vertical wall. The
pack's masonry is too desaturated for the warm faction recolor to see, so the
rampart pieces (and the Town Hall keep) take an explicit `stoneHue` pass —
without it every nation would share one grey wall. The owner marker goes on towers,
gates and every third plain segment rather than every tile, so a long wall is
not a dotted line of coloured squares. **Depth pass** (`collectDepthLayers` +
one sort in `render`): everything with height — tree canopies, buildings,
ramparts, units, loot piles — is drawn in a single list sorted by the world Y
of its base, so whatever stands nearer the camera overlaps whatever stands
behind it. The five separate passes this replaced meant a building always
painted over the tree in front of it and a unit always painted over the
building it was standing behind. Tree tiles are not drawn inside the terrain
loop: the same three `AT.TREES` sprites are drawn in the depth pass at
`TREE_CANOPY` 2 tiles across, 2–4 to a tile, jittered so canopies overlap their
neighbours and a patch of `T_TREE` closes into a wood instead of a grid of
lollipops. Clump density follows `countAdjacent(T_TREE)` (dense interior, sparse
fringe) and drops at zoom 1; placement comes from `tileNoise(x, y)`, a pure
function of the tile, so the forest never shimmers as the camera moves. Boulders
get the same deterministic jitter in their own terrain sub-pass — stamped dead
centre they lined up into a visible lattice. The art itself is untouched.
`collectDepthLayers` takes an optional fade set (tile indices to render
translucent) so the placement ghost can preview a tree about to be cleared.
**Construction bars** (`drawBuilding`): an unfinished building carries an amber
materials bar above its blue progress bar, and the blue one cannot move until
the amber one is full. A pending bridge tile draws its deck ghosted at 0.4 alpha
with a progress bar over it, since `map.bridge` is not stamped until the span is
finished and the tile would otherwise be invisible water.
**Civilians in the selection model**: box-select and Select Army skip them,
a single click opens a read-only card describing what that citizen is doing, and
a right click with only civilians selected does nothing at all.
**Unit overlays** (`drawUnit`): the sheet comes from `u.spriteKey ||
u.type.spriteKey || u.type.key` — the per-unit key exists so a civilian's
sprite can follow their trade rather than their unit type (see Civilians &
labour). Civilians are drawn at `type.scale` (0.85), and
every overlay measurement scales with the figure rather than the camera, so the
faction flash still sits on a worker's head. the faction flash, health bar, caravan/envoy
badge and plunder sack stack upward from the top of the *figure*, measured per
sheet by `describeSheet`, not from the top of its 32px frame — a foot soldier's
art starts 15 rows down it, so frame-anchored markers floated the better part of
a tile above his head. The selection ring sits on the sprite's foot line for the
same reason. Also: minimap (terrain + roads + buildings + units +
territory ownership tint + viewport rectangle, click/tap to jump), dashed
territory border lines on the main map, event cards (`#eventcard`, see Event
cards above). Topbar with live stats, tax slider,
and per-stat live tooltips (income vs consumption breakdowns; happiness
itemized). Building panel: workers (labelled Builders on a Town Hall or Builder House),
a construction site's materials ledger and how many builders are on it, storage
contents, castle training/upgrades/
rally/Grand Castle, market buy/sell/barter, copy, demolish; a box-selected
group of buildings gets its own summary panel with Copy and Delete All.
Diplomacy panel with
relation bars and full action set. Event log with fade. Pause menu (freezes
sim): Resume, Diplomacy, Select Army, Speed 1x/2x/3x, Hide UI, New Game.
Every HUD block is independently collapsible; global Hide UI (H) for
watching battles. Fixed-timestep sim (0.1s) decoupled from rendering.

## Touch & mobile — Deep

`js/ui.js`, `index.html`. Full parallel input scheme: one-finger drag pans,
pinch zooms about the gesture midpoint, tap selects, hold-then-drag
box-selects, double-tap or two-finger tap issues the command (move/attack/
rob/rally/board/land) with deferred-select logic so double-taps don't drop the
selection. **Pinching in past the widest tile zoom leaves the surface for the
orbit view**, where the gesture set collapses to the two that mean anything up
there: one finger spins and tips the planet, two pinch it closer, and a tap
that did not spin anything puts you down on that spot.
Safe-area insets, coarse-pointer sizing, portrait rotate prompt with a
persisted "play anyway" choice, orientation/visualViewport resize handling.
Panel placement is driven by shared `--hud-*` custom properties rather than
per-panel arithmetic, so every floating block clears the resource bar and the
build bar by the same margin and each owns one screen slot (see "HUD layout &
stacking" in `docs/formations-tiers-ui.md`). On a landscape phone the build bar
fits its full row of 14 buttons, the diplomacy panel becomes a centred sheet
with a backdrop and outranks the build bar and log in the stacking order, the
event card moves to the top row rather than fighting the build panel for the
bottom-left corner, and the pre-game/end overlays scroll instead of clipping.
The message log keeps 3 lines instead of 7 on a short screen.

## Rendering & assets — Deep

`js/assets.js`. Tile atlas mapping, per-faction palette swap at load (hue-band
recolor: blue clothing for units via `hue`, warm masonry for buildings via
`roofHue`), automatic animation table detection by scanning sheet rows for
non-empty frames (idle/walk/attack/hurt/death) plus the opaque bounds of the
figure inside its frame (`top`/`bottom`, used to place unit overlays and the
selection ring), projectile sheet, pixel-art icon CSS sprites replacing emoji
throughout the HUD.

**Civilians have their own art, and pick it per job.** Five sheets
(`assets/units/Civ*.png`: farmer, woodcutter, miner, builder, plain townsfolk)
take the ordinary per-faction `recolor` alongside the soldiers — same blue
band, so a civilian wears their nation's colours and whose workers those are
stays a targeting decision. Which sheet a given citizen uses is not fixed by
their unit type: `civSpriteFor` derives it from the job and stores it on
`u.spriteKey`, and `drawUnit` reads `u.spriteKey || u.type.spriteKey ||
u.type.key`.

The `drab` pass is gone with the placeholder it existed for. While civilians
borrowed `MiniShieldMan` and `MiniCrossBowMan`, they were soldiers' silhouettes
and needed muting (saturation ×0.42) to stop a crowd of workers reading as a
crowd of troops. Art that is drawn as townsfolk does not need to be washed out
to look like them, and washing it out cost real information — the farmer's
tunic is a light blue, and desaturating "pale blue" indiscriminately is exactly
what flattens it.

**Terrain added for the world pass.** The beach is a 3×3 sand set off the
punyworld sheet (`PUNY.SAND`), baked from the *plain* sheet rather than a
faction-recoloured one — a beach belongs to the world, not to whoever owns the
tile — and picked per tile by `GameMap.sandEdge` from its neighbours, with
water counting as sand so the strand runs to the waterline and the water's own
baked lip covers the join. Depth is a ramp of translucent navy (`DEEP_SHADES`,
`js/ui.js`) laid over the ordinary shoreline autotile; the first attempt swapped
in a flat dark tile past a depth threshold and drew a hard blocky shelf a few
tiles out, which read as a rendering seam rather than as water getting deeper.
The biome tint is one `fillRect` per visible tile, skipped where a biome
declares a wash of 0.

**Ships are baked, not spritesheets.** There is no boat anywhere in either
tileset, so `bakeShips` draws the Transport and the War Galley the same way the
Quarry and the Storehouse are drawn — as pixel runs — taking the nation's
colour on the sail. `drawShip` is a separate path from `drawUnit`: one static
sprite mirrored to its heading, a health bar, and pips along the gunwale for
the troops aboard.

**The minimap is two layers now.** The expensive one — one pixel per tile of
terrain, biome and territory — is a whole-world scan, so it is cached and
rebuilt on a 2s clock (`renderMinimapBase`); at planet scale that loop is half a
million pixels and running it per refresh cost more than drawing the game did.
The towns and troops are redrawn over it each time. The per-pixel work uses
scalars rather than a fresh `[r,g,b]` array per tile, which was most of its cost.

These sheets came from the design team as phone screenshots of a sprite viewer
rather than as PNGs, so `tools/import-civilians.py` rebuilds them: it undoes
the viewer's magnification (4.7325× across, 5.1425× down — the screenshots are
stretched, and resampling both axes the same way yields 32×33 frames and a
sheet that drifts out of alignment by the bottom row), floods the backdrop
away from the edges, clusters what is left down to the ~12 colours the artist
drew with, and cuts the frames on the soldier sheets' own convention (feet on
row 30, centred on column 16). Re-runnable, and `--check` reports the recovered
grid plus which colours the faction recolour will move. See BUGS #37 for what
is exact and what is approximate.

The two hue knobs used to be one. `hue: null` meant "leave the art alone",
which is right for the player's units (the Minifolks art is already blue) but
left Azuria fielding blue troops out of *orange* buildings while every rival's
buildings matched their banner. `roofHue` is now set for all four nations, and
the warm band wraps through red (345°–42°) instead of starting at 8° so the
Lumber Camp's timber — which straddles that seam and so half-recoloured —
takes the nation's colour cleanly along with everything else.

**Composited building art (`bakeBuildings`, `bakeFarmland`, `bakeArt`).** Same
no new image assets, just the atlas plus a few pixel ops per tile, baked once
per faction at load. Covers the Storehouse (barn doors and sacks on the house
silhouette — it shared the Lumber Camp's cell), the Quarry (a rock face and
dressed blocks — the cell was a cottage), the Church (mushroom caps `strip`ped
off, belfry/spire/cross and a gabled nave drawn on), the Castle (`shiftHue`
moves its violet stonework onto the faction colour) and the two farmland tiles.
The Town Hall, Lumber Camp, Gold Mine and Well are baked too but not *drawn*
here — they are whole punyworld cells (`bakePuny`), the Well having previously
been a hand-drawn wellhead put there because its atlas cell was a green mound
all but identical to the CAVE terrain tile. `drawBuilding` prefers a baked
canvas over the atlas lookup, so `BUILDING_TYPES.art` is `null` for every type
that has one — which is now every building except the House and the Market.
Note the church is baked from the *untouched* atlas and tinted afterwards:
`strip` matches exact hexes, and on the recoloured faction sheet the caps'
pinks have already moved. Gaps: bandits and trade caravans both ride the
horseman sheet, which is no longer any unit type's own art — it survives in
`UNIT_SHEETS` purely as the Bandit's `spriteKey` (and the caravan's, since
caravans spawn as Bandits with `carryCap` zeroed); the day/night indicator in the topbar is
still an emoji glyph (no sun/moon in `icons16x16.png`) — the last one, now that
the Copy/Paste buttons have dropped their clipboard; the Castle and the Church
still scale one 16×16 cell up to their 2×2 footprint, so they have visibly
chunkier pixels than a 1×1 House — `buildingSprite` reads a baked canvas at its
own size now, so closing that gap is a matter of art, not code (the Town Hall
already has it).

**Tileset is a spliced composite, not a single source.** `assets/tileset16x16_1.png`
is one 8×**17**-cell, 16px-grid PNG at the same coordinates `AT` has always
pointed at — but a 2026-07 pass overwrote specific cells in place with art from
the **PUNY_WORLD_v1** pack (a separate 27-column Tiled tileset, at that point
supplied only as a reference sheet): `AT.TREES` (all 3), `AT.SAPLING`,
`AT.ROCKS` (all 5, currently a single boulder tile repeated — the pack had only
one clean standalone rock icon), `AT.CAVE` (now a wood-framed mine-shaft
opening), `AT.WELL`, and both pair-slots of `AT.TOWNHALL`/`AT.HOUSE`/`AT.MARKET`
(a log-cabin set; player and AI pre-recolor art are now identical tiles — same
as every non-pair building already worked, see below). Because every replaced
building tile's dominant hue sampled into the existing warm recolor band
(`recolor(tileset, hue, 'warm')`, [8°,42°]), per-faction roof recoloring still
works unmodified. Deliberately **left untouched**: water (the full 9-slice +
strip autotile set), Castle, Church, Quarry, Storehouse, and base grass tiles
(swapping the grass hue risks a visible seam against water art's baked-in
shoreline-over-grass blend). `AT.CROP_VARS` is gone (farms have their own baked
field tiles now) and so is `AT.QUARRY`. That pass changed no code — it was
purely `assets/tileset16x16_1.png` pixels at existing `AT` coordinates. A backup
of the pre-splice original is not kept in-repo (recoverable via git history).

**The punyworld sheet is a second runtime tileset now, not a reference.** The
splice above stopped short of the wall, gate and bridge art on the grounds that
`bakeRamparts`/`bakeTile` hardcoded pixel offsets against the original sprites'
geometry, so a cell swap alone would have broken them. A later pass took the
other route: `assets/punyworld-overworld-tileset.png` (27×65 cells, art only to
row 37) is **loaded at runtime** alongside the atlas, and `PUNY` in
`js/assets.js` addresses it the way `AT` addresses the atlas. Off it come all
five rampart pieces, both bridge decks, and four buildings — Town Hall, Lumber
Camp, Gold Mine, Well. That pack's castle-wall set was drawn to tile, so the
edge-repair machinery `bakeTile` existed for is gone entirely, replaced by
`bakePuny` (block size in tiles, quarter-turn, `stoneHue`, overlay). What it
cost instead is the faction tint: the pack's masonry is too desaturated for the
warm recolor band to see, so the stone gets its own `shiftHue` pass — see
`docs/formations-tiers-ui.md`. Every recolor path is per-faction and baked once
at load, exactly as before. Left behind, catalogued but no longer drawn:
`AT.WALL`/`AT.WALL_V`/`AT.WALL_TOWER`/`AT.GATE`, `AT.BRIDGE_H`/`AT.BRIDGE_V`,
`AT.TOWNHALL`, `AT.LUMBER`, `AT.MINE`, `AT.WELL`, plus the long-unused
`AT.SAPLING` and `AT.POND_DECOR` — there is a note listing them under the `AT`
table in `js/assets.js`.

**The cliff set was appended, not overwritten.** The plateau art needed 29
tiles and the sheet had exactly one free cell, so a pass grew the PNG from 14
rows to 18 and put the set in the new rows 14–17 (`AT.CLIFF_*`, `AT.RAMP_*`).
Appending rather than repacking means every pre-existing `AT` coordinate still
addresses the same pixels — rows 0–13 are byte-identical — so nothing else had
to move. Unlike the 2026-07 pass this one is reproducible:
`tools/splice-cliffs.py` copies the cells out of
`assets/punyworld-overworld-tileset.png` and is safe to re-run, since it
rebuilds rows 14+ from scratch each time. (That sheet is loaded at runtime in
its own right now — see above — but the cliff set is still a splice, because
`AT.CLIFF_*`/`AT.RAMP_*` need rotations the pack never drew.) The cliff art
is greyish-olive (hue 70–80°) plus desaturated greys, and `shiftHue` only
rotates hues in the warm band with saturation > 0.15, so **no cliff pixel is
touched by the per-faction recolor** — mesas stay neutral terrain for every
nation. All 29 are drawn: the eight outer rim pieces, the plateau top, the four
concave corners, and the ramp set's tread/top-step/two-jambs ×4, because the
pack only drew one staircase (a south-facing one) and `js/map.js` needs stairs
facing all four ways — so `AT.RAMP_TREAD`/`RAMP_TOP`/`RAMP_JAMB_NEG`/
`RAMP_JAMB_POS` are each a length-4 array indexed by `rot` (0 = the tileset's
native south-rim art, 1–3 its 90/180/270° clockwise turns), and the other three
orientations in the splice tool are that same source art rotated losslessly with
PIL's exact 90-degree transpose rather than a runtime canvas transform.

Three things in there are not straight copies, and each is a fix for a hole the
pixel scanner found (BUGS #31):

- **Two of the four concave corners are rotations.** The pack drew NW and NE
  notches only. SW and SE are those two turned 180°. Composing them instead from
  the plateau top plus the matching outer corner's quadrant was tried first and
  failed: an outer corner's quadrant carries its transparency but not the rock
  band bordering it, so the composite had flat turf meeting that transparency
  along the quadrant seam — the very defect being fixed, 6px in every such tile.
  Rotating authored art keeps the rock border intact by construction; it inverts
  the light on that corner, which at 16px on a noisy grey-green texture does not
  read.
- **The jambs have their turf stripped.** Each is drawn as an overlay on top of
  whatever rim piece its tile already has, so it must contribute only rock. The
  pack drew a strip of plateau turf down each jamb's inner edge, invisible in the
  native south orientation (that edge faces the plateau top, which is turf) but
  facing *open ground* once rotated to a north rim.
- **Jambs are overlays, not replacements.** Using one as a tile's whole art —
  which is what "the jamb replaces the rim piece" amounted to — punched a gap in
  the rim run either side of every stair, leaving it floating in bare grass,
  because the jamb is a narrow post sized to frame a stair against a rim that is
  already there.
