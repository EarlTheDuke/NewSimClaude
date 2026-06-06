# CityWithLifeClaude — Economic Roadmap (Phase 16+)

**Status:** Active forward plan for the economic model.
**Adopted:** 2026-06-06
**Purpose:** Sequences the realism levers that come *after* [NORTH-STAR.md](NORTH-STAR.md)'s
three core moves. NORTH-STAR is the *compass* (why); [MASTER-PLAN.md](MASTER-PLAN.md) is the
*architecture*; this is the *forward sequence* (what's next, in what order). Read it at each
phase boundary alongside NORTH-STAR, and check proposed work against it before planning.

## Where the model is today

The shipped economy is a **closed, fixed-money, fixed-population, single-town** market:

- ✅ **#1 Wants grow with wealth** (Phase 13) — demand rises with wealth; GDP climbs.
- ✅ **#2 Business entry/exit** (Phase 15 D) — firms are born *and* die; self-healing.
- 🔶 **#3 Close the investment loop** (Phase 12c / 14c / **16, live**) — the open frontier.
  Producers are viable (15 B+A) and profit routes to owners (15 C), but the productivity
  engine **still doesn't compound**: the 2026-06-06 audit + Phase-16 probes proved
  investment self-extinguishes — firms run out of *cash* (distribution drains them to the
  reserve floor) before utilization ever binds, and target-scaling alone makes it worse.
  The **retain-to-reinvest** fix is Phase 16's live work and the gateway to everything below.

## The audit's top gaps (why these phases, in this order)

The closed economy caps growth + realism on five fronts. Each phase lifts one ceiling;
they're ordered so each unlocks the next. Every phase ships behind a **default-OFF flag**
(the proven 12a/13a/14a no-op discipline) so the baseline stays byte-identical until engaged.

### Phase 17 — Demand growth *(the keystone; unblocks the invest loop)*
- **Gap:** wants grow with wealth, but the *market* can't truly expand — 12 residents,
  tiered reservations, a near-fixed demand ceiling. Investment has nothing to grow *into*
  (Phase 16 proved the engine dies for lack of demand + cash).
- **Build:** a demand-side lever — marketing/advertising (spend cash → grow demand share /
  lift reservations), product quality/differentiation, deepened wealth-elasticity.
- **Why first:** the precondition for *every* growth lever below — and for Phase 16's
  retain-to-reinvest to pay (retained capital compounds only if the extra output sells).
  Benchmark: an uncapped market is the only kind where a skilled CEO pulls away.

### Phase 18 — Credit & banking
- **Gap:** firms can invest only from retained earnings; no leverage, no money-supply flex.
- **Build:** a bank that takes deposits + lends; firms (and residents) borrow to invest or
  buy ahead of cash.
- **Care:** credit *creates* money — the sacred conservation invariant becomes
  **money + net credit** (every loan a matched asset/liability). NORTH-STAR flags this as
  the riskiest to the invariant; prove conservation-with-debt before engaging.
- **Depends on 17:** borrowing-to-invest only pays when there's demand to grow into.

### Phase 19 — Population lifecycle
- **Gap:** a fixed 12 residents — no births, aging, or death; no organic growth.
- **Build:** seeded life events (birth, aging, retirement, death); households that grow.
  The cleanest *organic* growth driver (more people → more demand + labour) and the most
  genuinely "alive."
- **Care:** determinism — life events from the seeded RNG only; labour/demand pools resize.
- **Depends on 17–18:** a growing population needs an economy that can expand to employ
  and supply it.

### Phase 20 — Government & fiscal policy
- **Gap:** no taxes, public goods, or redistribution — no fiscal layer at all.
- **Build:** a government that taxes (income/business), spends (public goods, transfers),
  and redistributes — a real policy surface (a tax-rate decision; public investment).
- **Care:** all fiscal flows via `World.transfer` (stays closed/conserved); the state is a
  new agent behind the `DecisionProvider` seam.
- **Depends on 17–19:** there must be income + activity worth taxing.

### Phase 21 — External trade
- **Gap:** closed borders — the demand ceiling is hard; no outside supply or demand.
- **Build:** a port that buys exports (injects outside demand) + sells imports (outside
  supply), at world prices.
- **Care:** the economy is **no longer closed** — money crosses the border, so the
  invariant becomes a *tracked external balance* (the biggest change to the money model).
  NORTH-STAR's ultimate ceiling-breaker.
- **Depends on 17–20:** a firm needs the capacity + capital to serve export demand.

### Texture track *(parallel; optional toggles, benchmarked off)*
More goods/services, households + relationships, skills + inequality, neighborhoods + land
value — the depth that makes the town *feel* alive. Independent of the growth spine above;
ship as toggles when they add color without destabilizing a benchmark scenario.

## The realism-vs-benchmark tension (carried from NORTH-STAR)

Every lever here adds realism *and* noise. Build realism into the **world model**, but
benchmark through **curated scenarios** that freeze most of it and spotlight one decision
domain (pricing, investment, market entry, credit, trade). Determinism from seed + snapshot
is the gold that keeps a score about skill, not luck.

## Sequence at a glance

**16 retain-to-reinvest *(in progress)* → 17 demand growth → 18 credit → 19 population →
20 government → 21 trade**, with the **texture track** in parallel. Each step lifts one
ceiling and unlocks the next: 16–17 are the live frontier (the invest loop); 18–21 are the
bigger realism levers NORTH-STAR gated for later, now sequenced.
