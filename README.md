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

**Feed, house, and please your people.** Citizens eat food constantly. Population
grows only when there is surplus food, free housing, and happiness above 50%.
Starving citizens die, and starving armies fight poorly.

**Every resource comes from a real tile:**

| Resource | Comes from | Via |
|---|---|---|
| 🍞 Food | crop fields (bonus next to water/wells) | Farm workers |
| 🪵 Wood | tree tiles (they deplete!) | Lumber Camp workers |
| 🪨 Stone | rock tiles | Quarry workers |
| 🪙 Gold | cave tiles, taxes, trade caravans | Gold Mine, Market |

Click a finished building and use **+/−** to assign idle citizens to its worker
slots. Every building has a purpose: Houses add housing, Churches/Wells/Markets add
happiness, the Castle trains units, Walls/Gates/Bridges shape the battlefield, and
the Town Hall is your nation's heart — lose it and you lose the game.

**Diplomacy (🕊️ button):** relations run −100…+100 per nation.
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

**Controls:** WASD/arrows pan · wheel zooms · left-click/drag selects ·
right-click moves/attacks (or sets rally with a Castle selected) · Shift+click
places multiple buildings · Esc cancels.

## Code layout

Plain `<script>` modules, no build step:

- `js/assets.js` — atlas coordinates, animation auto-detection, faction palette-swap
  (the blue Minifolks art and orange roofs are hue-shifted per nation at load)
- `js/map.js` — seeded map generation, water autotiling, A* pathfinding
- `js/buildings.js`, `js/economy.js` — building defs/placement and the nation sim
- `js/units.js` — unit stats, movement, combat, projectiles
- `js/factions.js` — faction state and the AI (economy build order + military)
- `js/diplomacy.js` — relations, pacts, envoys, caravan trade routes
- `js/ui.js`, `js/main.js` — rendering, input, HUD, game loop

## Credits

- **Minifolks: Humans** unit sprites by LYASeeK
- 16×16 overworld tileset as provided in this repository
