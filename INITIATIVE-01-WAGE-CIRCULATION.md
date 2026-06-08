# INITIATIVE #1: Wage-Based Circulation — Targets & Deregulation

> First experiment of the free-market-economy direction (`VISION.md`). Designed via a
> 10-agent panel, then sharpened with the user's concrete targets + deregulation intent.
> **Status: designed, awaiting go. Nothing built yet.** Initiative #1 stays
> conservation-safe — it *redistributes* existing money; it mints nothing. Removing the
> rules below makes the economy a freer, more volatile "wild west" — by design.

## 0. Target end-state (user direction)

We are deliberately **removing artificial rules so a real free market can emerge**, with
the real-life volatility, inequality, and uncertainty that comes with it. We accept that —
it's the point of an observatory. The targets to ramp toward:

- **Firm profitability → ~90% to the people (labour), ~10% to owners (capital).** The
  owner keeps ~10%; the other ~90% reaches people, dominantly as **earned income from the
  firm they work for** (wages / profit-share), replacing today's equal dividend-to-everyone.
- **Unemployed / non-workers → a social safety net ≈ 50% of the average worker's income.**
  Targeted welfare for those who can't earn — *not* an equal UBI to all.
- **Deregulate:** progressively strip the caps/floors/seals that keep the current economy
  artificially balanced, so prices, wages, and fortunes move freely.

**Note:** the foundation *already* pays owners ~10% (`OWNER_DIVIDEND_SHARE = 0.1`). So the
capital share is done — the work is re-routing the **other 90% from "everyone equally" to
"workers (earned) + a welfare floor for non-workers."**

## 1. The mechanism — three money streams (replacing the even dividend)

Each day a firm's distributable surplus (cash above its reserve) splits into three
`World.transfer` streams — **all conserved, nothing minted**:

1. **Owner dividend** — ~10% (`OWNER_DIVIDEND_SHARE`, unchanged) → the firm's owner.
2. **Employee profit-share** — the bulk of the remaining ~90% → the firm's **own workers**,
   weighted by their earned wage (`resident.wagePerTick`). This is "redistribute to
   employees through wages." It rides the day-boundary distribution channel, so it is
   **not** blocked by the per-tick wage cap.
3. **Welfare levy → safety-net pool** — a carve-out from the ~90% that tops up each
   non-worker toward **~50% of the average worker's income**.
   - **The landlord (and any employee-less firm) funds the welfare pool.** It has no
     workers to profit-share to, and its surplus is rent extracted from everyone — so the
     rentier financing the safety net is both realistic *and* resolves the "landlord can't
     tilt to wages" problem the panel flagged.
   - **Peg welfare to the *prior day's* average worker income** (one-day lag) to avoid the
     circular dependency (today's worker income depends on the split, which depends on
     welfare, which depends on worker income…). Add an **absolute subsistence floor** so a
     deep bust can't drive a relative-50% peg to near-zero.

