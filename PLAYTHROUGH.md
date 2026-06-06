# Claude-as-CEO playthrough — can an intelligent player beat the baselines?

**Plan.** Sit in the chair of the goods-store CEO in the canonical benchmark scenario
(seed 9, 42 turns, recapitalized to $50,000) and make *every* daily decision myself
via an interactive harness (`src/bench/play.ts`), reasoning each turn. Win condition:
end net worth above the **rules CEO ($25,215)** and **no-op ($25,178)**. Keep a
turn-by-turn journal, then write up what worked, what didn't, bugs, and improvements.

**The control surface** (per review, clamped): `setPrice` (±25%/review, [1,100]),
`hire` (±2/review), `invest` (0–500 cash → equipment/review), `setWage` ([base,
2×base]). Net worth = cash + inventory×price + (capital − 100).

## Opening read (turn 0)

- Net worth **$50,680** = cash $50,000 + inventory 20@$34 ($680) + capital 0.
- **The drain:** each day, cash above the $3,000 reserve is distributed to residents,
  capped ~$900/day. Doing nothing, the $50k bleeds down — the no-op still ends at
  $25,178 (it keeps ~$24.5k cash because revenue partly offsets the drain).
- **Lever analysis (why this is hard):**
  - *Price:* $34 is the demand anchor; leisure demand is *full* at/below it and falls
    above it, so $34 is already revenue-optimal — raising sheds buyers faster than
    margin gains, lowering just discards margin. Little to gain.
  - *Hire:* already at DESIRED_HEADCOUNT (2) = full output at LABOR_FULL_STAFF=2;
    a 3rd worker adds nothing, layoffs cut output. Inert.
  - *setWage:* clamped to ≥ base, so payroll can't be cut; raising only burns cash.
  - *invest:* converts cash → capital 1:1 (both counted), but capital depreciates
    1%/day. While cash is abundant (> reserve + $900) the distribution takes its $900
    regardless, so investing mostly trades cash for *depreciating* capital — net
    slightly negative — UNLESS aggressive investing starves the distribution by
    pulling cash toward the reserve.
