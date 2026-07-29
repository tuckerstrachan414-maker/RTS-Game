# Nations — repo guide for Claude / future contributors

Browser RTS in vanilla JavaScript. No build step, no dependencies, no test
framework — plain `<script>` tags loaded in order by `index.html`. Serve over
HTTP (`python3 -m http.server 8000`), not `file://` (canvas pixel access needs
it). `?seed=N` replays a specific map. `game` and `ui` are `let`-scoped
globals in `js/main.js` (not on `window`).

## Documentation map — and the rule

| File | What it is |
|---|---|
| `README.md` | Player-facing: how to run and play |
| `docs/FEATURES.md` | Every system + a depth rating (Deep/Moderate/Basic) |
| `docs/BUGS.md` | Known bugs with file:line refs; plans column (currently TBD) |
| `docs/formations-tiers-ui.md` | Implementation notes: formations, castle tiers, gestures, tooltips, hide-UI |

**RULE: update the documentation after every addition or change.** Before
finishing any task that touches game code:

1. **`docs/FEATURES.md`** — add or amend the affected feature's entry and
   re-judge its depth rating.
2. **`README.md`** — update if the change is player-visible (controls, UI,
   mechanics, buildings, units).
3. **`docs/BUGS.md`** — add any bug you found (even ones you didn't fix, with
   `file:line`); move fixed bugs to the Fixed section with a one-line note.
   Leave the Plan lines as TBD unless asked to fill them in.
4. **`docs/formations-tiers-ui.md`** — update if you touched formations,
   separation, castle tiers, tap gestures, tooltips, or hide-UI.

Docs describing the game's *current* state are the deliverable here as much as
the code; stale docs are treated as bugs.

## Code layout

- `js/world.js` — world presets + `configureWorld` (`MAP_W`/`MAP_H` live here),
  the east-west wrap helpers (`wrapX`, `wdx`, `wdist`), the `BIOMES` table
- `js/assets.js` — atlas coords for both tilesets (`AT`, `PUNY`), animation
  auto-detection, faction palette swap
- `js/map.js` — seeded world generation (plates → sea → depth → rivers →
  climate → beaches → biomes → vegetation → homelands → plateaus → caves),
  water + cliff autotiling, A* (`findPath`, land and sea)
- `js/naval.js` — docks, ships, boarding/landings, the AI's navy (`aiNavalTick`)
- `js/globe.js` — the orbit view: world texture, cached sphere projection
- `js/buildings.js` — building defs, placement, castle upgrades, production
- `js/economy.js` — Nation sim; `res` is a Proxy over per-building `store`s
- `js/market.js` — supply/demand pricing, buy/sell/barter, embargo penalties
- `js/units.js` — unit defs, combat, projectiles, rob/haul, formations, separation
- `js/civilians.js` — the citizenry: population embodiment, job assignment,
  gathering trips, builders and construction sites, per-job sprite
  (`civSpriteFor`)
- `js/factions.js` — Faction state, training, the AI executor (`aiTick`)
- `js/diplomacy.js` — relations, pacts, envoys, caravans/routes, embargoes
- `js/events.js` — event-card queue (AI-initiated player choices, expiry)
- `js/territory.js` — per-tile influence/ownership, contested borders, disputes
- `js/ai.js` — ambitions (`f.ai`), re-evaluation, proactive diplomacy, war
  waves, expansion, bridge/wall engineering, coalitions
- `js/ai-perception.js` — `AIPerception` + `ScoutMemoryMap`: everything an AI
  knows about rivals, written only by observation
- `js/ai-utility.js` — `AIUtilityEngine`, `AI_ARCHETYPES`,
  `calculateMarginalUtility`, the day/night tax controller
- `js/ai-trade.js` — `AITradeManager`, `evaluateWarVersusTrade`
- `js/ai-combat.js` — `AICombatManager`: scouting, army, defence, war gating
- `js/ui.js` — rendering, input (mouse + touch), HUD, panels, minimap, event card
- `js/main.js` — Game class, fixed-timestep loop (SIM_DT 0.1), victory, loot
  piles, `DIFFICULTIES` + pre-game difficulty/world overlay

