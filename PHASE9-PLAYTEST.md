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

---

## Issues & ideas backlog

Severity: **S1** breaks an invariant / crashes · **S2** wrong or misleading
behaviour · **S3** awkward / unrealistic but harmless · **S4** polish / idea.
Status: `open` → `fixed (commit)` / `wontfix (reason)`.

| ID | Day | Severity | Observation | Diagnosis | Proposed fix | Status |
| -- | --- | -------- | ----------- | --------- | ------------ | ------ |
| P9-1 | 2 | S2 | `negotiateRaise` had no cooldown (job-change has 5d). A resident could ask every day and climb to the 2× cap in ~9 days, friction-free — and inflate the employer's payroll. | Clamp gated raises only on employment + wage cap; no time gate. Asymmetric with the job-switch cooldown. | Add `RAISE_COOLDOWN_DAYS` (7d); thread `daysSinceRaise` through the observation + a serialized `lastRaiseDay` map + a clamp gate. | **fixed** (this commit) |
| P9-2 | 1 | S3 | Inverted wage ladder: Keystone Housing ($0.20/tick) is the *top* wage, so every `switchJobTo` is a pay cut for Joy — the lever is dead for the best-paid resident. | Wage table puts the landlord at the top; not a bug, a position. Still makes one of five levers inert for her. | Revisit only if it makes job-switching uninteresting city-wide (would need a wage rebalance). | open |
| P9-3 | 3 | S3 | Re-homing is free — `reHomeTo` just reassigns `homeId`, no moving cost or deposit. | `apply()` sets `r.homeId` with no transfer. Makes "downsize for a cushion" strictly dominant, zero-risk. | Consider a small one-off moving cost/deposit so the choice has a tradeoff. Needs a balance call. | open |
| P9-4 | 5 | S3 | `buyVehicle` pays `biz_goods` even if that store is closed/bankrupt (no active check). | `applyBuyVehicle` transfers regardless of `goods.active`; the clamp can't see store status. | Gate `buyVehicle` on the vehicle seller being open (expose status in the observation). Edge case — doesn't occur in healthy runs. | open |
| P9-5 | 4 | S4 | Forced grain supply-shock spiked grain $3.61→$6.40 but downstream **food** *fell* ($7.22→$6.86) in-window — input shock didn't propagate to outputs. | Retail/food price is demand-driven with its own slow adjustment; propagation lag is plausible/realistic. | Observe across a longer-held shock to confirm it ever propagates; likely no-fix. | open |
| P9-6 | 3 | note | Needs reach a stable daily **limit cycle** by Day 3 (energy 64.30…, social 79.30… bit-identical each midnight) while hunger still converges upward (67→78→88). | Deterministic periodic routine sampled at the same phase (sleeping, midnight) each day. | None — positive signal of deterministic stability. | wontfix (working as intended) |
| P9-7 | 5 | S4 | A resident's one-off `buyVehicle` shows up as a GDP spike (+$713 ≈ vehicle cost). | GDP counts the consumer→goods transfer as activity. | Arguably correct (durable consumption is GDP). | wontfix (working as intended) |
