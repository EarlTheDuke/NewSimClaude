# Phase 18 — Credit & Finance (banking)

> **STATUS: RESUMED as Initiative C / leg C1 (2026-06-08). 18a SHIPPED.** This is the detailed,
> adversarially-verified design for the credit leg of [INITIATIVE-04-GDP-GROWTH.md](INITIATIVE-04-GDP-GROWTH.md).
> Designed via a multi-agent workflow (3 independent designs — minimal-first, conservation-first,
> CEO-lever-first — each stress-tested for money-leaks and determinism breaks, then synthesized).
>
> **Re-grounding (the design predates Initiative A slice 4d).** The data-driven `INDUSTRY_REGISTRY`
> (4d) + capability flags (4b) + the renderer's `BUSINESS_RGB_DEFAULT` fallback **simplify the seam**:
> **18a needs NO `BusinessKind` union / `ARCHETYPES` / `BUSINESS_HEX` change** (those "must move in 18a
> or typecheck fails" call-outs no longer apply). The bank arrives in **18b** as a registry entry with
> a **`bank` role flag** (the 4b pattern), seeded only under `includeBank`. Re-verify every file/line
> below against current code before building each remaining slice.
>
> House doc in the PHASE15/PHASE17 style. Every slice ships byte-identical to the brain-off
> baseline until a flag/constant is deliberately engaged; the whole subsystem is frozen OFF in
> the CEO bench. Resolves every `mustFix` from the three adversarial verdicts.

---

## 1. Context / Why

Retained earnings (Phase 16) are one way a firm funds growth; **credit is the other.** Phase 18
makes *"should I lever up to expand?"* a real, conserving CEO decision: a firm borrows from a
Bank to fund Phase-17 brand demand or Phase-12 capital faster than it can self-fund, pays
interest as a daily cash outflow, services or defaults on the debt under Phase-15 lifecycle
pressure, and — once the spread is healthy — earns yield on idle cash so hoarding is no longer
free. Credit only *pays* where there is growth to fund, so Phase 18 assumes Phases 16–17 are in
place (they are). The Bank is just another conserving holder; debt is non-cash bookkeeping;
money moves only through `World.transfer`.

---

## 2. The Decisive Corrections

The adversarial pass forced these. They are non-negotiable and baked into the slices.

- **Interest is a transfer, never a mint.** Daily interest is `World.transfer(firm → bank)`,
  capped at the firm's cash. Any shortfall is parked in `debt.accruedInterest` — a non-cash
  claim, never created money. The bank gains exactly what the firm pays.
- **Default settles *through* holders to the lender first.** On bankruptcy, `LifecycleSystem`
  routes the husk's residual cash `firm → bank` (capped at `min(cash, owed)`) **before** the
  existing `RECYCLE_BANKRUPT_ASSETS` `firm → owner` drain. Unrecovered debt is a real bank
  capital loss (the bank already paid out at borrow time and just doesn't get it back) — no
  burn, no mint. Priority changes only *who* receives, never the total.
- **The Bank is counted in `totalMoney()` from genesis.** It is a `Business` (`kind: "bank"`),
  so `World.totalMoney()` sums it for free and `structuredClone` serializes it for free. Its
  seed cash is **carved from the landlord's seeded 4000** so the genesis total (`macro.test`
  pins `30000`) is untouched.
- **The type-union change and its two total-record consumers move together.** Adding `"bank"`
  to `BusinessKind` immediately breaks two `Record<BusinessKind, …>` maps — `ARCHETYPES` and
  `BUSINESS_HEX` (+ the derived `BUSINESS_RGB` cast). Both `bank` entries land in **18a, the
  same slice as the union change**, or typecheck fails.
- **The bank is excluded from the distribution sweep in the slice that seeds it.**
  `DistributionSystem` gives any non-landlord kind `BUSINESS_RESERVE` (3000) and sweeps the
  rest nightly. A `bank` branch (`BANK_RESERVE`) lands in **18b** (the seeding slice) or the
  bank is drained to 3000 on day 1 and lending capacity is dead on arrival.
- **`includeBank`/`creditEnabled` are strictly opt-in, NEVER implied by the live constants.**
  `createCity` must not do `includeBank = options.creditEnabled ?? CREDIT_ENABLED`. The default
  city has no bank and `activeBusinesses===7` even after the live knobs flip.
- **Schedules are seeded and survive restore.** Accrual fires only at the day boundary
  (`ctx.totalTicks % TICKS_PER_DAY === 0`); interest is `principal * rate` (flat,
  time-independent), so `originDay` is informational. `CreditSystem` holds **no own state** —
  debt rides on `Business` in `WorldSnapshot.businesses`, so restore resumes mid-loan
  identically.
- **Financing flows are netted out of the observation.** Borrow/repay/interest move cash and
  would corrupt `dayProfit = biz.cash − prevCash` and the derived `dayRent`. A `dayFinancing`
  term is subtracted so the firm's mind doesn't misread a loan as profit or debt service as
  rent.
- **The bank cannot be bankrupted.** `LifecycleSystem.reviewSolvency` gets a `kind === "bank"`
  early-exit guard; a central bank doesn't liquidate to its owner and silently kill the
  subsystem.

---

## 3. Dependency-Ordered Slice Sequence

| Slice | One line |
|---|---|
| **✅ 18a** | Inert seam — SHIPPED (re-grounded): `Business.debt?` / `pnl.debtService?` types + all `CREDIT_*`/`BANK_*`/`BENCH_CREDIT_ENABLED` constants (inert) + no-op `CreditSystem` stub (registered between Distribution and Lifecycle) + `creditEnabled?` option. **NO union/record change** (4d/4b made it unnecessary). `credit.test.ts`: no debt booked, conserved, round-trips, deterministic, `creditEnabled:true` still a no-op. 428 tests green, byte-identical. |
| **✅ 18b** | Seed the Bank — SHIPPED (re-grounded): a `BANK_INDUSTRY` registry entry with a **`bank` role flag** (registered only under `includeBank`); `cityGen` seeds `biz_bank` co-located with the landlord, **cash carved from the landlord** (genesis total unchanged), non-producing (never staffed), `capital:0`. `BANK_RESERVE` branch in `DistributionSystem` (keyed on the flag) + bank-never-bankrupts guard in `LifecycleSystem`. Strictly opt-in ⇒ default city has no bank and `activeBusinesses===7`. 432 tests green. Still no lending. |
| **✅ 18c** | Borrow lever — SHIPPED: `BusinessAction.borrow` + `maxBorrowPerReview` clamp; `BusinessAgentSystem.applyBorrow` does a `bank→firm` transfer (applied first, so the firm can spend borrowed cash same-review) and books `debt.principal`/`borrowed` — with the `moved<=0` guard ABOVE the ledger write (no phantom debt). Bounded by the per-review clamp, the `creditMaxPrincipal` ceiling, AND the bank's cash. Threaded `creditEnabled`/`creditMaxPrincipal` via createCity. Rules brain silent. 437 tests green; default byte-identical. |
| **✅ 18d** | Interest accrual — SHIPPED: `CreditSystem.update()` goes live — daily `firm→bank` transfer of `principal × rate` (capped at firm cash; shortfall → `accruedInterest`); `pnl.debtService += paid`; fixed array order, fixed-id bank. `creditDailyRate` threaded via createCity. Rate 0 (default) ⇒ never runs ⇒ byte-identical. Tests: interest recouped + conserved, shortfall parks as a claim, rate-0 no debtService, save/reload mid-loan. 441 tests green. |
| **✅ 18e** | Repay lever — SHIPPED: `BusinessAction.repay` (fraction 0..1) + clamp; `applyRepay` does a cash-capped `firm→bank` transfer, waterfall **interest-first then principal**, `pnl.debtService += moved`; an emptied loan is **deleted** (byte-identical shape). Conserving (write-down non-cash). Tests: full repay clears + deletes, partial follows the waterfall, disabled ⇒ untouched, deterministic. 445 tests green. |
| **✅ 18f** | Default settlement — SHIPPED: in `LifecycleSystem.reviewSolvency`, a bankrupt debtor settles `husk→bank` (interest-then-principal, capped at min(cash,owed)) **before** the `→owner` recycle; unrecovered debt is written off (real bank loss). `creditEnabled` threaded into the constructor; debt-free firms byte-identical to Phase 15 D. Tests: bank paid first + conserved, off ⇒ owner gets it, deterministic. 448 tests green. |
| **✅ 18g** | Observation slice — SHIPPED: surfaced `debtPrincipal/debtInterest/borrowed/debtServicePaid` (off `biz.debt`, absent ⇒ debt-free) + `creditRate` (present only when credit engaged); **netted financing out of `dayProfit`/`dayRent`** via `dayFinancing = dayBorrowed − dayDebtService` (a `borrowed` field added to the ephemeral Bookmark; the `max(0,…)` handles repay+delete). Zero when credit-free ⇒ observation byte-identical. Tests: fields match the ledger, debt-free omits them, off ⇒ all undefined, A/B shows a loan isn't read as profit. 453 tests green. |
| **18h** | Engage live + teach `RuleBasedProvider` a conservative borrow-to-invest / repay-when-flush heuristic; debt-service-before-dividends priority; A/B soak. |
| **18i** | Optional savings interest (`bank → idle-cash holders`), default rate 0 ⇒ doubly dormant; closes the Phase-16 retain-hoard exploit. |
| **18j** | Benchmark freeze: `BENCH_CREDIT_ENABLED=false`, `includeBank:false` in `ceoBench`; soak re-baseline (credit-ON live only). |

---

## 4. Sub-Slices

### 18a — Inert credit seam (type + stub, byte-identical)
- `src/world/types.ts`: add `"bank"` to `BusinessKind`; add optional `debt?: { principal: number; accruedInterest: number; originDay: number; borrowed?: number }` to `Business` and `debtService?: number` to `ProfitAndLoss` (JSDoc'd "never money", mirroring `capital`/`brand`).
- `src/world/archetypes.ts`: add `bank` to `ARCHETYPES` (the landlord/non-producing shape — `sellsToResidents:false`, `target:0`, `maxPerDay:0`). Part of the type seam, not deferrable. `desiredHeadcount` then returns 0, so the bank is never staffed.
- `src/render/CanvasRenderer.ts`: add `bank` to `BUSINESS_HEX` (satisfies the total record + the `BUSINESS_RGB` cast).
- `src/systems/constants.ts`: inert knobs (each JSDoc'd in plain real-world terms) — `CREDIT_ENABLED=false`, `CREDIT_DAILY_INTEREST_RATE=0`, `CREDIT_MAX_PRINCIPAL_PER_FIRM=0`, `CREDIT_SAVINGS_DAILY_RATE=0`, `BANK_RESERVE=4500`, `BANK_SEED_CASH` (carve target, e.g. 1500), `BENCH_CREDIT_ENABLED=false`.
- `src/createCity.ts`: add `creditEnabled?: boolean` and `includeBank?: boolean` to `CitySimOptions` (both default `undefined`). Construct `new CreditSystem(world, options.creditEnabled ?? CREDIT_ENABLED)` and register it **between DistributionSystem and LifecycleSystem**.
- `src/systems/CreditSystem.ts`: new `implements System`, `id="credit"`; `update(ctx)` first line `if (!enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;` then empty. No own state ⇒ no serialize/restore.
- Do **not** seed a bank; do **not** seed any `debt` field.
- **Test** (`src/systems/credit.test.ts`, new): over 30 days on `createCity({seed:1})`, `"debt" in b === false` for every business; `totalMoney()` conserved; serialize→restore deep-equals; seed-7-twice → equal `serialize()`; typecheck green (proves the two total records are satisfied).

### 18b — Seed the Bank as a conserving holder (no lending)
- `src/world/cityGen.ts`: add `CityOptions.includeBank?`. When set, push `loc_bank` (a real workplace Location) and a fully-formed `biz_bank` Business (`kind:"bank"`, `cash:BANK_SEED_CASH`, `capital:0`/none, neutral owner). **Carve `BANK_SEED_CASH` from the landlord's seeded 4000** so genesis total is unchanged. Not in `agenticBusinessIds`. `ENTRANT_KINDS` already excludes `bank` (no entrepreneur can found one).
- `src/createCity.ts`: pass `includeBank: options.includeBank ?? false` — **never** `?? creditEnabled`/`?? CREDIT_ENABLED` (protects `macro.test`'s count).
- `src/systems/DistributionSystem.ts`: `reserve = … : biz.kind === "bank" ? BANK_RESERVE : BUSINESS_RESERVE`.
- `src/systems/LifecycleSystem.ts` (`reviewSolvency`, first line): `if (biz.kind === "bank") return;`.
- **Test**: `createCity({seed:1, includeBank:true})` runs 60 days without throwing; bank exists; `totalMoney()` conserved (carve); bank never swept below reserve. Guard: default city (no flags) has no `biz_bank` and `activeBusinesses===7`. Determinism with `includeBank:true`.

### 18c — Borrow lever (`bank → firm`, principal booked)
- `src/ai/types.ts`: `BusinessAction.borrow?: number`.
- `src/ai/clamp.ts`: `DecisionLimits.maxBorrowPerReview`; `out.borrow = clamp(action.borrow, 0, max)`; add to `DEFAULT_LIMITS`.
- `src/systems/BusinessAgentSystem.ts`: thread `creditEnabled`; in `apply()` after invest, `applyBorrow(biz, requested)` — resolve `bank=getBusiness("biz_bank")`; guard `!bank || bank.id===biz.id`; `want = min(requested, CREDIT_MAX_PRINCIPAL_PER_FIRM − (debt?.principal ?? 0))`; `if (want<=0) return 0`; `moved = transfer(bank.id, biz.id, want)`; `if (moved<=0) return 0` **before any ledger write**; then book `debt.principal += moved`, `debt.borrowed += moved`.
- Rules brain does NOT emit `borrow` yet.
- **Test**: MockProvider `{borrow:1000}` → `debt.principal === moved`, bank cash drops the same, total conserved; ceiling stops further borrowing; `creditEnabled:false` ⇒ `debt` undefined; determinism.

### 18d — Interest accrual (`firm → bank` daily transfer)
- `CreditSystem.update()` goes live at the day boundary: for each active business with `debt.principal>0`: `interest = principal * CREDIT_DAILY_INTEREST_RATE`; `paid = transfer(biz.id, bank.id, interest)`; `pnl.debtService += paid`; shortfall `debt.accruedInterest += (interest − paid)`. Resolve bank by fixed id; guard self. Iterate `world.businesses` in array order. Runs **after `DistributionSystem`, before `LifecycleSystem`**. Rate defaults 0.
- **Test**: borrow then run at rate 0.01 → bank cash up ~`Σ principal*rate`, `pnl.debtService` accrued, total conserved over 60 days. Capped-shortfall edge: `paid === min(interest, firmCash)`. Rate 0 ⇒ byte-identical. Save/reload mid-loan continuity.

### 18e — Repay lever (`firm → bank`, interest-then-principal)
- `BusinessAction.repay?: number` (fraction 0..1 of total owed); clamp `[0,1]`.
- `applyRepay`: `owed = principal + accruedInterest`; `target = owed*fraction`; `moved = transfer(biz.id, bank.id, target)` (capped at cash); waterfall interest-first then principal; `pnl.debtService += moved`; if both `~0`, **delete `biz.debt`** (restores byte-identical shape). No reserve floor (real deleveraging), but transfer caps at cash.
- **Test**: full repay deletes debt, bank cash = pre-loan + interest; partial repay follows the waterfall; round-trip mid-loan.

### 18f — Default settlement to the lender (via `LifecycleSystem`)
- In `reviewSolvency()` (bank already early-exits), after layoffs and **before** the `RECYCLE_BANKRUPT_ASSETS` owner transfer, insert a credit-gated block: if firm has debt and cash>0, `recovery = min(cash, owed)`, `transfer(biz.id, bank.id, recovery)`, reduce accruedInterest then principal. Remaining husk cash → owner (existing). Unrecovered debt written off (bank loss). Thread `creditEnabled` into the `LifecycleSystem` constructor.
- **Test**: drive a debtor bankrupt (`businessEntry:false`) with `creditEnabled:true` → bank gets `min(huskCash, owed)` **before** the owner; husk cash → 0; unrecovered debt is a measured bank loss; total conserved. Control `creditEnabled:false` → byte-identical to Phase-15-D. Save/reload across the default.

### 18g — Surface credit state + net financing out of the observation (read-only)
- `BusinessObservation`: add optional `debtPrincipal?`, `debtInterest?`, `borrowed?`, `debtServicePaid?`, `creditRate?`.
- `observe()`: populate from `biz.debt`/`biz.pnl.debtService` (undefined-safe); thread effective `creditRate` via constructor (mirrors `brandElasticity`). **Fix the cash identity:** track `dayFinancing = dayBorrowed − dayDebtService` and subtract it so `dayProfit`/`dayRent` exclude financing.
- **Test**: fields match the ledger; debt-free firm omits them; identity test (rent term unchanged at equal operating flows); no-borrow city unchanged vs 18f.

### 18h — Engage credit live + rules heuristic + debt-service-before-dividends + soak
- `constants.ts`: after a tuning sweep (the `PRODUCER_WAGE_FLOOR=0.12` precedent), set live `CREDIT_ENABLED=true`, `CREDIT_DAILY_INTEREST_RATE` (~0.001–0.005/day), `CREDIT_MAX_PRINCIPAL_PER_FIRM` (real ceiling), bank seed/reserve. `BENCH_*` stay OFF.
- `RuleBasedProvider`: conservative policy **gated on `o.creditEnabled === true`** (mirrors the brand dead-lever guard) — BORROW only when capacity-bound + profitable + expected return clears interest + below ceiling; REPAY when cash well above reserve and not capacity-bound. Apply order borrow → brand → invest.
- `DistributionSystem`: **debt-service priority** — when `creditEnabled && debt.principal>0`, subtract interest-due from the surplus pool before the cap/`payoutRate`, floored at 0.
- **Falsifiable success bar:** this economy is demand-driven, not cash-starved (util ~0.85). Borrowed capital depreciates ~1%/day while interest accrues, so credit-ON may *tie* OFF. **Run the sweep first and pick the weaker provable bar:** if A/B doesn't clear a margin, scope 18h to *"credit is available, conserving, harmless"* and defer compounding to a depreciation/elasticity retune.
- **Test**: `capital.test`-style A/B over ~2yr — ON meets the swept bar, total conserved both, producers crewed + both diners survive, determinism, mid-run restore. Distribution-priority test.

### 18i — Optional savings interest (doubly dormant)
- In `CreditSystem.update()`, gated on `creditEnabled && CREDIT_SAVINGS_DAILY_RATE>0`: for each non-bank business, `idle = max(0, cash − reserve)`, `transfer(bank.id, biz.id, min(idle*rate, bank.cash))` (never below bank reserve). The spread `interest − savings` is the bank's margin and the CEO's cost-of-carry. Makes hoarded retained earnings no longer *free* net worth (closes the Phase-16 100%-retain exploit).
- **Test**: rate 0 ⇒ byte-identical; rate>0 ⇒ each depositor's gain == `idle*rate` == bank's drop; bank never below reserve; total conserved; determinism.

### 18j — Benchmark freeze + soak re-baseline
- `ceoBench.ts` `setupScenario`: pass `creditEnabled: BENCH_CREDIT_ENABLED` (false) **and** `includeBank: false`, alongside the existing frozen knobs. Document that credit is frozen OFF.
- Optionally extend `ablationStudy` lever list to `borrow`/`repay` for a *future, versioned* credit-bench re-baseline.
- Re-baseline the soak **with credit ON in the live world only**, after the 18h sweep + a borrow-then-bankrupt safeguard.
- **Test**: `ceoBench.test` off/rules scorecards byte-identical for seeds {1,7,42}; no `biz_bank` in the bench world. Soak re-baselined credit-ON.

---

## 5. Conservation & Determinism Proof-Sketches

- **Interest (18d):** `transfer(firm → bank, min(interest, firmCash))` — giver loses exactly what receiver gains; shortfall is a non-cash claim. `totalMoney()` invariant. Flat `principal*rate`, fixed day boundary, array order, fixed-id bank, no RNG/clock; `accruedInterest` rides the snapshot → restore resumes mid-loan.
- **Default (18f):** `husk → bank` (capped), then `husk → owner` drains to 0. Every dollar lands in a real holder; unrecovered debt is a written-off non-cash claim. Priority changes who, not the total. Triggered by the existing deterministic `insolventDays` streak; survives serialize/restore.
- **Savings (18i):** `bank → saver`, capped at bank cash (≥ `BANK_RESERVE`) — no mint; bank counted in `totalMoney()`. Same fixed boundary + order + pure arithmetic.
- **Observation netting (18g):** read-only ⇒ conservation trivial; `dayFinancing` is pure arithmetic on persisted deltas.

---

## 6. Benchmark Discipline

Credit lives in the live world but is **frozen OFF** in the CEO bench: `creditEnabled:false` +
`includeBank:false` into `createCity` in `setupScenario`, mirroring the
`BENCH_WEALTH_ELASTICITY`/`BENCH_OWNER_DIVIDEND_SHARE`/`BENCH_BRAND_DEMAND_ELASTICITY`/`producerWageFloor:0`
freezes. No bank, no credit flows ⇒ score byte-identical to pre-18; `|moneyDelta| < 1e-6`
holds. Scoring leverage skill later is a deliberate, versioned bench re-baseline.

---

## 7. Test Impact

- **Sacred (stay GREEN unchanged through 18a–18g, default/bench through 18i):** `macro.test`
  (`activeBusinesses===7`, `totalMoney≈30000` on default city — protected by the landlord
  carve + strictly-opt-in `includeBank`); `ceoBench.test` (rules≥off, conserved, scorecards —
  protected by the 18j freeze); `capital.test`/`brand.test` round-trips (new fields absent).
- **Re-baseline (deliberately, credit-ON live worlds only):** the soak (after 18h + safeguards);
  `distribution.test` if the 18h debt-service branch changes a credit-ON payout.
- **New:** `src/systems/credit.test.ts` — one grill per sub-slice, each asserting
  `totalMoney()` ≥4dp and seed-twice → equal `serialize()`.

---

## 8. Risks & Rollback

| # | Risk | Mitigation | Rollback |
|---|---|---|---|
| R1 | `"bank"` union breaks the two total records | both entries in **18a** | revert 18a |
| R2 | Seeded bank crashes Market/Macro/observe via `ARCHETYPES[kind]` | `ARCHETYPES.bank` in 18a; 18b run-without-throw test | `includeBank:false` |
| R3 | Distribution drains the bank nightly | `BANK_RESERVE` branch in **18b** | `includeBank:false` |
| R4 | Live flip seeds a bank in default city → `macro.test` count breaks | `includeBank` strictly explicit; guard test | `includeBank` unset |
| R5 | Bank insolvency kills the subsystem | `kind==="bank"` early-exit in `reviewSolvency` (18b) | the guard is the rollback |
| R6 | Financing corrupts `dayProfit`/`dayRent` | `dayFinancing` netting in 18g | `creditEnabled:false` |
| R7 | "Credit compounds" may not hold (demand-driven economy) | sweep first; falsifiable bar; scope to "available & harmless" if it ties | keep `CREDIT_ENABLED=false` |
| R8 | Bank owner collects dividends on interest profit | neutral/no-dividend owner; test no owner dividend from bank interest | don't recirculate |
| R9 | Borrow-then-bankrupt churn breaks the soak | sweep + new-debt grace/min-cash-after-borrow guard before 18j | revert live knobs |
| R10 | Bank `capital` inflates `MacroSystem.totalCapital` | seed bank `capital:0`/none | `includeBank:false` |

**Universal escape:** 18a–18g are byte-identical with `CREDIT_ENABLED=false` + `includeBank`
unset; 18h–18i revert by setting the live knobs back to `false`/`0`. No slice requires undoing a
prior slice's structure to disable behaviour.

---

## 9. Definition of Done (whole phase)

All three gates GREEN (`typecheck`, `test:run`, `build`). Sacred invariants hold:
1. **Conservation** — every credit flow is a `World.transfer` between conserving holders;
   `totalMoney()` invariant to the cent in every test, including a 2-year soak and through a
   debtor bankruptcy; unrecovered default debt is a real bank loss, not a vanish.
2. **Determinism** — no RNG/wall-clock/iteration-order in any credit path; identical seed →
   identical `serialize()` after 40 days for every flag-on config; `CreditSystem` stateless,
   debt rides `Business`, so save/reload resumes mid-loan byte-for-byte.
3. **No-op default** — 18a–18g byte-identical until engaged in 18h/18i; each slice has an
   explicit OFF-equals-baseline test; the seeded bank (18b) runs ON without throwing.
4. **Correctness fixes landed** — the two total records carry a `bank` entry; the bank is
   excluded from the distribution sweep and from bankruptcy; `includeBank` strictly opt-in;
   financing netted out of the observation; the bank carries no plant capital.
5. **Benchmark discipline** — credit frozen OFF in `ceoBench`; historical scorecards unchanged;
   no `biz_bank` in the bench world.
6. **Falsifiable engagement** — 18h's live values come from an empirical sweep with a defined,
   provable success bar; if compounding isn't demonstrable, scope to "available, conserving,
   harmless" and defer compounding to a paired retune.

Each slice committed and pushed, with a plain-English real-world explanation in every constant's
JSDoc.

---

## 10. Critical Files

- `src/world/types.ts` — `BusinessKind` union; `Business.debt?`; `ProfitAndLoss.debtService?`.
- `src/world/archetypes.ts` — `ARCHETYPES.bank` (total-record satisfier).
- `src/render/CanvasRenderer.ts` — `BUSINESS_HEX.bank` (total-record satisfier).
- `src/world/cityGen.ts` — bank seed (carved from landlord), `loc_bank`, `includeBank` option.
- `src/systems/constants.ts` — all `CREDIT_*` + `BANK_*` + `BENCH_CREDIT_ENABLED` knobs.
- `src/createCity.ts` — `creditEnabled`/`includeBank` options; `CreditSystem` registration
  (between Distribution and Lifecycle); strictly-opt-in `includeBank` wiring.
- `src/systems/CreditSystem.ts` — interest accrual (18d), savings (18i); stateless.
- `src/systems/DistributionSystem.ts` — `BANK_RESERVE` branch (18b); debt-service priority (18h).
- `src/systems/LifecycleSystem.ts` — bank-is-special guard (18b); default settlement (18f).
- `src/systems/BusinessAgentSystem.ts` — `applyBorrow`/`applyRepay`; observation fields +
  `dayFinancing` netting (18g); `creditEnabled`/`creditRate` threading.
- `src/ai/types.ts` — `BusinessAction.borrow`/`.repay`; `BusinessObservation` credit fields.
- `src/ai/clamp.ts` — `maxBorrowPerReview`, `repay` clamp, `DEFAULT_LIMITS`.
- `src/ai/RuleBasedProvider.ts` — borrow/repay heuristic gated on `o.creditEnabled` (18h).
- `src/bench/ceoBench.ts` — `BENCH_CREDIT_ENABLED`/`includeBank:false` freeze (18j).
- `src/systems/credit.test.ts` — new; full per-slice grill.
- `src/systems/soak.test.ts`, `src/systems/macro.test.ts`, `src/bench/ceoBench.test.ts`,
  `src/systems/distribution.test.ts` — sacred / deliberate re-baseline.