## Gotchas worth knowing before editing

- **`MAP_W`/`MAP_H` are `let`, not `const`.** `configureWorld` (js/world.js)
  sets them from a preset in `boot()`, before `new Game()`. Never cache them at
  script-load time, and never size an array off them outside a constructor.
- **The world wraps east-west** (`WORLD_WRAP`, false only on Duel Island).
  `map.idx` folds x, so neighbour loops wrap for free — but any *distance* or
  *bounding* test written as `b.x - a.x` is a bug near the seam. Use `wdx`,
  `wdist`, `wmanhattan`, `wrapX`, `wrapPos`, and `ui.onScreen`/`ui.viewX` for
  anything on screen.
- Beaches (`T_SAND`) are walkable and buildable and sit between every coast and
  the sea. Anything that enumerates "open ground" — `openAt`, `canPlace`,
  `carveLine`, `carveShortestLink` — has to include them, or the shoreline
  becomes a wall.
- **Nations start on separate continents** and `connectStartZones` no longer
  links them; `map.continent`/`continentSize` is the cheap "can this army walk
  there?" answer, and crossing water is `js/naval.js`'s job. Duel Island sets
  `oneContinent` and keeps the old guarantee.
- Ships are ordinary `Unit`s with `type.naval`. They path with
  `findPath(..., 'sea')` — always via `Unit.pathTo`, never by calling
  `findPath` directly. A unit with `u.aboard` set is off the map entirely:
  skip it in ticking, drawing, separation, targeting and the minimap.
- The AI may still not read live rival state. The navy obeys this: ships
  observe like any other unit, and where an unscouted rival *is* comes from the
  drawn territory borders (public knowledge), never from their buildings list.

- `nation.res.gold -= x` works — it's a Proxy that withdraws from physical
  building stores (Town Hall drained first, Storehouses filled first).
- Production maths lives in exactly one place now: `workerYieldRate`
  (`js/buildings.js`), which returns what ONE worker earns per second and
  returns 0 when the ground is worked out. `estimateIncome` (`js/economy.js`)
  calls it rather than re-deriving it — the duplication that caused BUGS #6 is
  gone — but prefers a building's *measured* throughput (`b.yieldRate`) when it
  has one, because output now depends on how far the workers walk. If you add a
  producing building, `workerYieldRate` and `findWorkTile` are the two functions
  that need to know about it.
- **Nothing is deposited or built by a formula.** `Nation.tick` no longer
  produces resources or advances construction; civilians do both by walking
  (`js/civilians.js`). A new placement path must call `startConstruction`, not
  `placeBuilding`, and must check `nation.canStart(cost)` (which nets off
  materials already promised to open sites) rather than `canAfford`.
- Every citizen in `nation.pop` is one civilian unit on the map, and
  `syncCivilians` keeps that true both ways. Anything that changes `pop` (dawn
  growth, starvation, `trainUnit`) is fine; anything that kills a civilian must
  go through `onUnitDeath` so the population actually drops.
- `building.workers` is still the only thing that decides who works where —
  set it and `reconcileJobs` moves the bodies. Don't assign civilians directly.
- `trainUnit` / `startCastleUpgrade` return error *strings*, not exceptions.
- Bridges live in `map.bridge`, not `map.buildingAt` — they're terrain, not
  targetable buildings.
