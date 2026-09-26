# Nations — an RTS of trade and war

A browser real-time strategy game built entirely with vanilla JavaScript and the
asset packs in this repo: two 16×16 top-down tilesets
(`assets/tileset16x16_1.png` and `assets/punyworld-overworld-tileset.png`)
and the **Minifolks: Humans** unit pack (`assets/units/`).

You lead the blue nation of **Azuria** on a procedurally generated **planet**
shared with three AI nations — **Crimson**, **Violeta** and **Aurelia** — each
of them on a continent of its own, an ocean away. Who they *are*
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
replay a specific map; the chosen difficulty and world are added as
`&difficulty=` and `&world=` so a copied URL reproduces the whole setup.

## The world

**Before you pick a difficulty you pick a world.** The planet is generated from
plates, so it has real continents with bays and headlands and island chains off
their coasts, rivers running from the hills to the sea, and a sandy beach on
every shore.

| World | Size | What it is |
|---|---|---|
| **Duel Island** | 96×96 | The original close-quarters map: one island, four neighbours, nowhere to hide |
| **Small World** | 256×128 | A compact planet — a fleet crosses between continents in good time |
| **Standard World** | 384×192 | Four continents, real oceans. The default |
| **Large World** | 768×384 | Room to lose an army in. Long voyages, deep interiors |
| **Planet** | 1024×512 | Full planetary scale |

Every world except Duel Island **wraps east to west**. Walk west far enough and
you come back from the east; there is no edge of the map, only the ice caps at
the poles. Your army, your pathfinding, your borders and your camera all know
it.

**And you can look at the whole thing.** Zoom out past the widest map view and
you leave the surface: the planet is drawn as a globe hanging in space, with
its oceans, its ice caps, its biomes and every nation's territory painted on
it. Drag to spin it, and click anywhere — or zoom back in — to drop straight
down onto that spot. Your capital is ringed in white so you can always find
your way home.

**The land is not all the same.** Temperature falls from the equator to the
poles and with altitude; rain falls near the coasts and dries out inland. Where
those two meet decides what grows: dense rainforest and woodland, open
grassland and savanna, bare steppe and desert, cold taiga and tundra, and ice
at the caps. Woodland is thick with timber, desert has almost none, highlands
are strewn with stone. (Biomes tint the ground today rather than having their
own artwork — dunes, jungle and snow are still to come.)

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

**The year turns.** Every two days the season changes — Spring, Summer,
Autumn, Winter — a forty-minute year. Harvests swell through the year (Autumn's
is the biggest) and collapse in Winter, so fill your granaries in the autumn.
Winter chills your people, slows any army marching in foreign land, and wears
down an army camped in enemy territory. Pick your campaigns accordingly.

**Every resource comes from a real tile:**

| Resource | Comes from | Via |
|---|---|---|
| 🍞 Food | crop fields (bonus next to water/wells) | Farmhands, hauled to your stores |
| 🪵 Wood | tree tiles within 25 tiles of the camp (they deplete!) | Lumberjacks, hauled to your stores |
| 🪨 Stone | rock tiles within 4 tiles of the quarry | Stonecutters, hauled to your stores |
| 🪙 Gold | cave tiles, taxes, trade, plunder | Diggers and traders, plus taxes |
| 📖 Knowledge | Libraries, Universities, Churches, the Town Hall | Scholars studying — not stored, not robbable; feeds research |

Click a finished building and use **+/−** to assign idle citizens to its worker
slots. Every building has a purpose: Houses add housing, Churches/Wells/Markets add
happiness, the Castle trains units, the Dock builds ships, Walls/Gates/Bridges
shape the battlefield, and
the Town Hall is your nation's heart — lose it and you lose the game. Outgrew a
building? **Demolish** it from its panel and reclaim 75% of its cost.

**Your people are on the map.** Every citizen you have is a person walking
around down there. Put one in a Lumber Camp and a lumberjack walks out to a
tree, chops until they are carrying five wood, and walks it back to your Town
Hall or nearest Storehouse — nothing enters your stores that somebody did not
carry there. Farmhands work their own field, stonecutters the rock face,
diggers the cave mouth, traders the Market. Citizens with no job wander the
streets of your town, which is what an idle population looks like.

