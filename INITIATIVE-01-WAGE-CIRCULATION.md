# INITIATIVE #1: Shift Circulation from the Even Dividend Toward Wages

> First experiment of the free-market-economy direction (see `VISION.md`). Designed via a
> 10-agent panel (grounded readers → 3 approaches → adversarial critique → synthesis).
> **Status: designed, awaiting go.** Nothing built yet. Initiative #1 is fully
> conservation-safe — it only *rebalances* existing money; it mints nothing.

## 1. The idea, restated

Today money reaches people two ways. **Wages** flow tick-by-tick from an employer to a
working resident (`EconomySystem.ts:68`, `world.transfer(employer.id, resident.id, wagePerTick)`).
The **dividend** flows once daily: each firm pays ~10% of its capped surplus to its owner,
then splits the rest **equally among ALL residents** regardless of whether they work
(`DistributionSystem.ts:60–80`). That even split is, in effect, a universal basic income —
and it is also the closed economy's **demand pump** (it recirculates money out of firms back
to people so cash doesn't pool in business reserves and stall consumption).

"Circulate via wages, not the dividend" means **re-targeting that recirculated money so it
arrives mainly as earned income from the firm a person works for**, and only secondarily (or
eventually minimally) as an unearned equal share. In a real free-market economy the dominant
way money reaches households is payment for labour; an equal per-capita transfer is the
exception (welfare/dividends), not the rule. Earned-income-dominant is what gives the sim the
texture we want to *observe*: pay that tracks the firm you work for, inequality that emerges
from employment, income that rises and falls with the business cycle.

The smallest version is **not** a rewrite of the wage engine. The per-tick wage is capped at
2× base and already near the cap, and raising it collides with the circular-flow problem
(below). Instead we **re-partition the existing daily distribution budget** inside
`DistributionSystem` — the one place the even dividend is computed — adding the firm's own
employees as a recipient class *before* the even split. No new money is minted; the same
`world.transfer(biz.id, recipient.id, amount)` moves the same conserved budget to different
people.

## 2. Critical thinking — why this is harder than it looks

### (a) Wages only reach workers → non-worker destitution → demand collapse *(most severe)*
This is the exact failure the dividend was built to prevent. A wage/profit-share channel rides
`biz.employeeIds`. **Children** (`age < COMING_OF_AGE_YEARS`), the **jobless**, and the
**elderly** have no roster membership and no wage — they receive **nothing**. In the measured
20-resident town, ~7 of 20 live ~100% on the ~$50/resident/day dividend. Every dollar moved
from the even pool to a wage pool is removed from the *only* income these residents have. Zero
their cash and: they can't buy meals (stay hungry), rent goes unpaid (`rentMissedDays` climbs),
the storefronts lose a third of their customers, firm revenue shrinks, and the very budget being
split shrinks with it — a circular-flow collapse.

**Honest framing: wages alone cannot replace the dividend in a population with non-workers.** A
real economy reaches dependents through a *second, non-wage channel* — household support,
pensions, unemployment insurance, welfare.

**Fixes/options:** keep a **residual dividend as a floor** (a shrunk UBI); add a **targeted
safety-net stream** paid only to the structurally non-earning (welfare, not UBI); later,
**household transfers** (a worker supports dependents in their home); and **sequence the floor
BEFORE the wage shift** — prove non-workers stay solvent before draining what they live on, as a
hard CI gate.

### (b) The 2× wage cap
Per-tick wage is clamped to `[base, base*MAX_WAGE_MULT]` (`MAX_WAGE_MULT=2`) with a coarse
absolute clamp `maxWagePerTick=1` applied before `applySetWage`. Wages already sit near the cap.

**Fixes/options:** **don't fight the cap — route around it.** Send the extra earned income
through the *distribution channel* as a **daily profit-share** (a day-boundary transfer the
per-tick cap never touches), not through `wagePerTick`. (If you later want a real labour market:
raise `MAX_WAGE_MULT` *and* `maxWagePerTick` in lockstep — but note the **affordability ceiling**:
a diner's gross is capped at `maxPerDay 34 × $18 ≈ $612/day`, so at ~mult 4 its payroll already
exceeds revenue. High wage caps are economically vacuous for storefronts — which is why the
profit-share channel, not the wage rate, is the right first lever.)

### (c) Circular-flow chicken-and-egg
Firms can only afford to pay people when people have money to spend at those firms. If the
dividend is cut faster than wages rise, demand drops → revenue drops → the surplus that funds
wages drops → demand drops further.

**Fixes/options:** **re-target, don't enlarge** (the budget being split is unchanged — we only
change *who* receives it); **fund the wage pool only from realized surplus** (the existing
`budget<=0 → skip` guard makes affordability automatic — never dip into reserve); make any
dividend offset **proportional to wages actually paid**.

