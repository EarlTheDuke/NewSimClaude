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

### 11b re-soak checkpoint — 12-agent / 365-day full-agency soak (2026-06-03)

This is the validation the 11a note asked for: the full soak that originally surfaced
P10-1..5, re-run after 11a + 11b. **All 12 residents agentic** (rules), **365 days**,
**disasters OFF** (a clean, money-conserved structural read), seeds 1/2/3/5/7. Two arms on
the same seeds isolate the rival's marginal effect: **A = 11a only** (one diner), **B = 11a +
11b** (a second, competing diner). Money conserved to ±$0.00 in all 10 runs.

| Metric (5-seed mean) | Original soak (pre-11a) | A · no rival | B · rival diner |
| --- | --- | --- | --- |
| Resident median wealth | ~$100 | **$753** | **$797** |
| Resident min wealth | ~floor | $554 | **$736** |
| Wealth Gini (0 = equal) | 0.01–0.05 | ~0.0 | ~0.05 |
| Business cash share | ~96% | 70% | 71% |
| Vehicles owned | 0 / 12 | **11.6 / 12** | **12.0 / 12** |
| Residents with a savings goal | 0 / 12 | **11.6 / 12** | **12.0 / 12** |
| Luxuries bought (total) | 0 | 2,251 | 3,651 |
| Residents under eviction pressure | 7–8 / 12 | **0 / 12** | **0 / 12** |
| Producers running 0-staff | — | 4 / 4 | 4 / 4 |
| Resources pinned at floor | 2 / 4 | 4 / 4 | 4 / 4 |
| Storefront bankruptcies | 0 | 0 | 1 (every seed) |

**What's now healthy (P10-1, P10-4, P10-5 resolved):**

- **P10-1 (money pooling) — resolved.** Resident median rose from ~$100 to ~$780; the wealth
  Gini collapsed to ~0; *no business holds cash above its own reserve*. The residual ~70%
  "business share" is **not** pooling — it's the locked working capital every business is
  *designed* to keep on hand (the landlord's $4,500 + four producers at $3,000 each = $16.5k),
  sitting exactly at their floors. In plain terms: the one-way money pump is gone, surplus
  recirculates to residents, and what's left in business accounts is just the float a shop
  needs to keep its doors open.
- **P10-4 (aspirational arc) — resolved.** With real disposable income the "thriving" gate
  opens on its own: ~12/12 residents own a vehicle, ~12/12 set a savings goal, and the town
  buys thousands of luxuries over the year. The depth built in 10b is now reachable — exactly
  the P10-1 → P10-4 unlock we predicted (fix the income, the arc lights up for free).
- **P10-5 (eviction pressure) — resolved.** From 7–8/12 residents behind on rent to **0/12**.
  The town is no longer a debtors' town leaning on the safe-eviction backstop.

**What's still open (P10-2, P10-3 — same root):**

- **P10-2 (deflation to floor) — open, and worse at full scale.** All **4/4** resource prices
  now pin at the floor (the original soak had 2/4). 
- **P10-3 (labour concentration) — open.** All 4 producers run with **0 staff**; all 12
  workers pile into the 3 storefronts, yet the producers still ship full output.
- These are **one bug, not two.** Production is labour-independent, so an empty farm/mine/
  bakery/factory still makes a full batch; the wage ladder then pulls every worker into the
  higher-paying storefronts. Empty producers over-supplying B2B goods is what ratchets resource
  prices to the floor. **The single highest-value next build is labour-dependent production**
  (output scales with staffing) — it attacks both P10-2 and P10-3 at the source.

**New finding — rivalry consolidates over a full year (P10-6):** under pure rules with
disasters off, the original **biz_diner ends at $0 and goes inactive in all 5 seeds** (the
newer diner_2 + the goods store survive). The 90-day "truce, both survive" that
`competition.test.ts` proves does **not** hold out to 365 days — given long enough, geography
and the pricer let one diner quietly win the corner. The town is *better off for the rivalry
while it lasts*: the rival arm's residents are richer (min wealth +33%, $554 → $736; median
+6%) because two diners compete the price down and recirculate more cash. The open question is
a design choice, not a bug: accept realistic consolidation (one survivor), or tune the
pricer/geography for a durable duopoly. Logged as **P10-6** below.

