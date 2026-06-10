# PHASE-RENDER-R3-IDEAS — The Big Visual Backlog

> Companion to [VISION-RENDER.md](VISION-RENDER.md) / [PHASE-RENDER.md](PHASE-RENDER.md) /
> [PHASE-RENDER-R2.md](PHASE-RENDER-R2.md). R1 (decision narrative), R2 (Pixi + camera), and the
> first R3 slice (prosperity glow, inventory bar, worker figures) have shipped. This doc is the
> **idea backlog** for everything after — it extends the existing R3→R7 ladder, it does not
> replace it. Where an idea belongs to an already-planned phase (R4 economic flow, R5 charts &
> story, R6 atmosphere, R7 showpieces) the row says so.
>
> **The sacred rule applies to every row: rendering only reads.** Every idea below is pure
> presentation — it reads data the simulation already produces (or that can be derived read-only
> from it) and never writes a byte back. Animation timing is wall-clock, never sim state. The
> 365-day soak must never notice any of this shipped.

---

## The window-glow investigation (the user's bug report)

**Report:** "Houses do not visibly light up when people are home."

### What the code actually does today

The effect *exists* — it has since Phase 5 — but it is driven by the wrong things:

1. **The clock gates everything** (`src/render/daynight.ts`, `windowGlow(hour)`). Window
   brightness is `1 − daylight(hour)`, a smooth cosine: **0 at noon, only 0.5 at 18:00, and it
   doesn't reach full strength until deep midnight.** So at the very hour people stream home
   from work (17:00–19:00), the lights are at half power or less; by the time the glow is
   strong, the sky is so dark the whole map is dim anyway.

2. **The default (Pixi) renderer doesn't watch people at all — it watches leases.**
   `PixiRenderer.draw()` lights a home's windows by *tenancy*: residents whose `homeId` names
   the home, divided by its capacity (`occupantsByHome` in `src/world/housing.ts`). This was a
   deliberate HP-era choice ("show occupancy at a glance"), but it means **a tenanted home glows
   all night even when everyone is out at the diner, and the glow never changes when someone
   physically walks in the door.** The "lights come on when people get home" moment the user is
   looking for *does not exist* in the default renderer.

3. **The two renderers disagree.** The legacy `CanvasRenderer` still uses the *old* rule:
   windows light by bodies physically standing at the building's road node
   (`occupantsAt(nodeId)`, capped at 3). So the fallback actually responds to presence, and the
   default doesn't — a quiet parity break against the R2 checklist line "window glow vs occupancy."

4. **The effect is genuinely subtle even when it fires.** Four 6-pixel golden squares on a
   26-pixel building, at alpha = `glow × (0.12 + 0.88 × fraction)` — and *every* building gets
   the 0.12 floor at night, so an empty house and a full house differ only in faint alpha. There
   is no off/on contrast to catch the eye.

### Diagnosis

Not a dead feature and not strictly a bug — **a designed effect whose driver doesn't match what
a viewer expects**, compounded by a too-gentle dusk curve and a too-low contrast range. Verdict:
*missing feature (presence-driven home lights) + too-subtle tuning + a renderer parity drift.*

### The concrete fix (one small slice, both renderers, read-only)

- **Drive home windows by who is actually home:** count residents with `r.homeId === loc.id`
  AND `r.move.atNodeId === loc.nodeId` AND an empty `move.path` (standing, not passing through).
  All fields already exist on `Resident`/`Movement` — zero sim change.
- **Light windows one-per-person, not by alpha:** the building already has a 2×2 window grid as
  separate rects (both renderers). Show `min(peopleHome, 4)` windows at full gold instead of
  fading all four together. One person home = one bright window; the family back = all four.
  This is the visible "click" moment the user wants.
- **Steepen the evening curve:** add a presentation-only `windowGlowSharp(hour)` in
  `daynight.ts` (e.g. smoothstep from 17:00 → full by ~19:30, holding until ~05:30). Pure
  function of the hour, unit-tested like its siblings.
