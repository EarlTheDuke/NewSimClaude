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
2. **Engage (living economy).** Rules brain emits `setPayout` (retain when a profitable
   invest is warranted / utilization high; pay out when slack); observation surfaces
   retained earnings. Soak: aggregate demand stays alive (the paradox-of-thrift guard).
3. **Make reinvestment pay.** Couple with demand growth / capacity binding so
   retained → invested → grows revenue (folds in the "marketing / demand-growth"
   improvement). This is the *point* of retaining.
4. **Reframe the CEO bench to reward growth** (pending the decision above) + an anti-hoard
   guard; re-baseline; ablation proves `setPayout` is a real, correct-sign lever.

## Conservation & determinism

`setPayout` moves no money at set-time; `DistributionSystem` still transfers only via
`World.transfer`, capped at the firm's live balance; `payoutRate` is a constant scalar,
fixed business order, no RNG. Default 1.0 ⇒ byte-identical brain-off baseline. ✓

## Rollback

Each slice: `payoutRate` defaults to 1.0 (full distribution); revert by leaving the default
⇒ today's behavior. The seam is a no-op until a mind chooses to retain.
