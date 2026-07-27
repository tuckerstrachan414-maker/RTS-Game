# Nations — an RTS of trade and war

A browser real-time strategy game built entirely with vanilla JavaScript and the
asset packs in this repo: the 16×16 top-down tileset (`assets/tileset16x16_1.png`)
and the **Minifolks: Humans** unit pack (`assets/units/`).

You lead the blue nation of **Azuria** on a procedurally generated continent shared
with three AI nations — **Crimson**, **Violeta** and **Aurelia**. Who they *are*
is rolled fresh every match: the warlord on your border in one game is a
walled-up trader in the next. Each pursues its own **evolving ambition** — one
may drill a conquering army, another chase riches and its own Grand Castle,
another wall itself in or weave alliances — and those ambitions shift as the
world changes.
You never *have* to fight: trade, gifts and alliances are a complete path to
victory. But the world won't wait for you.

## Run it

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static file server works (assets are loaded with `fetch`-less `<img>`, but
canvas pixel access requires HTTP, not `file://`). Add `?seed=123` to the URL to
replay a specific map; the chosen difficulty is added as `&difficulty=` so a
copied URL reproduces the whole setup.

**Before the game starts you choose how hard the rivals come at you:**

- **Measured March** — wars are telegraphed: relations sour, armies visibly
  mass at your border, and an ultimatum arrives before blades are drawn. You
  get a 5-minute grace period, and the world gangs up on runaway powers.
- **Quiet Frontier** — the AI nations wage real wars on *each other*, but only
  march on you if provoked (declaring war, embargoes, robbing them, killing
  their people, defying their border claims).
- **Iron Age** — nations attack the moment they sense an advantage, you
  included, from the very start. No warnings, no mercy, bigger armies.

## How to play

**Feed, house, and please your people.** Citizens eat food constantly. Every
dawn, if there is surplus food, free housing, and happiness above 50%,
population grows by 30% of your housing cap — so more Houses means faster
growth. Starving citizens die, and starving armies fight poorly.

**Day and night.** A full day/night cycle takes 5 minutes — 2.5 minutes of
daylight, 2.5 of night — with the light gradually shifting between them
rather than snapping. The top bar shows the day count and whether it's day
☀ or night 🌙; at night, your Houses' windows glow.

**Every resource comes from a real tile:**

| Resource | Comes from | Via |
|---|---|---|
| 🍞 Food | crop fields (bonus next to water/wells) | Farm workers |
| 🪵 Wood | tree tiles (they deplete!) | Lumber Camp workers |
| 🪨 Stone | rock tiles | Quarry workers |
| 🪙 Gold | cave tiles, taxes, trade, plunder | Gold Mine, Market |

Click a finished building and use **+/−** to assign idle citizens to its worker
slots. Every building has a purpose: Houses add housing, Churches/Wells/Markets add
happiness, the Castle trains units, Walls/Gates/Bridges shape the battlefield, and
the Town Hall is your nation's heart — lose it and you lose the game. Outgrew a
building? **Demolish** it from its panel and reclaim 75% of its cost.

**Box-select works on buildings too.** Drag a selection box like you would over
an army; if it catches no units, it grabs every building inside instead (troops
in the box always win — buildings are only picked up when the box has no
units in it). With one or more of your own buildings selected, use **Copy**
to copy the type(s) and layout, then pan the camera and click **Paste** to
stamp a copy at the center of the screen (Ctrl+C / Delete also work from the
keyboard). **Delete All** tears every selected building down for the same 75%
refund as Demolish.

**Walls and gates build into one structure.** Click-and-hold, then drag to lay
a line (walls also snap to 45° diagonals) — the whole run shows as a
translucent preview while you drag, so you can see exactly what will be built
before you commit. Release to place it all at once; nothing is built or paid
for until you let go. The segments knit together — east–west and north–south
alike — with towers rising at corners, junctions and ends. Drop a Gate
anywhere in a run and it takes the run's direction, an archway set into the
wall rather than a gap in it.

**The ground fights you too.** Forests and boulder fields are not walls —
troops push through both — but the going is slow: roughly 2.4× as long to
cross a forest tile and 1.9× a rocky one. Roads still speed you up. Only deep
water without a bridge, cave mouths, walls and keeps stop a unit outright.

**You can build on forest and rock.** Place a Wall, House, or anything else
(except a Bridge, which needs water) right on top of trees or boulders and
the footprint clears them to make room — so a wall ring closes all the way
around a wooded camp instead of stopping at the treeline. While placing, the
ghost washes the tile **white** when the spot is legal and **red** when it
isn't, and any tree under the footprint fades so you can see the tile beneath
it.

**Taxes** are a slider in the top bar (0–40%): more gold per citizen, at a
happiness cost that scales with the rate.

**Tap any resource in the top bar** to open a live tooltip explaining what it is,
which tiles and buildings it comes from, and your income vs. consumption per second.
The happiness tooltip breaks down exactly what's pleasing (or angering) your people.

