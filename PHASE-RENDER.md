# PHASE-RENDER — The Visualization 10× Plan

> Companion to [VISION-RENDER.md](VISION-RENDER.md). The build plan for turning the city from a
> "dashboard with a map" into an immersive, watchable AI economy. Phased in the project's
> 12a/12b/12c cadence: small slices, each verify-green + committed, each ending with a
> **browser gate** — concrete things the user must *see working* before the next slice starts.

## Non-negotiables (inherited from CLAUDE.md — apply to every slice)
- **Rendering only reads.** The view layer never mutates `World` / sim state. New *events* may
  be emitted by systems, but the renderer only *subscribes*.
- **Determinism is sacred.** No `Math.random` / wall-clock in sim state. Animation may use
  `requestAnimationFrame` time — that's *presentation only* and must never feed back into the
  simulation. Same seed → same world, frame-rate independent.
- **Don't throttle the sim.** Stepping is delta-based (`sim.advanceRealTime(Δ)`), so a heavy
  renderer can only drop FPS, never slow sim-*time*. Keep per-frame render cost bounded; if it
  ever gets heavy, decouple render from a fixed sim step.
- **Tests stay green**, especially the 365-day soak + save/reload parity (both headless — no
  renderer — so the bar is "don't change the sim").
- **Verify before every commit:** `npm run typecheck && npm run test:run && npm run build`.

---

## The three foundational decisions (asked of "Phase 1", decided now for the whole plan)

### 1. Renderer tech: **stay on raw 2D canvas for Phase 1; port to Pixi.js as the Phase-2 foundation; reject Three.js.**

The honest tradeoff (the user values watchability over fidelity, but only *marginally*):

| Option | Watchability ceiling | Cost / risk for a solo dev | Verdict |
|---|---|---|---|
| **Raw 2D canvas (today)** | Medium — fine for shapes, glow, a few particles; hand-rolling a scene graph + many sprites gets painful | None (already here) | **Keep for Phase 1** (the narrative overlay needs no engine change) |
| **Pixi.js (WebGL 2D/2.5D)** | High — retained scene graph, thousands of sprites + particles + filters at 60fps, easy camera | Moderate — one dependency, a parity port; *no* asset pipeline required (can stay procedural) | **Adopt as the foundation (Phase 2)** |
| **Three.js (true 3D)** | Highest fidelity | High — 3D scene/camera/lighting, real asset pipeline, the watchability gain over good 2.5D is marginal | **Reject** (the explicit out-of-scope) |

Reasoning: the *moat* (decision narrative) is mostly DOM/canvas overlay and is **engine-agnostic**
— it survives a Pixi port for free (both engines can hand a DOM overlay an entity's screen
position). So we ship the moat first on canvas (Phase 1, zero risk), then port to Pixi exactly
when the *visual* phases (sprites, vehicles, particle flows, crowds) start needing WebGL's
headroom. This avoids the worst outcome the user named — a half-finished engine that ships no
watchable value — while still committing to the right long-term foundation. **A reviewer who
prefers engine-first can swap the order (do Phase 2 before Phase 1); the slices are independent.**

### 2. Asset strategy: **procedural first, AI-generated sprites optional later. Sound: AI-generated/royalty-free SFX, muted by default.**
- **Visuals:** start **procedural** (Pixi `Graphics` / shapes — crisp, deterministic, zero asset
  management, fits the clean-build ethos). Buildings, people, and vehicles can all be stylized
  vector shapes that already look far better than flat squares. *Optionally* drop in an
  AI-generated sprite sheet (buildings/people/vehicles) in a later polish slice if we want more
  texture — but never block a phase on art. Avoid hand-drawn (too slow for one dev).
- **Sound:** a tiny set of AI-generated or royalty-free SFX (day ambience, night crickets, a
  sale "cha-ching," a bankruptcy thud, festival music) + ambient music that shifts with
  GDP/time-of-day. **Default muted**, single HUD toggle. Sound is a late, optional phase.

### 3. Event-bus shape: **extend the existing `sim.bus` (`EventBus<SimulationEvents>`) with read-only domain events; the visual layer only subscribes.**
The bus already exists and is tested — it emits `tick` / `hourElapsed` / `dayRolled`. We grow
its vocabulary *as phases need it* (not all at once):

