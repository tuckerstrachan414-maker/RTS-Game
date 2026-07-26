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
`js/units.js:405` — `formationMove` filters out envoys, so a selected Prince
(alone or in a group) ignores move orders; the attack dispatch in
`js/ui.js:405` skips envoys too. An idle Prince is completely unorderable and
just stands wherever he spawned or last returned to — including in danger.
**Plan:** TBD

### 3. Bridges cannot be selected or demolished
`js/buildings.js:157` — bridges write to `map.bridge`, not `map.buildingAt`,
so `clickSelect` can never find them and the demolish path is unreachable.
A misplaced bridge is permanent (though it still cost wood, sits in
`faction.buildings`, and has 120 HP nothing can target).
**Plan:** TBD

### 9. Menu button tooltip promises "Esc" opens it, but Esc never does
`index.html:250` titles the button "Menu / Pause (Esc)", but the keydown
handler (`js/ui.js:66`) only uses Escape to close the pause menu / cancel
placement / clear selection. There is no keyboard shortcut that opens the
pause menu.
**Plan:** TBD

### 11. Trade roads persist after the route dies
`map.road` tiles are stamped at route creation (`js/diplomacy.js:177`) but
never cleared when routes are cancelled or die, so dead routes leave permanent
roads (which still grant the 1.3× road speed bonus and 0.7 path cost to
everyone). Arguably charming, but unintended.
**Plan:** TBD

### 12. Dead code: unit mirror ternary
`js/ui.js:1085` — `u.facing < 0 ? drawX : drawX` — both branches identical.
Behavior is actually correct (the transform math works out), the expression is
just meaningless. Cosmetic cleanup only.
**Plan:** TBD

### 14. Every building costs wood, so a nation can be locked out of building
`js/buildings.js:6-92` — every buildable type takes wood, **including the
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

### 18. AI wall rings leave permanent gaps at forest and rock tiles
`js/ai.js:721`, `js/buildings.js:149` — `canPlace` still requires `T_GRASS`, so
no wall can be built on a tree or rock tile. That was harmless while those tiles
were impassable natural barriers; now that troops can cross them
(`map.moveCost`), a ring drawn around a wooded town has real holes in it. They
are slow chokepoints rather than open doors, but a defensive AI cannot close its
perimeter and does not know it. Clearing terrain to build (or letting walls sit
on rough ground) would fix it.
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

### 13. Peace-offer / dispute cards can pile up against an idle player
`js/events.js` `pushPlayerEvent` — the queue caps at 3 and per-faction
politeness cooldowns apply, but three different factions can still each keep a
card up more or less permanently if the player never answers. Mostly cosmetic;
expiry consequences (relations drops) do apply.
**Plan:** TBD

## Fixed

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