A single dial **`WAGE_TILT` (τ, default 0 = today's even dividend)** controls how far the
people-pool moves from "even to all" toward "profit-share to workers + welfare to
non-workers." We **ramp τ toward ~0.9 in measured notches**, never jump.

## 2. Rules & caps to remove / relax (the deregulation list)

| # | Rule / cap | Where | Why it must go (for the free market) | When |
|---|---|---|---|---|
| 1 | **Even dividend to ALL residents** | `DistributionSystem.ts:73–80` | the artificial "seal" / emergent UBI; replace with profit-share + welfare | **now** (the core change) |
| 2 | **`PROFIT_DISTRIBUTION_CAP = 900`/day** | `constants.ts:253` | throttles how much a firm can return; "redistribute to a large degree" needs the *full* surplus to flow | **now** (raise → remove) |
| 3 | **`MAX_WAGE_MULT = 2`** + the **`maxWagePerTick = 1`** absolute clamp | `constants.ts:110`, `ai/clamp.ts:18` | the 2× wage ceiling blocks free wage discovery + a real labour market (and the absolute clamp silently caps storefronts but not producers) | **later** (when we add a labour market; the profit-share channel routes around it first) |
| 4 | **`BUSINESS_RESERVE = 3000` / `LANDLORD_RESERVE = 4500`** | `constants.ts:250–251` | firms hoard working capital before distributing; a freer market runs thinner buffers and takes more risk (more volatility, real failures) | **relax in notches** (raises payout + amplitude) |
| 5 | **`PRODUCER_WAGE_FLOOR = 0.12`** | `constants.ts:125` | an artificial wage *floor* — pure anti-free-market price control; wages should be market-set | **much later + carefully** — it prevented a supply-chain collapse (decisive at seed 7); only remove once a labour market can hold producer wages up organically |
| — | *(keep)* **`OWNER_DIVIDEND_SHARE = 0.1`** | `constants.ts:267` | already the ~10% capital share we want — **no change** | — |

Each removal is its own flag-gated, measured slice — we deregulate *incrementally* and
watch what happens, not all at once.

## 3. The plan — safety-first ramp to the targets

- **S0 — Instrument (no behaviour change).** Add `WAGE_TILT` (=0) + plumbing; split
  `ProfitAndLoss` into `wages` / `dividend` / `profitShare` / `welfare`; fix the
  `MacroSample.payroll` mislabel; add the headline **`wageChannelShare`** + a **solvency
  census** (count `money<=0` / `rentMissedDays>0` by cohort: workers vs non-workers).
  *Gate:* default == `τ:0` byte-identical; `totalMoney` conserved.
- **S1 — The three-stream split, default OFF.** In `DistributionSystem`: owner 10% →
  employee profit-share (by `resident.wagePerTick`) → welfare carve-out → even pool = the
  exact arithmetic remainder (so no cent is created/lost). Landlord/employee-less surplus
  routes to welfare. *Gate:* with τ>0 workers gain, money conserved to the cent.
- **S2 — Enforce the welfare floor BEFORE ramping.** Welfare tops up non-workers to
  ~50% of the lagged average worker income, with an absolute subsistence floor. **Non-worker
  solvency becomes a hard CI gate** (must stay 0 insolvent across births/mortality on & off).
- **S3 — Remove the distribution cap + ramp the tilt.** Delete/raise `PROFIT_DISTRIBUTION_CAP`;
  ramp τ in notches **0.1 → 0.3 → 0.6 → 0.9**, each gated on: non-worker solvency = 0,
  demand/GDP within a band vs the τ=0 baseline, and **cycle amplitude** bounded (boom-bust,
  not death-spiral). Stop / roll back a notch if a step breaks a gate.
- **S4 — Relax reserves** in notches (more flows out, more volatility) — measured.
- **S5 — Free-market labour (later):** remove the wage cap (`MAX_WAGE_MULT` +
  `maxWagePerTick`), add scarcity wage-bidding, so wages set themselves.
- **S6 — Remove the producer wage floor (much later):** only after S5 can hold producer
  wages up; watch seed 7 for the old supply-chain collapse.
- **(The fork — later, deliberate):** money creation for inflation + indefinite growth
  (see `VISION.md` §fork). Not part of #1.

## 4. Critical thinking on the aggressive targets

- **The welfare floor is the whole safety harness.** At τ≈0.9 with reserves thinned and the
  cap gone, almost all of a firm's surplus flows to its workers — so a non-worker's *only*
  income is welfare. If welfare fails, ⅓ of the town goes destitute → demand collapse. The
  welfare floor (50% of avg worker + an absolute subsistence minimum) is what keeps the
  economy from imploding as we deregulate. **Build and prove it before ramping τ.**
- **It will get genuinely volatile — that's the point, with a catch.** 90%-to-workers +
  thin reserves + no distribution cap makes income highly pro-cyclical: booms and busts,
  real inequality, occasional firm failures. *Desirable* to observe. The danger is a
  runaway death-spiral (this codebase produced one once). Mitigation: the welfare floor is
  a counter-cyclical stabilizer (relatively larger in busts), and every τ notch is gated on
  bounded cycle amplitude with per-notch rollback. We measure the difference between a
  *business cycle* and a *collapse* explicitly.
- **The welfare peg is relative — protect it.** Pegging welfare to *average worker income*
  means in a deep bust welfare shrinks with wages (soft floor). The absolute subsistence
  minimum is the backstop so a bust can't zero the safety net.
- **Removing `PRODUCER_WAGE_FLOOR` is the riskiest deregulation.** It's a price control, so
  the free market wants it gone — but it was load-bearing (its removal collapsed the supply
  chain at seed 7). Defer it to last, behind a working labour market.
- **Still fully conserved.** Every stream is a `World.transfer`; `totalMoney()` stays flat
  to the cent through all of Initiative #1. The 90/10 split is a *redistribution*, not money
  creation. Inflation + indefinite growth (which *need* money creation) remain the later,
  separately-decided fork.
- **"Wild west" = studied chaos, not bugs.** We accept failures, inequality, and volatility
  as **outcomes to observe** — kept analysable by determinism (every run reproducible),
  measurement (the metrics below), and per-slice rollback (any deregulation that proves
  non-viable reverts to a flag).

## 5. What to measure each step

| Metric | Watch for |
|---|---|
| **wageChannelShare** = (wages+profitShare)/(wages+profitShare+dividend) | climbs toward ~0.9 as τ ramps; flat ⇒ landlord-fold throttling |
| **Capital vs labour split** = owner take vs people take | converges to ~10/90 |
| **Solvency census** (by cohort) | **non-workers must stay solvent** — hard CI gate |
| **Welfare ratio** = avg non-worker income ÷ avg worker income | tracks the ~0.5 target |
| Demand / GDP vs same-seed τ=0 baseline | within band; abort the notch on monotonic decline |
| **Cycle amplitude** (peak-to-trough of consumption + unemployment) | bounded = business cycle; runaway = death-spiral |
| Inequality (Gini of resident wealth) | rises as we deregulate — expected; watch it's not total |
| Pooling (business-cash share; max holder) | should fall (money flows to people, not hoards) |
| Conservation (`totalMoney` vs start) | `toBeCloseTo(start, 2)` every slice |
| Determinism (snapshot equality) | any diff = ordering/RNG break |

## 6. Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Non-worker destitution at high τ | welfare floor (50%-of-avg + absolute min) enforced *before* the ramp; hard solvency gate | `WAGE_TILT=0` (byte-identical) |
| Death-spiral from thin reserves + 90% tilt | counter-cyclical welfare floor; per-notch amplitude gate | drop τ a notch / restore a reserve |
| Welfare floor collapses in a bust (relative peg) | absolute subsistence backstop | raise the absolute floor |
| Producer supply-chain collapse on floor removal | defer S6 behind a working labour market; watch seed 7 | restore `PRODUCER_WAGE_FLOOR` |
| Conservation drift | even pool = arithmetic remainder; `toBeCloseTo(start,2)` every slice | revert slice (test fails loudly) |
| Determinism break | fixed `employeeIds` order, scalar math, no RNG | revert slice |
| Crossing the money-creation fork by accident | #1 mints nothing; `World.create` doesn't exist yet | guarded by absence of a mint primitive |

---

*The 10-agent panel's foundational analysis (the three approaches, the demand-pump
reasoning, the circular-flow and pro-cyclicality critique) underpins this plan; this
revision applies the user's concrete 90/10 + 50%-welfare targets and the deregulation
agenda on top of it.*