### Live-config probe — what the in-browser game actually runs (2026-06-04)

The re-soak above made *all 12* residents agentic. The browser app (`main.ts`) does
not: it runs **seed 1, disasters ON, and only 4 of 12 residents agentic** (res_0..3 —
the owners of the diner, goods store, landlord, and farm). The other 8 are "NPCs":
they work, eat, and buy essentials, but make no life decisions — they never buy a
vehicle, set a savings goal, or buy a luxury. Reproduced headlessly (the sim is
deterministic on the seed) at days 30/90/180/365.

**Headline: in the live config the entire B2B production base goes bankrupt within a
year.** By day 365 farm, mine, bakery, and factory are all CLOSED (cash 0, 0 staff);
only the three storefronts + landlord survive, the original diner a zombie at $0. A
**disasters-OFF control rules disasters out** — the producers die either way, so the
cause is the 4-agentic setup, *not* the disasters. (Contrast: the 12-agentic re-soak
had **zero** producer bankruptcies.)

**Why:** with only four spenders, the eight NPCs hoard their wages — one ends the year
at ~$8–9k and **none ever buys anything aspirational** (0/8 own a vehicle) — draining
money out of the shopping circuit. Storefront revenue falls, the stores buy fewer
inputs, and the producers — already at floor prices with 0 staff (P10-2/P10-3) — have
no cushion and fail. In plain terms this is **P10-1 (money pooling) re-emerging, just
relocated from businesses to passive residents.** The "P10-1 resolved" result was
contingent on *all* residents being agentic; the shipped demo doesn't inherit it.