### (d) Pro-cyclicality — real business cycles (boon) vs. death-spiral (peril)
Tying income to employment is inherently pro-cyclical: a downturn cuts firm budgets → smaller
wage pool → workers spend less → deeper downturn. **Mild amplitude is exactly the emergent
business cycle the project wants to observe; large amplitude is a death-spiral** — and the
project history already saw wage-tied coupling produce a multi-year collapse once. A subtle
amplifier: profit-share is funded mostly by **storefront** surplus (the landlord, the largest
distributor, has no staff and *can't* tilt), and storefront revenue is the most demand-elastic /
volatile source — coupling the wage channel to the most cyclical money.

**Fixes/options:** **bound the tilt** + gate increases on a `rentMissedDays`-runaway check; keep
the **residual dividend as an automatic stabilizer** (relatively larger in busts); optional
**counter-cyclical safety net** (widen the net in busts); and **measure cycle amplitude
explicitly** so you can tell boom-bust (good) from death-spiral (bad).

### (e) The deeper tension — growth + inflation are impossible under fixed money
Initiative #1 is deliberately *conserved* (re-weighting mints nothing; `totalMoney()` stays flat
~$34k). But the project's long-run goals — indefinite population/real growth + **inflation** —
are **mathematically incompatible with a fixed money supply**. By `MV=PQ`: fixed M with rising
real Q forces the price level *down* (deflation), and per-capita money dilutes as population
grows. Sustained nominal growth + rising prices requires **M to grow** — money creation. Taken
to its conclusion, wages-from-value-add means a firm *creating* money equal to the value its
workers produce, which **breaks the current sacred invariant**. (Conscious forks in §6 — not now.)

## 3. Recommended first increment — "The Dial," sequenced safety-first

Add one tunable scalar that splits each firm's existing daily distribution budget into a small
employee **profit-share** pool and the legacy **even dividend** — but ship the dependent floor as
*enforced code* before the first live notch. Smallest measurable move: a tiny slice of surplus
from dividend → workers, dividend still covers the rest, nothing collapses.

- **Slice 0 — inert seam + instrumentation (no behaviour change).** `WAGE_DIVIDEND_TILT = 0`
  constant + `wageDividendTilt` plumbed through `createCity` + a `DistributionSystem` ctor param
  (mirror `ownerDividendShare`). Add `profitShare` to `ProfitAndLoss` (kept separate from
  `wagesPaid` so the CEO-bench labour signal stays clean). **Fix the existing macro mislabel**
  (`MacroSample.payroll` says "wages+dividends" but sums only wages): split into explicit
  `wages` / `dividend` / `profitShare` + a derived **`wageChannelShare`** headline. *Test:*
  default == `tilt:0` byte-identical; `totalMoney` conserved.
- **Slice 1 — the split, default OFF.** In `DistributionSystem.update`, after `budget`/`ownerCut`:
  `wagePool = (budget−ownerCut) × τ`, distributed to `biz.employeeIds` weighted by
  **`resident.wagePerTick`** (per-person — *not* the firm scalar). Even pool = the **arithmetic
  remainder** (`budget − ownerCut − Σ actual slices`) so float drift / transfer-capping fall into
  the even pool — no cent created or lost. *Test:* with τ=0.1, workers gain, money conserved to
  the cent.
- **Slice 2 — enforced dependent floor (BEFORE any live tilt).** `DEPENDENT_MIN_DIVIDEND`: the
  even pool must clear a per-non-worker subsistence/day; if `wagePool` would breach it, **shrink
  `wagePool`**. Gate τ>0 on this floor *in code*. *Test:* with τ=0.3, births/mortality on & off,
  no non-worker's income falls below the floor; their `rentMissedDays` doesn't trend up.
- **Slice 3 — first live notch.** Raise live `WAGE_DIVIDEND_TILT` `0 → 0.1`, only after 0–2 show
  zero non-worker insolvency (incl. births+mortality mode).

**MustFix items resolved:** landlord/zero-staff `wagePool` **folds to the even dividend**
(conserved) + report `wageChannelShare` *by firm* so the dial isn't mistaken for broken; floor
enforced before the live notch; report **realized-vs-intended** tilt (catch float/cap masking);
weight by `resident.wagePerTick`; owner gets `ownerCut` only (no double-dip); never dip into
reserve; deterministic (fixed `employeeIds` order, scalar math, no RNG).

