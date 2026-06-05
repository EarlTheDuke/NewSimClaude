# Phase 14 — Capacity Rebalance: the real productivity engine

**Status:** Active plan (adopted 2026-06-05) · **Owner:** CityWithLifeClaude
**Purpose:** Turn the Phase-12/13 invest lever from a *transient* spike into a *sustained* Solow productivity engine, by recalibrating supply-chain capacity so demand presses against it. Routine progress lives in `PHASE9-PLAYTEST.md`; the direction compass is `NORTH-STAR.md` (this closes move **#3**).

## Context — why we're doing this

Phase 13 delivered the keystone: **demand now grows with wealth, and GDP roughly doubles over a sim-year.** Phase 13c also fixed the *ordering* blocker so the Phase-12 invest lever finally fires. But capital-deepening is **transient** — it spikes then depreciates back to baseline — because the economy runs at **~25–50% capacity utilization (~75% slack everywhere)**. With that much headroom, investing in more capacity is genuinely pointless: the new capacity just sits idle, so the lever self-extinguishes after a few fires.

A *productivity* engine (North-Star move #3 — capital deepening compounds into sustained output growth) requires **demand to press against capacity**. That can't be tuned around; it needs a deliberate recalibration of the supply chain's base capacity. This is that dedicated, stability-first rebalance. We attempted a quick version in the deferred Phase 14 (commit `f2a29dd`) and reverted it — this plan incorporates exactly why that failed.

## The mechanical truth (verified in source)

Per producing business, once/day in `src/systems/MarketSystem.ts`:

```
capacity      = floor(maxPerDay × laborFactor × capitalFactor)   // capitalFactor = (capital/100)^0.3, =1 at baseline
make          = min(capacity, target − inventory [, inputOnHand]) // refill-to-target
utilization   = make / capacity                                   // the signal the invest gate reads
```

`make` has **two ceilings**: `capacity` AND `target − inventory`. At steady state `target − inventory ≈ daily demand D`, and today `maxPerDay ≈ 2.5 × D` and `target ≈ maxPerDay`, so `make = D`, `utilization ≈ 0.4`, forever. Investing raises `capacity` only — which *lowers* utilization further (`make` unchanged) → the lever shuts itself off. (`archetypes.ts:32-39`: farm 50/50, mine 24/24, bakery 40/45, factory 20/24, diner 40/45, goods 20/24 — `target ≈ maxPerDay` everywhere.)

## The decisive insight (why the deferred attempt failed, and what actually works)

**Both ceilings must be lifted together; neither fix works alone:**

1. **Cut `maxPerDay`** so `capacity` becomes binding → utilization runs hot (~0.85) → the gate fires. *Alone, this hits the second ceiling:* once wealth-elastic demand grows past `target`, the shelf empties, `make` saturates at `target`, utilization reads `target/capacity` which *falls* as you add capital — lever off again.
2. **Scale `target` with capital** (`effectiveTarget = ceil(target × capitalFactor)`, the **same** `capitalFactor` capacity already uses) so a recapitalised firm holds a deeper buffer. *Alone, this never fires* (the reverted-Phase-14 chicken-and-egg: the gate never triggers, so capital never deepens, so target never scales).

**Together they close the loop** — and yield a key stability property: because `target` and `capacity` scale by the *same* factor, **their ratio (utilization) is invariant to capital**. Investing no longer moves utilization in the short run; utilization moves only when *demand* moves. So the control loop is **demand-driven, not self-driven** → it cannot oscillate, and the firm stays near its operating utilization (~0.85) as it invests instead of falling back into slack. Capital deepening then does real work: more capital → more capacity → more units sold to growing demand → more profit → more investment, until diminishing returns (`^0.3`) plus depreciation (1%/day) balance at a genuine **Solow steady state** (capital rises with demand, then plateaus).

## Where we're going — what "done" looks like

A city you can watch **grow through investment**: as residents bank wealth and demand climbs, businesses become capacity-bound and **reinvest to chase it** — the *Investment / day* and *Capital stock* cards climb and **stay up** (not the 13c spike-then-fade), the decision trace shows regular `+$N invest` actions, and GDP grows for ~2 years then plateaus higher (Solow). Residents stay fed; money stays conserved to the cent; runs stay deterministic.

**Definition of Done** — a 365-day *and* a 730-day agentic soak (all six producers agentic, resident brain on, seeds 1 & 7) asserts ALL of:

1. Steady-state producer utilization in **[0.80, 0.92]** by day 30 and held there.
2. **investedDays > ~100/year** (was ~3–4).
3. **Capital sustained** — mean per-firm capital over the last 30 days **> 1.2× baseline** (permanent, not transient).
4. **Investment is a real GDP share** — `investment / gdp` averages **≥ 3%** (≈0% today).
5. **Solow shape** — annual GDP rises across years 1–2 then flattens (year-3 within ±5% of year-2); growth is capital-driven (capital up) with `totalMoney` flat.
6. **No starvation** — `minHunger > 25` every resident every day; no storefront stocks out a full day.
7. **Sacred invariants hold** — money conserved to the cent; determinism + save/reload exact; no negative cash; no bankruptcy; needs ∈ [0,100]; prices ∈ [base×0.4, base×1.6].
8. **No oscillation** — per-firm capital sign-flips < ~30×/yr; no resource price pinned at a bound for more than a few consecutive days.

## The changes (recommended approach)

- **`src/world/archetypes.ts`** — cut each producing archetype's `maxPerDay` toward its real daily drawdown so start-of-run utilization ≈ 0.85; keep `target ≥ maxPerDay` (a multi-day buffer so one slow day doesn't empty shelves); give upstream stages **+1–2 capacity** over the stage they feed so the **storefront binds first** (it earns retail profit and funds the first investments; the chain then deepens demand-end-backward). Update the neutral-band header comment (`:26-31`). **Starting hypothesis (set empirically in 14a):** diner 45→~26, bakery 45→~27, farm 50→~28, goods 24→~17, factory 24→~18, mine 24→~18.
- **`src/systems/MarketSystem.ts`** — add `effectiveTarget(biz) = ceil(target × capitalFactor)` (extract a shared `capitalFactor(biz)` helper from `effectiveCapacity`), and route **both** `produce()` and `procure()` through it (every site that reads `a.target` today). Floor it with a per-archetype `minTarget` so capital-scaling can only *raise* the buffer, never shrink a storefront's survival-meal stock; floor `capitalFactor` at 1 for below-baseline firms.
- **`src/systems/constants.ts`** — raise `INVEST_UTILIZATION_THRESHOLD` 0.45 → **0.80** (just below the 0.85 operating point, so the lever fires only when demand growth pushes utilization *above* normal, then relaxes — the negative feedback); lower `maxInvestPerReview` 500 → **~200** (overshoot guard); keep `CAPITAL_DEPRECIATION_RATE` 0.01 and `CAPITAL_OUTPUT_ELASTICITY` 0.3 unless the soak shows creep/runaway. Add `minTarget` + (optional) `TARGET_CAPITAL_SCALING` no-op flag.
- **`src/ai/RuleBasedProvider.ts`** — invest gate already reads `INVEST_UTILIZATION_THRESHOLD`; no structural change, just the higher value.
- **Live config** — make all six producers agentic so each link invests when *it* becomes the bottleneck (the 13c soak test already lists all six).

## How we get there — sub-slices (no-op-first; each shippable, green, committed, pushed)

- **14a — `effectiveTarget` seam + measurement probe (NO-OP).** Add `effectiveTarget` returning exactly `target` today (factor pinned to 1 at baseline) and route `produce()` + `procure()` through it — byte-identical for the seeded city. Build a throwaway probe (`phase14.probe.test.ts`) that logs each producer's daily `make`, `target − inventory`, utilization (mean/p95), investedDays, capital trajectory, minHunger, and GDP split over 365 days, for the seeded + full-agency configs. **Read it to set the real `maxPerDay` numbers, then delete it before commit.** *Gate:* full suite green (no-op).
- **14b — cut `maxPerDay` (BEHAVIOURAL — moves baselines).** Apply the measured cuts with `target ≥ maxPerDay`; `effectiveTarget` scaling still OFF (factor 1) to isolate the cut. Update the header comment. *Gate:* fresh-city day-1 per-firm utilization ∈ [0.78, 0.90]; `minHunger > 25` over 60 days; no full-day stockout; conserved; re-baseline the tests in the migration list.
- **14c — turn on `target × capital` + raise the gate (BEHAVIOURAL).** `effectiveTarget = ceil(target × capitalFactor)`; `INVEST_UTILIZATION_THRESHOLD = 0.80`; `maxInvestPerReview = 200`. Loop now live. *Gate:* 365-day agentic soak — `investedDays > 100`, `totalCapital` ends > 1.3× baseline **and sustained**, conserved, all firms active.
- **14d — stability + Solow-shape soak (TEST-ONLY).** Dedicated multi-year (730+ day) assertions: capital plateaus (last-30-day variance small), sign-flips < ~30/yr/firm, GDP grows years 1–2 then flat, `investment/gdp` a positive sustained share. Seeds 1 & 7.
- **14e — calibration + CEO bench re-curation + docs.** Tune the six `maxPerDay`, threshold, cap, depreciation against 14d until plateau/hunger/invest-share land in band. Re-snapshot the CEO benchmark baseline (capacity isn't a frozen bench param; scores legitimately shift — verify `rules > off` still holds and likely *strengthens*). Update this doc + `PHASE9-PLAYTEST.md` + the NORTH-STAR checklist (#3 closed for real).

## Test migration (don't loosen — pin a relationship, or isolate at `wealthElasticity:0`)

- **Phase 12a no-op guards SURVIVE untouched** — seeding lives in `cityGen.ts` (unchanged by `maxPerDay`); a brain-off city has no investor so capital genuinely stays at baseline; and every determinism/identity test compares two *live* runs of the same code, not against frozen old numbers. So `capital.test.ts:36-64`, `macro.test.ts:84-93`, and all save/reload + identical-seed tests stay green.
- **Re-baseline (few):** `capital.test.ts:120-129` — replace the literal `toBeLessThan(50)` with `toBeLessThan(ARCHETYPES.farm.maxPerDay)` (pins the relationship). `market.test.ts:34-43` (storefront-stocked) stays a `>0` guard and becomes the primary **stockout** gate — a failure here means rollback, not loosen. `elasticity.test.ts:172-186` is a ratio (`on > off*1.05`) — survives; update only the `+22%` comment. `macro.test.ts:16-27` are `>0`/counts — verify they hold. CEO bench magnitudes shift (14d/14e).
- **Sacred — never touched, failure = bug → rollback:** money conservation, determinism/save-reload, no-negative-cash / no-spurious-bankruptcy, needs ∈ [0,100], price bands.

## Risks & rollback

- **R1 Starvation / chain stockout (HIGH·HIGH)** — cutting `maxPerDay` below true drawdown starves producers → residents hit hunger 0. *Mitigate:* keep `target ≥ maxPerDay`, calibrate to **p95** drawdown with 15% headroom, `minTarget` floor on the diner, watch diner `inventory==0` frequency as the leading indicator.
- **R2 Lever still self-extinguishes (MED·HIGH)** — only if 14c's target-scaling isn't paired with 14b's cut and the *same* `capitalFactor`. *Mitigate:* same-factor lock-step; sequence 14b before 14c; gate on `investedDays`.
- **R3 Price drifts to a clamp bound (MED·MED)** — lower capacity raises the `sold/capacity` ratio `adjustPrices` reads. *Mitigate:* that ratio uses `effectiveCapacity` (which also falls), so it may stay mid-band — verify in soak; re-tune the 0.6/0.3 thresholds or `PRICE_REVERT_FRACTION` if it pins; update the header comment.
- **R4 CEO bench loses discrimination (LOW–MED·MED)** — re-curate in 14e; verify `rules > off`.

**Rollback triggers (abort slice, `git reset` to prior green commit):** any conservation drift; recurring steady-state starvation; any bankruptcy/negative cash; a price pinned at a bound in steady state; non-convergent (growing-amplitude) oscillation; any determinism break. 14a (calibrated no-op) is always a safe floor.

## Verification

- Per slice: `npm run typecheck && npm run test:run && npm run build` green; browser check (the *Investment / day* + *Capital stock* cards and decision trace now show sustained investment); commit + push.
- The soak protocol (throwaway probe, built in 14a, deleted before each commit per `CLAUDE.md`) measures every DoD metric across 365- and 730-day runs on seeds 1 & 7, plus the disasters+both-brains config, with the pass/fail thresholds in "Definition of Done."

## Critical files

- `src/world/archetypes.ts` — the six `maxPerDay` cuts + `target` buffers + header comment.
- `src/systems/MarketSystem.ts` — `capitalFactor` helper + `effectiveTarget` in `produce()` **and** `procure()`.
- `src/systems/constants.ts` — `INVEST_UTILIZATION_THRESHOLD` 0.45→0.80, `maxInvestPerReview` 500→~200, `minTarget`, optional `TARGET_CAPITAL_SCALING` flag.
- `src/ai/RuleBasedProvider.ts` — invest gate (reads the new threshold).
- `src/systems/capital.test.ts`, `src/systems/soak.test.ts`, `src/world/cityGen.ts` (make six producers agentic in the live config) — re-baselining + the 14d Solow/hunger soak.
