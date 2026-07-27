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
rocks, plateaus, and 14 sprinkled cave tiles. Four cleared start zones, each
guaranteed trees/rocks/a cave within reach. Water autotiling picks from a
9-slice + strip set by neighbor inspection. A* pathfinding (4-directional, min-heap, capped
iterations, partial-path fallback) with road tiles costing 0.7 to steer traffic
onto trade roads; per-faction passability (gates open for owner + allies,
walls/keeps solid, other buildings walkable). **Forest and rock are rough
ground, not walls**: troops push through both, at `TREE_MOVE_COST` 2.4× / 
`ROCK_MOVE_COST` 1.9× the time (`map.moveCost`, which divides unit speed in
`followPath` and multiplies the A* step cost), so the pathfinder skirts a wood
when the detour is short and cuts through when it isn't. Only water without a
bridge, caves, walls and keeps still block outright. **Buildings can be placed
on forest and rock too** (`canPlace`, `js/buildings.js`) — the footprint clears
whatever it lands on (terrain → grass, `treeWood` zeroed), the same way
`carveLine` clears a track — so a wall ring can seal all the way around a
wooded perimeter instead of stopping at the treeline; unit muster/formation
slots still deliberately prefer `moveCost === 1` tiles so ranks don't form up
inside a thicket. **Plateaus are the one piece of terrain that is a wall.** A
second noise field (`generatePlateaus`, `PLATEAU_LEVEL` 0.63) raises masses of
high ground, majority-smoothed three passes so they settle into shapes with an
outline rather than fraying into single-tile spurs. Each mass is split into a
rim of `T_CLIFF` — impassable, unbridgeable, uncuttable, the only terrain with
no way through it at all — and a top of ordinary ground flagged in `map.high`,
which builds, harvests and fights exactly like low ground. The way up is
`T_RAMP`, one to three stairs per mass, cut into *any* of its four rims
(`RAMP_DIRS` in `js/map.js`: each entry is a climb direction `d` and a
perpendicular `p` for the jambs, plus how many 90°-clockwise turns the
tileset's one staircase sprite needs to face that way — the pack only drew a
south-facing stair, so the other three orientations are that same art rotated
losslessly by `tools/splice-cliffs.py`, not a runtime transform). A candidate
tile needs open ground on the outside, plateau top on the inside, and rim
either side for the jambs, in whichever of the 4 directions satisfies that;
`map.rampDir` records which one so the renderer (`cliffTile`, `rampTopHere`)
and generation (`pickRamps`) agree on which rotated art and which neighbour
tiles apply. Crossed at `RAMP_MOVE_COST` 1.7×. That makes every mesa a
chokepoint approachable from more than one side: ~360 cliff tiles, ~19 ramps
split roughly evenly across the 4 directions, and ~760 tiles of high ground
per map. Rim membership is decided by 4-connectivity, not 8 — a tile whose four
sides are all plateau is inside it however its corners fall — which matches the
orthogonal pathfinder. That rule governs *movement*; it does **not** mean the
eight outer rim pieces are enough to draw with, which was assumed once and was
wrong. A 4-connected interior tile can still touch open ground at a corner, and
every rim piece is transparent on its outward side by design, so wherever a
plateau's edge ran diagonally the tile inside the step painted flat turf against
grass with nothing between: a staircase of disconnected rim fragments (BUGS #31).
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
the mask. **Start zones are guaranteed
traversable** (`connectStartZones`/`linkStartZones`): the 7×7 clearing is
stamped wherever the quadrant centre lands, which could leave a nation on a
grass island in a lake or sealed behind planted forest, so the generator floods
each zone, cuts a track to real country when the region is too small, and links
every start zone into one landmass at the narrowest crossing it can find
(Dijkstra weighting grass cheap, forest and rock a little, water heavily, and
refusing caves and cliffs outright — a breach would leave plateau top beside open
ground with no rock between, which no rim piece can paint, so the link pass tries
once going *round* every mesa and only re-runs with `allowCliff` if there is
genuinely no route at all; `lineCost` refuses cliffs unconditionally). That
connectivity runs on
clear ground plus ramps (`openAt`), so it is stricter than movement requires:
forest and rock are walkable but do not count toward it — which includes a
plateau-top tile that still has its original tree or boulder, so a forced
corridor is allowed to simplify one to grass exactly like it would off the
plateau. It must never touch `map.high` while doing that, though: clearing a
top tile *and* clobbering its `high` flag together would quietly shrink the
plateau by one tile rather than just tidy its ground (BUGS #30) — `high` is
plateau membership, decided once by `generatePlateaus` and never revisited.
Adding plateaus changed what a given seed generates — the same seed still
replays identically, it just replays a different map than it did before the
mesas existed. `?seed=N` URL replay. Notably absent: tree regrowth (the
`SAPLING` atlas entry is unused), map
sizes, biomes.

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
demolish with 75% refund (except Town Hall). **Any non-water building can be
placed on forest or rock** — the footprint clears it, same as cutting a track
(caves are still off-limits); the placement ghost fills the tile white when
legal and red when blocked, and a tree inside the footprint fades so the wash
doesn't have to fight a solid canopy (`drawGhost`/`collectDepthLayers`,
`js/ui.js`). **Every building reads as what it does.** Five types whose atlas
cell said the wrong thing are composited at load time instead
(`bakeBuildings`, `js/assets.js`): the Storehouse no longer shares the Lumber
Camp's log cabin, the Quarry is a worked rock face rather than a cottage, the
Well is a wellhead rather than a green mound near-identical to the CAVE terrain
tile, the Church has a belfry and cross in place of two pink mushroom caps, and
the Castle takes its nation's colour instead of staying violet for everyone.
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
(turtle doctrine rings) and bridges (war-route engineering) too. Gaps: no
building upgrades outside the Castle, no repair, bridges can't be removed once
placed (see BUGS), and pasted layouts don't rotate/mirror.

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
arch when the run through them is north–south. Each piece is the tileset's own
art with the minimum edit needed to make its tile edges match (grass margins
stripped, one band extended to the tile edge, the vertical run and the tower
sharing one body row so they cannot disagree on width, the tower's crown closed
so a wall above it leaves no seam, and `GATE`'s arch composited into the column
to make the vertical gate the tileset lacked). The owner marker goes on towers,
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
**Unit overlays** (`drawUnit`): the faction flash, health bar, caravan/envoy
badge and plunder sack stack upward from the top of the *figure*, measured per
sheet by `describeSheet`, not from the top of its 32px frame — a foot soldier's
art starts 15 rows down it, so frame-anchored markers floated the better part of
a tile above his head. The selection ring sits on the sprite's foot line for the
same reason. Also: minimap (terrain + roads + buildings + units +
territory ownership tint + viewport rectangle, click/tap to jump), dashed
territory border lines on the main map, event cards (`#eventcard`, see Event
cards above). Topbar with live stats, tax slider,
and per-stat live tooltips (income vs consumption breakdowns; happiness
itemized). Building panel: workers, storage contents, castle training/upgrades/
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
rob/rally) with deferred-select logic so double-taps don't drop the selection.
Safe-area insets, coarse-pointer sizing, portrait rotate prompt with a
persisted "play anyway" choice, orientation/visualViewport resize handling.
Panel placement is driven by shared `--hud-*` custom properties rather than
per-panel arithmetic, so every floating block clears the resource bar and the
build bar by the same margin and each owns one screen slot (see "HUD layout &
stacking" in `docs/formations-tiers-ui.md`). On a landscape phone the build bar
fits its full row of 13 buttons, the diplomacy panel becomes a centred sheet
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

The two hue knobs used to be one. `hue: null` meant "leave the art alone",
which is right for the player's units (the Minifolks art is already blue) but
left Azuria fielding blue troops out of *orange* buildings while every rival's
buildings matched their banner. `roofHue` is now set for all four nations, and
the warm band wraps through red (345°–42°) instead of starting at 8° so the
Lumber Camp's timber — which straddles that seam and so half-recoloured —
takes the nation's colour cleanly along with everything else.

**Composited building art (`bakeBuildings`, `bakeFarmland`, `bakeArt`).** Same
approach as `bakeRamparts`: no new image assets, just the atlas plus a few
pixel ops per tile, baked once per faction at load. Covers the Storehouse
(barn doors and sacks on the house silhouette — it shared the Lumber Camp's
cell), the Quarry (a rock face and dressed blocks — the cell was a cottage),
the Well (a wellhead — the cell was a green mound all but identical to the CAVE
terrain tile), the Church (mushroom caps `strip`ped off, belfry/spire/cross and
a gabled nave drawn on), the Castle (`shiftHue` moves its violet stonework onto
the faction colour) and the two farmland tiles. `drawBuilding` prefers a baked
canvas over the atlas lookup, so `BUILDING_TYPES.art` is `null` for those types.
Note the church is baked from the *untouched* atlas and tinted afterwards:
`strip` matches exact hexes, and on the recoloured faction sheet the caps'
pinks have already moved. Gaps: bandits and trade caravans both ride the
horseman sheet, which is no longer any unit type's own art — it survives in
`UNIT_SHEETS` purely as the Bandit's `spriteKey` (and the caravan's, since
caravans spawn as Bandits with `carryCap` zeroed); the day/night indicator in the topbar is
still an emoji glyph (no sun/moon in `icons16x16.png`) — the last one, now that
the Copy/Paste buttons have dropped their clipboard; multi-tile buildings
scale one 16×16 cell up to their footprint, so a 2×2 Castle has visibly
chunkier pixels than a 1×1 House.

