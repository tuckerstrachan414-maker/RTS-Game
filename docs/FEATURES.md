# Feature inventory — current state

An audit of every system in the game as it exists in the code today, with a
depth rating for each. Depth scale:

- **Deep** — multiple interacting mechanics, edge cases handled, AI participates
- **Moderate** — works well, one or two layers of mechanics, some gaps
- **Basic** — functional but simple; the obvious next candidate for expansion

Player-facing behavior is described in `README.md`; implementation notes for the
formations/tiers/gestures batch are in `docs/formations-tiers-ui.md`. Known bugs
are tracked in `docs/BUGS.md`.

## Map & terrain — Deep

`js/map.js`. Seeded procedural generation (mulberry32 + smoothed value noise)
of a 96×96 continent: water, grass, depleting forests (`treeWood` per tile),
rocks, and 14 sprinkled cave tiles. Four cleared start zones, each guaranteed
trees/rocks/a cave within reach. Water autotiling picks from a 9-slice + strip
set by neighbor inspection. A* pathfinding (4-directional, min-heap, capped
iterations, partial-path fallback) with road tiles costing 0.7 to steer traffic
onto trade roads; per-faction passability (gates open for owner + allies,
walls/keeps solid, other buildings walkable). **Forest and rock are rough
ground, not walls**: troops push through both, at `TREE_MOVE_COST` 2.4× / 
`ROCK_MOVE_COST` 1.9× the time (`map.moveCost`, which divides unit speed in
`followPath` and multiplies the A* step cost), so the pathfinder skirts a wood
when the detour is short and cuts through when it isn't. Only water without a
bridge, caves, walls and keeps still block outright. Consequences worth knowing:
a wall ring no longer seals at forest tiles (buildings still require grass, so
`canPlace` refuses walls there) — the gap is a slow chokepoint rather than a
barrier; and unit muster/formation slots deliberately prefer `moveCost === 1`
tiles so ranks don't form up inside a thicket. **Start zones are guaranteed
traversable** (`connectStartZones`/`linkStartZones`): the 7×7 clearing is
stamped wherever the quadrant centre lands, which could leave a nation on a
grass island in a lake or sealed behind planted forest, so the generator floods
each zone, cuts a track to real country when the region is too small, and links
every start zone into one landmass at the narrowest crossing it can find
(Dijkstra weighting grass cheap, forest and rock a little, water heavily, caves
never — this still runs on grass-only connectivity, so the guarantee is stricter
than movement now requires and seeds keep generating identical terrain).
`?seed=N` URL replay. Notably absent: tree regrowth (the `SAPLING` atlas
entry is unused), map sizes, biomes.

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
instead of duplicating it. Worker assignment is manual per building (+/−) with
idle-worker accounting; over-assignment after deaths is auto-unassigned.
`estimateIncome(f, res)` lives here too (moved from `js/ui.js`) and now respects
forest depletion, so an exhausted Lumber Camp reports zero — the signal the AI
uses to decide a shortage is structural.

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

`js/buildings.js`. 13 types: Town Hall, Storehouse, House, Farm (2×2 crop
field, +50% near water, +25% near a Well), Lumber Camp (consumes real tree
tiles; idles when forest exhausted), Quarry, Gold Mine (needs a cave), Market,
Church, Well, Castle, Wall/Gate (line-drag placement including 45° diagonals;
rendered as one connected structure in both axes — see the renderer entry),
Bridge (water-only, rotatable, drag to lay a span, seamless vertical mid-tile).
Placement validation with per-type requirements, construction time, HP/damage,
demolish with 75% refund (except Town Hall), and **capture**
(`captureBuilding`/`annexBuildings`): a conquered nation's completed civilian
buildings and bridges change hands with their stored goods intact, at 40% HP,
unstaffed and with queues cleared, while walls, gates and the fallen Town Hall
come down. AI nations now build walls/gates
(turtle doctrine rings) and bridges (war-route engineering) too. Gaps: no
building upgrades outside the Castle, no repair, bridges can't be removed once
placed (see BUGS).

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