**And you can see who is who.** Your people carry the tools of their trade —
a scythe on the farms, an axe in the treeline, a pick at the rock face and the
cave mouth, a hammer on every building site — so a glance across your land
tells you where your economy actually is. Anyone with empty hands has no work
to do.

**So where you put your Storehouses is now a real decision.** A Lumber Camp
with a Storehouse beside it earns nearly twice what the same camp earns hauling
its wood twenty tiles home. Build storage out to your camps, or accept that
distant ground pays less.

**And you need builders to build anything.** Placing a building no longer
raises it — it stakes out a **site**, and the cost is not paid yet. Builders
walk to your stores, pick up **15 materials at a time**, carry them to the
site, and only once everything the site needs is physically there do they start
raising it. Up to three builders can work one site. You start with two builders
quartered in the **Town Hall**; a **Builder House** (30 wood) quarters three
more, and staffing it is how you build faster. Materials on a builder's back
are real: kill the builder and the load spills on the ground. A site shows an
amber bar for materials delivered and the usual blue bar for construction, and
calling one off returns everything already carried there.

> Watch out: with no builders, nothing you place will ever be built. If your
> Town Hall's builder slots are empty and you have no Builder House, the game
> tells you so the first time you place something.

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

## Knowledge, research and the Ages

**Your nation grows up.** Every match begins in the **Tribal Age**, and the
great arc of a game is climbing through the **Feudal Age** and the **Age of
Kingdoms** to the **Imperial Age** — each one a real transformation: new
technologies, new buildings, new troops, and new castle upgrades.

**Knowledge** is the resource that drives it. Your Town Hall produces a trickle
on its own, every **Church** adds a little (monks copy scripture), but the real
engine is the **Library** (40🪵 25🪨): staff it with up to three **scholars**
and they sit and read, pouring knowledge into whatever you are studying.
Scholars are citizens like any other, so every one of them is a farmhand or a
lumberjack you are not employing — the classic guns, butter *or books* choice.
Later, **Education** unlocks the **University**: four scholars, each worth
nearly two in a Library.

**Research (press T, or click the knowledge readout on the top bar)** opens the
tree: 30 technologies in three branches — **Economy**, **Military** and
**Civic** — laid out by Age. Click one to study it; click one further down the
tree and the whole path to it is queued for you. Knowledge you earn while
studying nothing is banked (up to a cap) and spent the moment you pick
something. A few examples of what's in there:

| Age | Technologies (a sample) |
|---|---|
| Tribal | Crop Rotation, Woodcraft, **Masonry** (unlocks the Watchtower), Bronze Working, Fletching, Writing, Mysticism, Horseback Riding |
| Feudal | **Iron Working** (Shieldman), **Crossbows** (Crossbowman), Feudalism, Heavy Plough, Deep Mining, Currency, Stonemasonry, Code of Laws |
| Kingdom | **Engineering** (Catapult), Chivalry, Guilds, Banking (treasury interest), **Education** (University), Theology, Fortification, Navigation |
| Imperial | **Arcane Mastery** (Archmage), Standing Army, Printing Press, Mercantilism, Architecture, **The Enlightenment** |

**Advancing an Age** takes a set number of the current Age's technologies (3,
then 4, then 5), a knowledge project, and a payment in goods — then the whole
nation steps forward, with a banner across the screen to mark it. The Age you
stand in gates the castle upgrades: the **Garrison** needs the Feudal Age and
the **Royal Academy** the Age of Kingdoms. The **Enlightenment** is the last
and greatest study of all.

**Your rivals research too**, each by its own lights — a warlord drills iron
and chivalry, a merchant prince chases currency and banking, a walled-up
homebody studies masonry and fortification. Their Age is public (you'll hear
when a rival enters a new one, and see it in Diplomacy); their technologies are
not.

**Watchtowers** (Masonry, 20🪵 40🪨) are stone towers whose archers shoot any
enemy in range on their own. Walls, gates and towers are **fortifications**:
ordinary troops do only a third of their damage to them, so breaking a
fortified town takes siege engines.

