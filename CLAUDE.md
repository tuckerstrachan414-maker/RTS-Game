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

- `js/assets.js` — atlas coords, animation auto-detection, faction palette swap
- `js/map.js` — seeded generation, water autotiling, A* (`findPath`)
- `js/buildings.js` — building defs, placement, castle upgrades, production
- `js/economy.js` — Nation sim; `res` is a Proxy over per-building `store`s
- `js/market.js` — supply/demand pricing, buy/sell/barter, embargo penalties
- `js/units.js` — unit defs, combat, projectiles, rob/haul, formations, separation
- `js/factions.js` — Faction state, training, the AI (`aiTick`)
- `js/diplomacy.js` — relations, pacts, envoys, caravans/routes, embargoes
- `js/ui.js` — rendering, input (mouse + touch), HUD, panels, minimap
- `js/main.js` — Game class, fixed-timestep loop (SIM_DT 0.1), victory, loot piles

## Gotchas worth knowing before editing

- `nation.res.gold -= x` works — it's a Proxy that withdraws from physical
  building stores (Town Hall drained first, Storehouses filled first).
- `estimateIncome` in `js/ui.js` deliberately re-implements
  `buildingProduction` math because the real function mutates tree tiles.
  Change production math in BOTH places (they've already drifted once — see
  BUGS #6).
- `trainUnit` / `startCastleUpgrade` return error *strings*, not exceptions.
- Bridges live in `map.bridge`, not `map.buildingAt` — they're terrain, not
  targetable buildings.
- Keep `formationMove`'s melee-in-front sort stable; both player and AI use it.
- New HUD elements need the `.hud` class to be hidden by Hide UI, and an
  explicit entry in the `body.ui-hidden` CSS list in `index.html`.
- Verification pattern (headless Playwright driving `game.tick(0.1)` loops) is
  documented at the bottom of `docs/formations-tiers-ui.md`.
