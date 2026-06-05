# CityWithLifeClaude — Master Development Plan

> **Status update (2026-06-04):** Phases 0–8 of this plan **shipped as v1.0**. This document
> remains the standing **architecture & guiding-principles** reference, but it is no longer the
> active to-do list. For *what we build next*, the compass is **[NORTH-STAR.md](NORTH-STAR.md)**
> (post-v1 direction); routine progress lives in **[PHASE9-PLAYTEST.md](PHASE9-PLAYTEST.md)**.

**Version:** 1.0 (high-level)
**Date:** 2026-06-01
**Status:** Planning — no code written yet
**Purpose:** The single source of truth for building CityWithLifeClaude from scratch into the living, watchable, AI-driven city economy described in the project vision.

---

## 0. Key Decisions (locked for v1)

These three choices frame the entire plan:

1. **Build approach: pure from-scratch.** We design our own clean architecture. We do *not* port or copy the sibling `CityWithLifeGrok` codebase. We may glance at it the way you'd glance at any reference, but the structure, naming, and code are ours.
2. **AI brain: model-agnostic abstraction, default Claude.** Every "mind" in the city talks to a single `DecisionProvider` interface. Claude (Anthropic API) is the default implementation; Grok, a local model, or a pure rule-based brain can be swapped in without touching the simulation.
3. **Scope: MVP vertical slice first, then grow.** We get the thinnest possible *watchable, alive* city working end-to-end, then deepen each layer toward the full vision in phases.

---

## 1. Executive Vision

We are not building a city-builder game. We are building **a world you watch.**

In most city sims you are a god-mayor and the citizens are scenery. Here we invert that: the residents and the businesses are the ones making decisions, and the human is a naturalist with their face pressed to the glass. The city is a terrarium, **time is the weather, money is the bloodstream, disasters are the conflict, and the cast is a population of AI minds living an economy.**

The real product is **observable AI agency under pressure.** The genuinely interesting question the whole thing exists to answer: *when you give a simulated baker or a simulated single parent an actual mind, what do they do — and can a human watch them be clever, or dumb, in real time and understand why?*

Three properties make that real and are therefore non-negotiable:

- **Nothing on screen is theater.** Rendering may only ever *read* the simulation, never change it. Every car that moves, every light at dusk, every price that jumps in a crisis is the visible shadow of a real calculation underneath.
- **Every decision shows its work.** Any choice a mind makes — switch jobs, cut prices, sell the car, ask for a raise — carries a written, human-readable reason and an auditable trace. "Why did it do that?" is always answerable in one click.
- **It is a laboratory, not just a toy.** Seeded determinism + full serialization means an entire run can be reproduced exactly, so we can change one variable (brain on vs. off) and measure the difference.

**North star:** a city that feels *alive* even when you leave it running in the background, and rewards leaning in to inspect a single mind.

---

## 2. What a Human Watching Actually Enjoys (Product Pillars)

The plan must keep delivering against the *human-interest* experience, not just a working backend. These are the pillars we protect through every phase:

1. **People with visible inner lives.** Residents you can follow: they walk with purpose at rush hour, carry tools to work and grocery bags home, trudge wearily when unemployed; color shows what they're doing (working, eating, sleeping, socializing).
2. **The city breathing.** Daily rush-hour commute waves, directional traffic surges at peak hours, congestion blooming at junctions, windows lighting at night, buildings tinting by occupancy — the whole organism inhaling and exhaling on a daily rhythm.
3. **Money you can see moving.** Gold trade pulses, rent coins floating off homes on payday, profit and staff counts hovering over workplaces. The economy is *visible*, not just charted.
4. **AI made legible.** A badge marks a business or resident run by a real model vs. a heuristic; persistent "spark" dots trail each mind to show recent decisions, so across a long run you literally watch one agent's strategy vary under stress.
5. **Emergent stories you didn't script.** A blackout hits; a marginal shop with 4 days of runway slashes prices to survive; a resident who just lost income re-homes to cheaper rent and the payroll curve bends — and you can click in and read the AI's stated reason for every move.
6. **Two ways to watch.** Real-time 1:1 mode to follow a single commute at human pace; fast modes (100x–1000x) to compress months of history into a coffee break.

