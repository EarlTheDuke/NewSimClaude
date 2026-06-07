# Phase 17 — Demand can grow (the marketing/quality lever)

> Implement slice by slice. This is the **firm-level demand-growth lever** that NORTH-STAR move **#1** ("let wants grow with wealth — the keystone") demands at firm granularity, and the direct prerequisite that **unblocks then finishes Phase 16** (slices 3 + 4). Status tracked at the bottom; the operating manual is [CLAUDE.md](CLAUDE.md), the sequence [ROADMAP.md](ROADMAP.md), the compass [NORTH-STAR.md](NORTH-STAR.md).

## Why (North-Star + ROADMAP alignment)

**NORTH-STAR move #1 — the keystone, at firm granularity.** Real people don't have fixed appetites, and real firms don't face fixed demand: a firm spends on advertising, product quality, ambience, and reputation to *grow its own demand*. Today demand tops out at ~12 residents' wants, so capacity never stays bound, the invest gate self-extinguishes, and the CEO game is a *managed decline* ([PLAYTHROUGH.md](PLAYTHROUGH.md): net worth fell 50,196 → 26,805; the lone price lever only changed margin-per-sale, never built). NORTH-STAR: *"an uncapped market is the only kind where a skilled LLM CEO can pull away from a mediocre one; with a hard ceiling everyone scores the same."* Phase 17 lifts that ceiling.

**Why this unblocks Phase 16 (the measured wall).** Phase 16 stalled because **demand is capped**:
- Slice 2 (flat-buffer retain) was *reverted* — retained cash → more invest → lower capital-poisoned utilization → the invest gate (`utilization > 0.45`) self-extinguishes.
- Slice 3's `TARGET_CAPITAL_SCALING` probe was *refuted* (3 yr, seeds 1 & 7): turning it on made the engine **worse** (capital 879 → 189; invest/day yr2–3 = 0). The engine doesn't die from poisoned utilization (util stayed 65–77%, above the gate) — it dies from **cash**: distribution drains every firm to its reserve, so the cash gate only clears in year 1's exceptional surplus, and bigger targets cost *more* to fill, starving cash further. **It pushed supply with no demand pull.**

Phase 17 is the mirror image: it **pulls demand without inflating the supply buffer.** That is the missing precondition — retain, invest, and (later) credit all need somewhere to grow *into*. With it, a capacity-bound firm can retain surplus to fund *sustained* investment that chases *growing* demand, so the loop **compounds** instead of self-limiting. Only then can Phase 16 slice 3 (retain → reinvest → grow) and slice 4 (reframe the bench to reward growth) ship cleanly.

**What this is in the real world.** A firm builds *brand equity* — an asset, like productive capital, that you buy, that depreciates, and that has diminishing returns. Productive capital lifts the *supply* ceiling; brand lifts the *demand* ceiling (how much customers will pay, and how much they buy). A Michelin-starred restaurant charges triple a diner for the same calories and is busier; a generic shop is a walk-to-your-neighbourhood choice. Brand is the **demand-side twin of capital** — and that symmetry is the whole design.

## The lever — name + precise semantics

`brand?: number` on `BusinessAction` — cash the firm spends on marketing/quality this review (mirrors `invest`). It builds a non-cash stock:

- **`Business.brand?: number`** — a "brand equity" stock, the **demand-side mirror of `capital`**, quoted relative to `BRAND_BASELINE = 100` exactly as `capital` is quoted relative to `CAPITAL_BASELINE = 100` (`applyInvest` builds `biz.capital = (… ?? CAPITAL_BASELINE) + moved`, `BusinessAgentSystem.ts:182`; `depreciate()` decays only above-baseline excess, `MarketSystem.ts:265–273`; `capitalFactor = pow(capital/BASELINE, elasticity)`, `MarketSystem.ts:234–237`). **Absent ⇒ read as baseline ⇒ factor 1 ⇒ byte-identical.**
- **`Business.brandSpent?: number`** — cumulative cash spent (mirror of `capitalInvested`); for observation/GDP/ROI. **Never money.**

**The one demand axis (decided — see Risk H1).** Brand drives **reservation price only** (Hook A). The unit-per-visit hook (Hook B) ships behind a *separate* constant defaulted to 0 and stays OFF through 17d, because stacking both on the same leisure visit multiplies demand by `brandFactor²` (the `for`-loop at `EconomySystem.ts:112` re-checks the reservation gate *and* runs `units` times) — a silent doubling of the configured elasticity. Hook A alone already delivers "demand grows toward the population cap at constant price," which is the keystone. Hook B is plumbed inert as optional future texture, never engaged in this phase.

**Share-neutrality is a Phase-17 invariant (Risk H5).** Brand lifts the willingness-to-pay of whichever venue a resident *already chose* on price + distance; it is read off the venue **after** `storeForResident` (`EconomySystem.ts:169–183`) picks the store. Brand never enters store selection. So two rival goods stores both spending on brand raise the *whole town's* WTP cooperatively — neither poaches the other. This is load-bearing: it makes the marketing-war a stable Solow equilibrium (concave `pow` lift = linear decay cost), not a positive-feedback share grab to a corner. Any future win-share mechanic (the rejected Design-2 travel hook) is a separate, flagged phase.