- Plateau tops are ordinary terrain with `map.high[i] === 1`; the wall around
  them is `T_CLIFF` (impassable, and the only terrain with no way through at
  all) and the way up is `T_RAMP`, facing any of 4 directions per
  `map.rampDir`/`RAMP_DIRS` (the tileset only drew a south-facing stair; the
  other 3 are that art rotated by `tools/splice-cliffs.py`, not at runtime).
  `generatePlateaus` guarantees every top tile is walkable from a stair —
  anything added after it that can make a tile impassable (caves are the
  existing case) must not land on a top or any ramp's footing, or it strands
  ground. Don't reset `map.high` outside `generatePlateaus`: `carveLine`/
  `carveShortestLink` simplify whatever they cross to grass, including a
  plateau-top tile, but must never clear its `high` flag while doing so — that
  silently ejects the tile from the plateau instead of just tidying it
  (BUGS #30).
- `assets/tileset16x16_1.png` is 8×18 now, not 8×14. Rows 14-17 are the cliff
  set; re-splice with `tools/splice-cliffs.py` rather than editing pixels by
  hand. Appending kept every older `AT` coordinate valid — don't repack it.
- `assets/units/Civ*.png` are **reconstructions** of screenshots, not original
  art (BUGS #37) — regenerate with `tools/import-civilians.py` rather than
  editing them, and read that script's docstring before assuming anything about
  their provenance. A civilian's sheet comes from their *job*, via
  `civSpriteFor` → `u.spriteKey`, not from their unit type; there are two
  civilian types and five sheets.
- **There are two runtime tilesets.** `assets/punyworld-overworld-tileset.png`
  (27×65 cells, art only to row 37) is loaded alongside the atlas; `PUNY`
  addresses it the way `AT` addresses the atlas. Walls, gates, both bridge
  decks and the Town Hall / Lumber Camp / Gold Mine / Well come off it via
  `bakePuny`. Its castle masonry is too desaturated for the warm faction
  recolor to see, so those pieces take an explicit `stoneHue` pass — drop it
  and every nation shares one grey wall. `AT.WALL*`/`AT.GATE`/`AT.BRIDGE_*`/
  `AT.TOWNHALL`/`AT.LUMBER`/`AT.MINE`/`AT.WELL` are dead coordinates now.
- Plateau rim art has one rule: **raised turf must never touch low grass** —
  rock goes between, always. `high` being 4-connected is a movement rule, not a
  drawing one, so a top tile can still touch open ground at a corner and needs a
  concave piece (`plateauTopTile`); a stair jamb is an overlay on top of the rim
  piece, never a replacement for it; and nothing one tile thick survives
  generation, because the set has no piece for it. If you touch any of this, run
  the pixel scan in `docs/formations-tiers-ui.md` — six separate holes shipped
  past visual review here (BUGS #31), and the scan is the only thing that caught
  them all.
- Keep `formationMove`'s melee-in-front sort stable; both player and AI use it.
- New HUD elements need the `.hud` class to be hidden by Hide UI, and an
  explicit entry in the `body.ui-hidden` CSS list in `index.html`.
- The Game is NOT constructed until a difficulty is chosen — headless scripts
  must pass `?difficulty=ramped|slanted|ruthless` in the URL or `game` stays
  null behind the `#difficulty` overlay.
- All AI *initiative* (wars, pacts, gifts, embargoes, peace) lives in
  `js/ai.js` and the `js/ai-*.js` managers; `Diplomacy.tick` is ambient
  relations drift only. Don't add AI decision-making back into diplomacy.js.
- **The AI must not read live rival state.** Army sizes, store contents and
  building positions come from `f.brain.perception` only. Public knowledge —
  the diplomacy matrices, market prices, drawn territory borders, and a
  nation's own state — is fair game. There is a list of the reads that were
  removed in `docs/FEATURES.md`; don't reintroduce them.
- `aiTick` is a thin dispatcher into `f.brain.utility.tick()`. Knobs come from
  `AI_ARCHETYPES` (keyed by `f.ai.doctrine`) and `game.diff`. Personality is
  rolled per match by `rollPersonalities` — don't mutate it; mutate the
  ambition instead.
- Use `game.rng()` in AI code — and in civilian code, which is sim state for
  every nation including the player — never `Math.random()`. The last three
  stragglers were removed (BUGS #16) and the whole match is now deterministic:
  two runs of a seed produce identical state, which is what makes an A/B
  comparison of an AI change mean anything. Don't reintroduce one.
- Verification pattern (headless Playwright driving `game.tick(0.1)` loops) is
  documented at the bottom of `docs/formations-tiers-ui.md`.
