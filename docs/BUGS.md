# Known bugs & issues

Found during the 2026-07 documentation audit by reading every module. None are
fixed yet. **Plans are intentionally left blank (TBD) — to be filled in
later.** When you fix one, move it to the Fixed section at the bottom with a
one-line note on the fix.

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

### 4. Wars between AI nations never end
No `aiTick` path calls `suePeace`, and ambient diplomacy (`js/diplomacy.js`
`tick`) has no peace-seeking branch — war weariness caps at 25 and just sits
there. Any AI–AI (or AI-declared) war continues until a Town Hall falls,
unless the player is a belligerent and pays for peace.
**Plan:** TBD

### 5. AI signs trade pacts with the player without consent
`js/diplomacy.js:251` — mercantile ambient diplomacy flips any neutral pair
straight to `trade` (12% roll per 5s, both Markets required), including pairs
involving the player — no envoy, no offer, no way to refuse. It benefits the
player (caravan gold), but bypasses the entire consent/envoy system the
player has to use, and an unwanted pact also can't be refused pre-emptively.
**Plan:** TBD

### 6. Resource tooltip income ignores forest depletion
`js/ui.js:1214` — `estimateIncome` mirrors `buildingProduction`'s math but not
its tree check: a Lumber Camp whose forest is exhausted shows a positive
+X/s in the wood tooltip while actually producing nothing
(`js/buildings.js:211` returns null). The two functions have already drifted —
exactly what the comment in `docs/formations-tiers-ui.md` warns about.
**Plan:** TBD

### 7. "Prioritize farms when food is low" AI logic is unimplemented
`js/factions.js:118` — `const want = (b.type.key === 'farm' && foodRate < 0) ?
b.type.slots : b.type.slots;` — both ternary branches are identical, so the
commented intent (staff farms first during shortage) does nothing. Workers are
assigned in whatever order buildings sit in the array.
**Plan:** TBD

### 8. Envoy death silently loses the proposal
If a Prince dies mid-mission (he walks through war zones unarmed and can't be
escorted — see bug 2), the proposal simply vanishes with no log message. The
player only learns by noticing the pact never arrived.
**Plan:** TBD

### 9. Menu button tooltip promises "Esc" opens it, but Esc never does
`index.html:250` titles the button "Menu / Pause (Esc)", but the keydown
handler (`js/ui.js:66`) only uses Escape to close the pause menu / cancel
placement / clear selection. There is no keyboard shortcut that opens the
pause menu.
**Plan:** TBD

### 10. Loot log spam from wars the player isn't in
`js/main.js:169` — when any non-player storehouse is razed, the player gets a
green "spills its stores — grab the loot!" message, even for an AI-vs-AI raid
on the far side of the map that the player can't meaningfully act on.
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

## Fixed

*(nothing yet)*