If a phase ships and the city is *less* watchable or *less* legible than before, the phase is not done.

---

## 3. Definition of Success

The project (and each phase) is succeeding when:

- The **simulation core is correct and observable before visuals are added.**
- Every major system has **automated tests** (unit + invariant) plus a documented **manual verification protocol** (what a human should watch for).
- The sim can run for **simulated weeks/months** without breaking or producing nonsensical economics.
- We can always answer **"why did X happen?"** quickly, for any entity.
- A run is **reproducible** from a seed (with LLM non-determinism cleanly isolated and recordable).
- Adding a major feature (housing, weather, government) does **not require rewriting core systems.**
- The agentic minds produce **genuinely interesting, sometimes surprising** behavior a human can follow.

---

## 4. Guiding Principles (Non-Negotiable)

1. **Simulation core is sacred.** Core logic is fully decoupled from rendering and UI, and is unit-testable headless.
2. **Time is the fundamental primitive.** Everything happens *in time*; one clock drives every system.
3. **Many small systems, not one monolith.** TimeSystem, MovementSystem, EconomySystem, EventSystem, etc.
4. **Observability first.** If we can't easily inspect what an entity is doing, the feature isn't finished.
5. **Serializable by default.** All important state is part of one snapshot from day one.
6. **Deterministic by default.** Seeded RNG; identical seed → identical run. LLM calls are the *only* sanctioned source of non-determinism and are isolated + recordable.
7. **Model-agnostic minds.** All decisions flow through one provider interface; the simulation never knows or cares which model (or rule set) is behind it.
8. **Build in layers, not features.** Thinnest vertical slice first, then deepen.
9. **Embrace emergence.** Create the *conditions* for interesting behavior; don't script outcomes.
10. **Safety rails on every mind.** Decisions are clamped to safe ranges; a slow or broken model degrades gracefully to rules and never crashes or destabilizes the city.

---

## 5. Technology Stack (Recommendation)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript (strict)** | Complex interdependent state (time, economy, movement, decisions) is unmanageable without types past ~2k lines. |
| Build/dev | **Vite** | Fast dev server + HMR + simple production build. |
| Rendering | **HTML5 Canvas 2D** | Full control over the "breathing city" visuals; performant for hundreds of agents; no heavy engine. Abstraction layer so we *could* move to WebGL/PixiJS later if needed. |
| Tests | **Vitest** | Fast, TS-native; ideal for unit + invariant + long-run tests. |
| UI / God Mode | **Vanilla DOM** (lightweight) initially | Keep complexity in the sim, not the framework. Revisit a thin React layer only if tooling UI grows large. |
| AI brains | **`DecisionProvider` interface** + `ClaudeDecisionProvider` (Anthropic SDK), `MockProvider`, `RuleBasedProvider` | Model-agnostic seam; Claude default; mockable for tests; rule-based control for A/B. |
| Persistence | **JSON snapshot** of the single simulation state object | One source of truth; trivial save/load + experiment reproducibility. |

This is a recommendation, not a religion — but it directly serves the vision (watchable in a browser, deeply testable, reproducible) and avoids premature heaviness. We change it only with explicit reason.

---

## 6. High-Level Architecture

Four layers, with a strict one-way dependency rule: **outer layers may read the core; nothing may write the core except the core's own systems.**