- **Hypothesis:** the no-op is near-optimal; the only real lever is *invest-to-
  preserve* (race cash into capital before it's distributed), and even that fights
  depreciation. I'll test max-invest vs. holding, and probe pricing empirically.

## Journal

**Market research first (the probe).** Before committing, I swept fixed strategies over
the full 42 turns (`playprobe.ts`). This overturned my opening hypothesis:

| strategy | net worth | vs no-op |
|---|---|---|
| **price → $42, hold** | **$26,805** | **+$1,627** |
| price → $41 | $26,204 | +$1,026 |
| price → $40 | $25,235 | +$57 |
| no-op / price $34 / hire +2 | $25,178 | — |
| price → $43 | $22,154 | **−$3,024** ← cliff |
| invest 500/day | $23,112 | −$2,066 |
| wage → max | $19,777 | −$5,401 |
| price → $26 | $17,354 | −$7,824 |

The demand curve is *inelastic up to a reservation*, then steps down. Each resident's
willingness-to-pay is `anchor × (1 + 0.6 × tier)` over 6 tiers (`EconomySystem.leisureReservation`):
**$34, $38.08, $42.16, $46.24, $50.32, $54.40**, two residents each. So:
- $42 sits just under tier-2's $42.16 → captures the top 4 tiers (8 of 12 residents) at max margin.
- $43 crosses $42.16 → those 2 buyers vanish → the **cliff** ($26.8k → $22.2k for +$1).

**The play (set price $42 turn 1, hold to 42).** Turn-by-turn via `play.ts`:

| turn | net worth | price | util | day-rev | note |
|---|---|---|---|---|---|
| 0 | $50,680 | $34 | — | — | recapitalized to $50k |
| 1 | $50,196 | $42 | 76% | $408 | jumped to the cliff edge; demand re-sorting |
| 2 | $49,463 | $42 | 48% | $420 | transient |
| 5 | $47,161 | $42 | 57% | $504 | revenue ramping |
| 42 | **$26,805** | $42 | 100% | $882 | steady state |

Holding $42 matched the probe exactly. I re-evaluated mid-game and held — the fixed-$42
line beat every other fixed price over the full horizon, so there was nothing to adjust.

**The honest shape of the game: one real decision, then 41 holds.** Full per-day trace
via `npx vite-node src/bench/play.ts -- log` (reproducible). Phases:

- **Day 1 — the only decision:** $34 → $42 (one review; clamp allows up to $42.5). Net
  worth dips to $50,196; util 76%; day-revenue craters to $408 as demand re-sorts.
- **Days 2–8 — hold nerve:** util sags to 48% then recovers (48→52→57→67→71→76%); revenue
  climbs $420 → $672. The dip is a transient, not a mistake. Hold.
- **Days 9–35 — the wealth engine shows:** util grinds 76% → 95%, revenue $672 → $840.
  As the store distributes profit to residents, they get richer and (wealth-elastic) buy
  *more* from it — demand it partly funds itself. Net worth still bleeds ~$570/day to the
  capped distribution, but I'm above both baselines the whole way. Hold.
- **Days 36–42 — steady state:** util pins at 95–100%, revenue tops out at $882/day. End
  net worth **$26,805**.

Net worth fell monotonically (50,196 → 26,805) — the game is a *managed decline*: the
$50k drains via distribution no matter what; pricing at $42 just makes it drain slower
than the baselines. Inventory sat at 24 every day (the store restocks to target), so the
only thing my single lever changed was margin-per-sale.

### Final scoreboard

| player | net worth | vs me |
|---|---|---|
| **Me (price → $42)** | **$26,805** | — |
| Rules CEO | $25,215 | **+$1,590 (+6.3%)** |
| No-op | $25,178 | **+$1,627 (+6.5%)** |

**I beat both baselines** — purely through price discovery. The win is finding the $42
profit peak the rules brain never reaches (it anchors to the $34 reference price).

## What worked / what didn't

**Worked**
- **Pricing is the one real lever.** Raising to $42 (the highest price retaining tier-2)
  is the entire edge: +6.5% over no-op. The rules CEO leaves this on the table.
- **Market research mattered.** The optimum is non-obvious and hides behind a cliff;
  probing the curve (what a real CEO does) was essential. My *a-priori* reasoning was wrong.

**Didn't work (the "building" levers are dormant or harmful in this scenario)**
- **invest — net-negative (−$2,066).** Capital deprecates 1%/day, and because the firm's
  cash stays far above reserve all game, the distribution drains its capped ~$900/day
  *regardless* of investing. So investing doesn't reduce the drain; it just adds
  depreciation. My opening "invest-to-preserve" hypothesis was wrong.
- **hire — completely inert (= no-op to the cent).** Gated at DESIRED_HEADCOUNT=2; the
  lever silently does nothing with no feedback.
- **setWage — can only *raise* (clamp ≥ base), which only burns cash (−$5,401 at max).**
  No way to cut payroll; raising never pays off with a fixed, capped workforce.

This confirms the standing tension (NORTH-STAR / Phase-15): **the isolated CEO bench
rewards tactical pricing, not strategic building.** Phase 15 made the labour/invest
levers meaningful in the *living* economy under churn (per `TUNING-STUDY.md`: ~24 avoided
firm-deaths) — but in this stationary, single-firm, recapitalized bench they stay dormant.

## Bugs found

1. **🐞 Profit distribution is mislabeled as `wagesPaid`** (`DistributionSystem.ts:65,73`).
   The owner-dividend and even-recirculation transfers each do
   `biz.pnl.wagesPaid += world.transfer(...)`. So a firm's reported wage bill =
   real wages + its daily distribution payout. Measured on the goods store:
   - reported `wagesPaid` = **$43,898 over 42 days ($1,045/day)**
   - actual wages (the 2 workers' `lastPaycheck`) = **~$172/day**; the *entire city*
     pays only ~$538/day in wages — so the tally exceeds what the whole city could pay.
   - **Money is still conserved** (the transfers are real and capped); net worth matches
     the bench. It is purely a **P&L-attribution bug**, but it corrupts:
     - the CEO observation: `dayWages` is inflated ~5×, and `dayRent = revenue − wages −
       profit` (`BusinessAgentSystem.ts:244`) goes wrong as a result.
     - likely the **rules CEO's own decisions** — it sees wages > revenue every single
       day, which plausibly explains why it never pushes price up to the $42 optimum.
   - **Fix:** don't add distribution to `wagesPaid`. Either drop the tally on those two
     lines, or add a dedicated `pnl.distributed` field. Touches the `Business.pnl` type,
     serialization, the CEO observation, and any test asserting `wagesPaid` — re-baseline
     deliberately; the bench net-worth ordering must still hold.

2. **🐞 / design — the demand cliff is a knife-edge.** With only 12 residents across 6
   reservation tiers, demand drops in chunky steps; the profit-optimal price ($42) is one
   dollar from a 11%-revenue cliff ($43). A player can't find it without probing, and an
   LM CEO gets no signal that the cliff is there. Borderline bug because the `setPrice`
   clamp (±25%/review) and the top-of-band tolerance are *both* 0.25-ish, so the reachable
   max from anchor ($42.5) lands right on tier-2 — a coincidence worth checking.

3. **Minor — `hire` gives no feedback when gated.** Hiring at desired headcount returns
   byte-identical no-op with no signal that the action was ignored. An LM would waste the
   lever and never learn why.

## Improvements (ranked)

1. **Fix the `wagesPaid` attribution bug (#1).** Highest value: it corrupts the core CEO
   observation the whole benchmark is built around, and may be degrading the rules
   baseline. Add `pnl.distributed` and surface it separately to the CEO.
2. **Make the bench reward building, not just pricing.** Today optimal play is "find one
   static price, hold." Options: (a) a *producer*-CEO scenario (the planned F3) where
   `invest`/`hire`/`setWage` out-build pricing; (b) inject demand growth or a shock so
   capacity/invest decisions bite; (c) let `setWage` cut below base (real payroll control).
3. **Smooth the demand curve** (or add more residents / finer tiers) so price discovery is
   a gradient, not a cliff — and surface each venue's reservation structure (or a "demand
   at price X" hint) in the CEO observation so the lever is *learnable*.
4. **Give `hire`/levers explicit feedback** in the observation (e.g. `hireBlocked: atCap`)
   so a no-op action is distinguishable from an effective one.
5. **Re-examine whether the bench firm's cash should be distributed at all.** The $50k
   draining via distribution makes the game "preserve value from the drain," which dilutes
   the "run a business well" intent and makes invest structurally negative.

## How to replay

`src/bench/play.ts` is the interactive harness (deterministic, seed 9, matches `ceoBench`):
```
npx vite-node src/bench/play.ts -- reset                 # turn 0 + baselines
npx vite-node src/bench/play.ts -- add '{"setPrice":42}' # apply a decision, advance a day
npx vite-node src/bench/play.ts -- hold 41               # hold current levers N days
```