- **Cut the empty-house floor** from 0.12 to ~0 for homes (keep a faint tenancy hint at most),
  so occupied vs empty reads as on vs off.
- **Apply identically in `CanvasRenderer`** so the fallback keeps parity (it's a ~10-line change
  there — it already counts bodies).

Real-world explanation for the doc/comment: *windows glow when the family is actually inside
after dark — exactly like driving through a neighborhood at 8pm and seeing who's home.*

---

## How to read the backlog

- **ID** R3-n, in priority order within each tier.
- **Effort** S = a slice of an evening, M = a full slice with tests, L = a multi-slice mini-phase.
- **Impact** 1–5: how much more *watchable* the city gets (the VISION-RENDER bar).
- **Tier** NOW (build next) / NEXT (after the NOW set proves out) / LATER / AMBITIOUS.
- **Data it reads** must already exist in the sim or be derivable read-only — listed per row.
- ⭐ = **easy win**: S effort with impact ≥ 3.

> **Build status (2026-06-09):** the suggested first slice has SHIPPED — ✅ R3-1 window-glow fix
> (both renderers, parity restored) · ✅ R3-2 two-lane roads + footpaths (both renderers) ·
> ✅ R3-3 cars vs walkers (Pixi; canvas keeps dots per the parity-where-cheap waiver) ·
> ✅ R3-4 per-kind silhouettes (civic trio + all seven seeded kinds + orchard) · ✅ R3-6
> posted-wage placards (Pixi) · ✅ **R3-44 corner lots** (user request, added post-doc: buildings
> sit BESIDE their intersection on one of four corner lots — co-located firms take different
> corners — each with a driveway stub to the kerb, and standing residents gather at the
> DOORSTEP of their destination instead of mid-crossing; both renderers; sim geometry untouched;
> follow-up: the kerb fallback moved to the corner pavement so nobody ever stands on asphalt).
>
> **Second wave shipped (2026-06-10, autonomous session):** ✅ R3-5 street lamps (dusk pools at
> every crossing) · ✅ R3-7 Zzz wisps over sleeping homes · ✅ R3-13 staffed-storefront doorway
> lights · ✅ R3-8 hover name tags · ✅ R3-9 wealth-tier rings (top fifth gold, bottom grey) ·
> ✅ R3-10 HUD 7-day trend arrows + the amber Gini alert · ✅ R3-11 trade-balance gauge ·
> ✅ R3-12 press status light · ✅ **R3-14 THE BOAT** (a sailing launches at the dock whenever
> trade flows — glide in, bob at the pier, glide out; still water when the port is dead) ·
> ✅ R3-26 arrival/departure puffs. All Pixi (the default renderer), pure presentation.
> Remaining NOW/NEXT highlights: R3-15 coin particles, R3-16 mint-press animation, R3-17
> walk/drive animation frames, R3-19 prosperity building growth, R3-22 cinematic disasters.

### Easy wins at a glance
⭐ R3-1 window-glow fix · ⭐ R3-2 two-lane roads + footpath · ⭐ R3-5 street lamps ·
⭐ R3-6 posted-wage signs · ⭐ R3-7 Zzz over sleeping homes · ⭐ R3-8 hover name labels ·
⭐ R3-9 wealth-tier dot rings · ⭐ R3-10 HUD trend arrows + Gini alert · ⭐ R3-11 trade-balance
gauge · ⭐ R3-12 press status light · ⭐ R3-13 open/closed door light · ⭐ R3-26 arrival puffs

---

## NOW — the next visible jump

