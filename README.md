# Nations — an RTS of trade and war

A browser real-time strategy game built entirely with vanilla JavaScript and the
asset packs in this repo: two 16×16 top-down tilesets
(`assets/tileset16x16_1.png` and `assets/punyworld-overworld-tileset.png`)
and the **Minifolks: Humans** unit pack (`assets/units/`).

You lead the blue nation of **Azuria** on a procedurally generated continent shared
with three AI nations — **Crimson**, **Violeta** and **Aurelia**. Who they *are*
is rolled fresh every match: the warlord on your border in one game is a
walled-up trader in the next. Each pursues its own **evolving ambition** — one
may drill a conquering army, another chase riches and its own Grand Castle,
another wall itself in or weave alliances — and those ambitions shift as the
world changes.
There is no way to win. You never *have* to fight — trade, gifts and alliances
are a complete way to keep the peace — but the world won't wait for you, and
the only way the game ends is if it stops waiting for good: your Town Hall
falls.

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
| 🪵 Wood | tree tiles within 25 tiles of the camp (they deplete!) | Lumber Camp workers |
| 🪨 Stone | rock tiles | Quarry workers |
| 🪙 Gold | cave tiles, taxes, trade, plunder | Gold Mine, Market |

Click a finished building and use **+/−** to assign idle citizens to its worker
slots. Every building has a purpose: Houses add housing, Churches/Wells/Markets add
happiness, the Castle trains units, Walls/Gates/Bridges shape the battlefield, and
the Town Hall is your nation's heart — lose it and you lose the game. Outgrew a
building? **Demolish** it from its panel and reclaim 75% of its cost.

**Everything on the map looks like what it is.** A Farm is a field — ploughed
soil while it is being cleared, standing crop once it is finished — a
Storehouse is a barn with sacks stacked outside, a Quarry is a worked rock face,
a Well is a roofed wellhead, a Gold Mine is a timbered adit cut into a mound,
a Lumber Camp is a log cabin, and a Church has a steeple. Your Town Hall is a
tiered stone keep drawn at full size across its footprint rather than one tile
of art stretched to fit. Buildings wear their nation's
colour, including yours, so you can read who owns a town at a glance. Trees,
troops and buildings overlap each other by how near they are to you, so a
soldier walking behind a keep goes behind it and a wood in front of a farm
hides its front row.

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
anywhere in a run and it takes the run's direction, a timber gate set into the
wall rather than a gap in it. A north–south stretch is the same masonry as an
east–west one, not a thinner fence, and the crenellated stone takes your
nation's colour like everything else you build.

**The ground fights you too.** Forests and boulder fields are not walls —
troops push through both — but the going is slow: roughly 2.4× as long to
cross a forest tile and 1.9× a rocky one. Roads still speed you up. Only deep
water without a bridge, cave mouths, cliffs, walls and keeps stop a unit
outright.

**Bridges run straight, and they can be brought down.** A span only ever goes
horizontal or vertical, never both — two bridges can't touch or join at a
corner, and troops crossing one can't turn onto a perpendicular span partway
across. Attack either end of an enemy bridge and the whole crossing collapses
into the water at once, not just the tile you hit; a damaged span shows the
same green health bar as any other building so you can see it about to give.

**Take the high ground.** Every map raises a few plateaus — flat-topped mesas
ringed by a rock face no one can climb, bridge, or cut through. The only ways up
are the stairs cut into their rims, one to three per plateau and facing
whichever of the four sides had room for one, and climbing one is a little
slower than walking on the flat. That makes a plateau two things at once: a
wall that armies have to march around, and a piece of ground worth holding,
because whoever owns the stairs owns everything on top. The top itself is
ordinary country — you can farm it, log it, quarry it and build on it exactly
as you would down in the valley.

**You can build on forest and rock.** Place a Wall, House, or anything else
(except a Bridge, which needs water) right on top of trees or boulders and
the footprint clears them to make room — so a wall ring closes all the way
around a wooded camp instead of stopping at the treeline. Cliffs and stairs are
the exception: nothing can be built on either. While placing, the
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
  **spills onto the ground as loot**. Only **Bandits can carry it** — no other troop
  has a cargo hold — so bring a raider or two along on a raid, or the spoils just sit
  there and rot. A laden Bandit must physically carry the plunder home to a storehouse
  to keep it; cut one down and the loot spills again for anyone to grab. Idle Bandits
  near spilled loot will move to collect it.

## Your army

**Nine troops, and each one does a job no other does.**

| Tier | Troop | What it's for |
|---|---|---|
| 1 | **Swordsman** | Cheap line infantry — the body of any army |
| 1 | **Spearman** | Just as cheap, and hits Cavaliers for ×2.2 |
| 1 | **Archer** | Ranged, pierce damage, dies fast if anything reaches it |
| 1 | **Bandit** | Fast raider — **the only troop that can carry plunder** |
| 1 | **Prince** | Envoy, not a fighter; carries proposals to other nations |
| 2 | **Halberdier** | Armoured tank — blades and arrows glance off, magic doesn't |
| 2 | **Cavalier** | Fast, heavy shock cavalry. Spearmen are its answer |
| 3 | **Mage** | Ranged magic with splash, and armour doesn't stop it |
| 3 | **King** | One per nation. +15% damage to troops near him |