The four agentic owners, by contrast, thrive and recirculate: ~$750 each, all own a
vehicle, all saving, luxuries climbing 26 → 1033 over the year. Money stayed at exactly
$34,000 the whole run — the grant disaster never rolled in seed 1, so nothing was
minted and conservation held even with disasters on. Net: left running a year, the live
demo decays into a town with no producers, a $0 diner, and eight cash-hoarding NPCs.
Logged as **P10-7**. (Caveat: a deterministic reproduction assuming a hands-off tab —
not a read of the exact running tab; God-Mode meddling or a Load would diverge it.)

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
| P10-1 | soak | S2 | **Money pools in businesses; residents stuck at subsistence.** Over 365d (seeds 1/7/3) businesses hold ~96% of all cash; the diner hoards $11–12k vs its $3k reserve, residents converge to ~$100 each (Gini 0.01–0.05). | Profit-distribution is flat-capped at `PROFIT_DISTRIBUTION_CAP` $900/biz/day, but storefront inflow (meals + social) outruns the cap, so surplus strands in the diner instead of recirculating. Reserves ($3k/$4.5k) sit above what residents ever re-accumulate. | Balance/design: make distribution scale with surplus (e.g. % above reserve) rather than a flat cap; and/or lower `BUSINESS_RESERVE`; and/or add a wage-pressure feedback. **Root cause** — P10-2/4/5 cascade from it. | **resolved** (11a + re-soak) — the 12-agent/365d re-soak confirms it: resident median ~$100→~$780, Gini→~0, no business holds cash above its reserve. The residual ~70% business share is just locked working capital (landlord $4.5k + 4 producers ×$3k), by design. See the 11b re-soak checkpoint above. |
| P10-2 | soak | S2 | **Live-game deflation to the floor.** Re-soak (12-agent/365d) confirms & worsens it: **all 4/4** resources end pinned at base×0.4 (was 2/4) — grain 1.6, materials 2.0, food 3.2, wares 4.4. | **Shares one root with P10-3.** Production is labour-independent, so the 4 producers ship full output with 0 staff (P10-3); that oversupply holds utilization <0.3, where the ×0.95 branch ratchets to the floor and the 10f reversion (neutral band only) never engages. *Not* a demand problem now — P10-1 is fixed and residents are rich; it's a supply glut from empty, full-output producers. | **Labour-dependent production** (output scales with staffing) is the shared fix — fewer/no staff → less output → utilization recovers off the floor. Secondarily, gate the ×0.95 to a base-relative floor. Add a live-config (full-agency) market test. | open |
| P10-3 | soak | S3 | **Labour fully concentrates at the storefronts; all 4 producers run with 0 employees** yet keep producing at full capacity. Re-soak confirms: 4/4 producers 0-staff, all 12 workers in the 3 storefronts, both arms, every seed. | The P9-2 wage fix works but overshoots: `switchJobTo` chases the top wage, so everyone piles into the diner(s)+goods. `MarketSystem.produce()` is labour-independent, so empty producers still make full output — masking the exodus **and** gluting the B2B market (this is the P10-2 deflation root). | **Labour-dependent production** (output scales with staffing) — the shared fix with P10-2. Optionally per-employer hiring caps / a wage equilibrium so jobs don't collapse to a few employers. Needs design. | open |
| P10-4 | soak | S2 | **Phase-10b aspirational arc is dead in a real run:** 0 vehicles, 0 luxuries, 0 savings-goals across all 3 seeds / 365d. | The rules provider gates luxury/savings on `thriving = employed && hasVehicle`; a vehicle costs $800 but residents sit at ~$100 (P10-1), so the gate never opens — the depth we built is unreachable. | Primarily a P10-1 fix (give residents disposable income). Secondarily revisit the $800 vehicle gate / `thriving` definition so the arc can start. | **resolved** (via P10-1) — re-soak shows the arc fully alive once income recovers: ~12/12 own a vehicle, ~12/12 set a savings goal, thousands of luxuries/year. No gate change needed; the P10-1 fix unlocked it for free, exactly as predicted. |
| P10-5 | soak | S3 | **7–8/12 residents under chronic eviction pressure** (rentMissedDays > 0) at day 365. | Residents at ~$100 can't reliably cover rent ($50–70/day) plus meals/social. Symptom of P10-1; the safe-eviction backstop keeps them housed so no invariant breaks. | Follows P10-1. Until then, the re-home backstop is doing real work — worth confirming it never thrashes. | **resolved** (via P10-1) — re-soak: **0/12** under eviction pressure in both arms, every seed. With income restored the town pays its rent. |
| P10-6 | soak | S3 | **Storefront rivalry consolidates over a full year.** Under pure rules / disasters-off, the original `biz_diner` ends at $0 and goes inactive in **all 5 seeds** by day 365; the newer `diner_2` + the goods store survive. The 90-day "truce, both survive" in `competition.test.ts` does not hold to 365 days. | Given long enough, geography + the rules pricer let one diner win the corner — a slow, deterministic shake-out, not a crash (money stays conserved; the town is *richer* for the rivalry while it lasts: resident min wealth +33% vs the no-rival arm). | **Design choice, not a bug.** Either accept realistic consolidation (one survivor) — likely fine — or, if a durable duopoly is wanted, tune the pricer/geography (e.g. a softer undercut response, or a loyalty/locality pull) so both hold. Add a long-horizon (365d) competition assertion either way. | open (decision) |
| P10-7 | live | S2 | **The shipped in-browser config (4 of 12 residents agentic, disasters on) lets the entire B2B production base — farm, mine, bakery, factory — go bankrupt within a year.** A disasters-off control reproduces the same 4 closures, ruling out disasters and isolating the 4-agentic setup as the cause. The 12-agentic re-soak had **0** producer bankruptcies. | The 8 non-agentic NPCs hoard wages (one hits ~$9k) and never spend on vehicles/luxuries (0/8), draining money from the retail circuit. Storefront revenue falls → fewer B2B input purchases → producers (already floor-priced & 0-staff per P10-2/P10-3) have no cushion and fail. This is **P10-1 pooling relocated** from businesses to passive residents; the "resolved" P10-1 result was contingent on *all* residents being agentic. | Run the live demo with all (or most) residents agentic; or give NPCs baseline aspirational spending so they don't hoard; or make producers viable at low B2B demand (ties to labour-dependent production, P10-3). | open |

---

## Phase 12 plan — Capital & Productivity (the first growth engine)