| ID | Idea | What you'd see | Data it reads | Effort | Impact |
|---|---|---|---|---|---|
| ⭐ R3-1 | **Window glow fix** (the investigation above) | Houses light up window-by-window as each resident walks in the door after dark | `Resident.homeId`, `move.atNodeId`, `move.path`, `Location.capacity`, hour | S | 5 |
| ⭐ R3-2 | **Two-lane roads + footpath** | Each road becomes two asphalt lanes with a center dash, plus a lighter dashed walking trail running alongside | `world.roads`, node positions (geometry drawn once) | S | 4 |
| R3-3 | **Cars vs. walking people** | A resident *with* a vehicle renders as a tiny car driving on the right-hand lane of their direction of travel; one *without* renders as a small walking figure on the footpath | `Resident.hasVehicle`, `move.x/y`, `move.path[0]` (heading = vector to next node; right-side offset = perpendicular) | M | 5 |
| R3-4 | **Per-kind building silhouettes** | The port looks like a dock with a moored boat, the bank gets columns and a $ pediment, the City Reserve a mint with a press, the farm field rows, the mine a pithead, the factory a chimney, the bakery an awning, diners a sign | `Business.kind` (incl. the `port`/`bank`/`authority` kinds and the teal data-driven extras), `Location.type` | M | 5 |
| ⭐ R3-5 | **Street lamps** | Lamp posts at each intersection pop on at dusk with a small light pool, off at dawn — the town visibly "switches on" | node positions, hour (pure presentation) | S | 3 |
| ⭐ R3-6 | **Posted-wage signs (the wage war, visible)** | A small "$0.34/t" placard floats over a firm whenever its posted wage is bid above base — watch rival firms outbid each other for scarce labour in real time | `Business.wagePerTick` vs `baseWagePerTick` | S | 4 |
| ⭐ R3-7 | **Zzz over sleeping homes** | A faint drifting "z" wisp above a home when its occupants are asleep at night | `Resident.activity === "sleeping"` + presence at home node | S | 3 |
| ⭐ R3-8 | **Name labels on hover** | Mouse over any dot → the resident's name (and activity) in a tiny tag; no click needed | `Resident.name`, `activity`, pointer position through the existing camera inverse | S | 3 |
| ⭐ R3-9 | **Wealth-tier dot styling** | The richest residents get a thin gold ring, the broke a grey one — inequality readable on the street, matching the Gini card | `Resident.money` (percentiles computed per frame, read-only) | S | 3 |
| ⭐ R3-10 | **HUD trend arrows + Gini alert** | Each vitals card gets a ▲/▼ vs. 7 days ago; the Gini card turns amber when inequality is climbing fast | `macro.history()` (already polled) | S | 3 |
| ⭐ R3-11 | **Trade-balance gauge** | A small needle/bar on the HUD: exports vs imports per day, green when the city sells more than it buys | `MacroSample.exports` / `.imports` (already charted in boom) | S | 3 |
| ⭐ R3-12 | **Press status light** | A dot on the City Reserve card (and over its building): dark = idle, pulsing green = money being minted today | `MacroSample.minted`, `world.mintedTotal()` | S | 3 |
| ⭐ R3-13 | **Open/closed door light** | Storefronts show a warm doorway glow while staffed during opening hours; dark when nobody's working — distinct from bankruptcy boards | `Business.employeeIds`, residents' `activity === "working"` at the node, hour | S | 3 |

## NEXT — once the streets feel alive

