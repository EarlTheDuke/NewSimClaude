# Phase 9 — Joy's Playthrough (play-and-improve log)

I (Claude) live in the city as the resident **Joy** (`res_9`), playing from a
god-level vantage — making her life choices in-character, watching the whole
economy, and occasionally reaching in with God Mode as a deliberate experiment.
As I play I record everything I learn here. At each arc boundary I implement the
high-value fixes (with tests), so the simulation improves *through* play.

- **Avatar:** Joy (`res_9`), seed 9
- **Mode:** "Joy's eyes, God's hands" — resident levers in-character + God-Mode experiments
- **Harness:** `src/play/cli.ts` (run via `npx vite-node src/play/cli.ts`), driven by `play.command.json`, state in `playthrough.save.json` (both gitignored)
- **Resident levers:** `switchJobTo` · `reHomeTo` · `negotiateRaise` · `buyVehicle` · `sellVehicle`

---

## Journal (arc timeline)

> Newest last. The full beat-by-beat narration lives in chat; this is the durable index.

### Arc 1 — Days 1–5 (seed 9): "Settling in"

Joy starts at **Keystone Housing** ($0.20/tick — the city's *top* wage), **Home 4** ($58/day),
wallet **$649**, waking hungry (22) but otherwise fine.

- **Day 1** — Lived the day as it came. Hunger was a midnight/pre-breakfast dip, not a crisis; recovered by morning.
- **Day 2** — `negotiateRaise`. Wage → **$0.216** (+8%). Wallet $725. City-wide, an early payroll-spike was settling (payroll $2648→$1981, prices deflating $7.00→$6.65 avg).
- **Day 3** — `reHomeTo` Home 6 ($50/day). Wallet rose to **$789** across the move — **confirmed re-homing is free** (no moving cost/deposit). Energy/social already pinned to a stable daily value.
- **Day 4** — *God experiment:* forced `supplyShock`. Grain spiked **$3.61 → $6.40** (settled $6.08 by nightfall), fully absorbed — money still conserved at $30k. Notably the downstream **food** price *fell* ($7.22→$6.86) rather than rising. Joy stood pat; coasted to **$858**.
- **Day 5** — `buyVehicle` ($800). Wallet $858 → **$122**; vehicle owned. GDP spiked to **$1729** (+$713 ≈ the purchase). The $800 landed at **Maker Goods Co.** (cash $3000→$3800) — sensible recipient, conserved.

**Arc takeaways:** the closed-economy invariant held through every lever and a forced disaster ($30k conserved throughout). The early payroll>>GDP gap was a transient that self-corrected as the city settled (Day 5: GDP $1729 vs payroll $1843). Needs reached a clean **limit cycle** by Day 3 — a good sign of deterministic stability, not a freeze. Highest-value finding: `negotiateRaise` had **no cooldown** (fixed at this checkpoint).

**Checkpoint fix shipped:** raise cooldown (P9-1). See backlog.

### Arc 2 — Days 6–10 (seed 9): "Stress, and the optimized life"

Joy enters Arc 2 already near-optimal — top wage (landlord, base $0.20 → $0.216 after the Arc 1 raise),
cheapest home (Home 6, $50), owns a vehicle. So Arc 2 turns the dial toward *stress-testing the city*
and probing the edges of the resident lever set.

- **Day 6** — *God experiment:* `strike fire` at **The Corner Diner** (a food vendor) — torched 91 units of prepared food. The shock reached Joy even though she doesn't work there: with the diner's food gone she couldn't buy a meal, and her **hunger crashed 88 → 23** in a day. A single building's fire became a city-wide food shortage — emergent, and realistic.
- **Day 7** — Recovery. The diner restocked; Joy's hunger climbed back **23 → 59**. Stood pat and let the city heal. $30k conserved.
- **Day 8** — *God experiment:* `strike illness` — hit **2 *other* residents** (res_11 among them), not Joy. Her energy snapped back to the bit-identical limit-cycle value (**64.30000000000125**): the Day-6 fire had knocked her off the attractor for two days, and by Day 8 she'd returned to it. Robust periodic stability, confirmed under perturbation.
- **Day 9** — `negotiateRaise`. The Arc-1 raise cooldown (7d, P9-1) had just expired, so this one **LANDED**: $0.216 → **$0.23328** (+8%). Live confirmation the cooldown fix works as designed.
- **Day 10** — Pressed my luck: asked again the *very next day*, plus a God grain `shockPrice`. The raise was **BLOCKED** (cooldown reset to Day 9; wage held at $0.23328 — `lastRaiseDay: res_9→9` in the save). Grain spiked to **$6.40** and settled to $6.08; once again downstream **food *fell*** (to **$5.57**) instead of rising — **P9-5 re-confirmed**.

**Arc takeaways:** money stayed conserved at **$30k** through every disaster and intervention. The headline finding is that **Joy has nearly run out of levers** — at top wage, cheapest home, and owning a vehicle, `switchJobTo` is always a pay cut (P9-2), `reHomeTo` only moves her *up* in rent, and she can't buy a second vehicle; her only live move is `negotiateRaise`, until it tops out at the 2× cap. Separately, the city ran a slow **deflation**: avg resource price drifted **7.00 (Day 1) → 5.43 (Day 10)** as utilization stayed low — a persistent downward ratchet worth watching (the soak test proves it floors out rather than collapsing). The fire→food-shortage cascade was the most satisfying emergent beat: a fire in a building Joy never enters still made her go hungry.

**Checkpoint fix shipped:** P9-4 — `buyVehicle` now refuses a closed seller (clamp gate + live guard), with tests. P9-1 validated live in-play.

### 365-day soak evaluation (2026-06-03, seeds 1/7/3, full agency + disasters)

Ran three headless year-long games with *everything on* — business brain (rules),
all 12 residents agentic (rules), organic disasters — and mined the macro series +
final state. Config note: all 12 residents agentic (the soak test uses only 4), which
amplifies labour dynamics.

**What's rock-solid:** money conserved to 6 dp on every seed (Δ ≈ 0 over 365 days),
100% business survival (0 bankruptcies), unemployment ~0 (max 2 transient), GDP and
payroll both alive (~$2.2k–2.9k/day). The P9-2 fix is validated *live*: 9–10/12
residents migrate employers and 12/12 end earning above their job's base wage — real
mobility, where Phase 9 had a frozen ladder.

**The headline problem — the long-run economy converges to an unhealthy attractor.**
A single root cause (weak profit recirculation) cascades into four visible symptoms:

- **Money pools in businesses (~96% of all cash), residents drained to subsistence.**
  At day 365 businesses hold ~$28.7k of $30k; the diner alone hoards $11–12k against
  its $3k reserve, while every resident converges to ~$100 (Gini 0.01–0.05, median = min).
  Profit-distribution is flat-capped at $900/biz/day, but storefront inflow outruns it,
  so surplus strands in the diner and never gets back to people. → **P10-1**
- **Live-game deflation to the price floor.** Avg resource price collapses 7.0 → ~3;
  materials & wares end pinned exactly at the floor (base×0.4). The 10f reversion only
  restores base inside the neutral utilization band — but broke residents buy little, so
  producer utilization sits *below* 0.3, where the ×0.95 branch ratchets to the floor.
  So **P9-9 is fixed for the idealized steady state but not for the live game.** → **P10-2**
- **Labour fully concentrates at the two storefronts; all four producers run with 0 staff**
  yet keep producing at full capacity (production is labour-independent). The P9-2 fix
  overshot. → **P10-3**
- **The Phase-10b aspirational arc is dead:** 0 vehicles, 0 luxuries, 0 savings-goals
  across all 3 seeds / 365 days — residents at ~$100 can never clear the $800 vehicle
  gate that unlocks "thriving". → **P10-4**
- **7–8/12 residents under chronic eviction pressure** (rentMissedDays > 0); the city is
  a debtors' town, kept housed only by the safe-eviction backstop. → **P10-5**

### 11a checkpoint — price-elastic leisure + a reference-anchored pricer (2026-06-03)

The root cause behind the soak's unhealthy attractor was **captive demand**: a storefront
could raise its price without ever losing a customer, so the diner/goods store became a
one-way money pump that drained residents to subsistence (P10-1). 11a removes the captivity
on *discretionary* spend — leisure is now price-sensitive (a shopper only buys when the
asking price sits at or below their personal willingness-to-pay), so pricing above the going
rate now *sheds buyers*. Essential meals stay inelastic (nobody starves to make a point).

To stop the rule-based pricer from death-spiralling under the new demand curve, it's now
**reference-anchored**: a losing day *above* the going market rate eases price back toward it
(the high price is what's driving customers away), instead of the old "loss → raise" reflex
that simply chased the cap. Measured under the product config (brain rules, 4 agentic
residents, 120d, seeds 1/7): storefront prices now **park at their anchors** (diner ~18–20,
goods ~34–37) instead of pinning at the $100 clamp; **business cash share falls 91% → 37%**
and **resident median wealth rises from the $91 floor to ~$860** — money recirculates.

Honest scope: this is measured on the 4-agent/120d product config, *not* the 12-agent/365d
soak that surfaced P10-1..5. A full re-soak is the next validation. P10-1 is materially
relieved (storefronts can no longer pump captive demand); the cascade items (P10-2 producer
deflation, P10-3 labour concentration, P10-5 eviction pressure) are not yet directly
addressed and await the 11b competitor + a re-soak.

---

## Issues & ideas backlog

Severity: **S1** breaks an invariant / crashes · **S2** wrong or misleading
behaviour · **S3** awkward / unrealistic but harmless · **S4** polish / idea.
Status: `open` → `fixed (commit)` / `wontfix (reason)`.

| ID | Day | Severity | Observation | Diagnosis | Proposed fix | Status |
| -- | --- | -------- | ----------- | --------- | ------------ | ------ |
| P9-1 | 2 | S2 | `negotiateRaise` had no cooldown (job-change has 5d). A resident could ask every day and climb to the 2× cap in ~9 days, friction-free — and inflate the employer's payroll. | Clamp gated raises only on employment + wage cap; no time gate. Asymmetric with the job-switch cooldown. | Add `RAISE_COOLDOWN_DAYS` (7d); thread `daysSinceRaise` through the observation + a serialized `lastRaiseDay` map + a clamp gate. | **fixed** — validated live: Day 9 raise landed, Day 10 ask blocked |
| P9-2 | 1 | S3 | Inverted wage ladder: Keystone Housing ($0.20/tick) is the *top* wage, so every `switchJobTo` is a pay cut for Joy — the lever is dead for the best-paid resident. **Confirmed Arc 2:** feeds P9-10 (her lever set is nearly exhausted). | Wage table put the landlord at the top, so the best-paid resident's only structural job move was downward. | Re-ranked city-gen base wages so the two cash-rich storefronts out-earn the landlord (goods $0.20 > diner $0.17 > landlord $0.15), leaving the fragile B2B producers untouched. A landlord worker now has an upward `switchJobTo` target. Test: `city.test.ts` wage-ladder. | **fixed** (10f) |
| P9-3 | 3 | S3 | Re-homing is free — `reHomeTo` just reassigns `homeId`, no moving cost or deposit. | `apply()` sets `r.homeId` with no transfer. Makes "downsize for a cushion" strictly dominant, zero-risk. | Consider a small one-off moving cost/deposit so the choice has a tradeoff. Needs a balance call. | open |
| P9-4 | 5 | S3 | `buyVehicle` pays `biz_goods` even if that store is closed/bankrupt (no active check). | `applyBuyVehicle` transferred regardless of `goods.active`; the clamp couldn't see store status. | Added `vehicleSellerOpen` to the observation + a clamp gate, plus a live `!goods.active` guard in `applyBuyVehicle`. Tests: clamp drop + live no-buy/money-conserved. | **fixed** (this commit) |
| P9-5 | 4 | S4 | Forced grain supply-shock spiked grain $3.61→$6.40 but downstream **food** *fell* — input shock didn't propagate to outputs. **Re-confirmed Day 10:** grain re-shocked to $6.40, food still fell to $5.57. | **Root-caused** (`MarketSystem.adjustPrices`): each resource's price is set purely from its *own* producer's sales utilization (`sold/cap`), never from input costs — so input→output propagation can't happen by construction. | None — by design. A "fix" would re-architect the tuned, test-covered market. | wontfix (by design — utilization-priced) |
| P9-6 | 3 | note | Needs reach a stable daily **limit cycle** by Day 3 (energy 64.30…, social 79.30… bit-identical each midnight) while hunger still converges upward (67→78→88). | Deterministic periodic routine sampled at the same phase (sleeping, midnight) each day. | None — positive signal of deterministic stability. | wontfix (working as intended) |
| P9-7 | 5 | S4 | A resident's one-off `buyVehicle` shows up as a GDP spike (+$713 ≈ vehicle cost). | GDP counts the consumer→goods transfer as activity. | Arguably correct (durable consumption is GDP). | wontfix (working as intended) |
| P9-8 | 6 | S3 | Fire at one food vendor (the diner) cascaded into a city-wide food shortage — Joy, who doesn't work there, starved (hunger 88→23, recovered by Day 7). | Food supply is concentrated; one vendor's destroyed stock leaves the city short until it restocks. | Emergent and realistic — arguably working-as-intended. Flag only if one-vendor fragility feels too punishing over longer play. | wontfix (emergent realism) |
| P9-9 | 10 | S3 | Persistent deflation: avg resource price ratcheted 7.00 (D1) → 5.43 (D10) as utilization stayed low; prices drift toward the floor. | `adjustPrices` had no restoring force: in the neutral utilization band it simply *held*, so prices froze wherever the early-ramp transient left them — a path-dependent downward drift with no memory of base. | Added mean-reversion (Phase 10f): in the neutral band the price drifts `PRICE_REVERT_FRACTION` (0.2) toward base each day and snaps to base within `PRICE_REVERT_SNAP` (0.5%). Base is now the unique attractor — every price returns *exactly* to base at steady state (verified seeds 1/2/7 over 120d). Test: `market.test.ts` P9-9. | **partially fixed** (10f) — neutral-band freeze fixed & verified in the no-agency steady state, but the live full-agency game still deflates to the floor (utilization stays <0.3). See **P10-2**. |
| P9-10 | 6–10 | S2 | An optimized resident runs out of meaningful levers: at top wage + cheapest home + owning a vehicle, only `negotiateRaise` is live, and it caps at 2×. No late-game depth. | Small lever set; the inverted wage ladder (P9-2) kills `switchJobTo`; no aspirational sinks (savings goals, luxury, business ownership). | Phase-10 design item: add upward goals/sinks so a thriving resident still faces decisions. | **mitigated** — 10b added aspirational sinks (savings goal + luxury spend); 10f fixed the inverted ladder (P9-2) so `switchJobTo` is a live upward move again. Business ownership remains a future idea. But the sinks are unreachable in a real run — see **P10-4**. |
| P10-1 | soak | S2 | **Money pools in businesses; residents stuck at subsistence.** Over 365d (seeds 1/7/3) businesses hold ~96% of all cash; the diner hoards $11–12k vs its $3k reserve, residents converge to ~$100 each (Gini 0.01–0.05). | Profit-distribution is flat-capped at `PROFIT_DISTRIBUTION_CAP` $900/biz/day, but storefront inflow (meals + social) outruns the cap, so surplus strands in the diner instead of recirculating. Reserves ($3k/$4.5k) sit above what residents ever re-accumulate. | Balance/design: make distribution scale with surplus (e.g. % above reserve) rather than a flat cap; and/or lower `BUSINESS_RESERVE`; and/or add a wage-pressure feedback. **Root cause** — P10-2/4/5 cascade from it. | **mitigating** (11a) — price-elastic leisure + reference-anchored pricer removes the captive-demand pump: under the product config (4 agents, 120d) business cash share fell 91%→37% and resident median rose $91→~$860. Awaits a 12-agent/365d re-soak + the 11b competitor. See the 11a checkpoint above. |
| P10-2 | soak | S2 | **Live-game deflation to the floor.** Avg resource price 7.0 → ~3 over the run; materials & wares end pinned at base×0.4 (the floor). | The 10f reversion only pulls toward base inside the neutral band [0.3,0.6]; low resident demand (P10-1) holds producer utilization <0.3, where the explicit ×0.95 branch ratchets to the floor unopposed. P9-9's fix never engages. | Extend reversion to also pull *up* from below base when demand is structurally low, or gate the ×0.95 to not undercut a base-relative floor, or fix P10-1 (the demand root). Add a *live-config* market test (full agency) so this is caught. | open |
| P10-3 | soak | S3 | **Labour fully concentrates at the 2 storefronts; all 4 producers run with 0 employees** yet keep producing at full capacity. | The P9-2 wage fix works but overshoots: `switchJobTo` chases the top wage, so everyone piles into diner+goods. `MarketSystem.produce()` is labour-independent, so empty producers still make full output — masking the exodus. | Labour-dependent production (output scales with staffing), and/or per-employer hiring caps, and/or a wage equilibrium so jobs don't collapse to 2 employers. Needs design. | open |
| P10-4 | soak | S2 | **Phase-10b aspirational arc is dead in a real run:** 0 vehicles, 0 luxuries, 0 savings-goals across all 3 seeds / 365d. | The rules provider gates luxury/savings on `thriving = employed && hasVehicle`; a vehicle costs $800 but residents sit at ~$100 (P10-1), so the gate never opens — the depth we built is unreachable. | Primarily a P10-1 fix (give residents disposable income). Secondarily revisit the $800 vehicle gate / `thriving` definition so the arc can start. | open |
| P10-5 | soak | S3 | **7–8/12 residents under chronic eviction pressure** (rentMissedDays > 0) at day 365. | Residents at ~$100 can't reliably cover rent ($50–70/day) plus meals/social. Symptom of P10-1; the safe-eviction backstop keeps them housed so no invariant breaks. | Follows P10-1. Until then, the re-home backstop is doing real work — worth confirming it never thrashes. | open |