`js/units.js`, `js/main.js`. Two paths: Bandits (fast, fragile, `robber`) are
sent onto an enemy storage building, siphon 30/s prioritizing gold → stone →
wood → food up to a 45 carry cap, then auto-haul home and bank the take.
Razing a storage building spills its entire stock as a ground loot pile; units
have per-type carry capacities (0 for King/Prince), pick loot up by standing on
it, idle carriers within 5 tiles are auto-drawn to it, laden porters show a
sack sprite and spill their cargo when killed, and piles decay after 120s (with
a blink warning). The AI trains bandits in wartime and targets the richest
enemy storehouse.

## Units & combat — Deep

`js/units.js`. 13 unit types across 3 castle tiers, with three damage types
(melee/pierce/magic), armor (Shieldman, ignored by magic), an anti-cavalry
bonus (Spearman ×2.2 vs horse units), projectiles (arrows, fireballs with
splash), the unique King (aura: +15% damage in 4 tiles; morale penalty on
death), and the Prince envoy. Real-time combat with cooldowns, auto-acquire
within 5 tiles, fight-back when hit, periodic repathing toward moving targets,
building attack/destruction. Training consumes a citizen (requires 2 free) and
runs through a per-castle queue with rally points.

## Formations & crowd separation — Deep

`js/units.js` (`formationMove`, `separateUnits`). Group orders arrange units in
rotated ranks facing travel direction — melee/tanky front, ranged/mages rear —
one unique destination tile per unit via spiral search. Every tick, a spatial
hash pushes overlapping units apart (0.45-tile radius, capped nudge,
golden-angle split for perfectly stacked pairs), with an escape hatch for units
stranded on impassable tiles. Full detail in `docs/formations-tiers-ui.md`.

## Castle tiers — Moderate

`js/buildings.js` (`CASTLE_UPGRADES`), `js/factions.js`. Two purchasable
upgrades: Garrison (tier 2: Shieldman/Halberdier/Crossbowman/Horseman) and
Royal Academy (tier 3: Mage/Archmage/Cavalier/King). Locked units render with
a lock icon and unlock hint. The AI buys upgrades under threat/doctrine/
population triggers (conquest and prosperity upgrade eagerly) and filters its
training pool by tier. Data-driven — a tier 4 needs only data entries. The
separate Grand Castle upgrade (`GRAND_CASTLE_COST` in `js/buildings.js`:
300g/200w/200s, 50 pop + 70% happiness gates) is the prosperity victory
condition — for the player and for prosperity-doctrine AI nations alike.

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
replays identically.

**Nothing is read from global state.** Each nation keeps a `ScoutMemoryMap`:
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
strength (capped at a third of the population). Marginal utility per resource is
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
trade pacts. Gaps: territory has no direct economic effect (no tile tribute),
walls don't project claims far.

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

## Victory & defeat — Moderate

`js/main.js`. Three win paths — Prosperity (Grand Castle), Conquest (all rival
Town Halls destroyed), Diplomatic (every survivor allied, after 60s) — and
defeat on losing your Town Hall **or when a rival completes its own Grand
Castle** (prosperity doctrine AIs pursue it; construction start is announced).
**A win can be played on**: the end screen offers *Keep playing* beside *Play
again*, which unfreezes the sim exactly where it stopped (`Game.resume`) and
sets `endless`. Each victory is banked in `Game.claimed` and fires only once, so
the condition you just met can't re-trigger next tick while the *other* win
paths stay live — conquer the map after a Prosperity win and Conquest Victory
still fires. In an endless game a rival's Grand Castle is logged as news instead
of ending the run (you already have your crown), but losing your own Town Hall
still ends it; defeat never offers *Keep playing*.
Elimination kills a faction's units and cancels its routes, but its buildings
are **annexed** by whoever felled the Town Hall (`conqueredBy` →
`annexBuildings`) rather than erased — so taking a rival's mining town is worth
more than burning it, and the map consolidates into real empires. Every survivor
rethinks its ambition; on paced difficulties the victor
rests (consolidation) before its next war, and the map can consolidate without
the player — you might face one giant empire late. No score screen or stats
beyond lifetime trade gold.