## The exact mechanic — bounded, deterministic, diminishing returns + decay

### `brandFactor` — the demand-side twin of `capitalFactor` (pure, exported)

New exported pure function in `EconomySystem.ts` (next to `consumptionUnits`, ~line 202):

```ts
/**
 * Demand-side twin of MarketSystem.capitalFactor: (brand / baseline) ^ elasticity,
 * exactly 1 at BRAND_BASELINE. UNBOUNDED by design — brand 9e9 at e=0.3 returns ~234.
 * Every call site MUST clamp the resulting lift (Hook A clamps the final reservation).
 * elasticity 0 short-circuits to 1: the hard global OFF switch (mirrors consumptionUnits).
 */
export function brandFactor(
  biz: Pick<Business, "brand">,
  elasticity: number = BRAND_DEMAND_ELASTICITY,
): number {
  if (elasticity === 0) return 1;                 // hard OFF switch
  const brand = biz.brand ?? BRAND_BASELINE;      // pre-17 saves read as baseline
  return Math.pow(Math.max(0, brand) / BRAND_BASELINE, elasticity);
}
```

No RNG, no wall-clock, no iteration — `Math.pow` of a stored scalar. The unboundedness is **intentional and tested** (see 17a DoD) so a future careless caller can't be surprised by it; the clamp lives at the hook.

### Decay — folded into the EXISTING `MarketSystem.depreciate()` loop (no new system)

Inside `depreciate()` (`MarketSystem.ts:265–273`), after the capital block, the byte-identical twin:

```ts
const brand = biz.brand ?? BRAND_BASELINE;
if (brand > BRAND_BASELINE) {
  const excess = brand - BRAND_BASELINE;
  biz.brand = BRAND_BASELINE + excess * (1 - BRAND_DEPRECIATION_RATE);
}
```

Only above-baseline brand decays; a no-spend city sits at baseline and **never moves** (the no-op guarantee). Strictly better than a new `MarketingSystem`: zero new system, zero new update-order wiring, runs in the existing daily `this.depreciate()` call.

### Spend → brand (the twin of `applyInvest`, `BusinessAgentSystem.ts:171–188`)

```ts
private applyBrand(biz: Business, requested: number): number {
  const headroom = Math.max(0, biz.cash - BUSINESS_RESERVE);   // never spend into insolvency
  const want = Math.min(requested, headroom);
  if (want <= 0) return 0;
  const sink = this.world.getBusiness("biz_landlord");          // fixed id, matches collectRent
  if (!sink || sink.id === biz.id) return 0;                    // never self-transfer (Risk H3)
  const moved = this.world.transfer(biz.id, sink.id, want);     // the sole money move
  if (moved <= 0) return 0;                                     // keep this guard ABOVE the stock writes
  biz.brand = (biz.brand ?? BRAND_BASELINE) + moved * BRAND_PER_DOLLAR;
  biz.brandSpent = (biz.brandSpent ?? 0) + moved;
  return moved;
}
```

Three folded fixes vs the draft: **(H3a)** resolve the sink by the *fixed id* `getBusiness("biz_landlord")` to match `collectRent` (`EconomySystem.ts:140`) — there is only ever one landlord and it never respawns, so this is equivalent today and unambiguous forever; **(H3b)** `sink.id === biz.id` self-transfer guard, so a hypothetically-agentic landlord can never mint brand for free; **(H1-conservation)** the `moved <= 0` guard stays **above** the `brand`/`brandSpent` writes (mirrors `applyInvest`) so a no-op transfer can never record phantom spend. `BRAND_PER_DOLLAR = 1` keeps brand on the capital scale ($1 → 1 point above baseline 100), so the two stocks tune on the same axis.

### Hook A — reservation price (the lever's teeth), with the final-reservation clamp

`leisureReservation` (`EconomySystem.ts:133–137`) gains the venue and applies a brand premium, **clamped at the final reservation** (Risk H2):

```ts
private leisureReservation(resident: Resident, anchor: number, venue: Business): number {
  const idx = Number(resident.id.split("_")[1] ?? 0);
  const tier = (idx % LEISURE_TOLERANCE_TIERS) / (LEISURE_TOLERANCE_TIERS - 1);
  const lift = brandFactor(venue, this.brandElasticity) - 1;         // 0 at baseline ⇒ no-op
  const lifted = anchor * (1 + LEISURE_PRICE_SPREAD * tier) * (1 + lift);
  const ceiling = anchor * (1 + LEISURE_PRICE_SPREAD);               // = anchor × 1.6, today's top
  return Math.min(ceiling, lifted);                                  // brand lifts the FLOOR up, never past the band
}
```

**Why the final-reservation clamp, not a brand-premium clamp (Risk H2).** The draft clamped the brand premium alone to 0.6 and asserted "max reachable = anchor × 1.6." That was wrong: the tier spread *already* reaches `anchor × 1.6` at the top tier (`tier=1`, spread 0.6), so a brand-maxed top-tier resident would hit `anchor × 1.6 × 1.6 = anchor × 2.56` — a brand-new super-premium region with no analog and no price-discipline backstop. Clamping the *final* reservation to `anchor × (1 + LEISURE_PRICE_SPREAD)` makes the real-world story exact: **marketing converts price-sensitive window-shoppers into buyers** — it lifts the low/mid tiers up toward the *existing* ceiling, never past it. The §"won't price-collapse" bound is then literally true. Sole caller is `spendIfSocializing` (`EconomySystem.ts:115`), which already has `venue` in scope; hoist `const lift`/the call above the per-unit `for` loop since `venue.brand` is loop-invariant (Risk H6, micro-opt).