```
┌──────────────────────────────────────────────────────────────┐
│  UI / GOD MODE LAYER                                           │
│  dashboards · inspectors · God Mode controls · experiment rig  │
│  (reads snapshots, issues *intents* to the core)               │
├──────────────────────────────────────────────────────────────┤
│  RENDERING LAYER  (READ-ONLY)                                  │
│  CityRenderer: roads, buildings, agents, vehicles, money fx    │
│  (decoupled from sim rate; never mutates state)                │
├──────────────────────────────────────────────────────────────┤
│  SIMULATION CORE  (headless, deterministic, testable)          │
│                                                                │
│   Simulation  ── owns state + the tick loop                    │
│     ├─ TimeSystem        (ticks→min→hr→day; speeds; real-time) │
│     ├─ MovementSystem    (agents travel the road graph)        │
│     ├─ TrafficSystem     (lights, congestion, vehicles)        │
│     ├─ ResidentsSystem   (needs, schedules, life decisions)    │
│     ├─ BusinessSystem     (P&L, production, hiring, pricing)    │
│     ├─ EconomySystem      (markets, prices, money conservation) │
│     ├─ HousingSystem      (rent, eviction, re-homing)           │
│     └─ EventSystem        (disasters / drama injection)         │
│                                                                │
│   Entities: Resident · Business · Location · Vehicle · Road    │
│   Utilities: SeededRNG · EventBus · Serializer · Logger        │
├──────────────────────────────────────────────────────────────┤
│  BRAIN SEAM  (the model-agnostic boundary)                     │
│   DecisionProvider interface                                   │
│     ├─ RuleBasedProvider   (deterministic control)             │
│     ├─ ClaudeDecisionProvider (Anthropic API, default)         │
│     ├─ MockProvider        (tests / replay)                    │
│     └─ (future: Grok, local model, …)                          │
└──────────────────────────────────────────────────────────────┘
```

### The brain seam (most important design contract)

Every mind — resident or business — makes decisions through one narrow, auditable contract:

```
DecisionProvider.decide(context)  →  { actions[], reason, meta }
```

- **`context`** is a compact, serializable snapshot of exactly what the mind is allowed to know (its own finances/needs, local market, active disasters). No hidden global access.
- **`actions`** are a *closed, clamped* set of levers (e.g. business: adjust price / hire / produce; resident: switch job / re-home / buy food / buy-sell vehicle / negotiate raise). The core validates and clamps every action so no single decision can destabilize the city.
- **`reason`** is a required human-readable string. Every decision is logged with its full context, output, reason, model identity, latency, and timestamp.
- **Graceful degradation:** a timeout, error, or malformed response falls back to the `RuleBasedProvider` automatically. The city never stalls on a slow model.
- **Determinism boundary:** rule-based runs are fully reproducible. Model-driven runs record every request/response so a run can be *replayed* deterministically from the log.

This one seam is what makes the project both model-agnostic and a real laboratory.

---

## 7. The MVP Vertical Slice (v1 target)

The first version we are proud to open and watch. Deliberately tiny, but **alive end-to-end.**

**World:** a small map — a handful of homes and 2–3 workplaces connected by a minimal road network.

**People:** ~10–20 residents, each with money, an hourly wage, a home (paying rent), a job (earning a wage), a daily schedule, and three needs (hunger, fatigue, social) that can hijack the schedule.

**Businesses:** 2–3 enterprises with cash, inventory, a simple P&L, that produce goods, sell them, and pay wages.

**Movement:** residents actually commute home↔work along roads over real minutes.

**Closed economy:** wages → residents → rent + food → business revenue → wages. Money is conserved and visibly circulates.

**Rendering:** minimal Canvas — roads, buildings, moving dots colored by activity, plus a clock/speed HUD. Real-time 1:1 mode so you can follow one commute at human pace.

**Inspection:** click any resident or business and read its current state.

**Definition of Done:** open it, press play, watch residents commute and money circulate; run 30 simulated days with no breakage, no stuck agents, correct wage/rent flows; save → reload → resume identically. **This is the "it's alive" moment.** No LLM yet — brains are rule-based here; the *seam* exists but Claude is wired in the next phase.

---

## 8. Phased Roadmap

Each phase: a clear goal, scope, and Definition of Done (DoD). Build the slice (Phases 0–1), then deepen (2+). Phases after the MVP can be reordered based on what's most exciting to watch next.

### Phase 0 — Foundation & Skeleton
**Goal:** a professional, deterministic, testable core that runs headless.
**Scope:** Vite + TS strict + Vitest setup · `Simulation` + tick loop · `TimeSystem` (ticks→minutes→hours→days; 1x/10x/100x/1000x + pause + real-time 1:1) · seeded RNG · EventBus · snapshot/serialization scaffolding · headless run harness.
**DoD:** run 10,000 ticks deterministically with no errors; identical seed → identical state; save/load round-trips; tests green.