| ID | Idea | What you'd see | Data it reads | Effort | Impact |
|---|---|---|---|---|---|
| R3-14 | **The boat (C4 made visible)** | A little cargo boat glides to the port dock when trade flows that day, sits while "loading", departs; busier trade = more sailings | `MacroSample.exports + imports` (boat frequency), `biz_port` existence; pairs with R3-4's dock | M | 5 |
| R3-15 | **Coin/cargo particles on trade** | Gold coin sparks drift port→firm on an export payment, crates drift firm-ward on an import — money visibly crossing the city line | `pnl.exportRevenue` / `pnl.importSpend` day-deltas per firm (poll, no new events needed) — *overlaps planned R4 (which adds the `transfer` bus event for the general case)* | M | 4 |
| R3-16 | **Mint press animation** | When the City Reserve mints, the building stamps — a press glyph thumps and fresh-coin sparkles helicopter outward to homes | `MacroSample.minted` (per-day delta), authority building position | M | 4 |
| R3-17 | **Heading-aware sprites + walk/drive animation** | Walkers bob with a 2-frame gait and face their direction; cars point along the road — movement stops being "sliding dots" | `move.path[0]` heading, wall-clock animation phase | M | 4 |
| R3-18 | **Congestion glow** | A road segment carrying many travellers at once brightens/warms — rush hour reads as rush hour | per-frame count of residents whose position lies on each segment (derived read-only) | M | 3 |
| R3-19 | **Prosperity-driven building size + decay** | A capital-rich firm's building grows a storey; a firm sliding toward insolvency shows cracks/dimming before the boards go up | `Business.capital` (R3 `prosperityT` already maps it), `insolventDays` | M | 4 |
| R3-20 | **Producer stock bars** | The R3 inventory bar (today only storefront `inventory`) extended to producers: a grain bar on the farm, materials at the mine — the whole supply chain's fullness at a glance | `Business.resources` per kind (`economyVisuals.fillFraction` reused) | S | 3 |
| R3-21 | **Eviction / move-out animation** | A resident changing homes walks out with a suitcase glyph; an eviction shows a red notice pinned to the door first | `Resident.homeId` change frame-over-frame, `rentMissedDays` | M | 3 |
| R3-22 | **Cinematic disasters** | Fire = flicker + smoke column on the target; festival = bunting + crowd glow; illness = pale pall; supply shock = storm clouds over producers | `events.latest()` kind + targetId (exact `disasterStruck` shape) — *this IS planned R6's first half* | M | 4 |
| R3-23 | **Festival decorations** | During a festival day the whole street gets string lights and confetti drift, not just a banner | same as R3-22 (festival kind) | S | 3 |
| R3-24 | **Weather as pure presentation** | Occasional rain streaks, drifting clouds, fog mornings — derived from a hash of the sim day so it replays identically, affecting *nothing* | day number (pure function — deterministic, never sim state) | M | 3 |
| R3-25 | **Story cards** | A card slides in for the moments worth noticing: first bankruptcy, a founding, a record GDP day, the press switching on — *planned R5* | `macro.history()`, decision logs, `population.events()`, `events.events()` | M | 4 |
| ⭐ R3-26 | **Arrival/departure puffs** | A tiny dust puff when a resident sets off or arrives — comings and goings stop being teleport-ish | `move.path` transitions frame-over-frame | S | 3 |
| R3-27 | **Live line charts (vitals upgrade)** | The sparkline cards grow into hoverable Bloomberg-style charts with axes and a shared day cursor — *planned R5* | `macro.history()` (nothing new) | M | 4 |
| R3-28 | **Construction scaffolding** | A new home rises with a scaffold + hammering dust over a few sim-hours after the landlord builds — *the `build` toast, upgraded* | `population.events()` kind `build` (seq log already polled for toasts) | M | 3 |

## LATER — texture and depth