**Tileset is a spliced composite, not a single source.** `assets/tileset16x16_1.png`
is one 8×**17**-cell, 16px-grid PNG at the same coordinates `AT` has always
pointed at — but a 2026-07 pass overwrote specific cells in place with art from
the **PUNY_WORLD_v1** pack (a separate 27-column Tiled tileset supplied as a
reference sheet, never loaded at runtime itself): `AT.TREES` (all 3), `AT.SAPLING`,
`AT.ROCKS` (all 5, currently a single boulder tile repeated — the pack had only
one clean standalone rock icon), `AT.CAVE` (now a wood-framed mine-shaft
opening), `AT.WELL`, and both pair-slots of `AT.TOWNHALL`/`AT.HOUSE`/`AT.MARKET`
(a log-cabin set; player and AI pre-recolor art are now identical tiles — same
as every non-pair building already worked, see below). Because every replaced
building tile's dominant hue sampled into the existing warm recolor band
(`recolor(tileset, hue, 'warm')`, [8°,42°]), per-faction roof recoloring still
works unmodified. Deliberately **left untouched**: water (the full 9-slice +
strip autotile set), Wall/Gate/rampart art (`bakeRamparts` hardcodes pixel
offsets against the original wall sprite's geometry — swapping it needs a
rework, not a splice), Bridge (`bakeTile`'s seamless mid-tile replication is
similarly geometry-specific), Castle, Church, Quarry, Mine, Lumber Camp/
Storehouse, and base grass tiles (swapping the grass hue risks a visible seam
against water art's baked-in shoreline-over-grass blend). `AT.CROP_VARS` is
gone (farms have their own baked field tiles now) and so is `AT.QUARRY`;
`AT.WELL` and `AT.WALL_V` are still catalogued but no longer drawn, along with
the long-unused `AT.SAPLING` and `AT.POND_DECOR` — there is a note listing all
four under the `AT` table in `js/assets.js`. That pass changed no code — it was
purely `assets/tileset16x16_1.png` pixels at existing `AT` coordinates. A backup
of the pre-splice original is not kept in-repo (recoverable via git history).

**The cliff set was appended, not overwritten.** The plateau art needed 29
tiles and the sheet had exactly one free cell, so a pass grew the PNG from 14
rows to 18 and put the set in the new rows 14–17 (`AT.CLIFF_*`, `AT.RAMP_*`).
Appending rather than repacking means every pre-existing `AT` coordinate still
addresses the same pixels — rows 0–13 are byte-identical — so nothing else had
to move. Unlike the 2026-07 pass this one is reproducible:
`tools/splice-cliffs.py` copies the cells out of
`assets/punyworld-overworld-tileset.png` (still never loaded at runtime) and is
safe to re-run, since it rebuilds rows 14+ from scratch each time. The cliff art
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