**Motivation.** GDP/day is flat in every long game because the model has *no growth engine*. GDP here is need-capped consumption (`MacroSystem` sums storefront revenue; a resident eats one lunch whether rich or broke), in a fixed-population, fixed-money, price-reverting closed loop. Real aggregate GDP grows from **population growth + labour-productivity growth** (and productivity ≈ capital deepening + technology). Phase 12 adds the highest-leverage of these: **productivity via capital investment.**

**Core idea (plain terms).** Today a producer's output is a fixed constant (`maxPerDay`), independent of staffing or equipment — which is *why* empty producers ship full output (P10-3), glut the market to the floor (P10-2), and GDP never grows. Phase 12 makes **output a function of labour × capital**, and lets a business **spend cash on capital goods (equipment) that raise future output**. One change, three wins:
- **Investment is itself GDP** (expenditure approach: GDP = Consumption + **Investment**) — the headline number finally moves.
- **Fixes the open bugs:** output needs staff (closes P10-3); understaffed producers make less, so utilization climbs off the floor (closes P10-2); the factory gains equipment buyers (counters the P10-7 producer die-off).
- **Creates the CEO decision a benchmark wants:** distribute profit now, or invest for higher future output?

**Honest economics caveat.** Capital deepening yields *transitional* growth — a multi-year GDP climb as the town builds its capital stock — that converges to a higher steady state (Solow). For *perpetual* growth, layer technology (TFP) or population later. Phase 12 turns "flat from day 1" into "climbs for years, then plateaus higher."

**Key design decisions.**
- **Capital good = wares, bought wholesale from `biz_factory`** (factories make machines — realistic; keeps investment in the B2B layer, away from the resident retail-elasticity tests; routes money to the dying factory).
- **Money stays conserved:** investment is a `World.transfer(biz → biz_factory)`; `capital` is a non-money quantity (like `inventory`/`resources`); depreciation reduces that quantity, not cash.
- **Determinism intact:** capital is arithmetic; decisions come through the deterministic rules provider; no new RNG.
- **Capital depreciates daily** (ongoing maintenance capex), so investment is a recurring decision and output isn't free forever.
- **Invest only surplus above `BUSINESS_RESERVE`** — over-investing into insolvency is a real risk the pricer must respect.