**Scope note (load-bearing).** The **meal path (`buyMealIfEating`, `EconomySystem.ts:77–95`) has no reservation gate** — meals are inelastic ("one meal sates"). Hook A is therefore *goods-only by construction*; the essential-goods invariant is never touched. `RETAIL_REFERENCE_PRICE.goods = 34` is defined, so the `anchor !== undefined` guard passes for the goods storefront — the lever has teeth on exactly the right target.

### Hook B — units per visit (PLUMBED INERT, OFF through 17d)

`consumptionUnits` gains optional `venue` + `brandUnitsElasticity`, gated on a *separate* constant `BRAND_UNITS_ELASTICITY = 0` so it is a pure no-op in this phase (Risk H1 — never let A and B compound on one visit; Risk H4 — independent of `BRAND_DEMAND_ELASTICITY`):

```ts
export function consumptionUnits(
  resident: Pick<Resident, "id" | "money">,
  elasticity: number = WEALTH_ELASTICITY,
  venue?: Pick<Business, "brand">,
  brandUnitsElasticity: number = BRAND_UNITS_ELASTICITY,
): number {
  if (elasticity === 0 && (venue === undefined || brandUnitsElasticity === 0)) return 1;
  const ratio = Math.max(0, resident.money) / WEALTH_BASELINE;
  const wealthMult = elasticity === 0 ? 1 : Math.max(1, Math.pow(ratio, elasticity));
  const brandMult = (venue && brandUnitsElasticity !== 0) ? brandFactor(venue, brandUnitsElasticity) : 1;
  // Brand units, if ever engaged, get their OWN headroom (BRAND_DEMAND_CAP) so they are
  // not swallowed by WEALTH_DEMAND_CAP, which rich residents already saturate (Risk H2-cap).
  const cap = brandMult > 1 ? BRAND_DEMAND_CAP : WEALTH_DEMAND_CAP;
  const mult = Math.min(cap, Math.max(1, wealthMult * brandMult));
  const idx = Number(resident.id.split("_")[1] ?? 0);
  const phase = (idx % WEALTH_ROUND_TIERS) / WEALTH_ROUND_TIERS;
  return Math.floor(mult + phase);
}
```

The OFF guard uses explicit `venue === undefined` (an active venue with `brand` unset is a real object, correctly `!== undefined`). With `BRAND_UNITS_ELASTICITY = 0` (all of Phase 17) `brandMult ≡ 1` and `cap ≡ WEALTH_DEMAND_CAP`, so this is byte-identical to today. The `BRAND_DEMAND_CAP` headroom and the separate elasticity are *plumbed for a future phase*; they ship inert so the surface is right but the teeth are off.

### Threading

`brandElasticity` is threaded into `EconomySystem` exactly like `wealthElasticity` (`createCity.ts:121`):

```ts
constructor(
  private readonly world: World,
  private readonly wealthElasticity: number = WEALTH_ELASTICITY,
  private readonly brandElasticity: number = BRAND_DEMAND_ELASTICITY,
) {}
```

plus `CitySimOptions.brandElasticity?: number` (after `createCity.ts:67`) and `new EconomySystem(world, options.wealthElasticity, options.brandElasticity)`.

## Slices (dependency-ordered, each flag-gated / default-OFF/no-op, per the 12a/13a/14a/15/16 pattern)

Each ships green on `typecheck` + `test:run` + `build` and keeps `brain:"off"` **byte-identical** until 17d.

### 17a — Inert stock + decay seam (pure no-op)
Add `brand?`/`brandSpent?` to `Business` (with the "Never money" doc note — and **do NOT seed/default them in any archetype or cityGen**, Risk H3). Add the constants (`BRAND_DEMAND_ELASTICITY = 0`). Add `brandFactor()` and the brand-decay block in `depreciate()`.
- **Gate:** elasticity 0 ⇒ `brandFactor ≡ 1`; no field set ⇒ decay loop skips every firm.
- **DoD:** a seeded 1-year `brain:"off"` run is byte-identical to a pre-17 golden — `world.serialize()` deep-equals it **AND** `"brand" in biz === false` for every firm (the field must be genuinely absent, so `structuredClone` never emits it). `totalMoney()` conserved. Unit tests: `brandFactor({brand: 9e9}, 0) === 1` (OFF switch) and `brandFactor({brand: 9e9}, 0.3) ≈ 234` (unboundedness pinned as intentional).