**Resources are stored physically.** Goods pile up in your **Town Hall** and
**Storehouses**, not in an abstract bank — so storage is finite (build Storehouses
to hold more) and, crucially, **lootable**. Select any storehouse to see exactly
what's inside it.

## Trade & the market

Select your **Market** to open the commodity exchange:
- **Buy / Sell** food, wood, and stone for gold at live prices. Prices move with
  **supply and demand** — flood the market selling and the price drops; buy heavily
  and it climbs. When nations run short of a good, its price **spikes** — sell your
  surplus to desperate neighbors for a fortune.
- **Barter** goods directly (e.g. 🪵→🪨) at market-implied rates, no gold needed.
- Trade pacts still spawn caravans that pay both partners; alliances still hold.

**Embargo (🚫, Diplomacy panel):** cut a rival off from trade without going to war.
Your allies join the blockade, and the target's market terms worsen the more nations
shun them — a way to strangle an economy by diplomacy alone.

## Raiding & plunder

At war, you don't just burn buildings — you rob them.
- **Bandits** (train at the Castle) are fast, fragile raiders. Send one onto an enemy
  **Storehouse** and it siphons the goods inside, then flees home to bank them. Robbery
  doesn't destroy the building — it just empties it.
- **Full raid:** send your army to raze a storehouse. When it falls, its entire stock
  **spills onto the ground as loot**. Your troops must physically **carry the plunder
  home** to a storehouse to keep it — cut down a laden porter and the loot spills again
  for anyone to grab. Idle troops near spilled loot will move to collect it.

## Your army

**Castle upgrades unlock troops.** A fresh Castle trains Swordsmen, Spearmen,
Archers, Bandits and the Prince. Buy the **Garrison** upgrade to unlock the
Shieldman, Halberdier, Crossbowman and Horseman, then the **Royal Academy** for
the Mage, Archmage, Cavalier and King. Locked troops show a 🔒 with what unlocks
them — and AI nations climb the same tiers.

**Armies march in formation.** Group move orders arrange your troops into ranks
facing the direction of travel — melee up front, ranged and mages behind — and
units physically push apart so they never stand inside each other.

**Diplomacy (Menu → Diplomacy):** relations run −100…+100 per nation.
- 🎁 **Gifts** buy goodwill.
- 🐎 **Trade pacts** need a Market on both sides and a **Prince** envoy (trained at
  the Castle) who physically rides to their Town Hall with the offer. Accepted pacts
  spawn caravans that pay both nations gold every trip — and draw a real road.
- 🤝 **Alliances** need strong relations. Allies join wars in each other's defense.
- ⚔️ **War** is always an option — and warlike neighbors may covet you if you're
  weak. Trade with them or gift them to stay off their list; peace is always drift,
  never luck.

**The rivals come to you.** AI nations send their own envoys, gifts, embargoes
and armies — at you and at each other. Their approaches arrive as **event
cards** (top right): a proposal to accept or rebuff, a border dispute to
concede, settle for gold, or defy, an ultimatum to pay or refuse, a peace offer,
a plea to join a coalition. Cards expire on a timer, and **silence is an
answer** — ignored envoys take offense.

**They have to find you first.** Rival nations don't read the map — they only
know what they have actually seen. They send out **riders to scout**, and what
they learn goes stale: a nation that has lost track of you assumes the worst and
goes looking rather than gambling. Kill their scouts and they are guessing.
Nobody declares war in the opening minutes, and nobody attacks on a whim — a
rival needs a real army, a reason, a route, and an advantage that *holds*, so
armies massing on your border are a genuine warning rather than a formality.

**They will go looking for land.** When a nation works out its forests or runs
short of stone, it sends settlers to found a new town on ground that has what it
needs — and competing claims are what border disputes are made of.

**Taxes rise at night.** Population only grows at dawn, and only above 50%
happiness, so rival nations squeeze their people through the night and ease off
before dawn. Drag one into a long war and the war weariness costs them their
next generation.

**Borders are real.** Your buildings project territory: dashed frontier lines
on the map (and a color tint on the minimap) show who claims what. Building
deep into a rival's claim — or letting their settlers creep into yours —
sparks disputes that can be talked out or fought over. Watch for rumors in the
event log ("soldiers drilling…", "masons quarrying…") and for armies massing
at your border: ambitions are never announced outright, but they always show.

**Winning:**
- 👑 **Prosperity** — 50 population, 70% happiness, then build the Grand Castle
  upgrade (300🪙 200🪵 200🪨) at your Castle. The peaceful win.
- 🤝 **Diplomatic** — every surviving nation allied with you.
- ⚔️ **Conquest** — every rival Town Hall destroyed.

