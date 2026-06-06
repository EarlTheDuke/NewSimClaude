# Phase 15 — The Living Firm Economy: meaningful controls + firm health

> Implement slice by slice. This closes North-Star moves **#2** (firm health / business
> entry) and **#3** (productivity engine + route profit to owners), together. Status is
> tracked at the bottom; the live operating manual is [CLAUDE.md](CLAUDE.md), the compass
> [NORTH-STAR.md](NORTH-STAR.md).

## Context — why we're doing this

A thought experiment exposed the real problem: *if a skilled mind sat in a business's chair, could the current controls let it succeed?* Only partly. **`setPrice` is a real lever; `hire`, `produce`, and `invest` are traps or exploits**, so the game rewards tactical pricing, not strategic *building*. And that is the **same fact** as "the productivity engine self-extinguishes" — *"investment doesn't pay off for a player"* and *"the engine doesn't fire"* are one problem seen from two angles: **the levers aren't yet meaningful strategic choices, and the firm economy can't survive agentic play.**

Two verified discoveries reshape the fix:
- **Businesses cannot set their own wage** (no `setWage` in `BusinessAction`; only residents `negotiateRaise`). A producer paying 0.05/tick while goods pays 0.20 is *powerless* to keep staff — that asymmetry **is** the labour drain that collapses the supply chain (P10-3), which is why Phase-14c's engine couldn't fire.
- **`ownerId` is inert** — it's set but never read; profit distributes *evenly to all residents*, so "owning a business" means nothing economically. Entrepreneurship and the whole CEO premise have no payoff.

The goal: a **life-like firm economy** where firms compete for labour, owners earn their firm's profit, failed firms die and new ones are *born* into profitable niches — and where every control (`price`, `wage`, `hire`, `invest`) is a genuine, rewarding decision. Same fixes make the city's productivity engine fire and the "$50k/42-turn LM benchmark" finally test *strategy*.

## The decisive corrections (from design review)

1. **Producer viability is upstream — do it FIRST.** A firm with no margin can't fund a competitive wage no matter how good `setWage` is. Fix money-in before the labour market.
2. **"Producer cost-plus" is a price-book *floor*, not a lever.** Producers have no per-firm selling price (`biz.price` = 0); their output sells at the global resource price book in `MarketSystem.adjustPrices`. B modifies that floor.
3. **`setWage` must re-rate *sitting* staff** (the wage paid comes from `resident.wagePerTick`, not `biz.wagePerTick`) and fire **only on a real vacancy + affordability** — otherwise it's either inert (no retention) or a ratchet to the 2× cap.
4. **`setWage` + raising `LABOR_FULL_STAFF` are two halves of one mechanism — ship together.** Each is inert/harmful without the other.
5. **Profit→owners must be a SPLIT, not a re-route.** `DistributionSystem`'s even payout is the primary demand-recirculation pump; 100% to owners pools money in ~7 owners and collapses the other residents' demand. Split: owner share `λ≈0.35`, remainder recirculated as today.
6. **Count capital at *depreciated* book in net worth** (it decays ~1%/day) — that makes invest-*timing* a real decision rather than a flat penalty.

## Sequence (dependency-ordered)

`B (producer viability) → A+E (labour market + headcount-drives-output + kill exploits + re-fire 14c) → C (real ownership, split) → F-partial (scoring + ablation) → D (business entry/exit) → F-final (whole-arc soak)`

**Discipline:** every slice ships behind a **default-OFF flag or no-op-default constant** (the proven 12a/13a/14a pattern), so the brain-off baseline stays byte-identical until each is deliberately engaged.

## Sub-slices