### Phase 1 — The Watchable Vertical Slice (MVP)  ⟵ *first "alive" release*
**Goal:** ship Section 7 in full.
**Scope:** small world + roads · residents with needs/schedule/wage/home/job · 2–3 businesses with P&L · commuting movement · closed money loop · minimal Canvas + HUD · real-time mode · basic inspector.
**DoD:** the Section 7 DoD. A human can watch the city live and money circulate for 30 sim-days.

### Phase 2 — Brains & the Decision Provider (model-agnostic)
**Goal:** make businesses *think*, behind the model-agnostic seam.
**Scope:** define `DecisionProvider` contract · `RuleBasedProvider` (deterministic control, 3 clamped levers: price/hire/produce) · `ClaudeDecisionProvider` (Anthropic SDK) + `MockProvider` · timeout + graceful fallback · decision logging/explainability from day one · per-business agentic toggle · A/B seam (same seed, brain on vs. off) · cost + latency tracking.
**DoD:** a business runs on Claude with a full decision trace and clamped, sane behavior; failures fall back to rules invisibly; rule-based control reproduces Phase 1 behavior exactly; an A/B pair runs on one seed.

### Phase 3 — Agentic Residents
**Goal:** give residents real economic agency — "run one of the people directly."
**Scope:** resident decision levers (switch job, re-home for cheaper rent, buy food, buy/sell vehicle, negotiate raise) — all clamped, logged, reasoned · vehicles affect movement speed + job reach · hand a single citizen to Claude.
**DoD:** a Claude-driven resident lives a coherent life with an auditable "why" for every choice; rule-based residents behave exactly as before (the intelligence is isolated).

### Phase 4 — Economy Depth & Markets
**Goal:** an economy with real macro behavior and stakes.
**Scope:** ~7 business archetypes with distinct economics · resource price book · central market + peer-to-peer trade · GDP / payroll / rent macro vitals · housing/rent market with eviction + re-homing · businesses that can actually fail.
**DoD:** runs 100+ sim-days stable (no runaway inflation/deflation, no dead economy); economic invariants hold; macro curves are sensible and chartable.

### Phase 5 — The Breathing City (rich rendering)
**Goal:** deliver the watchable experience in full (Product Pillars 1–4).
**Scope:** expressive resident animation (arm-swing, tools/grocery bags, weary unemployed, activity colors) · districts + labeled zones · major vs. local roads · lit windows at night · rush-hour commute waves + congestion · distinct vehicles (car/van/bus) with brake-glow · money visuals (trade pulses, rent coins, profit/staff overlays) · brain badges + decision sparks · rendering decoupled so it stays smooth at 1000x.
**DoD:** the city visibly "breathes"; the legend matches what's on screen; performance target met.

### Phase 6 — Disasters / Drama Layer
**Goal:** the conflict that reveals smart vs. dumb minds.
**Scope:** EventSystem with blackout, port strike, interest-rate shock, cyber attack, labor strike, tariff shock + softer events (festival, job fair, infrastructure grant) · effects that hit exactly the levers minds care about · compounding/stacking shocks.
**DoD:** triggering a disaster produces visibly different, logged behavior from the minds; compound crises work and stay stable.

### Phase 7 — God Mode & Experiment Harness
**Goal:** turn watching into experimenting; make it a laboratory.
**Scope:** God Mode panel (spawn residents, inject cash, trigger any disaster at intensity, one-click compound "magic slices") · deepened inspectors (full decision logs per entity) · reproducible long-run rig (30/60/90/120 days) · A/B brain-on-vs-off on identical seeds · structured report (decision variety under stress, housing robustness, event reactivity) · export deltas · LLM-response replay.
**DoD:** run a reproducible A/B experiment and export a report that proves or disproves the brain's value.

### Phase 8 — Hardening, Persistence, Polish → v1.0
**Goal:** a solid, documented, long-term platform.
**Scope:** robust mid-simulation save/load · performance profiling pass · LLM cost dashboard + budgets · documentation (architecture + how to run experiments) · final QC long-runs.
**DoD:** a documented, stable v1.0 anyone can pick up and understand in under 30 minutes.