## Desktop UI/HUD — Deep

`js/ui.js`, `index.html`. Canvas renderer (pixelated, 4 zoom steps, wheel-zoom
to cursor, WASD/arrow pan with Shift boost, camera clamp), y-sorted units,
health/construction bars, selection rings/outlines, placement ghost with
validity tint, drag box-select. **Ramparts** (`bakeRamparts` in `js/assets.js`,
`drawRampart`/`drawTileSlice` in `js/ui.js`): walls and gates are assembled per
tile from five baked connector pieces rather than stamped as whole sprites, so
runs join seamlessly **horizontally and vertically** and gates sit inside a run
instead of interrupting it. Straight runs draw the connector whole; corners,
junctions, ends, lone posts and diagonals draw a half connector toward each
neighbour they actually have and a tower over the join. Gates pick a vertical
arch when the run through them is north–south. Each piece is the tileset's own
art with the minimum edit needed to make its tile edges match (grass margins
stripped, one band extended to the tile edge, one flattened column, and
`GATE`'s arch composited into that column to make the vertical gate the
tileset lacked). **Forest canopy pass** (`drawForest` /
`drawTreeClump`): tree tiles are no longer drawn inside the terrain loop — the
same three `AT.TREES` sprites are redrawn afterwards at `TREE_CANOPY` 2 tiles
across, 2–4 to a tile, jittered and y-sorted so canopies overlap their
neighbours and a patch of `T_TREE` closes into a wood instead of a grid of
lollipops. Clump density follows `countAdjacent(T_TREE)` (dense interior, sparse
fringe) and drops at zoom 1; placement comes from `tileNoise(x, y)`, a pure
function of the tile, so the forest never shimmers as the camera moves. The art
itself is untouched. Also: minimap (terrain + roads + buildings + units +
territory ownership tint + viewport rectangle, click/tap to jump), dashed
territory border lines on the main map, event cards (`#eventcard`, see Event
cards above). Topbar with live stats, tax slider,
and per-stat live tooltips (income vs consumption breakdowns; happiness
itemized). Building panel: workers, storage contents, castle training/upgrades/
rally/Grand Castle, market buy/sell/barter, demolish. Diplomacy panel with
relation bars and full action set. Event log with fade. Pause menu (freezes
sim): Resume, Diplomacy, Select Army, Speed 1x/2x/3x, Hide UI, New Game.
Every HUD block is independently collapsible; global Hide UI (H) for
watching battles. Fixed-timestep sim (0.1s) decoupled from rendering.

## Touch & mobile — Deep

`js/ui.js`, `index.html`. Full parallel input scheme: one-finger drag pans,
pinch zooms about the gesture midpoint, tap selects, hold-then-drag
box-selects, double-tap or two-finger tap issues the command (move/attack/
rob/rally) with deferred-select logic so double-taps don't drop the selection.
Safe-area insets, coarse-pointer sizing, portrait rotate prompt with a
persisted "play anyway" choice, orientation/visualViewport resize handling.

## Rendering & assets — Moderate

`js/assets.js`. Tile atlas mapping, per-faction palette swap at load (hue-band
recolor: blue clothing for units, orange roofs for buildings), automatic
animation table detection by scanning sheet rows for non-empty frames
(idle/walk/attack/hurt/death), projectile sheet, pixel-art icon CSS sprites
replacing emoji throughout the HUD. Gaps: bandits reuse the horseman sprite
(distinguished only by behavior), farms/walls are procedurally drawn rather
than sprite art.