### 17b — Hook A behind elasticity 0 (still no-op)
Wire Hook A (`leisureReservation` venue param + final-reservation clamp + caller). Plumb the inert Hook B params on `consumptionUnits` (the `venue`/`brandUnitsElasticity` signature, gated by `BRAND_UNITS_ELASTICITY = 0`) — a typecheck-shape change only, no value change. Thread `brandElasticity` through `EconomySystem` + `CitySimOptions`.
- **Gate:** with `BRAND_DEMAND_ELASTICITY = 0` and `venue.brand` unset, `lift = 0` → Hook A returns today's values exactly; `consumptionUnits` short-circuits to 1; byte-identity holds.
- **DoD:** byte-identical brain-off. Unit test sets `biz.brand` + an *explicit* `brandElasticity > 0` and asserts a higher reservation for a mid tier (proving the curve before the city knob turns on, mirroring how `consumptionUnits` tests pass explicit elasticity). A second unit test pins the clamp: a top-tier resident with `brand = 9e9` reserves *exactly* `anchor × (1 + LEISURE_PRICE_SPREAD)` (no super-premium region).

### 17c — The lever (action + clamp + apply + observe), inert and **not yet wired into the rules brain**
Add `BusinessAction.brand?` (`ai/types.ts`), the `clampAction` block + `DecisionLimits.maxBrandPerReview` (DEFAULT e.g. 500, mirror the invest block at `clamp.ts:12,45–49`). Add `applyBrand` + wire into `apply` after the invest block (`BusinessAgentSystem.ts:141–143`). Surface `brand`/`brandSpent` in `BusinessObservation` + `observe`. Add the ClaudeDecisionProvider tool field + parse guard + system-prompt coaching + `observationText` prose. **Do NOT add the RuleBasedProvider heuristic yet** (Risk H-bench, deferred to 17d).
- **Why defer the rules heuristic:** with the coefficient frozen at 0, a rules CEO that fires a brand heuristic would spend on a lever with zero demand payoff — a pure cash→landlord drain. Brand is **not** counted in net worth (`ceoBench.ts:147` = `cash + inventory*price + capitalValue`), so the *rules-CEO bench score would silently regress* even though brain-off stays byte-identical. Shipping the heuristic only at 17d (alongside live engagement) keeps the rules-CEO baseline intact through 17a–17c.
- **Gate:** `BRAND_DEMAND_ELASTICITY` still 0 and no rules path emits `brand`, so the live and bench economies are byte-identical; the lever is present, conserving, and exercised only by tests/Claude.
- **DoD:** money conserved to the cent across a brain-on run where a mock/Claude provider spends `brand` (a pure cash→landlord transfer; `brandFactor ≡ 1` ⇒ zero demand effect). Decision log records `brand` amounts. Conservation test asserts `totalMoney()` constant; self-transfer guard test (an agentic-landlord stub) asserts no brand minted.

### 17d — Engage + soak-tune + wire the rules brain
Set `BRAND_DEMAND_ELASTICITY ≈ 0.3` (live); keep `BENCH_BRAND_DEMAND_ELASTICITY = 0` (frozen). Add the RuleBasedProvider brand heuristic, **gated to the goods storefront only** and with an **explicit budget split vs invest** (Risks H1-budget, H3b, H4):

```ts
// Brand: grow demand when capacity-bound + profitable. GOODS-ONLY — only the goods
// storefront has a demand hook; a producer/diner brand spend can never pay back, so the
// rules CEO must not burn their cash on a dead lever. Brand takes its slice of surplus
// BEFORE invest, so the two levers don't fight over one cash-minus-reserve pool.
if (
  o.kind === "goods" &&
  o.referencePrice !== undefined &&
  o.capacityUtilization !== undefined &&
  o.capacityUtilization > INVEST_UTILIZATION_THRESHOLD &&
  o.cash > BUSINESS_RESERVE + INVEST_MIN_SURPLUS
) {
  action.brand = (o.cash - BUSINESS_RESERVE) * BRAND_SURPLUS_FRACTION; // e.g. 0.25, taken first
  notes.push("capacity-bound + profitable, spending on brand to grow demand");
}
```