---

## 9. Cross-Cutting Concerns

- **Determinism & reproducibility.** One seeded RNG threaded through all systems. The only non-determinism is the LLM; isolate it behind the provider and record every request/response so any run replays exactly. Rule-based runs are bit-for-bit reproducible.
- **Serialization.** The entire world is one `SimulationSnapshot`. Save/load and experiment reproducibility fall out of this for free. Design it in Phase 0; never bolt it on.
- **Observability.** Decision logs, per-entity inspectors, and "why" traces are first-class from Phase 2 onward — not a Phase 8 afterthought.
- **Performance targets.** 1000x smooth on a modern laptop (rendering must never throttle the sim — decouple render rate from tick rate); 200+ agents + 50+ vehicles comfortable at 60–100x.
- **LLM cost & safety.** Clamp every action; timeout + fallback always; track tokens/latency/cost from the first Claude call; cache where sane; keep decision scopes narrow. A model should never be able to crash, stall, or economically detonate the city.
- **Testing discipline.** Unit tests for pure logic; invariant tests (e.g. "total money changes only in defined ways"); long-run tests (100+ sim-days, assert no number explosions/contradictions); documented manual verification per phase.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Simulation complexity explodes | High | Very High | Strict layering; ruthless per-phase scope control; this document as the gate. |
| Agentic minds behave boringly or destructively | Medium | High | Start narrow + clamped; heavy logging/eval; easy per-entity disable; rule-based control for comparison. |
| Performance unacceptable at scale | Medium | High | Profile early; keep core lean; decouple render from tick. |
| LLM cost prohibitive | Medium | Medium | Narrow scopes; caching; cost tracking from day one; rule-based + local model fallbacks. |
| Non-determinism breaks reproducibility | Medium | High | Isolate LLM behind the seam; record/replay responses; keep rule-based runs pure. |
| Scope creep ("just one more feature") | Very High | High | MVP-slice-first; phase DoDs; revisit this plan at each phase boundary. |
| Building a backend nobody enjoys watching | Medium | High | Protect the Product Pillars (Section 2) as acceptance criteria every phase. |

---

## 11. Milestones

- **M0 — End of Phase 0:** professional, deterministic, testable foundation exists.
- **M1 — End of Phase 1:** the city is *alive* — watchable commutes + circulating money (MVP).
- **M2 — End of Phase 2:** first thinking business behind the model-agnostic seam, with full decision traces.
- **M3 — End of Phase 5:** the city genuinely *breathes* — impressive to watch.
- **M4 — End of Phase 7:** a working laboratory — reproducible A/B experiments proving the brain's value.
- **v1.0 — End of Phase 8:** solid, documented platform ready to expand.

---

## 12. Immediate Next Actions

1. **Review this plan** and adjust scope/ordering where desired (especially the MVP slice contents and the post-MVP phase order).
2. **Confirm the tech stack** (Section 5) or flag changes.
3. **Lock the `DecisionProvider` contract** at a sketch level (Section 6) — it's the load-bearing interface.
4. **Begin Phase 0:** scaffold the Vite + TS + Vitest project and the `Simulation` + `TimeSystem` core with tests.

---

## 13. Open Questions / Deferred Decisions

- **Anthropic API access:** key management, rate limits, and whether early development runs mostly on `MockProvider`/`RuleBasedProvider` to control cost.
- **Map representation:** named locations vs. tile grid vs. zone graph (decide during Phase 1 — start as simple as possible).
- **UI framework escalation:** when, if ever, the God Mode tooling justifies a thin React layer (revisit at Phase 7).
- **Persistence target:** local JSON files only, or browser storage / a small backend for long unattended runs.
- **Multiple concurrent agentic minds:** how many real-model agents can run at once within cost/latency budgets (informs Phase 2/3 defaults).

---

*This is a living document. We update it whenever we learn something important. We are not in a rush — we are building something that deserves care.*

*Document owned by the CityWithLifeClaude project.*