## 4. Slices beyond the first (dependency-ordered)
1. **S0** inert seam + macro instrumentation (`constants.ts`, `createCity.ts`, `types.ts`, `MacroSystem.ts`).
2. **S1** profit-share split, default OFF (`DistributionSystem.ts`).
3. **S2** enforced `DEPENDENT_MIN_DIVIDEND` floor + non-worker solvency CI gate (`DistributionSystem.ts`, `soak.test.ts`).
4. **S3** first live notch τ 0→0.1 + full regression.
5. **S4** realized-vs-intended + per-firm `wageChannelShare` reporting (`MacroSystem.ts`).
6. **S5** targeted safety-net stream (paid only to child/jobless via predicate) (`DistributionSystem.ts`, `PopulationSystem.ts`).
7. **S6** ramp τ → ~0.3–0.5 in checkpointed notches, each gated on solvency + GDP band.
8. **S7** counter-cyclical safety net (auto-widen in busts).
9. **S8** *(optional, free-market labour)* flag-gated wage-cap lift + scarcity bidding (`BusinessAgentSystem.ts`, `RuleBasedProvider.ts`, `clamp.ts`).
10. **S9** household/dependent transfers (a worker supports dependents at home).

## 5. What to measure each step

| Metric | Definition | Watch for |
|---|---|---|
| **wageChannelShare** | `(wages+profitShare)/(wages+profitShare+dividend)` | Rises with τ; flat ⇒ landlord-fold throttling it |
| Per-capita income split | mean daily income, workers vs non-workers | Workers up; non-workers down only by a *bounded* amount |
| **Solvency census** | count `money<=0` / `rentMissedDays>0` by cohort | **Non-workers must stay 0** — hard CI gate |
| Demand / GDP | `consumption`, `gdp` vs same-seed τ=0 baseline | Within tolerance; abort ramp on monotonic decline |
| Velocity proxy | daily consumption ÷ `totalMoney()` | Drop ⇒ cash stranding / pooling |
| Pooling | business-cash share of `totalMoney`; max holder balance | Should not rise (shift to wages, not to hoarding) |
| Realized-vs-intended | `Σ profitShare ÷ (τ·(budget−ownerCut))` | <1 ⇒ float/cap masking the true tilt |
| Cycle amplitude | variance / peak-to-trough of consumption & unemployment | Bounded = business cycle; runaway = death-spiral |
| Conservation | `totalMoney()` vs start | `toBeCloseTo(start, 2)` every slice |
| Determinism | snapshot equality on same-seed re-run | Any diff = ordering/RNG break |

## 6. The fork in the road
**Initiative #1 stays fully conserved — no decision needed yet.** Re-weighting wages vs dividend
mints nothing. The decision becomes unavoidable only when you reach for the *macro* goals
(**inflation, indefinite growth**), which are impossible under fixed money (§2e). At that point
you consciously relax "money conserved to the cent" → **accounted money-creation**: keep
`World.transfer` as the only transfer, add a single auditable `World.create(amount, holder)` mint
with every minted dollar logged and attributable; the invariant becomes `totalMoney = seed +
Σ(audited mints) − Σ(audited burns)` — weaker but still testable. **Cleanest first fork: the
credit / central-bank path** (Phase 18, already designed) — bounded, reversible (repayment burns
the money). **This is your call, made deliberately as its own initiative — not smuggled into #1.**

## 7. Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| **Non-worker destitution** | enforced `DEPENDENT_MIN_DIVIDEND` (S2) before any live τ; solvency = hard CI gate | `WAGE_DIVIDEND_TILT=0` (byte-identical) |
| **Demand collapse / death-spiral** | bound τ; residual dividend stabilizer; ramp gated on `rentMissedDays` + GDP band | lower τ one notch; flag off |
| Dial looks inert (landlord can't tilt) | explicit fold-to-even + per-firm `wageChannelShare` report | accept lower per-notch effect |
| Realized tilt undershoots τ | report realized-vs-intended | observability fix |
| Conservation drift | even pool = arithmetic remainder; `toBeCloseTo(start,2)` every slice | revert slice (test fails loudly) |
| Determinism break | fixed `employeeIds` order, scalar math, no RNG; snapshot-equality test | revert slice |
| CEO-bench drift | `profitShare` in its own pnl field; bench freezes τ=0 | bench keeps τ=0 |
| Weighting no-op (firm scalar vs per-person) | weight by `resident.wagePerTick`; unit test | covered by test |
| Premature money-creation | #1 mints nothing; `World.create` doesn't exist yet | guarded by absence of a mint primitive |

## Panel scores (all three approaches)
- **The Dial** — 62/100 · demand-collapse: med · non-worker: high · pro-cyclical: med · conservation: low · realism: ok → **recommended** (lowest-risk, isolates the variable).
- **Free-market labour (lift cap + bid)** — 58 · demand-collapse: high · non-worker: high → deferred to S8 (collides with the cap + affordability ceiling).
- **Wages + targeted safety net** — 62 · non-worker: **medium** (best on the central problem) · pro-cyclical: high → folded in as S5 (the safety-net stream).