```
interface SimulationEvents {
  tick: { totalTicks: number };               // exists
  hourElapsed: TimeSnapshot;                   // exists
  dayRolled: { day: number };                  // exists
  // added when the phase that needs it lands:
  decisionApplied: { day; kind: 'business'|'resident'; id; action; reason };  // narrative (R-later; R1 can poll)
  transfer: { from; to; amount };              // coin particles / lane intensity (R4)
  sale:     { businessId; units; revenue };    // cha-ching + story cards (R5)
  disasterStruck: { kind; headline; targetId };// cinematic disasters (R6; EventSystem already logs these)
}
```
Rules that keep this clean + safe:
- **Emitting is additive and deterministic** — systems fire events in their existing fixed run
  order; emitting changes *no* state, so determinism is untouched.
- **Zero headless cost** — `emit()` early-returns when there are no listeners, so tests/soaks
  (no renderer) pay nothing.
- **`World.transfer` emitting `transfer`** needs `World` to hold a bus reference — a small,
  isolated plumbing change, deferred to R4 (the first phase that needs it). Until then the
  renderer **polls** the existing logs (`agent.decisions()`, `macro.history()`, `events.events()`)
  exactly as `main.ts` already does — so **Phase 1 adds no events at all.**

---

## The phased plan

Each phase is independently shippable and ends with a **GATE** (what the user must see in the
browser before moving on). Phases 1–2 are specced here; 3–7 are scoped at direction level and
get a detailed slice breakdown at their boundary (house convention).

### R1 — Decision narrative MVP *(the moat; canvas; no engine or sim change)* ← recommended start
The unique value, shipped first, at zero risk. Pure read-only overlay over today's renderer.
- **Thought bubbles:** when a business's brain decides, a callout pops over its building showing
  the lever(s) (`price→$x`, `+1 hire`, `invest $y`, `brand $z`, `payout 0.5`) and a one-line
  `reason`, fading after a few seconds.
- **City decision ticker:** a live scrolling strip of recent decisions across the whole city
  (businesses + residents), each with its reason — the "news feed" of the AI economy.
- **Click → "why now?":** selecting an entity adds, to the inspector, its *latest decision* + the
  **observation values that triggered it** (cash, utilization, rival price, day-profit…) so the
  reason is backed by the numbers the mind actually saw.
- Reads `agent.decisions()` / `residentAgent.decisions()` (already polled in `renderFrame`).
- **GATE:** in the browser — (a) pause and a firm shows a thought bubble with its real reason;
  (b) the ticker narrates decisions live as days roll; (c) click a firm → "why now?" shows the
  reason + the triggering numbers. `typecheck + test:run + build` green; determinism + soak
  untouched (no sim change).

### R2 — Rendering foundation: port to Pixi.js + camera *(parity-first, gated)*
Replace the raw-canvas draw with a Pixi scene graph **at feature parity** (roads, buildings,
residents, day/night tint, window glow, disaster marker, selection, picking) behind the same
read-only contract — then add **pan/zoom (drag + scroll) and follow-cam** on the selected
entity. Keep the old `CanvasRenderer` available behind a swap until parity is signed off. The
R1 narrative overlay rides on top unchanged (it only needs an entity→screen-position function,
which Pixi provides).
- **GATE:** the city renders in Pixi at visual parity with R1; pan/zoom/follow works; FPS ≥ the
  old renderer; the 1000-day soak + save/reload are byte-identical (sim untouched); tests green.

### R3 — Buildings & people come alive *(visual economic state; sprites)*
Procedural sprites replacing squares/dots: buildings whose **size/glow scales with capital
stock**, a **warehouse fill bar for inventory**, **visible little worker figures** for staff
count, mournful shuttered buildings; residents as small walking figures colored by activity with
smooth interpolation between ticks.
- **GATE:** at a glance you can tell a thriving firm (big, glowing, stocked, staffed) from a
  struggling one; workers visibly populate buildings; a bankruptcy visibly empties one.

### R4 — Economic flow *(vehicles + money particles; first new bus event)*
Add the `transfer` event to `sim.bus` (the isolated `World` plumbing change). Render
**coin/particle bursts along roads when `World.transfer` fires**, **lane intensity = traffic**,
and **vehicles on the actual road graph** — delivery trucks for B2B resource flows, cars/taxis
for resident commutes (driven by existing `VEHICLE_SPEED_MULT` / `hasVehicle`; *render* them, no
sim change). Optional wealth/profit/utilization **heatmap overlays** (toggle).
- **GATE:** you can watch money move (a sale sparks a coin trail), trucks run the supply chain,
  commuters drive to work; a heatmap toggle reveals where wealth/capacity concentrate. Soak +
  determinism untouched (events are read-only, emit is no-op headless).

