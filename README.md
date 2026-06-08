# CityWithLifeClaude

A small, watchable city economy that **runs, lives, and grows** by itself. It starts
as twelve residents and seven businesses — they wake, commute, work, eat, and
socialize; firms buy inputs, produce goods, set prices, hire, invest, and compete —
and from there the town comes alive: **people move in, families have children,
children grow up and take jobs, residents age and die leaving inheritances, the
landlord builds new homes, and rents float with scarcity.** You watch it breathe on a
WebGL canvas — and, if you like, hand the businesses' and residents' strategic
decisions to Claude and see how the economy diverges from the deterministic baseline.

It is built from scratch in TypeScript: no game engine, no UI framework, one
seeded RNG, and a strict tick loop. Same seed in, same city out — every time.

---

## Current state — a living, growing city (finished for now)

Since v1.0 the city stopped being a fixed tableau and became a **living, growing,
self-sustaining economy.** What's in it now:

- **A real firm economy.** Businesses pull genuine strategic levers — `setPrice`,
  `hire`, `invest` (buy capital → more output), `setWage` (compete for staff),
  `setPayout` (retain vs. distribute), `brand` (marketing → demand) — are *born* into
  empty niches and go *bankrupt*, and their **owners earn their firm's dividend**.
- **A living population** (the Housing & Population track — see
  `PHASE-HOUSING-POPULATION.md`). The town grows over time: newcomers arrive and
  families have children; children **come of age** and join the labour market;
  residents age and **die**, their estates **inherited** (money conserved); the
  **landlord builds new homes** (HP4) when the town fills; and **rent floats with
  housing scarcity** (HP2). It grows ~12 → ~25 and self-limits at a wealth-supported
  size. Every working-age resident is its own agent.
- **A watchable city** (Pixi.js v8 default renderer, Canvas fallback via
  `?renderer=canvas`): a decision ticker + thought bubbles, a live **demography HUD**
  + population sparkline, a **"town life" feed** (births / arrivals / coming-of-age /
  new homes / partings), **lit windows** showing home occupancy, **map toasts** that
  pop at the home where each life event happens, and **life-stage resident dots**.