**You don't have to stop.** The victory screen offers **Keep playing** next to
Play again. Take it and the game picks up exactly where it paused, with the win
already banked — it won't pop up again, but the *other* win conditions still
can, so you can take the Grand Castle and then go conquer the continent as well.
Playing on, a rival finishing its own Grand Castle is just news in the log
rather than a defeat; losing your Town Hall still ends the run.

**Conquest means annexation.** Destroy a nation's Town Hall and its surviving
farms, mines, markets and storehouses — goods and all — become **yours**, at
reduced health and unstaffed until you assign workers. Walls and the ruined Town
Hall come down. This cuts both ways: a rival that overruns you inherits your
whole economy, and the continent consolidates into real empires.

**Losing:** your Town Hall falls — or a **rival finishes its own Grand
Castle**. Prosperous AI nations race for it too (you'll be warned when
construction starts), and conquerors can swallow the whole map if nobody
stops them. AI nations fight, bridge rivers to reach each other, and eliminate
one another — the continent you face in the late game may not be the one you
started on.

**The Menu button** (top right) opens the pause menu — the simulation freezes
while it's up. From there: Diplomacy, Select Army (grabs your whole standing
army), game **Speed** (1x/2x/3x), Hide UI, and New Game.

**Controls (desktop):** WASD/arrows pan (Shift = faster) · wheel zooms ·
left-click/drag selects an army, or buildings if the box has no units in it ·
right-click moves/attacks — or, with bandits selected, sends them to rob an
enemy storehouse; sets rally with a Castle selected · click-and-hold then drag
to lay a wall/gate/bridge run, shown as a preview until you release · Shift+click
places multiple buildings · R rotates a bridge while placing · Ctrl+C copies
selected building(s) (then click Paste, or press it again, to stamp another) ·
Delete/Backspace removes selected building(s) for a 75% refund · Esc cancels
placement or a pending paste / clears selection / closes menus.

**Controls (touch / mobile):** plays in landscape or portrait (tap "Play in portrait
anyway" to dismiss the rotate hint). One-finger drag pans · pinch zooms · tap selects
or places · hold-and-drag box-selects an army, or buildings if none are caught ·
holding while placing a wall/gate/bridge previews the run until you lift your
finger · **double-tap** (or two-finger tap) moves/attacks/robs or sets a rally.
With buildings selected, use the panel's **Copy**/**Paste** and **Demolish**/
**Delete All** buttons.

**Hide UI** (Menu → Hide UI, or press H) clears every panel off the screen to
watch the battle; tap the 👁 eye to bring the interface back. Each HUD panel
(top bar, minimap, build menu) also has its own **▾ collapse tab** if you just
want one out of the way.

## Code layout

Plain `<script>` modules, no build step:

- `js/assets.js` — atlas coordinates, animation auto-detection, faction palette-swap
  (the blue Minifolks art and orange roofs are hue-shifted per nation at load)
- `js/map.js` — seeded map generation, water autotiling, A* pathfinding
- `js/buildings.js` — building defs/placement, incl. physical storage buildings
- `js/economy.js` — the nation sim; `res` is a Proxy over per-building stockpiles
- `js/market.js` — supply/demand commodity pricing, buy/sell, barter
- `js/units.js` — unit stats, movement, combat, projectiles, robbing & hauling loot
- `js/factions.js` — faction state, rolled personalities, the AI tick dispatcher
- `js/diplomacy.js` — relations, pacts, envoys, caravan trade routes, embargoes
- `js/ai.js` — ambitions, proactive diplomacy, war waves, expansion, bridge and
  wall engineering
- `js/ai-perception.js` — what each AI nation actually knows (scouting, memory)
- `js/ai-utility.js` — the utility engine: archetypes, marginal utility, taxes
- `js/ai-trade.js` — AI market orders, trade pacts, the war-versus-trade call
- `js/ai-combat.js` — AI scouting, army sizing, defence, war declarations
- `js/events.js` — the event-card queue (AI-initiated choices for the player)
- `js/territory.js` — per-tile influence/ownership, borders, border disputes
- `js/ui.js`, `js/main.js` — rendering, input, HUD, loot piles, difficulty
  select, game loop

## More documentation

- `docs/FEATURES.md` — every system in the game with a depth rating
- `docs/BUGS.md` — known bugs (with file:line refs) and design quirks
- `docs/formations-tiers-ui.md` — implementation notes for formations, castle
  tiers, touch gestures, tooltips, and hide-UI
- `CLAUDE.md` — contributor guide; includes the rule that **docs must be
  updated after every code change**

## Credits

- **Minifolks: Humans** unit sprites by LYASeeK
- 16×16 overworld tileset as provided in this repository, with trees, rocks,
  the cave/mine-shaft tile, the Well, and the Town Hall/House/Market buildings
  replaced with art from the **PUNY_WORLD_v1** tileset pack (same 16×16 grid,
  spliced tile-for-tile into `assets/tileset16x16_1.png` — see
  `docs/FEATURES.md` → Rendering & assets)