### R5 — Time, dashboards & story *(player agency + memory)*
A visible **day scrubber + playback speed + pause + reset-to-seed**; the text vitals upgraded
into **Bloomberg-style live line charts** (GDP, money, prices, wages, capital, brand) read
straight from `MacroSystem` (no duplication); **story cards** for moments — first sale of the
day, a bankruptcy, a festival, a brand campaign launch.
- **GATE:** the user can scrub/pause/speed/reset the day, read the economy from live charts, and
  story cards surface the moments worth noticing.

### R6 — Cinematic atmosphere *(disasters + sound)*
Cinematic disasters (fire glow + smoke, supply-shock storm, festival crowd glow, illness pall)
keyed off the `disasterStruck` event; the **muted-by-default sound layer** (ambience that shifts
with time/GDP, sale cha-ching, bankruptcy thud, festival music) with a HUD toggle.
- **GATE:** a disaster is unmistakable and atmospheric; toggling sound on makes the city audibly
  alive; default-muted so nothing is forced.

### R7 — Showpieces *(optional / advanced)*
The flashy extras once the core is great: **brain-comparison split-screen** (same seed, rules vs
Claude, two cameras, divergence highlighted — leans on the existing experiment harness),
**spectator "auto-cam"** that cuts between interesting moments, **richer resident profiles**
(seeded faces/names, job history, relationships).
- **GATE:** each showpiece is independently demoable; none is required for a great everyday watch.

---

## Phase-1 technical spec (prototype level — the recommended start)

**Goal:** ship the decision-narrative moat on the existing canvas, pure read-only, no sim/engine
change. Everything below reads data `main.ts` already polls.

### File-by-file
- **`src/render/DecisionNarration.ts`** *(NEW)* — the read-only narrative model. Pure logic, no
  world mutation, unit-testable:
  - `formatDecision(entry)` → a compact lever summary + reason (the lever-formatting logic
    currently inlined in `main.ts renderTrace` moves here and is shared by bubbles + ticker).
  - `activeBubbles(decisions, now)` → the set of recent decisions still within their display
    window, keyed by `(id, day)` so each decision bubbles once. TTL is wall-clock
    (presentation-only — never touches sim state).
  - `tickerFeed(businessDecisions, residentDecisions, n)` → the merged, newest-first feed.
  - `whyNow(pick, world, market, decisions)` → for the selected entity: its latest decision +
    the key observation values behind it (cash, utilization, rival/reference price, day-profit,
    understaffed…), pulled from `world` + `market` (the same numbers the mind saw).
- **`src/render/CanvasRenderer.ts`** *(EDIT)* — add one overlay pass `drawThoughtBubbles(bubbles,
  posFor)` (rounded callouts above a building, drawn last so they sit on top) and expose a public
  `screenPosOf(pick): {x,y}` (reuse `buildingSlot` / resident `move`). Still strictly read-only.
- **`src/main.ts`** *(EDIT)* — construct the narration model; add a DOM **ticker strip** to the
  HUD and a **"why now?"** block to the inspector; in `renderFrame()` compute bubbles from
  `agent.decisions()` + `residentAgent.decisions()` and pass them to `renderer.draw(...)`; add a
  HUD **toggle** for bubbles/ticker (default on).
- **`index.html` / `src/style.css`** *(EDIT)* — styles for the ticker strip + "why now?" block
  (bubbles are canvas-drawn, so no DOM needed for them).
- **`src/render/DecisionNarration.test.ts`** *(NEW)* — unit tests for the pure narration logic:
  given seeded decision logs, asserts the right bubbles/ticker/trace, that each decision bubbles
  once, that it never mutates the world, and that it's deterministic.

### Why this is safe
No new sim events, no `World` changes, no engine swap. The simulation, determinism, conservation,
save/reload, and the 365-day soak are untouched by construction (the renderer and a pure,
read-only narration module are the only things that change). The narration module is engine-
agnostic, so it carries forward unchanged when R2 ports the scene to Pixi.

---

## The kill-switch principle (every phase)
Before starting phase **N+1**, the user must **see, in the browser**, the phase-N GATE items
working — and judge that watchability genuinely improved. If a phase turned into invisible
plumbing with no watchable payoff, stop and re-scope rather than pressing on. This is what keeps
the visual upgrade from quietly bloating the project: **every phase must earn its place on
screen.**