**Castle upgrades unlock troops.** A fresh Castle trains the whole of tier 1.
Buy the **Garrison** upgrade to unlock the Halberdier and Cavalier, then the
**Royal Academy** for the Mage and the King. Locked troops show a 🔒 with what
unlocks them — and AI nations climb the same tiers.

**Armies march in formation.** Group move orders arrange your troops into ranks
facing the direction of travel, and units physically push apart so they never
stand inside each other. A formation also marches at the pace of its **slowest**
member, so your Cavaliers no longer arrive alone, ten seconds ahead of the
shield wall.

**You decide how they march (Menu → Formations).**
- **Shape:** a **Diamond** (a point that widens and narrows again — covers the
  flanks) or a **Rectangle** (a solid block, up to six wide).
- **Marching order:** drag the nine troop types into the order you want them to
  hold the line. Whoever is at the top takes the point; whoever is at the bottom
  brings up the rear. Put Halberdiers first to soak the charge, or Archers first
  if you want them shooting before your infantry closes.
- Both settings are **remembered between games**, so you set your doctrine once.

**Tell a group what to hunt.** Select troops and use the **Targeting priority**
dropdown on their panel: *Anything* (the default), *Troops only*, *Buildings
only*, or one specific target — *Town Halls*, *Storehouses*, *Farms*, *Houses*.
A siege group set to **Buildings only** walks past the defenders and puts
everything into razing their works instead of getting bogged down in a brawl;
set it to **Farms** and you starve a nation out instead of fighting it.

Two things the priority does *not* do, on purpose: a direct attack order always
hits what you aimed it at, and troops standing idle still fight back when
they're attacked. It tells them what to *look for*, not what they're allowed to
hit.

**Give a group a standing role.** The same panel has **Group role**:
- **Offensive** — never moves on its own. It waits for your orders and then goes
  wherever you send it, however far.
- **Defensive** — the troops take up a **post** on the ground they're standing on
  and garrison it. They patrol your territory around it, attack anything hostile
  that comes near — and **won't be lured away**. Bait them and they'll break off
  and walk back. Order a defensive group to move and they re-post where they
  arrive, so it means "defend *there* instead".
- **None** — no standing orders, same as Offensive.

Selected garrisons draw a dashed line to the post they're holding, so you can
see what each group is guarding.

**Split Group** peels part of a selection into a group of its own: press it, tap
the troops you want to move out, then confirm. The troops you picked become the
new selection, ready for their own role and targeting priority — so you can
leave half your army home on **Defensive** and march the other half out on
**Offensive** in a few taps.

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

**There is no way to win.** No score to chase, no crown that ends the match —
you play to keep your nation standing for as long as you want to. Build a
Grand Castle (👑 300🪙 200🪵 200🪨 at your Castle, once you have 50 population
and 70% happiness) if you want the prestige of it; conquer every rival if you
want the whole continent; ally with everyone if you'd rather keep the peace.
None of it ends the game — it's just what kind of nation you choose to build.

**Conquest means annexation.** Destroy a nation's Town Hall and its surviving
farms, mines, markets and storehouses — goods and all — become **yours**, at
reduced health and unstaffed until you assign workers. Walls and the ruined Town
Hall come down. This cuts both ways: a rival that overruns you inherits your
whole economy, and the continent consolidates into real empires.

**Losing:** your Town Hall falls. That's the only way the game ends — a
rival's Grand Castle, a rival's conquest of the rest of the map, none of it
touches you. Prosperous AI nations still race to raise their own Grand Castle
(you'll be warned when construction starts, purely as news), and conquerors
can still swallow the rest of the map if nobody stops them — AI nations fight,
bridge rivers to reach each other, and eliminate one another, so the continent
you face in the late game may not be the one you started on. But it's only
*your* Town Hall that can end your run.

**The Menu button** (top right) opens the pause menu — the simulation freezes
while it's up. From there: Diplomacy, Select Army (grabs your whole standing
army), Formations, game **Speed** (1x/2x/3x), Hide UI, **Dev Mode**, and New Game.

**Dev Mode** (Menu → Dev Mode) is a cheat for testing: your resources never run
out and training is never blocked by cost or population. A red **DEV** badge
stays on the topbar the whole time it's on so it's never left running by
accident, and it resets to off on a new game.

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

**The interface keeps out of its own way.** Each panel owns one corner of the
screen: messages top-left, resource tooltips top-centre, Diplomacy top-right,
the building panel bottom-left, placement controls (Cancel / Rotate / Paste)
centred above the build menu, and event cards bottom-right — top-centre on a
phone, where the bottom strip only has room for one panel. The full row of
build buttons fits without scrolling down to a phone in landscape, and the
pre-game and end screens scroll rather than clip on a short screen.

## Code layout

Plain `<script>` modules, no build step:

- `js/assets.js` — atlas coordinates for both tilesets, animation auto-detection,
  faction palette-swap (the blue Minifolks art, orange roofs and castle stone are
  hue-shifted per nation at load)
- `js/map.js` — seeded map generation, water and cliff autotiling, plateaus and
  their stairs, A* pathfinding
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
  replaced with art from the **PUNY_WORLD_v1** tileset pack, and the cliff,
  plateau and stair set appended from the same pack (same 16×16 grid, spliced
  tile-for-tile into `assets/tileset16x16_1.png` by `tools/splice-cliffs.py` —
  see `docs/FEATURES.md` → Rendering & assets)