## The rulers of the world

**Every rival nation is ruled by someone.** Each match rolls a new cast: a
Norse chieftain in Crimson, a Byzantine lord in Violeta, an Iberian king in
Aurelia — each with a **pixel portrait**, a name, an age, **two traits**
(Warmonger, Merchant Prince, Covetous, Paranoid, Honorable, Schemer, Zealot,
Scholar), a **hidden agenda** (Warlord, Trade Baron, Seeker of Wisdom,
Territorial, Peacemaker, Builder, Tribute Seeker) and a voice of their own.
Their titles rise with their Age — Chieftain, Lord, King, Emperor — and they
earn epithets from what they do: *the Bold*, *the Builder*, *the Faithless*…

**You have to meet them first.** A court introduces itself the first time its
scouts or ships find your people — greet them as friends, send a welcome gift,
or tell them to stay out of your way. First impressions last. Until then, a
nation across the sea is an unknown court.

**They remember.** A leader's opinion of you is not one number, it is a
ledger: *"+14 Kept their word"*, *"−30 Declared war on us"*, *"+8 Trading
partners"*, *"−10 Despises your weak army"*, each with its own weight and its
own memory — a gift fades in minutes, a betrayal lasts an hour. Their traits
decide how hard things land (an Honorable ruler never forgets a broken
promise; a Zealot takes every rebuff as an insult) and their agenda decides
what they care about. Hold an **Audience** to see every line of it.

**They ask you things.** Leaders come to you with questions, requests,
demands and offers, in their own words:
- *"Why do your soldiers gather at our border?"* — withdraw (a promise), pay an
  apology, or tell them your soldiers go where they please.
- *"You build too close to our lands."* — promise to build no closer, or not.
- *"Our children go hungry."* — send food, or don't.
- *"Which of our neighbours do you trust least?"* — your answer poisons their
  view of whoever you name.
- *"If Violeta attacks us, will you stand with us?"* — give your word, and be
  held to it.
- Friendship, research pacts, resource trades, joint wars, pleas for aid,
  ultimatums, peace offers, surrender…

**Your word is tracked.** Promise to withdraw and have soldiers at their border
45 seconds later, promise to build no closer and finish a farm by their fields,
promise to defend them and sit out the war — they will know, and word gets
around the other honorable courts.

**The Audience screen** (Diplomacy → Audience, or the button on any card)
shows the leader, their traits and agenda, how they stand with every other
nation, why they feel as they do about you, and what you have promised them —
and lets you act: gifts, **declare friendship** (public — war on a friend is a
betrayal the whole world remembers), a **research pact** (+15% knowledge for
both, 10 minutes), trade pacts and alliances by envoy, **denounce** them,
**demand tribute** (only if they fear you), embargo, war, peace, **demand
surrender** — plus a **deal builder** to trade any goods for any goods (they
price it by what they actually need, and drive a harder bargain if they
dislike you) and questions: *"What do you think of Crimson?"*, *"What do you
want from us?"*

**Wars can end in vassalage.** A nation that has truly lost a war — its
capital battered or its towns burning, facing an army it knows it cannot beat
— will offer you its fealty: a vassal pays you a fifth of its treasury every
minute and marches in your wars. It works the other way too: an enemy
crushing you may demand your submission, which ends the war at the price of
your gold and your freedom to fight them — until you declare independence.
Vassals rebel when they think they can win.

**Size has a price.** Every citizen past thirty makes your people a little
harder to keep content (**crowding**, shown in the happiness breakdown). A
nation grows large by building churches, wells and markets and studying the
civic arts — or it stops growing.

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
- **Their people are targets too.** Enemy civilians are unarmed and will run for
  cover rather than fight, and no unit picks a fight with one on its own — but a
  direct attack order kills them, and every one you kill is a citizen that nation
  no longer has, working no field and hauling no timber. Splash damage does not
  discriminate.

## The sea

**Trade and diplomacy cross the ocean.** A trade pact with a nation on another
continent sails: once both of you have a **Dock**, **merchant ships** in your
colours ply the lane between the two harbours, paying both nations each voyage
— more for a longer crossing. A burned Dock closes the lane until you raise
another, and a war galley at war will sink them. Envoys to a court across the
sea take ship from your Dock and come home the same way.