**Sub-phases** (each independently shippable + tested, per the 11a/11b cadence):
- **12a — Data model + calibration (deliberately a no-op).** Add `capital?: number` to `Business`; add `CAPITAL_BASELINE` + capacity params to `constants.ts`; city-gen seeds each producer's capital to a baseline calibrated so the 12b formula returns *today's* output (a 100-day run stays byte-identical). Serialize/restore round-trips via `structuredClone`. Tests: round-trip + back-compat + no behavioral change.
- **12b — Labour- & capital-dependent production (fixes P10-2 + P10-3).** Rewrite `MarketSystem.produce()`: `effectiveCapacity = baseCapacity × laborFactor(staffing) × capitalFactor(capital)` (0 staff → ~0 output; baseline capital → factor 1, diminishing returns above). **Critical:** `adjustPrices()` must measure utilization against the *same* effective capacity. Add daily depreciation. Main tuning effort lives here.
- **12c — The `invest` lever behind the DecisionProvider seam.** Add `invest?` to `BusinessAction`, `maxInvestPerReview` to `DecisionLimits`, clamp it; add `capital`/`capacityUtilization` to `BusinessObservation`; in `BusinessAgentSystem.apply()` transfer cash → factory and raise `capital` (guarded by reserve); rules provider invests surplus when capacity-constrained + profitable.
- **12d — GDP = Consumption + Investment + UI. ✅ shipped.** Each invest-lever spend is booked to `Business.capitalInvested` (gross capex); `MacroSystem` differences it day-over-day into an `investment` term, so `gdp = consumption + investment`, and samples also carry the `consumption` / `investment` / `totalCapital` breakdown. The macro panel gained *Investment / day* and *Capital stock* cards, the business inspector shows `capital · utilization`, and the decision trace renders the invest lever. Back-compat is exact: with nobody investing, `investment = 0` and `gdp == consumption`, so every existing macro metric is unchanged (258 tests green; browser-verified — cards render, investment $0 / capital 800 flat). **Deferred to 12e:** the "multi-year soak shows GDP climbing then flattening" Solow test — the engine is still inert in the seeded city (distribute-before-review drains the cushion; demand is need-capped until the keystone #1), so there's no organic climb to assert yet. 12d ships the *instrument*; 12e + #1 make the needle move.
- **12e — Re-soak, re-tune, document, push.** Re-run live-config + 12-agentic soaks; tune capacity/depreciation/invest params so P10-2/P10-3 close, P10-7 is mitigated, and GDP trends up for years. Update this doc; full verify + push.

**Invariants & risks.** Conservation (investment = transfer; assert money conserved in soaks) · determinism (no new RNG; identical-seed test) · the pricer's `cap` denominator must track effective capacity (easy to miss) · balance drift from 12b needs real re-tuning time in 12e · invest only above reserve (bankruptcy guard).

---

## Phase 13 plan — Wants grow with wealth (the keystone, North Star #1)

**Motivation.** Demand is **need-capped**: a resident eats one lunch whether rich or broke, so the demand ceiling is fixed. That's why the Phase 12 growth engine is inert — storefronts never become capacity-bound, so the invest lever never fires and GDP can't climb. The keystone (NORTH-STAR #1) makes **consumption rise with wealth** so the ceiling lifts. Highest value, highest blast radius (moves every soak baseline).

**Design (from the `keystone-design` multi-agent workflow: 5 demand-mappers → 3 scored designs → adversarial validation).** Winner = a **quantity loop**: wrap the single-unit buy in `EconomySystem.buyMealIfEating` / `spendIfSocializing` in an N-unit loop where `N = consumptionUnits(resident)` — a **pure, RNG-free** function of `resident.money` pivoted on `WEALTH_BASELINE` (= the $500 seeded start). `mult = clamp((money/BASELINE) ^ WEALTH_ELASTICITY, 1, WEALTH_DEMAND_CAP)`, integerized by a deterministic per-resident **phase offset** (`idx % WEALTH_ROUND_TIERS`, the same id-index `leisureReservation` uses) so the fractional unit spreads across the population without ever touching the seeded stream. Each unit is its own `World.transfer`, so conservation is automatic and over-ordering is impossible (the loop breaks when cash or stock runs out). A rejected design used stochastic rounding via a **non-existent** `rng.nextFloat()` that would have desynced the whole city — caught and discarded.

**The honest causal chain (validator's key correction — important).** Wealth-elastic demand lifts `consumption → GDP → storefront utilization` (verified: faster inventory depletion raises `make/capacity` in `MarketSystem`). But it does **NOT, by itself, fire the invest lever** and close the Phase 12 loop. The lever is a 3-condition AND gate (`utilization>0.85 AND dayProfit>50 AND cash>1.5×reserve`); demand only satisfies the first. The other two are still defeated by **distribute-before-review ordering** — exactly what `capital.test.ts:331-363` locks (`investedDays===0`). **So loop-closure additionally requires the 12e-class ordering fix (invest-before-distribute).** 13a/13b own the demand half; the ordering fix is its own slice and must land for the keystone to fully pay off. Don't write a "13c invest lever fires" test that contradicts the `investedDays===0` lock without shipping the ordering change in the same slice.

**Sub-slices** (each independently shippable + tested):
- **13a — Inert no-op scaffold. ✅ shipped.** Added `WEALTH_BASELINE`/`WEALTH_ELASTICITY=0`/`WEALTH_DEMAND_CAP=4`/`WEALTH_ROUND_TIERS=6`, the exported pure `consumptionUnits()` helper, and the N-loop wrappers. At `WEALTH_ELASTICITY=0` the helper short-circuits to 1, so every loop runs once and the seeded city is **byte-identical** (266 tests green; EconomySystem stays RNG-free — zero extra draws). A drift-guard test pins every resident's start to `WEALTH_BASELINE`. The helper takes `elasticity` as a defaulted param so the curve is unit-tested *now*.
- **13b — Engage quantity-only. ✅ shipped.** `WEALTH_ELASTICITY` 0 → 1; residents above $500 now order more per visit (capped at `WEALTH_DEMAND_CAP`). **The keystone bites** (90-day probe): brain-off goods revenue +35%; **agentic diner +102% / goods +61%** — residents do bank surpluses (median $689–1285), so demand lifts in practice, and a bonus emergent effect, the knob *compresses* wealth (the rich spend their surplus back into the shops, max wealth $4207 → $1650). Browser-verified live: GDP climbs (~$850 → ~$1.4k), 8/8 businesses alive, money conserved, no errors. **Benchmark freeze wired for real:** a `wealthElasticity` option threads `createCity → EconomySystem`, and `ceoBench` passes a frozen `BENCH_WEALTH_ELASTICITY` so live-knob tuning can't drift historical CEO scores. **Test re-baselining (honest, not slackened):** the two orthogonal-mechanism guards — `market.test.ts` P9-9 price-reversion and `competition.test.ts` geography-split — are pinned to `wealthElasticity: 0` (they test mechanisms independent of wealth), and the demand lift gets its own assertion in `elasticity.test.ts`. (`macro.test.ts` needed no change — brain-off keeps `investment=0`, so `gdp==consumption` holds.) 267 tests green. **Still inert by design:** investment stays $0 / capital flat — utilization climbs but the invest lever's profit/cash gates remain blocked by distribute-before-review (closes in 13c).
- **13c — Close the invest loop (the reorder). ✅ shipped — but partial; read the honest limit.** Split profit distribution into its own `DistributionSystem` that runs **after** the business agent (it used to run inside `MarketSystem`, *before* it). A business now reviews its day with its full operating profit in hand and can reinvest before paying the dividend — and because distribution is independent of the price step it now follows, this is **byte-identical for any brain-off city**; only agentic behaviour changes. The invest gate dropped the broken `dayProfit>50` (always distribution-dominated) and keys off the now-meaningful surplus: `utilization > INVEST_UTILIZATION_THRESHOLD (0.45) && cash > BUSINESS_RESERVE + INVEST_MIN_SURPLUS (200)`. **Result: the lever fires** — the ordering blocker `capital.test.ts` documented is gone (that `investedDays===0` lock is flipped to assert it now invests), and capital visibly deepens (live: 800 → ~1280 in the first days). 267 tests green incl. the 365-day soak and a new end-to-end "invest loop closes" test; browser-verified (GDP climbs, capital rises then eases, money conserved, no errors).
  - **The honest limit (newly discovered, important):** capital-deepening is **modest and transient** because daily utilization **structurally peaks ~0.5** — each business refills to a fixed stock `target` it can always reach, so it is *never hard capacity-bound*. Investing raises the ceiling, which *lowers* utilization, so the lever self-limits and the gained capital depreciates back toward baseline. Confirmed by sweep: utilization stays ~0.49 even at elasticity 1→3. So the keystone's realized payoff is the **demand-driven GDP climb** (consumption roughly *doubles* over a year — North Star #1 delivered), not yet a strong productivity/Solow engine.
  - **Deferred to Phase 14 (capacity calibration):** make demand press against capacity so capital-deepening compounds — e.g. scale a business's `target` (and/or `maxPerDay`) with its capital, so a well-capitalised firm genuinely stocks & sells more and utilization runs hot. The optional realism axes (wealth-lifted `leisureReservation`; eat-out-more `BrainSystem` thresholds) move there too. Kept `WEALTH_ELASTICITY = 1` (stable across the soak; the feared rich-tail explosion never materialised, so no re-tune).

**Invariants & risks.** Conservation (every unit a capped transfer) · determinism (pure, RNG-free; no new draws — the decisive win over the rejected stochastic-rounding design) · `WEALTH_BASELINE` must track cityGen's $500 start (pinned by a test) · inventory starvation / GDP over-shoot from the rich tail → bound by `WEALTH_DEMAND_CAP` + diminishing-returns elasticity, watched in the 13c soak · units 2..N are discretionary splurge (needs already satisfied) — keep the loop confined to EconomySystem · the 12-agent live config showed a non-monotonic goods-revenue dip at e=1 (agentic resident behaviour interacts with higher demand) — a 13c tuning/interaction item to watch in the soak.
