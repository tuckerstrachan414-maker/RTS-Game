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
walls/keeps solid, other buildings walkable). `?seed=N` URL replay. Notably
absent: tree regrowth (the `SAPLING` atlas entry is unused), map sizes, biomes.

## Economy & population — Deep

`js/economy.js`. Citizens eat continuously; population grows once per dawn
(see Day/night cycle below) by 30% of the housing cap (rounded, capped at the
cap), gated on surplus food (> 2× pop), free housing, and happiness > 50;
starvation kills a citizen every 12s (floor of 2) and weakens the army (−30%
damage). Happiness is a drift toward a computed target: base 50, fed/starving,
housed/overcrowded, building auras (church/well/market, diminishing with pop),
war weariness (0–25), taxes (slider, 0–40%), −12 while the nation's King is
dead. Tax slider converts happiness into gold income. Worker assignment is
manual per building (+/−) with idle-worker accounting; over-assignment after
deaths is auto-unassigned.

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
shows `Day N` with a sun/moon glyph. Notably absent: no gameplay effects tied
to night beyond the population trigger (no vision/stealth changes, no AI
behavior changes), no seasons.

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
Church, Well, Castle, Wall/Gate (line-drag placement including 45° diagonals,
tileset-baked sprite rendering — straight runs vs. corner/junction/end towers),
Bridge (water-only, rotatable, drag to lay a span, seamless vertical mid-tile).
Placement validation with per-type requirements, construction time, HP/damage,
demolish with 75% refund (except Town Hall). Gaps: no building upgrades
outside the Castle, no repair, bridges can't be removed once placed (see BUGS).

## Market & commodity trading — Deep

`js/market.js`. A global supply/demand exchange for food/wood/stone with gold
as currency: price = base × (equilibrium ÷ stock), clamped 0.35×–3.5×, 10%
buy/sell spread. Player selling floods the stock (price falls); buying drains
it (price rises); stock mean-reverts 2%/s; nations running short of a good pull
stock down so shortages spike prices. Direct barter at market-implied rates.
Embargoes impose up to a 60% access penalty on the target's trade terms
(20% per embargoing nation). AI factions with a Market actively sell gluts and
buy shortfalls, so prices genuinely move. Exploit note: the stock floor of 5
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
a lock icon and unlock hint. The AI buys upgrades under threat/aggression/
population triggers and filters its training pool by tier. Data-driven — a
tier 4 needs only data entries. The separate Grand Castle upgrade (300g/200w/
200s, 50 pop + 70% happiness gates) is the prosperity victory condition.

## Diplomacy — Deep

`js/diplomacy.js`. Symmetric relations (−100…+100) and a status matrix
(war/neutral/trade/alliance) per pair. Gifts buy relations. Trade pacts and
alliances require a Prince envoy who physically rides to the target's Town
Hall (acceptance depends on relations + personality; rejection costs −3).
Pacts spawn caravan pairs on a real pathfound route, stamped as road tiles
(speed bonus), paying both sides 8 gold per arrival; caravans are killable and
routes die with their markets. War declaration drags in the defender's allies;
peace costs 100 gold reparations and can be refused by a winning AI. Embargoes
cascade to the embargoer's allies and worsen the target's market terms.
Ambient drift: trade/alliance warm relations, warlike AIs covet weaker
neighbors and declare war when strong enough, mercantile AIs open trade routes
on their own. Gaps: AI never sues for peace, never embargoes, and never sends
envoys (its pacts happen instantly — including with the player, see BUGS).

## AI opponents — Moderate

`js/factions.js` (`aiTick`, ~2s cadence). Three personalities (warlike Crimson
0.8 aggression, mercantile Violeta 0.9 mercantile, cautious Aurelia). Keeps
workers assigned, follows a priority build order (food → wood → storage →
market/housing → military → comforts), trades on the market, maintains an army
scaled to threat + aggression + population, buys castle upgrades, sends bandit
raids, launches 70%-of-army attack waves at the weakest enemy's Town Hall, and
rallies home in peacetime. Gaps: never builds walls/gates/bridges, no
defensive reaction beyond unit auto-acquire, single attack-wave pattern, no
peace-seeking.

## Victory & defeat — Moderate

`js/main.js`. Three win paths — Prosperity (Grand Castle), Conquest (all rival
Town Halls destroyed), Diplomatic (every survivor allied, after 60s) — and
defeat on losing your Town Hall. Elimination removes a faction's units and
buildings and cancels its routes. No score screen or stats beyond lifetime
trade gold.

## Desktop UI/HUD — Deep

`js/ui.js`, `index.html`. Canvas renderer (pixelated, 4 zoom steps, wheel-zoom
to cursor, WASD/arrow pan with Shift boost, camera clamp), y-sorted units,
health/construction bars, selection rings/outlines, placement ghost with
validity tint, drag box-select, minimap (terrain + roads + buildings + units +
viewport rectangle, click/tap to jump). Topbar with live stats, tax slider,
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
