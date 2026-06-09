# INITIATIVE B: Competition Between Firms — make the rivalry *bite*

> The **second leg** of the three-part free-market program (after Initiative A — business creation;
> before C — GDP growth & scaling). See [ROADMAP.md](ROADMAP.md) + [INITIATIVE-02-BUSINESS-CREATION.md](INITIATIVE-02-BUSINESS-CREATION.md).
> Program order is load-bearing: **A created the rivals; B makes them fight over customers and
> workers; C then scales the growing, variety-rich economy A+B produce.**
>
> **Ladders up to NORTH-STAR move #2** ("market entry as a testable decision") and sets up the
> benchmark payoff: "when do I enter / how hard do I compete?" is a rich CEO decision.

## What already exists (B is partly pre-built — don't rebuild it)

Code audit (2026-06-08) — a lot of "competition" emerged from Initiative #1 + Phase 11b + Initiative A:

- **Storefront price competition** (`competition.test.ts`, Phase 11b): the rules pricer is
  **rival-aware** — it eases toward an undercutting rival, caps a raise at the rival's price (a
  geography-split *truce*, not a monopoly), and floors at unit cost so a price war can't go
  self-destructive. Customers split across storefronts by **price + distance**
  (`EconomySystem.storeForResident`).
- **A real labour market** (Phase 15 A + Initiative #1 S1): a short-staffed firm **bids its wage
  up** for scarce labour (`RuleBasedProvider` — +25% when the jobless pool is empty, affordability-
  gated), and workers **move to the best-paying _hiring_ job** (`RuleBasedResidentProvider` — jobless
  take the top offer; employed switch when a hiring job pays >15% more, off cooldown). So **poaching
  already happens emergently**: raise the wage → become the best hiring offer → pull a rival's worker.
- **Multiple firms per kind** (Initiative A slices 1–3): storefronts and producers can multiply, so
  there are real rivals to compete.

## The genuine gaps B fills (grounded in the audit)

1. **Producers don't actually compete.** Slice 2's multi-producer B2B splits a buyer's order
   **proportional to each producer's stock at the single market price** (`MarketSystem.procure`). A
   *more efficient* producer wins no extra share — there's no supply-side analog to storefront price
   competition. **This is the clearest missing piece.**
2. **Labour rivalry is reactive + blind.** A firm sees no `rivalWage`, and a worker only moves to a
   rival that is **hiring** — so a higher-paying, fully-staffed rival can't *pull* a worker, and a
   firm can't *strategically poach* or *match-to-retain*. The wage war isn't a visible CEO lever.
3. **Competitive exit isn't sharply caused by losing.** Firms go bankrupt via `LifecycleSystem`, and
   entry (A) refills — but losing share/customers/workers isn't cleanly the *cause* of exit, so the
   "compete → win or die → re-enter" churn isn't demonstrated end-to-end.

## The slice plan (small, flag-gated, default byte-identical — the house pattern)

### ✅ B1 — Producer competition (share by competitiveness) · SHIPPED
The multi-producer order split now weights each producer's pull by **competitiveness**:
`weight = stock × (marketPrice / unitCost) ^ PRODUCER_COMPETITION`, where unit cost is the producer's
input + wage bill spread over its effective capacity (the same cost the price floor reckons). A
cheaper, more efficient producer wins **more** share, earns more, and out-grows a laggard. Keeps the
**single market price** (per-producer pricing deferred). Flag-gated via `producerCompetition` (the
exponent; **0 ⇒ proportional-to-stock ⇒ byte-identical**; engage ~1–2). 412 tests green.
- **Also fixed slice 2's split to be _truly_ proportional** (divide the still-wanted units by the
  *remaining* pull, a suffix sum — equal producers now split ~evenly; the old code biased share
  toward the lowest-id producer). Single-producer seeded city stays byte-identical; only multi-
  producer cases (all flag-gated) change, and none assert exact shares.
- `producerPool.test.ts`: at strength 0 two equal farms split ~50/50; at strength 2 the cheaper
  farm wins clearly more, conserved + deterministic. *Real-world:* buyers route contracts to the
  cheaper/more reliable supplier, so efficient producers grow and inefficient ones lose the business.
- *Deferred (noted):* a hard share floor / truce (today a laggard's share decays smoothly toward
  zero as cost diverges, then it exits → entry refills — which is the intended B3 churn).

### B2 — Rival-aware wages (the wage war + a truce)
Surface a `rivalWage` signal (what same-kind rivals pay) in the observation, and let a firm **bid to
match/beat** a rival that's poaching its crew (retain) or to **poach** when it wants to grow —
affordability-gated, with a **truce** (converge, don't ratchet to the cap), mirroring the storefront
price truce. Optionally let a worker be pulled by a clearly-higher rival even at full staff (a
posted opening). Flag-gated. Makes labour competition strategic + visible.

### B3 — Competitive exit + churn (tie A ↔ B)
Demonstrate (and sharpen if needed) that a firm which persistently **loses** share/customers/workers
runs underwater and **exits** (`LifecycleSystem`), and **entry (A) refills** the freed niche — so the
market visibly churns: *enter → compete → win or die → re-enter*. Mostly a soak that proves
competitive churn holds conservation + determinism; a small sharpening only if the loss→exit link is
too weak.

### B4 — Competition as a CEO benchmark scenario (the payoff)
A curated, frozen scenario where the LM CEO competes **head-to-head** with a rival (pricing + wages +
investment), scored on **share / profit**. The benchmark reason B exists — "how hard do I compete?"
is a rich, score-separating decision. **OFF in the simple bench** (the NORTH-STAR realism-vs-
benchmark tension); a dedicated scenario switches it on.

## Sequencing rationale
**B1 first** — it's the concrete missing mechanism (producers finally compete) and builds directly on
slice 2. **B2** then deepens the labour side into a real war. **B3** ties the loop to A (exit ↔
entry). **B4** harvests it as a benchmark. Each is flag-gated and byte-identical at its default.

## Invariants (non-negotiable, every slice)
- **Closed economy** — all share/wage/exit moves are `World.transfer`; `totalMoney()` conserved.
- **Deterministic** — seeded/derived order only, no RNG, no wall-clock; same seed ⇒ identical world.
- **Flag-gated, default byte-identical** — the brain-off + seeded baseline never moves until engaged.
- **Realism in the world; benchmark via frozen scenarios** — competition lives in the live sim; the
  simple CEO bench keeps it off so the skill signal stays clean.
