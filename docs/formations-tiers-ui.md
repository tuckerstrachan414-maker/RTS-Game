# Formations, Tiers & UI — feature notes

Running notes on gameplay systems and interface work. Newest entries first.

## 2026-07-20 — Fortifications, walkable settlements & pause menu

### Walls & fortifications
- **Connected walls.** Walls render from the tileset's own art: straight runs draw the
  wall sprite, while corners, junctions, ends, lone posts and diagonals draw the tower
  sprite — so a run reads as one continuous crenellated rampart with turrets instead of
  isolated blocks.
- **Sprite baking (`bakeTile` in `js/assets.js`).** At load the wall/tower sprites are
  cleaned: the grass painted into their corners is stripped to transparency, and the wall
  body is edge-extended to full-bleed so straight segments tile without seams.
- **Walkable settlements.** Collision was reworked so only *fortifications* block movement:
  walls and the two keeps (Town Hall, Castle) are solid, gates open for their owner and
  allies, and every other building (houses, farms, camps, markets) is walkable. Troops now
  move freely between the buildings of a settlement, which makes walls the deliberate
  barrier. Marked via a `solid` flag on building types; enforced in `GameMap.passable`.

### Building & placement
- **Click-drag to build.** Drag from a start tile to an end tile to lay a run of walls,
  gates or bridges. The run anchors at the start tile and snaps to the nearest axis:
  horizontal, vertical, or — for walls only — a **45° diagonal** (Clash-of-Clans style).
  Placement is live during the drag, skips blocked tiles, and stops spending when the
  treasury runs dry without ever double-charging a tile. (`beginPaint` / `paintTo` /
  `paintPlace` / `endPaint` in `js/ui.js`.)
- **Bridge rotation.** Press **R** or the on-screen Rotate button to flip a bridge between
  horizontal and vertical; a drag auto-faces the span along its direction.
- **Vertical bridges connect.** The vertical bridge sprite's top/bottom end-caps are
  replaced by its plank middle at bake time (`replicateMid`), so a north–south span reads
  as one continuous bridge instead of broken segments.
- **Demolish.** Any building except the Town Hall can be demolished from its panel,
  reclaiming **75% of the build cost, rounded up** (`demolishBuilding` in `js/buildings.js`).

### UI
- **Pause menu.** The old always-on menu panel is now a single **Menu** button. Clicking it
  pauses the simulation and floats a centered menu over a dimmed, frozen battlefield
  (Resume, Diplomacy, Select Army, Speed, Hide UI, New Game). Esc or clicking the backdrop
  resumes. The sim tick is gated on `ui.paused` in the main loop.
- **Hide UI.** Collapses the entire interface down to a single show button — no leftover bar.
