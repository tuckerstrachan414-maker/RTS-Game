# Nations — an RTS of trade and war

A browser real-time strategy game built entirely with vanilla JavaScript and the
asset packs in this repo: the 16×16 top-down tileset (`assets/tileset16x16_1.png`)
and the **Minifolks: Humans** unit pack (`assets/units/`).

You lead the blue nation of **Azuria** on a procedurally generated continent shared
with three AI nations — warlike **Crimson**, mercantile **Violeta**, and cautious
**Aurelia**. You never *have* to fight: trade, gifts and alliances are a complete
path to victory.

## Run it

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static file server works (assets are loaded with `fetch`-less `<img>`, but
canvas pixel access requires HTTP, not `file://`). Add `?seed=123` to the URL to
replay a specific map.

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

**Winning:**
- 👑 **Prosperity** — 50 population, 70% happiness, then build the Grand Castle
  upgrade (300🪙 200🪵 200🪨) at your Castle. The peaceful win.
- 🤝 **Diplomatic** — every surviving nation allied with you.
- ⚔️ **Conquest** — every rival Town Hall destroyed.

**The Menu button** (top right) opens the pause menu — the simulation freezes
while it's up. From there: Diplomacy, Select Army (grabs your whole standing
army), game **Speed** (1x/2x/3x), Hide UI, and New Game.

**Controls (desktop):** WASD/arrows pan (Shift = faster) · wheel zooms ·
left-click/drag selects · right-click moves/attacks — or, with bandits selected,
sends them to rob an enemy storehouse; sets rally with a Castle selected ·
Shift+click places multiple buildings · R rotates a bridge while placing ·
Esc cancels placement / clears selection / closes menus.

**Controls (touch / mobile):** plays in landscape or portrait (tap "Play in portrait
anyway" to dismiss the rotate hint). One-finger drag pans · pinch zooms · tap selects
or places · hold-and-drag box-selects an army · **double-tap** (or two-finger tap)
moves/attacks/robs or sets a rally.

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
- `js/factions.js` — faction state and the AI (economy, trading, military, raiding)
- `js/diplomacy.js` — relations, pacts, envoys, caravan trade routes, embargoes
- `js/ui.js`, `js/main.js` — rendering, input, HUD, loot piles, game loop

## More documentation

- `docs/FEATURES.md` — every system in the game with a depth rating
- `docs/BUGS.md` — known bugs (with file:line refs) and design quirks
- `docs/formations-tiers-ui.md` — implementation notes for formations, castle
  tiers, touch gestures, tooltips, and hide-UI
- `CLAUDE.md` — contributor guide; includes the rule that **docs must be
  updated after every code change**

## Credits

- **Minifolks: Humans** unit sprites by LYASeeK
- 16×16 overworld tileset as provided in this repository