### B — Producer viability (cost-plus B2B floor). **The first, highest-leverage slice.**
- **B1 — Floor seam, inert.** Add `PRODUCER_COST_FLOOR` flag (OFF → floor = `base*PRICE_MIN_MULT`, today's behaviour) + `PRODUCER_COST_PLUS_MARGIN`. *Gate:* byte-identical, floor pure.
- **B2 — Engage.** In `adjustPrices` (`MarketSystem.ts`), `floor = clamp(unitInputCost + unitWageCost + margin, base*MIN, base*MAX*0.99)`; revert/snap target becomes `max(base, floor)` so the pricer doesn't fight the floor. Unit wage cost derived purely from staffing. *Gate:* a stranded producer's resource price never drops below input+wage cost AND diner/goods still clear a positive day-margin (the `PRICE_MAX_MULT` collision guard). *DoD:* producers stay solvent over a 200-day brain-on soak without the cash-inflation test hack.
- **B3 — Re-baseline** `competition.test`/`soak` price levels; document.

### A + E — Labour market + headcount-drives-output. **Ship together.**
- **A1** `setWage?` added to `BusinessAction` + `DecisionLimits` bounds + `clamp` (cap 2× base, bounded per-review move); no provider emits it yet (no-op).
- **A2** Apply `setWage`: set `biz.wagePerTick` AND **re-rate sitting employees upward** (never below their current rate — no perverse wage-cut). *Gate:* retention works; money conserved (setWage moves no cash; wages still flow via `EconomySystem` capped at balance).
- **A3** Real hiring capacity: `observe` reports `hiring = employeeIds.length < desiredHeadcount` (not always `true`) so residents don't stampede one firm. (`residentClamp` already drops switches to non-hiring jobs.)
- **A4** Rules brain emits `setWage`: short-staffed **and affordable** → raise toward rival parity (bounded); fully-staffed/cash-thin → hold. Breaks the all-pay-max ratchet → wages plateau at the vacancy-clearing level. *Gate:* equilibrium **tripwire** — no firm's wage pins at 2× base for >K days; payroll variance bounded.
- **E1** Remove the `produce` lever (the market already auto-produces to target; the lever is a redundant free-COGS exploit). Re-baseline `businessAgent.test`. *(If kept instead: must consume inputs and cap at capacity.)*
- **E2** Raise `LABOR_FULL_STAFF` above 1 so headcount drives output — **re-tuned together** with the 14b `maxPerDay` numbers and seeded headcount (`cityGen`). Re-baseline the 12b "no-op" claims. *Gate:* new "1 worker ≈ half, 2 = full" output test; `hire` is now a real growth lever.
- **E3** Re-fire 14c: turn on `TARGET_CAPITAL_SCALING` + raise the invest gate. *Gate:* strengthen the "invest loop closes" test — capital deepens *materially* and utilization stays bound under brain-on play (this is the productivity engine finally firing, now that producers survive).

### C — Real ownership (split, not re-route).
- **C1** `OWNER_DIVIDEND_SHARE` flag default **0** → byte-identical.
- **C2** Engage `λ≈0.35`: in `DistributionSystem`, pay the owner `λ·budget` via `transfer(biz, ownerId, …)`, recirculate `(1−λ)·budget` evenly as today (keep cap + reserve). *Gate:* owner wealth rises with their firm; non-owners still recirculate; aggregate demand-vs-payroll stays in band over 30 days (the demand-collapse guard).
- **C3** Re-baseline the CEO bench (the owner dividend leaves the firm → lower absolute net worth; the rules>off **ordering** must still hold) + soak.

### F (partial) — Scoring + ablation. **Before D** (prove it on a stationary economy).
- **F1** Net worth counts capital at depreciated book: `cash + inventory*price + (capital − CAPITAL_BASELINE)` (invest is 1:1 cash→capital). Re-baseline the bench net-worth identity; conservation untouched (capital isn't money). Invest is no longer a flat penalty.
- **F2 — Lever-ablation harness (the core deliverable).** Extend `ceoBench`/`bench/cli.ts` to run the rules CEO with each lever disabled and measure the net-worth delta. *Gate:* **every lever shows a measurable, correct-sign impact** — a zero-impact lever is a dead control and gets flagged. This *proves* the control surface is meaningful rather than assuming it.
- **F3** Skill = building: a **producer-CEO** scenario where `invest`+`hire`+`setWage` let a skilled CEO out-build the no-op by more than pricing alone could.

### D — Business entry/exit (creative destruction). **Last before the final soak.**
- **D1** Liquidation: on bankruptcy, `transfer(corpse, ownerId, corpse.cash)` (owner recoups residual equity — conserves money, unfreezes the corpse) + release non-cash stock. Flag `RECYCLE_BANKRUPT_ASSETS` OFF until flipped.
- **D2** `BusinessEntrySystem` (registered after Lifecycle, before Macro): **pure** niche detection (a `BusinessKind` with zero active firms + unmet demand), detection-only, deterministic + reproducible.
- **D3** Deterministic spawn: entrepreneur = lowest-index resident with `money ≥ threshold`; id = `biz_<kind>_<countOfKind>`; location at the lowest free node (the `secondDiner` template: push Location → push Business → `world.reindex()`); fund via `transfer(entrepreneur, newBiz, startingCapital)` (resident→firm, net-zero, no mint); staff from the jobless pool deterministically; cooldown + hysteresis to stop thrash; cooldown state in `serialize/restore`. *Gate:* kill `biz_diner` → a new diner appears at a deterministic id/node/owner, money conserved, identical across two seeded runs, save/reload round-trips.
- **D4** Self-healing soak: kill firms, verify firm count recovers (heals the P10-6 consolidation).

### F (final)
- **F4** 3–5-year whole-arc soak, everything engaged, seeds 1 & 7 → the whole-arc DoD below.

## Conservation & determinism (proof-sketches for the risky bits)

- **setWage**: changes only non-cash fields; no money moves at set-time; wages still flow via `World.transfer` capped at balance; fixed business-id + stable employee order; no RNG. ✓
- **Owner split**: every cent still moves only via `World.transfer` (capped at the firm's live balance); constant share, fixed `ownerId`, stable resident loop, no RNG. ✓
- **Liquidation**: a single `transfer(corpse, ownerId, cash)`; zeroing non-cash touches no money; Lifecycle's fixed order; no RNG. ✓
- **Birth**: starting capital is `transfer(entrepreneur, newBiz, …)` — net-zero; the new firm is counted in `totalMoney`, so the sum is unchanged; entrepreneur/id/node are deterministic scans, any jitter from `ctx.rng` only; cooldowns serialized. ✓

## Test impact (don't loosen — re-baseline deliberately or keep sacred)

- **Sacred (unchanged):** money conservation, determinism/save-reload, never-negative, needs ∈[0,100], price bands, the bench rules>off **ordering**. A failure here = bug → rollback.
- **Re-baseline (call out per commit):** the 12b no-op claims (when `LABOR_FULL_STAFF` rises), the wage-ladder test (keep the *intent* "no permanent wage trap"), competition/soak price levels (B floors), `businessAgent` produce test (E1 removal), bench net-worth identity (F1 capital) + lower absolutes (C dividend).

## Risks & rollback (every slice has a default-OFF escape)

| Risk | Guardrail | Rollback |
|---|---|---|
| B floor too high → storefront margin negative | clamp floor < `base*MAX*0.99`; assert storefront day-margin > 0 | `PRODUCER_COST_FLOOR` OFF → byte-identical |
| setWage ratchet to the cap | raise only on real vacancy + affordable; switching friction; equilibrium tripwire | wage cap = base, or flag off |
| `LABOR_FULL_STAFF` retune under-supplies | retune `maxPerDay` + seed headcount together; output-vs-headcount gate | revert constant to 1 (one line) |
| Owner split collapses demand | `λ≈0.35`; demand-vs-payroll band assertion | `OWNER_DIVIDEND_SHARE`=0 → today |
| Birth/death thrash or non-determinism | cooldown + hysteresis; pure scans + `ctx.rng` only; determinism + save/reload gates | spawn flag OFF (detection-only) |

## Definition of Done (whole arc)

A skilled CEO builds a thriving firm — `invest` + `hire` + `setWage` each *measurably* contribute to net worth (proven by ablation); the productivity engine fires (capital deepens as wealth-elastic demand presses capacity); firms compete for labour (producers retain staff; wages reach a stable equilibrium — no pin-at-cap, no oscillation); firms are born and die (a profitable empty niche attracts a deterministic resident-entrepreneur who funds it from savings and earns its dividend; dead firms liquidate to their owner); owners earn more than non-owners yet broad recirculation keeps demand alive; and **all of it is money-conserved to the cent, deterministic from seed+snapshot, needs bounded, no holder negative, stable over a 3–5-year soak on seeds 1 & 7.**

## Verification

- Per slice: `npm run typecheck && npm run test:run && npm run build` green; browser check where visible (the live game shows firms competing for staff, owners enriching, firms born/dying); commit + push.
- The DoD metrics are measured by throwaway probes (built per slice, deleted before commit, per `CLAUDE.md`) plus the committed soak and the new ablation harness.

## Critical files

- `src/systems/MarketSystem.ts` — cost-plus floor (B); `LABOR_FULL_STAFF`/capacity retune + `TARGET_CAPITAL_SCALING` (E); depreciation read for net worth (F1).
- `src/systems/BusinessAgentSystem.ts` — `setWage` apply + employee re-rate (A); remove `produce` (E1); invest (E3).
- `src/systems/DistributionSystem.ts` — owner-dividend split (C).
- `src/systems/LifecycleSystem.ts` — corpse liquidation to owner (D1); registration site for the new `BusinessEntrySystem` (D2–D3).
- `src/ai/types.ts` + `src/ai/clamp.ts` + `src/ai/RuleBasedProvider.ts` — `setWage` lever type/clamp/heuristic; ablation surface (A, F2).
- `src/bench/ceoBench.ts` + `src/bench/cli.ts` — capital in net worth + the lever-ablation harness (F1–F3).
- `src/world/cityGen.ts` — seed-headcount retune (E2); the `secondDiner` block as the runtime-spawn template (D3).
- `src/systems/constants.ts` — all new flags/knobs (default-OFF / no-op): `PRODUCER_COST_FLOOR`, `PRODUCER_COST_PLUS_MARGIN`, `OWNER_DIVIDEND_SHARE`, `RECYCLE_BANKRUPT_ASSETS`, entry thresholds/cooldowns, revised `LABOR_FULL_STAFF`.
- New: `src/systems/BusinessEntrySystem.ts` (D).

## Progress log

- **Step 0** — plan persisted as this doc (commit `41f0dcb`). Started from green 14b (`ae9c239`, 267 tests).
- **B1** (`a01bbb4`) — producer cost-floor seam shipped inert (flag OFF): extracted `priceFloor()` in `MarketSystem.adjustPrices`, added `PRODUCER_COST_FLOOR`/`PRODUCER_COST_PLUS_MARGIN`. Byte-identical, 267 tests green.
- **B2** — cost-plus floor engaged (flag ON). `priceFloor = clamp((inputCost + wageCost)·(1+margin), bandFloor, base·MAX·0.99)`; neutral-band revert now targets `max(base, floor)` so it doesn't fight the floor; added read-only `costFloorFor()` observability. **All 267 existing tests stayed green with no re-baseline** — the floors land *below* base at brain-off steady state (inputs revert to base, wages modest), so the floor is slack there and only bites in a squeeze. +3 load-bearing tests prove it binds for a staffed processor (wares floored above materials cost; food above grain) and is correctly inert for an unstaffed primary producer. **270 tests green.**
  - **Key finding (probe, brain-on, every resident agentic, 365d):** the agentic collapse is **labour-first, not a price squeeze.** Every resident piles into the top-paying storefront, so all four producers end at **staff = 0** → produce nothing → buy no inputs → no costs *and* no revenue → frozen at the 3000 reserve (`active=true`, never bankrupt). Their resource prices sit at the *band* floor because an unstaffed producer has no wage cost, so cost-plus correctly collapses to the band floor. **⇒ B's floor is the right structural piece but its solvency value is _latent until A keeps producers staffed._** This confirms the plan's sequencing (B is the money-in that lets A's wage competition work) and means the producer-solvency DoD completes at **A+E**, not B alone. The squeeze (P10-7) the floor guards is real but secondary; the primary failure is the labour drain (P10-3), which A+E fixes.
- **B3** — folded into B2: no competition/soak price-level re-baseline was needed (floor slack at steady state). The floor's behaviour is locked by the 3 new market tests instead.
