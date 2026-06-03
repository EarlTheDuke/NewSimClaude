# CityWithLifeClaude

A small, watchable city economy that runs itself. Twelve residents wake, commute,
work, eat, and socialize; seven businesses buy inputs, produce goods, set prices,
and hire or fire. You watch it breathe on a canvas — and, if you like, hand the
businesses' and residents' strategic decisions to Claude and see how the economy
diverges from the deterministic baseline.

It is built from scratch in TypeScript: no game engine, no UI framework, one
seeded RNG, and a strict tick loop. Same seed in, same city out — every time.

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
ResidentAgentSystem→ (optional) once-a-day resident life decisions via a provider
LifecycleSystem    → bankruptcy + safe eviction / re-home, on the settled day
NeedsSystem        → decay hunger / energy / social
MacroSystem        → record GDP, payroll, rent, unemployment, prices (read-only)
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
  render/      CanvasRenderer + day/night palette
  experiment/  headless A/B experiment harness
  createCity.ts  assembles everything
  main.ts        the browser UI (canvas, HUD, panels) — the only DOM code
```

---

## The AI brains (model-agnostic)

Every strategic decision flows through one small seam, so the core never knows
whether a rule set, a mock, or Claude produced the action:

- **Business**: `DecisionProvider` (`src/ai/types.ts`). Sees a flat snapshot of
  the business's day; may propose `setPrice`, `hire`/fire, `produce`.
- **Resident**: `ResidentDecisionProvider` (`src/ai/residentTypes.ts`). May
  switch jobs, move home, buy/sell a vehicle, or negotiate a raise.

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