| ID | Idea | What you'd see | Data it reads | Effort | Impact |
|---|---|---|---|---|---|
| R3-29 | **Lunch-rush queues** | Residents eating at a diner line up at the door instead of fanning in a ring — busy firms *look* busy | residents at node + `activity === "eating"` (extends `residentLayout.ts`) | M | 3 |
| R3-30 | **Wealth/utilization heatmap toggle** | A HUD toggle washes the map in a heat layer: where money pools, which firms run hot — *planned R4* | `Resident.money`, `market.capacityUtilizationFor` | M | 3 |
| R3-31 | **B2B delivery trucks** | Trucks run the actual supply chain: farm→bakery, mine→factory, factory→goods — *planned R4's centerpiece* | resource purchase flows (needs R4's `transfer` bus event, or per-day `resources` deltas) | L | 4 |
| R3-32 | **Mini-map + camera bookmarks** | A corner mini-map showing the viewport; click to jump; number keys bookmark spots | camera state + static world geometry | M | 3 |
| R3-33 | **Sound layer, muted by default** | Crickets at night, a cha-ching on sales, a thud on bankruptcy, gulls at the port — *planned R6's second half* | events/decision logs (presentation only) | L | 3 |
| R3-34 | **Seeded resident portraits** | Each resident gets a tiny deterministic pixel-face (hashed from their id) shown in the inspector and hover tag — *planned R7* | `Resident.id`, `name`, `age`, `origin` | M | 3 |
| R3-35 | **Family trees & lineage view** | Click a resident → see their parent, children, and inherited estate as a little tree | `Resident.parentId`, `age`, `origin` (all exist) | M | 3 |
| R3-36 | **Night sky + moon phases** | Stars at night; the moon badge waxes/wanes on a fixed day cycle — pure charm | day number, hour | S | 2 |
| R3-37 | **Luxury bling** | A resident's luxuries show: a brief sparkle on purchase, a tiny hat/flair tier on the dot | `Resident.luxuriesOwned` | S | 2 |
| R3-38 | **Brand halo** | High-brand storefronts get a subtle colored aura + a star rating on hover — capital glow's demand-side twin | `Business.brand` (vs `BRAND_BASELINE`) | S | 3 |

## AMBITIOUS — the showpieces

| ID | Idea | What you'd see | Data it reads | Effort | Impact |
|---|---|---|---|---|---|
| R3-39 | **Spectator auto-cam** | A "watch" mode that cuts between interesting moments (a wage war, a boat arrival, a bankruptcy) like a sports broadcast — *planned R7* | all existing logs + camera | L | 4 |
| R3-40 | **Brain-comparison split screen** | Same seed, rules vs Claude, side by side with divergences highlighted — *planned R7, leans on the experiment harness* | experiment harness (headless) + two render targets | L | 4 |
| R3-41 | **2.5D building faces** | Buildings get simple isometric depth — two visible faces + roofs — without any 3D engine | static geometry only | L | 3 |
| R3-42 | **"A day in the life" replay** | Pick a resident → a cinematic follow-cam replay of their last day with narration from their decision log | decision logs + positions (presentation re-run) | L | 3 |
| R3-43 | **Day scrubber + time-travel ghosts** | Scrub back through recent days; the map shows ghosted past positions — *extends planned R5's scrubber* | would need a render-side position ring buffer (read-only capture) | L | 3 |

---

## Suggested first slice (what I'd build first, and why)

1. **R3-1 — the window-glow fix.** It's the user's concrete report, it's small, it touches both
   renderers (parity restored), and "lights come on as each person gets home" is the single
   cheapest *life* signal in the whole backlog. Ship it first, alone, and verify at 19:00 sim
   time in the browser.
2. **R3-2 — two-lane roads + footpath.** Pure one-time geometry on `roadsGfx` (Pixi) and the
   road loop (canvas). Zero per-frame cost, and it's the stage R3-3 performs on.
3. **R3-3 — cars vs. walkers.** The biggest "it's a real town now" payoff: `hasVehicle` is
   sitting in the data unused by the eye, heading comes free from `move.path[0]`, and the
   right-hand-lane offset is one perpendicular vector. Pixi first; the canvas fallback can keep
   dots one slice longer (R2 set that precedent — parity where cheap, waiver where not).
4. **R3-4 — building silhouettes for the civic trio first** (port = dock + boat hull, bank,
   City Reserve), then the seven seeded kinds. The boom scenario is the live watch right now,
   and its three special buildings are where the C4 story happens — they should not be
   anonymous squares. Doing the port's dock here also pre-builds the stage for R3-14's boat.
5. **R3-6 — posted-wage signs.** One comparison (`wagePerTick > baseWagePerTick`) and a tiny
   placard, and suddenly the labour-market bidding war — the heart of INITIATIVE-01 — is
   visible on the map instead of buried in the ticker.

Each lands as its own flag-safe, verify-green slice (typecheck + test:run + build), browser-gated
per the kill-switch principle in PHASE-RENDER.md. None touches the sim; all of them read fields
that already exist today.