The existing invest heuristic (`RuleBasedProvider.ts:106`, `invest = (cash − reserve)/2`) then runs on the *remaining* surplus. Tune `BRAND_PER_DOLLAR`, `BRAND_DEPRECIATION_RATE`, `BRAND_SURPLUS_FRACTION` against soak so both stocks sustain simultaneously without crossing the reserve floor.
- **Gate (the real success metric, made goods-specific — Risk H-citywide):** on a 2–3 year full-agentic soak a **goods storefront** that uses `brand` + `invest` shows **sustained** utilization > 0.45 and **compounding** `goods.capital` across year 2+ (vs today's transient ~3×-then-decay), with **both** `brand` and `capital` held/grown by recurring spend and neither crossing the reserve floor. Measured by a goods-store assertion (not the city-wide sum), confirming `investedDays` rises and `goods.capital` holds/grows.
- **DoD:** money conserved to the cent across the 3-year soak; deterministic save/reload; no price oscillation; `soak.test.ts` `activeKinds ≥ 4` floor still met (this test is the one that catches a budget-split bankruptcy — run it, don't just re-baseline numbers). Brain-off still byte-identical.

## Conservation & determinism (proof-sketches)

**Conservation.** The **only** cash move is `applyBrand`'s single `world.transfer(biz.id, "biz_landlord", want)` — the sole money primitive, conserving by construction (debit = credit, capped at payer balance; `holderBalance` throws on an unknown id, so a phantom sink crashes loudly rather than minting). The sink `biz_landlord` is a real, existing holder (`collectRent` resolves it; `LANDLORD_RESERVE = 4500` and `DistributionSystem` recirculates landlord cash above reserve to residents daily — so brand spend re-enters resident pockets, recirculated, not parked). `brand`/`brandSpent`/`BRAND_PER_DOLLAR`/`brandFactor`/the decay are **non-cash** — the exact precedent `capital`/`capitalInvested` already follow, and the CLAUDE.md rule ("Non-cash quantities never touch the money invariant"). The demand lift is a *pure read* of the non-cash stock inside `leisureReservation`; it only changes *which* `world.transfer(resident → venue)` purchases fire, each still capped at the resident's balance — no new money path. The self-transfer guard and the `moved <= 0`-before-stock-write ordering close the two latent mint paths. ✓

**Determinism.** No RNG, no wall-clock, no iteration-order hazard. `brandFactor` and the hooks are `Math.pow`/arithmetic over stored scalars and the existing RNG-free id-index fan-out (`idx % …`). Decay rides the existing `depreciate()` loop over `world.businesses` (an **array** — stable order; the only Map, `lastUtilization`, is `.get`/`.set`/`.delete` only, never iterated for state). `applyBrand` resolves the sink by fixed id (`getBusiness`), fully deterministic. ✓

**Save/reload.** `brand`/`brandSpent` are plain optional `number` fields on `Business`, captured by `World.serialize`/`restore` via `structuredClone` (identical to `capital`/`capitalInvested`). No ephemeral derived state — `brandFactor` recomputes from `biz.brand` every read. Pre-17 saves: `brand` absent ⇒ `?? BRAND_BASELINE` ⇒ factor 1 ⇒ resume byte-identical. **Conditional on never seeding the field** (Risk H3) so a brain-off snapshot omits it entirely. DoD: run 17d to day N, snapshot, restore into a fresh sim, run M days; assert the snapshot deep-equals an uninterrupted N+M run. ✓

## Constants (`constants.ts`, in the wealth-consumption block ~376–403 + bench block ~418–430)

```ts
export const BRAND_BASELINE = 100;             // demand-capital scale, twin of CAPITAL_BASELINE
export const BRAND_DEMAND_ELASTICITY = 0;      // Hook A master knob. OFF (17a–17c); ~0.3 live in 17d.
export const BRAND_UNITS_ELASTICITY = 0;       // Hook B (units/visit) — OFF for all of Phase 17 (Risk H1).
export const BRAND_DEPRECIATION_RATE = 0.01;   // daily decay of above-baseline brand (≈ capital)
export const BRAND_PER_DOLLAR = 1;             // cash→stock; keeps brand on the capital scale
export const BRAND_DEMAND_CAP = 4;             // headroom for the (inert) Hook B, separate from WEALTH_DEMAND_CAP
export const BRAND_SURPLUS_FRACTION = 0.25;    // share of surplus to brand, taken BEFORE invest (17d split)
export const BENCH_BRAND_DEMAND_ELASTICITY = 0;// bench freezes the COEFFICIENT (not the lever)
```

## Bench treatment (freeze the COEFFICIENT, enrich the LEVER)

Brand is a **CEO control**, so the *lever* is enriched into the bench (the rules/Claude CEO can pull `brand`), but the **effectiveness coefficient is frozen** so re-tuning the live knob never drifts historical scores — the exact `BENCH_WEALTH_ELASTICITY` / `BENCH_OWNER_DIVIDEND_SHARE` discipline (`ceoBench.ts:122–126`).

- Add `BENCH_BRAND_DEMAND_ELASTICITY = 0` next to the other two frozen knobs.
- `setupScenario` passes `brandElasticity: BENCH_BRAND_DEMAND_ELASTICITY` into `createCity` alongside the two existing frozen knobs. During the freeze the CEO *can* spend on brand but it has zero demand payoff. Because the rules brand heuristic is **deferred to 17d** (and goods-only) and the bench target is the single `biz_goods` storefront, the rules CEO *will* exercise it at 17d — but against the frozen coefficient it is a pure cash drain, and brand is **not** counted in net worth (`ceoBench.ts:147`), so the score correctly punishes naive over-spend. Same reasoning as `BENCH_OWNER_DIVIDEND_SHARE = 0`. **(Verified interaction, Risk H4:** `BENCH_WEALTH_ELASTICITY = 1` is *live* in the bench, so the wealth term is on — but `brandFactor(venue, 0) = 1` zeroes the brand contribution regardless, so the freeze holds.)
- **Free ablation:** `AblationStudy`/`AblatedProvider` (`ceoBench.ts`) drop a `keyof BusinessAction`; pass `"brand"` to measure the lever's worth — no new code.

## Soak + exact tests to re-baseline (don't loosen — re-baseline deliberately or keep sacred)

**Sacred (must stay green, a failure = bug → rollback):** money conservation, determinism/save-reload, never-negative, needs ∈ [0,100], price bands, the bench `rules > off` ordering, and brain-off byte-identity through 17c.

**Re-baseline at 17d (verified each actually moves before touching it):**
- **`soak.test.ts:80–118`** (`assertLivingCity`, 3-year) — floors/invariants, not exact values; **should still pass** unless a budget-split bankruptcy drops a kind. *This is the test that catches the 17d budget split — run it, don't just re-number.*
- **`capital.test.ts:422–448`** ("invest loop closes") — loose `> startCapital × 1.5` city-wide floor; likely still passes, but its ~3×-then-decay *narrative* goes stale, and a **goods-specific** assertion should be added per the 17d Gate.
- **`distribution.test.ts:44–68`** — landlord is the brand sink and recirculates; brand spend → landlord cash → larger daily payout, so landlord-cash/payout assertions may move. Legitimate candidate.
- **`elasticity.test.ts` `consumptionUnits` tests (~113–188)** — a *signature* review only (extra optional args; values unchanged because `BRAND_UNITS_ELASTICITY = 0`). Typecheck touch, not a value re-baseline.
- **`ceoBench.test.ts`** — add to the list at 17d (the rules brand heuristic ships there). The `rules > off` *ordering* must still hold; re-baseline absolutes deliberately.
- **Likely-unaffected (do NOT pre-emptively touch):** `capital.test.ts:356–383` (diner-only 13c, brand is goods-only) — should stay byte-identical through 17c.

Per slice: `npm run typecheck && npm run test:run && npm run build` green; throwaway probes built/deleted per CLAUDE.md; commit + push at 17a, 17c, 17d.

## How Phase 17 unblocks then FINISHES Phase 16

**Slice 3 (retain → reinvest → grow compounds).** With 17d live, a capacity-bound goods firm has a real reason to retain (`payoutRate < 1`, applied at `BusinessAgentSystem.ts:145`): retained cash funds **both** `invest` (capacity) and `brand` (demand), split by `BRAND_SURPLUS_FRACTION` so they don't starve each other. Invest + brand keep utilization pressed and revenue rising, so retained surplus earns a return instead of sitting inert — the demand headroom the slice-3 probe proved it lacked. Re-run the PHASE16 probe table; expect goods capital to *rise* year 2→3 instead of collapse. The asymmetry with target-scaling is decisive: target-scaling pushed the supply buffer (`effectiveTarget`) with no demand pull (`TARGET_CAPITAL_SCALING` *stays off*, `MarketSystem.ts:251`), starving cash; brand pulls demand without touching the buffer, and each new buyer is a real `transfer` into the firm, so effective marketing *grows* cash to fund both levers.

**Slice 4 (reframe the bench to reward growth, anti-hoard guard).** Un-freeze `BENCH_BRAND_DEMAND_ELASTICITY` to the live value as a *deliberate, versioned bench re-baseline* (not a silent mid-introduction drift). The bench then rewards spend-to-grow over harvest. Hoarding becomes strictly dominated — both stocks depreciate while a growing market rewards deployment — so the anti-hoard guard is **emergent from depreciation**, not bolted on ("an uncapped market is the only kind where a skilled LLM CEO can pull away"). **Slice-4 decision to record explicitly:** decide whether to add `brand` to `capitalValue()` in net worth. The design omits it deliberately — an un-frozen bench that scores brand at $0 still punishes spend *unless the resulting cash/inventory gains exceed it*, which is the intended "spend-to-grow must actually pay" pressure. State this in the slice-4 DoD.

## Why it won't repeat the target-scaling failure (causal chain)

1. A goods firm spends `brand` → `Business.brand` rises 1:1.
2. `brandFactor > 1` → Hook A lifts every below-ceiling tier's reservation toward this firm so window-shoppers clear the cutoff and buy **at constant price** — demand toward this firm grows exogenously toward the population cap, the keystone at firm granularity.
3. `make` rises toward the (post-14b binding) capacity ceiling → utilization climbs above 0.45 → the invest gate fires (`cash > BUSINESS_RESERVE + INVEST_MIN_SURPLUS` = 3000 + **200** = 3200 — note the constant is 200, not 3200; the cash gate is easier to clear than feared, which *helps* the loop).
4. Invest raises `effectiveCapacity`; continued brand spend keeps demand growing so the new capacity is *filled*, not slackened → utilization stays bound → the loop **compounds**.
5. Both stocks depreciate (capital ~1%/day, brand `BRAND_DEPRECIATION_RATE`/day), so sustaining it needs recurring spend on both — a real Solow engine, not a one-off spike.

**No overproduction / price-collapse:** `make` is still capped by `target − stock` and `capacity` (`MarketSystem.ts:181`); brand never touches `effectiveTarget`, so a firm produces only what it can sell into a now-larger-but-finite demand — no glut. The lift is clamped to `anchor × 1.6` (today's band); higher utilization → `adjustPrices` firms price *up* toward the band, never down; the cost-plus floor backstops. Diminishing `pow` returns + decay + the `cash − BUSINESS_RESERVE` headroom floor in `applyBrand` make spend self-limiting.

## Critical files (all absolute)

- `C:/Users/sugar/Desktop/ALL AI GAMES/Projects in progress/CityWithLifeClaude/src/world/types.ts` — `Business.brand?`, `Business.brandSpent?` (with "Never money" note, **never seeded**); `BusinessAction.brand?`; `BusinessObservation.brand?`/`brandSpent?`; `DecisionLimits.maxBrandPerReview`.
- `.../src/systems/constants.ts` — the eight `BRAND_*` / `BENCH_BRAND_*` constants above (all default-OFF/no-op).
- `.../src/systems/EconomySystem.ts` — `brandFactor()` export (~:202); `leisureReservation` venue param + **final-reservation clamp** (:133) + caller, lift hoisted above the loop (:115); `consumptionUnits` venue/`brandUnitsElasticity` params plumbed inert (:202); constructor `brandElasticity` (:36).
- `.../src/systems/MarketSystem.ts` — brand-decay twin inside `depreciate()` (:265–273).
- `.../src/createCity.ts` — `CitySimOptions.brandElasticity?` (after :67) + pass to `EconomySystem` (:121).
- `.../src/ai/types.ts`, `.../src/ai/clamp.ts` (:12, :45–49) — `brand` action + `maxBrandPerReview` clamp.
- `.../src/systems/BusinessAgentSystem.ts` — `applyBrand` (mirror `applyInvest`, fixed-id sink + self-transfer guard + guard-before-write); wire into `apply` (after :143); surface in `observe` (incl. `kind`/`referencePrice` for the 17d gate).
- `.../src/ai/RuleBasedProvider.ts` — **17d only** brand heuristic, goods-only, budget-split-before-invest (after :108); `.../src/ai/ClaudeDecisionProvider.ts` — tool field/parse/prose (17c).
- `.../src/bench/ceoBench.ts` — pass frozen `brandElasticity: BENCH_BRAND_DEMAND_ELASTICITY` (:125–126); ablation gets `"brand"` for free.
- Re-baseline at 17d: `soak.test.ts` (80–118), `capital.test.ts` (422–448, + new goods-specific assert), `distribution.test.ts` (44–68), `ceoBench.test.ts`; signature-touch `elasticity.test.ts` (113–188).

## Risks & rollback (every slice has a default-OFF escape)

| Risk | Guardrail | Rollback |
|---|---|---|
| Hook A + Hook B compound to `brandFactor²` on one visit (silent 2× elasticity) | Hook A is the *only* live axis; Hook B behind `BRAND_UNITS_ELASTICITY = 0` for all of Phase 17 | `BRAND_DEMAND_ELASTICITY = 0` → no lift at all |
| Reservation clamp leaves a super-premium `anchor × 2.56` region | Clamp the **final** reservation to `anchor × (1 + LEISURE_PRICE_SPREAD)`, not the brand premium; unit test pins the ceiling | flag off → today's band |
| Brand & invest fight over one `cash − reserve` pool → loop oscillates (the target-scaling cash-starve, relocated) | Explicit `BRAND_SURPLUS_FRACTION` split, brand taken **before** invest; 17d soak proves both stocks sustain without crossing reserve | lower `BRAND_SURPLUS_FRACTION`, or coefficient 0 |
| Rules CEO burns producer/diner cash on a dead lever | Heuristic gated to `kind === "goods" && referencePrice !== undefined`; deferred to 17d | omit the heuristic (lever still Claude-only) |
| `applyBrand` self-transfer mints free brand (agentic landlord) | `sink.id === biz.id` guard; `getBusiness("biz_landlord")` fixed-id lookup | flag off |
| Phantom `brandSpent` on a no-op transfer | `moved <= 0` guard kept **above** the stock writes (mirror `applyInvest`) | n/a (structural) |
| 17a golden-master drifts because `structuredClone` emits `brand` | **Never** seed/default `brand`/`brandSpent`; 17a DoD asserts `"brand" in biz === false` brain-off | n/a (don't seed) |
| Rules-CEO bench score regresses while coefficient frozen | Defer rules heuristic to 17d; `ceoBench.test.ts` re-baselined deliberately at 17d | revert heuristic |
| Marketing war escalates to a corner | Share-neutrality invariant (brand read post store-choice); any win-share hook is a separate flagged phase | flag off |
| Live-knob retune drifts historical bench scores | `BENCH_BRAND_DEMAND_ELASTICITY` freezes the coefficient; un-freeze only as the versioned slice-4 re-baseline | freeze stays 0 |

## Rollback (overall)

Each slice defaults to a no-op: `brand`/`brandSpent` absent ⇒ `?? BRAND_BASELINE` ⇒ `brandFactor ≡ 1` ⇒ Hook A `lift = 0`; the decay block skips at/below baseline; the rules heuristic doesn't exist until 17d. Revert any slice by leaving `BRAND_DEMAND_ELASTICITY = 0` (and, for 17d, removing the heuristic) ⇒ today's behaviour, byte-identical.

## Status (as built — 2026-06-06)

- **17a–17c shipped + green** (byte-identical seam → Hook A reservation lift → lever
  surface). Brand is a real, conserved, bench-protected CEO lever (action + clamp +
  `applyBrand` → landlord sink + observation + Claude tool).
- **17d shipped + green (303 tests): the lever is ENGAGED.** `BRAND_DEMAND_ELASTICITY = 0.3`
  live; the rules brain spends on brand goods-only, gated on a *live* `o.brandElasticity`
  so the frozen CEO bench (elasticity 0) never spends on a dead lever — **`rules > off`
  holds.** Hook A grows demand (proven in 17b + the engagement); the bench enriches the
  lever with the coefficient frozen. The invest-loop (`capital.test`) and dividend
  (`distribution.test`) tests are isolated from the new brand confounder via
  `brandElasticity: 0` — the same freeze discipline as the bench + the leisure test.
- **DoD limitation (real blocker — reported, not yet solved):** full *multi-year
  compounding* (a goods storefront sustains utilization > 0.45 and grows capital in
  year 2+) is **NOT** achieved. A 3-year full-agentic probe (seeds 1 & 7) shows the brand
  engine fires in year 1 (goods brand + capital build) then **decays to baseline** — the
  same self-extinguishing seen in 13c/14c. The root cause is **upstream of brand**: under
  the demand-shifted economy the supply chain breaks (the factory bankrupts on the P10-3
  labour drain — self-healed by business-entry, `producingKinds` stays 6/6 and the 3-year
  soak passes), and goods utilization self-poisons as its own capital grows. **Brand
  successfully pulls demand, but sustained compounding additionally needs the
  supply-chain/labour fix + a capital-discounted utilization signal** — a deeper follow-up
  (a dedicated supply-chain phase, or folded into Phase 18 credit). **Phase 16 slices 3+4
  remain parked behind that** (retain-to-reinvest only compounds once the engine sustains).

### Update 2026-06-06 — root cause found + a working fix (engagement needs a re-tune)

The compounding blocker is now **diagnosed, with a proven fix**. A 3-year full-agentic probe
(seeds 1 & 7) isolated the cause: under brand-grown demand the **lowest-wage producer (mine,
0.05/tick) loses its crew to the storefronts (0.17–0.20), starving the chain so the factory
dies** — goods then loses its supply, utilization collapses, and the invest/brand engine
decays to baseline. **Shoring up producer wages fixes it:** with producers floored at ~0.16
the chain stays staffed and goods capital + brand **sustain ~1700–2100 over 3 years** (vs
decaying to 0) — the engine compounds. This confirms the blocker is the **shared-labour-pool
fragility (P10-3)**, not the utilization signal.

- **Shipped:** the `PRODUCER_WAGE_FLOOR` seam (constants + cityGen, default 0 ⇒
  byte-identical, 303 green; commit `361e8b9`).
- **Not engaged — needs a re-tune (real fork, deferred):** setting it to 0.16 keeps the live
  economy healthy (the 3-year soak passes) but **squeezes the storefronts** — producers and
  storefronts share one labour pool, so competitive producer wages raise B2B cost-plus prices
  off base and break the two-diner truce into a monopoly (4 isolated-mechanism tests shift).
  This is exactly the *"pricing-band re-tune + fresh soak"* the tuning study foresaw: a careful
  trade-off (staff the chain *without* squeezing storefronts), with genuine direction choices —
  thread the floor value, widen the labour pool structurally (more residents / Phase 19
  population), or accept + re-baseline the truce. The seam is in place to engage once the
  approach is chosen; this is the keystone that then unblocks Phase 16 slices 3+4.

### Update 2026-06-06 (later) — ENGAGED at 0.12; compounding DoD MET ✅

The fork is resolved. The re-tune was a *value* choice, and 0.16 was simply too high. A
fresh floor sweep (`{0, 0.08, 0.10, 0.12, 0.14, 0.16}`, seeds 1 & 7) measured both the
engine **and** the truce at each value:

- **Engine sustains for any floor ≥ 0.08** (at 0, the factory dies and goods capital never
  leaves baseline ~107). Best at **0.12**: goods capital/brand **~2600 over 3yr (~1700–2500
  at 2yr)** with *all four producers fully crewed*.
- **The two-diner truce holds for every floor ≤ 0.14** and breaks only at **0.16** (it
  pushed producers to near-parity with the diner's 0.17 base and starved diner_2 — the
  monopoly the earlier engage saw).

So **0.12 dominates**: it maximises sustained capital/brand, keeps the whole chain staffed,
AND preserves the truce — collapsing the "4 broken tests" of the 0.16 attempt down to **one**
genuine confounder. Engaged (`PRODUCER_WAGE_FLOOR = 0.12`, commit `42eaaae`):

- **`capital.test` — new A/B compounding test** (the now-met DoD): with the floor the
  factory survives and goods capital compounds ~25× baseline over 2 years; without it the
  factory dies and capital stays ~baseline. Money conserved both ways.
- **One freeze only** — `market.test`'s mean-revert-to-base test pins `producerWageFloor: 0`
  (a higher floor correctly firms B2B prices above base via cost-plus, already covered by the
  Phase 15 B "never below input" test). `competition.test` and `elasticity.test` now pass
  untouched at 0.12.
- **Bench frozen** at `producerWageFloor: 0` (same discipline as the other `BENCH_*` knobs).
- **304 tests green**, build green, live app reloads clean.

**NORTH-STAR move #3 (close the investment loop) is now structurally achieved**: brand pulls
demand, the chain stays staffed, and the invest/brand engine compounds over multiple years
instead of self-extinguishing. **Phase 16 slices 3+4 are unblocked.** The deeper structural
relief for the shared-labour-pool tension remains **Phase 19 (population growth)** — the floor
is the realistic near-term fix (a mine must pay competitively to keep miners); population is
the eventual "more workers so producers *and* storefronts can both staff up" answer.