**Your neighbours are across the water.** On every world but Duel Island each
nation starts on its own continent, so an army that cannot embark is an army
that can never meet another nation.

**Build a Dock** (70 wood, 20 stone) on the shore — it needs open water right
against its footprint — and it builds two ships:

| Ship | What it's for |
|---|---|
| **Transport** | Carries up to 6 troops. Unarmed: send a Galley with it |
| **War Galley** | Fighting ship — escorts transports and rakes anything near the shore |

**To invade:** select the troops you want to send, right-click one of your
Transports, and they march to the quay and go aboard (the pips over the hull
show how many are loaded). Then select the Transport and right-click where you
want them — even a spot far inland; the fleet finds the nearest coast to it,
sails there and puts them ashore. Select ships and right-click open water to
sail without landing.

Troops aboard a ship are *inside* it — nothing can shoot them, and nothing can
be shot by them. **If the hull goes down, everyone aboard goes with it.** A
Galley can shell troops on a beach and archers on a beach can shoot back at a
hull, but neither will go chasing the other across the waterline.

The AI nations do all of this too. They build shipyards, send a galley off to
chart the oceans and find out who else is out there, and when they decide on a
war across water they assemble a fleet, load an army onto it, and land it on
your coast.

## Your army

**Thirteen troops, and each one does a job no other does.**

| Unlocked by | Troop | What it's for |
|---|---|---|
| Castle | **Swordsman** | Cheap line infantry — the body of any army |
| Castle | **Spearman** | Just as cheap, and hits Cavaliers for ×2.2 |
| Castle | **Archer** | Ranged, pierce damage, dies fast if anything reaches it |
| Castle | **Bandit** | Fast raider — **the only troop that can carry plunder** |
| Castle | **Prince** | Envoy, not a fighter; carries proposals to other nations |
| Iron Working | **Shieldman** | Slow, armoured, and halves arrow damage — the wall your archers hide behind |
| Crossbows | **Crossbowman** | Slow reload, but the bolt ignores 3 points of armour |
| Garrison | **Halberdier** | Armoured tank — blades and arrows glance off, magic doesn't |
| Garrison | **Cavalier** | Fast, heavy shock cavalry. Spearmen are its answer |
| Engineering | **Catapult** | Siege engine: smashes walls, towers and buildings from 7.5 tiles. Can't fire point-blank and does little to troops — escort it |
| Royal Academy | **Mage** | Ranged magic with splash, and armour doesn't stop it |
| Royal Academy + Arcane Mastery | **Archmage** | Heavier fire, wider splash |
| Royal Academy | **King** | One per nation. +15% damage to troops near him |

**Soldiers grow.** Every soldier earns experience in battle and rises from
Recruit to **Veteran**, **Elite** and finally **Legend** — each rank hits
harder and lasts longer (gold chevrons over their heads). Legends get a name —
*Aldric the Bold* — and steady the troops around them.