- **An emergent citizen's dividend (a UBI).** Each day every firm's surplus above its
  working-capital reserve is split — ~10% to the owner, the rest **equally to every
  resident** (the closed economy's demand pump). In practice ~$50/resident/day, paid
  to *everyone regardless of work* — ~35% of a worker's income and **100% of a
  non-worker's** (children, the jobless, and the elderly never go broke). It wasn't
  designed in; it **emerged** from keeping a closed-money loop circulating, and it's a
  defining feature of the economy. Full analysis + a cradle-to-grave life trace are in
  `LIFE-TRACE.md`.

Everything stays **money-conserved to the cent and deterministic from seed + snapshot**
across the entire living cycle (≈378 tests, multi-year soaks on seeds 1 & 7). Forward
detail lives in the `PHASE*.md` docs + `LIFE-TRACE.md` + the git log.

---

## Quick start

```bash
npm install
npm run dev        # open the printed localhost URL and watch the city
```

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Vite dev server + HMR — the live, interactive city        |
| `npm run test:run`   | Run the whole test suite once (use this in CI / one-shot) |
| `npm test`           | Vitest in watch mode (re-runs on change)                  |
| `npm run typecheck`  | `tsc --noEmit` — strict type check, no output             |
| `npm run build`      | Type-check the build config, then bundle with Vite        |
| `npm run preview`    | Serve the production build locally                        |

Requires Node 18+ (project is ESM, `"type": "module"`).

---

## Core ideas

**Determinism.** The simulation is driven by a single seeded RNG
(`mulberry32`, in `src/utils/rng.ts`). Given the same seed and options, a run is
bit-for-bit reproducible — that is what makes save/load, A/B experiments, and the
tests possible. The **only** sanctioned source of non-determinism is a networked
LLM provider, and it lives entirely behind the decision seam (below).

**Time.** One tick is one sim-minute; `TICKS_PER_DAY = 1440`. Systems that act
"once a day" do so on the day's first tick. The live loop converts real elapsed
time into owed ticks at the current speed; headless runs just call `sim.run(n)`.

**A closed economy.** Money is never minted or burned — it only moves, via
`World.transfer(fromId, toId, amount)` (which caps at the payer's balance and
returns what actually moved). `World.totalMoney()` is invariant across the entire
simulation, including disasters and God Mode. Many tests assert exactly this.

---

## Architecture

The orchestrator (`src/core/Simulation.ts`) owns the shared services — time, RNG,
event bus — holds an ordered list of **systems**, and on every `step()` advances
time and calls each system's `update(ctx)` in registration order. A system is a
focused unit of logic with an optional `serialize()`/`restore()` for snapshots.

`src/createCity.ts` assembles a city and wires the systems in this order:

```
WorldSystem        → carries the shared World into the snapshot
EventSystem        → (optional) disasters strike at the start of the day
BrainSystem        → minute-to-minute resident behavior (needs-driven)
MovementSystem     → walk residents along the road graph
EconomySystem      → settle wages, rent, and sales for the day
MarketSystem       → resource price book + B2B procurement + production
BusinessAgentSystem→ (optional) once-a-day business strategy via a provider
DistributionSystem → split each firm's daily surplus: owner dividend + the even
                     citizen's dividend (the "UBI") to every resident
ResidentAgentSystem→ (optional) once-a-day resident life decisions via a provider
LifecycleSystem    → bankruptcy + capacity-aware eviction / re-home, on the settled day
BusinessEntrySystem→ found a new firm in any empty niche (creative destruction)
NeedsSystem        → decay hunger / energy / social
MacroSystem        → record GDP, payroll, rent, unemployment, prices (read-only)
PopulationSystem   → growth: in-migration, births, coming-of-age, mortality +
                     inheritance, housing construction, dynamic rent
```

`GodMode` (`src/systems/GodMode.ts`) is deliberately **not** a system: it never
runs in the tick loop, so its mere presence changes nothing. It only acts when
you call it, and it is never serialized.

### Directory map

```
src/
  core/        Simulation, TimeSystem, snapshot types
  utils/       SeededRNG, EventBus, snapshot (de)serialization
  world/       World state, entity types, archetypes, deterministic city generator
  systems/     all the tick-loop systems (above) + disasters + GodMode + constants
  ai/          the decision seam: provider contracts, clamps, rule/mock/Claude
               providers (business + resident), and LLM cost accounting
  render/      PixiRenderer (WebGL, default) + CanvasRenderer fallback behind a
               CityRenderer seam · camera (pan/zoom/follow) · day/night palette
  experiment/  headless A/B experiment harness
  createCity.ts  assembles everything
  main.ts        the browser UI (canvas, HUD, panels) — the only DOM code
```

---

## The AI brains (model-agnostic)

Every strategic decision flows through one small seam, so the core never knows
whether a rule set, a mock, or Claude produced the action:

- **Business**: `DecisionProvider` (`src/ai/types.ts`). Sees a flat snapshot of
  the business's day; may propose `setPrice`, `hire`/fire, `invest`, `setWage`,
  `setPayout`, and `brand`.
- **Resident**: `ResidentDecisionProvider` (`src/ai/residentTypes.ts`). May
  switch jobs, move home, buy/sell a vehicle, negotiate a raise, set a savings
  goal, or splurge on a luxury.

Three guarantees hold no matter who decides:

1. **Clamped** — every proposed action passes through a clamp before it touches
   the world, so a model (or a buggy rule) can't detonate the economy.
2. **Fallible-safe** — if a provider throws or its promise rejects, the
   deterministic rule-based provider covers invisibly (logged `fallback: true`).
3. **Traceable** — every applied action is logged with its reason, provider id,
   and (for networked providers) token / latency / cost usage.

By default both brains run on `"rules"` — fully deterministic and free. To hand
the city to Claude, set the providers in `src/main.ts`:

```ts
import { ClaudeDecisionProvider } from "./ai/ClaudeDecisionProvider";
import { ClaudeResidentProvider } from "./ai/ClaudeResidentProvider";

const brain: BrainOption = new ClaudeDecisionProvider();          // businesses
const residentBrain: ResidentBrainOption = new ClaudeResidentProvider(); // people
```

Claude providers read `VITE_ANTHROPIC_API_KEY` from the environment. Claude is
async: a decision fires at the day boundary and lands a few ticks later — the
lone, contained source of non-determinism.

---

## Running experiments

The harness (`src/experiment/harness.ts`) runs fresh, headless cities and reports
aggregate metrics — perfect for "does this change actually matter?" The economy
is closed, so any difference between two arms is caused by the config you varied,
not by chance.

```ts
import { compareExperiments, formatComparison } from "./experiment/harness";

const results = compareExperiments(
  [
    { label: "off", options: { disasters: false }, days: 40 },
    { label: "on",  options: { disasters: true  }, days: 40 },
  ],
  [1, 2, 3], // shared seeds — same world, only the config differs
);
console.log(formatComparison(results)); // fixed-width comparison table
```

The live UI has a **Run A/B** button that does exactly this against the running
configuration and prints the table in the Experiment panel.

---

## God Mode

`GodMode` lets an observer reach into the *live* city and meddle — all
money-conserving:

- `strike(kind)` — force a disaster (fire, festival, illness, supply shock, grant)
- `subsidize(from, to, amount)` / `bailOutPoorest(amount)` — move existing cash
- `setNeed` / `healAll` / `exhaustAll` — bless or afflict residents
- `setActive(bizId, on)` — shutter or revive a business
- `shockPrice(resource)` — peg a resource price to its ceiling

Forced disasters are mirrored into the events log so they show up in the UI and
on-canvas exactly like organic ones. The God Mode panel in the UI wires these to
buttons.

---

## LLM cost & budgets

With the default rules brains, cost is `$0.0000` — but the meter is always live.
`src/ai/cost.ts` folds both decision logs into one spend/latency summary
(`summarizeCost`), shown in the UI's **LLM cost** panel.

`BudgetedProvider` wraps any provider with a soft spend cap: once cumulative
`costUsd` reaches the budget it throws, which the agent systems already treat as
a provider failure — so a blown budget degrades gracefully to free rules-based
behavior rather than overspending.

```ts
import { BudgetedProvider } from "./ai/cost";
const brain = new BudgetedProvider(new ClaudeDecisionProvider(), 5.0); // $5 cap
```

---

## Save / load

The whole simulation serializes to a single JSON snapshot
(`sim.serialize()` → `snapshotToJSON`), and restores into a fresh city
(`snapshotFromJSON` → `sim.restore()`). Every behavior-affecting bit is captured —
World, market prices, macro series, disaster RNG + log, and agent bookmarks — so a
reloaded run continues bit-for-bit in lockstep. The UI's Save / Load buttons use
`localStorage`.

---

## Testing

```bash
npm run test:run
```

The suite covers determinism, money conservation, the AI seam (clamps, fallback,
async), market stability over 100+ days, disasters, the experiment harness, God
Mode, a full-config save/load round-trip, and a year-long invariant soak. If
you're changing core behavior, run the soak (`src/systems/soak.test.ts`) — it runs
365 sim-days with everything on and asserts money is conserved, needs stay in
`[0,100]`, nothing goes NaN, and no holder goes negative.

---

## How it was built (phase history)

The project grew as a vertical slice, then deepened. See `MASTER-PLAN.md` for the
full roadmap.

- **0** — engine: seeded RNG, time, event bus, tick loop, snapshots
- **1** — a living city: residents, businesses, needs, movement, closed economy
- **2** — the business decision seam + rule/mock/Claude providers + fallback
- **3** — the resident decision seam (jobs, homes, vehicles, raises)
- **4** — supply chains, a resource market, bankruptcy/eviction, macro vitals
- **5** — day/night rendering and living buildings
- **6** — disasters (fire, festival, illness, supply shock, grant)
- **7** — God Mode + the headless experiment harness
- **8** — hardening: robust save/load, LLM cost dashboard + budgets, a year-long
  soak, and this documentation → **v1.0**
```
