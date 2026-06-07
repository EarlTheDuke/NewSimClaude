# Phase 16 — Retain vs Distribute: the dividend lever (closing the growth loop)

## Why (North-Star alignment)

NORTH-STAR move **#3 — close the investment loop.** The Claude-as-CEO playthrough
([PLAYTHROUGH.md](PLAYTHROUGH.md)) proved the CEO game is a *managed decline*: the firm's
profit is auto-drained by `DistributionSystem` every day, so a CEO can only *slow* the
bleed (via price) — never *build*. `invest`/`hire`/`setWage` are dead because there is no
retain-and-compound path and no demand to grow into. Real firms choose: pay dividends, or
**retain earnings to reinvest**. This phase gives the CEO that choice — the keystone that
turns decline into growth and makes the other levers worth pulling.

## The lever

`setPayout(rate ∈ [0,1])` — the fraction of the day's distributable surplus the firm pays
out; `1 − rate` is **retained** as cash (working capital to reinvest). `Business.payoutRate`
defaults to (undefined ⇒) **1.0**, i.e. today's full distribution — byte-identical until a
mind sets it.

## The two tensions (and how we resolve them)

1. **Paradox of thrift (living economy).** Distribution is the closed economy's demand
   pump. If firms retain, less money recirculates → residents spend less → the retaining
   firm's *own* revenue falls. We **keep** this — it's a real, interesting decision (Ford's
   "pay workers enough to buy the cars"). Guard: a soak proving aggregate demand stays
   alive; if needed, a floor (minimum payout) so the economy can't seize.

2. **Bench hoarding exploit — THE OPEN DECISION.** The CEO bench scores raw net worth
   (`cash + inventory + capital`) on a *decline* scenario ($50k start, drains). A
   retain-100% CEO would trivially "win" by hoarding cash. A retain lever is only a *skill*
   if reinvesting beats hoarding — which needs a growth path. **Proposed:** reframe the
   bench from "preserve $50k" to "grow the firm from working capital" (start smaller, score
   net-worth *growth*), so hoarding can't win (NORTH-STAR: "an uncapped market is the only
   kind where a skilled CEO can pull away"). Deferred to slice 4 — needs sign-off, as it
   moves the historical bench baselines.

## Slices (each flag-gated / default = byte-identical, per the 12a/13a/14a pattern)

1. **Seam (inert).** `payoutRate` field (default 1.0) + `setPayout` lever type + clamp
   [0,1] + apply (`setPayout → payoutRate`) + `DistributionSystem` honors `payoutRate`
   (default 1 ⇒ byte-identical). No brain emits it yet. Test: a firm with `payoutRate < 1`
   retains more cash; the default path is unchanged.
2. **Engage (living economy).** Rules brain emits `setPayout`; observation surfaces
   retained earnings. Soak guards aggregate demand (paradox of thrift).
   **— Attempted 2026-06-06, REVERTED.** A standalone buffer-retain rule (retain 50% of
   surplus below a $6k cushion) broke two engaged systems and was backed out:
   - *invest loop* (`capital.test`): capital stopped deepening — retained cash → more
     invest → lower capital-poisoned utilization → the invest gate (`utilization > 0.45`)
     stops firing → the loop self-extinguishes.
   - *owner dividend* (`distribution.test`): the owner/non-owner wealth gap inverted —
     retaining shrinks the owner cut faster than the even payout.
   **Lesson:** the paradox-of-thrift coupling is real + measured. Retain can't ship
   standalone — it needs slice 3 first (so reinvestment *compounds* instead of
   self-limiting), or to be offered to the LM CEO only (no rules-economy disruption).
   **— SHIPPED 2026-06-06 (commit `94a1b1b`) via the LM-CEO path.** Context changed: the
   Phase-18-pre producer-wage-floor fix (`PRODUCER_WAGE_FLOOR=0.12`) already closed the
   investment loop — capital compounds ~25× over 2yr with `payoutRate=1`, no retain needed
   (NORTH-STAR #3 met). So re-attempting the refuted *rules-brain* retain is now low-value
   (the engine compounds without it) **and** still risks the demand-pump disruption. Instead
   we took the doc's endorsed safe path: `setPayout` is now a real lever for the **LM CEO** —
   `BusinessObservation.payoutRate` surfaces the current stance, and `ClaudeDecisionProvider`
   offers/parses `setPayout` (prompt + tool schema + observation text). The **rules brain
   stays silent**, so every rules/off test + soak is byte-identical; only LM runs see it.
   305 tests green. This fulfils the phase's stated purpose — *give the CEO the
   retain-vs-distribute choice* — without re-breaking the living economy.
3. **Make reinvestment pay.** Couple so retained → invested → grows revenue.
   **— Probed 2026-06-06; TARGET_CAPITAL_SCALING (re-fire 14c) REFUTED.** Measured the
   full agentic economy (3 yr, seeds 1 & 7), flag off vs on:
   | | OFF (today) | ON (14c) |
   |---|---|---|
   | capital yr1→yr3 | 2090 → 1410 | **879 → 189** |
   | GDP yr3 | 1951 | 1798 |
   | invest/day yr2-3 | 0 | 0 |
   Turning the flag on makes the engine **worse** (capital + GDP lower, invest never
   fires). The engine doesn't die from poisoned utilization — util stays **65–77%**,
   *above* the 0.45 gate. It dies from **cash**: distribution drains every firm to its
   reserve floor, so the invest gate (`cash > reserve + surplus`) only clears in year 1's
   exceptional surplus; target-scaling makes bigger targets that cost *more* to fill,
   starving cash further. **The real fix is retain-to-reinvest** — a capacity-bound firm
   retains its surplus specifically to fund *sustained* investment (slice 2 done right:
   tie retain to the invest opportunity, not a flat buffer), designed + tuned with a soak.
   The flat-buffer retain (slice 2) and target-scaling (this) each fail alone; they must
   be designed *together*. A genuine mini-phase, not a one-liner.
4. **Reframe the CEO bench to reward growth** (pending the decision above) + an anti-hoard
   guard; re-baseline; ablation proves `setPayout` is a real, correct-sign lever.

## Conservation & determinism

`setPayout` moves no money at set-time; `DistributionSystem` still transfers only via
`World.transfer`, capped at the firm's live balance; `payoutRate` is a constant scalar,
fixed business order, no RNG. Default 1.0 ⇒ byte-identical brain-off baseline. ✓

## Rollback

Each slice: `payoutRate` defaults to 1.0 (full distribution); revert by leaving the default
⇒ today's behavior. The seam is a no-op until a mind chooses to retain.
