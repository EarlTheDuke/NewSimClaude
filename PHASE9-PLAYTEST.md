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
| P9-9 | 10 | S3 | Persistent deflation: avg resource price ratcheted 7.00 (D1) → 5.43 (D10) as utilization stayed low; prices drift toward the floor. | `adjustPrices` had no restoring force: in the neutral utilization band it simply *held*, so prices froze wherever the early-ramp transient left them — a path-dependent downward drift with no memory of base. | Added mean-reversion (Phase 10f): in the neutral band the price drifts `PRICE_REVERT_FRACTION` (0.2) toward base each day and snaps to base within `PRICE_REVERT_SNAP` (0.5%). Base is now the unique attractor — every price returns *exactly* to base at steady state (verified seeds 1/2/7 over 120d). Test: `market.test.ts` P9-9. | **fixed** (10f) |
| P9-10 | 6–10 | S2 | An optimized resident runs out of meaningful levers: at top wage + cheapest home + owning a vehicle, only `negotiateRaise` is live, and it caps at 2×. No late-game depth. | Small lever set; the inverted wage ladder (P9-2) kills `switchJobTo`; no aspirational sinks (savings goals, luxury, business ownership). | Phase-10 design item: add upward goals/sinks so a thriving resident still faces decisions. | **mitigated** — 10b added aspirational sinks (savings goal + luxury spend); 10f fixed the inverted ladder (P9-2) so `switchJobTo` is a live upward move again. Business ownership remains a future idea. |