**Morale decides battles.** Wounds, friends falling nearby, being outnumbered
and a cavalry charge wear a soldier's nerve down; home ground, rest, the King
and Legends build it back. A soldier whose nerve breaks **routs** — drops
everything and runs home (you'll see a white rag), and panic spreads to those
beside it — then rallies once it has recovered. Veterans hold longer. Lose your
King in battle and your whole army is shaken.

**Cavalry charges.** A horseman who rides a few tiles into the fight lands his
first blow half again as hard and shakes the man he hits — unless that man has
a spear, a halberd or a shield.

**Armies heal at home, and cost money.** Wounded soldiers recover out of the
fight on your land, fast near a Town Hall, Castle or Church. Soldiers eat and
draw pay; ships and siege engines cost gold. An army you can't pay loses heart.
In winter, an army deep in enemy land wears down.

**Castle upgrades and research unlock troops.** A fresh Castle trains the basic
five. The **Garrison** upgrade (Feudal Age) unlocks the Halberdier and Cavalier,
the **Royal Academy** (Age of Kingdoms) the Mage and the King, and research
unlocks the rest. Locked troops show a lock with what unlocks them — and AI
nations climb the same tiers and study the same tree. Military technologies
make your whole army better too: Bronze and Iron Working sharpen blades,
Fletching and Crossbows harden arrows, Chivalry armours your horse, Standing
Army toughens every soldier.

**Armies march in formation.** Group move orders arrange your troops into ranks
facing the direction of travel, and units physically push apart so they never
stand inside each other. A formation also marches at the pace of its **slowest**
member, so your Cavaliers no longer arrive alone, ten seconds ahead of the
shield wall.

**You decide how they march (Menu → Formations).**
- **Shape:** a **Diamond** (a point that widens and narrows again — covers the
  flanks) or a **Rectangle** (a solid block, up to six wide).
- **Marching order:** drag the thirteen troop types into the order you want them to
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

**Diplomacy (Menu → The Courts, or press L):** each ruler's opinion of you runs
−100…+100, with every reason listed on their Audience screen.
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

**How a match ends is your choice.** On the setup screen, beside the world
and the difficulty, pick **Victory conditions** or **Endless**, and a **Pace**
(Quick ≈ an hour, Standard ≈ two, Epic an evening).

With victory conditions on, five races run for **every** nation at once, and
the first to finish one wins the match — if that isn't you, you lose:

| Victory | How |
|---|---|
| ⚔ **Domination** | Every rival conquered or sworn to you as a vassal |
| 📖 **Science** | Complete *The Enlightenment*, the last study of the Imperial Age |
| 🏛 **Culture** | Bank culture — mostly from standing Wonders — with three of them standing |
| 🪙 **Economic** | Earn a fortune from caravans and merchant ships *and* hold a great treasury, for three minutes |
| 🤝 **Diplomatic** | Every surviving nation your ally or vassal, in the Age of Kingdoms, for three minutes |

Rivals pick their own race by temperament and change course as the world
does. Everyone is warned as a nation closes in (75%, 90%, and a countdown
when a held condition starts), and past 75% the leader becomes **everyone's
target** — even peaceful courts go to war to stop it, and traders embargo a
would-be trading empire. Press **V** for the Ledger: every race, every
nation's progress, the legacy chart and the milestones.

**Endless** plays as the game always has: no victory, and only your Town Hall
falling ends it. Either way every nation earns **legacy** — its Age and
learning, Wonders, culture, people, land, trade, conquests and vassals, the
**milestones** it reached first (first into each Age, first Wonder, first
conquest…), and whether its word could be trusted.

**The Chronicle (J)** writes the history of the match as it happens — every
war and peace, Age, Wonder, conquest, betrayal and broken promise, by day.
When the match ends (in victory, defeat, or a rival's victory), the end screen
shows how history will remember you — *the Conqueror*, *the Builder*, *the
Enlightened*, *the Merchant*, *the Faithless*… — a chart of every nation's
legacy over the match, the final standings and the chronicle's great moments.
After a victory you can **rule on** in endless mode.

**Wonders of the world.** Seven Wonders — the Great Library, Grand Bazaar,
Royal Gardens, Great Cathedral, Great Wall, Imperial Palace and Grand
Observatory — each worth a lasting bonus (see the Wonders tab of the build
bar). There is only one of each in the whole world: several nations can race
for the same one, and whoever finishes first wins it; everyone else's site is
abandoned. A Wonder can be captured with its nation — or burned, and then it
is lost to history for everyone. They take six builders at once and a great
deal of stone and gold, and they are what Culture is made of.

**Peace comes with a truce.** Every war that ends leaves a five-minute truce:
the AI never breaks one, and if you do, every court remembers it.

**Conquest means annexation.** Destroy a nation's Town Hall and its surviving
farms, mines, markets and storehouses — goods and all — become **yours**, at
reduced health and unstaffed until you assign workers. Walls and the ruined Town
Hall come down. This cuts both ways: a rival that overruns you inherits your
whole economy, and the continent consolidates into real empires.

**Losing:** your Town Hall falls — on any setting — or, with victory
conditions on, a rival wins one of the five races first. Prosperous AI nations still race to raise their own Grand Castle
(you'll be warned when construction starts, purely as news), and conquerors
can still swallow the rest of the map if nobody stops them — AI nations fight,
bridge rivers to reach each other, and eliminate one another, so the continent
you face in the late game may not be the one you started on.

**The Menu button** (top right) opens the pause menu — the simulation freezes
while it's up. From there: Diplomacy, Research, Select Army (grabs your whole standing
army), Formations, game **Speed** (1x/2x/3x), Hide UI, **Dev Mode**, and New Game.

**Dev Mode** (Menu → Dev Mode) is a cheat for testing: your resources never run
out and training is never blocked by cost or population. A red **DEV** badge
stays on the topbar the whole time it's on so it's never left running by
accident, and it resets to off on a new game.

**Commanding an army (desktop):** right-click **moves** (the group marches
through without stopping to fight) or attacks what you clicked · **F** then
click, or **Ctrl+right-click**: **attack-move** (fight your way there) · **P**
then click: **patrol** · **Z**: **hold** position · **X**: **stop** ·
**Shift+right-click** queues waypoints · **Ctrl+1-9** makes a control group,
**1-9** selects it (twice jumps to it) · **double-click** a soldier selects all
of that type on screen · **I** selects idle soldiers · **Space** jumps to the
latest attack alert (alerts also ping the minimap). On touch, the same orders
are buttons on the army panel; double-tap then gives the target.

**Controls (desktop):** WASD/arrows pan (Shift = faster) · wheel zooms ·
left-click/drag selects an army, or buildings if the box has no units in it ·
right-click moves/attacks — or, with bandits selected, sends them to rob an
enemy storehouse; sets rally with a Castle selected · click-and-hold then drag
to lay a wall/gate/bridge run, shown as a preview until you release · Shift+click
places multiple buildings · R rotates a bridge while placing · Ctrl+C copies
selected building(s) (then click Paste, or press it again, to stamp another) ·
Delete/Backspace removes selected building(s) for a 75% refund · **T** opens
Research · **L** opens the Courts (diplomacy) · **V** the Ledger (victory &
legacy) · **J** the Chronicle · **B** cycles the build tabs · Esc cancels
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
- `js/world.js` — world size/presets, the east-west wrap helpers, the biome table
- `js/map.js` — seeded world generation (plates, oceans, rivers, beaches,
  climate, biomes), water and cliff autotiling, plateaus and their stairs,
  A* pathfinding (land and sea)
- `js/buildings.js` — building defs/placement, incl. physical storage buildings
- `js/economy.js` — the nation sim; `res` is a Proxy over per-building stockpiles
- `js/market.js` — supply/demand commodity pricing, buy/sell, barter
- `js/units.js` — unit stats, movement, combat, projectiles, robbing & hauling loot
- `js/civilians.js` — the citizenry: workers, builders, wanderers, gathering trips
  and construction sites
- `js/army.js` — veterancy and Legends, morale and the rout, healing,
  attrition, upkeep, and attack alerts
- `js/seasons.js` — the four seasons and what they do to harvests, people and armies
- `js/naval.js` — docks, ships, boarding and landings, and the AI's navy
- `js/globe.js` — the orbit view: world texture, sphere projection, starfield
- `js/tech.js` — knowledge, the technology tree, the Ages, tech modifiers
  (`f.mods`) and the AI's research choices
- `js/icons.js` — extra HUD icons drawn from pixel grids at load
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
- `js/leaders.js` — the rulers: portraits, traits, agendas, the opinion ledger,
  promises, their questions and requests, friendships, deals and vassals
- `js/ui-leaders.js` — the Courts list and the Audience screen
- `js/ui.js`, `js/main.js` — rendering, input, HUD, loot piles, difficulty
  select, game loop
- `js/ui-research.js` — the Research screen, the Age banner, the knowledge readout
- `js/wonders.js` — the seven Wonders: the race, their effects, their art, the AI
- `js/victory.js` — the five victories, the AI's race, legacy, milestones, the chronicle
- `js/ui-victory.js` — the Ledger, the legacy chart, the end screen

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
