# INITIATIVE #1: A Free Labour Market — let wages *emerge*, only welfare is a control

> First experiment of the free-market direction (`VISION.md`). **Status: S0 + S1 SHIPPED**
> (flag-gated, default byte-identical, in the fork's local git — commits `63a4152`, `f9de674`).
> Next: engage the free wage live + S2 welfare floor. Conservation-safe (redistributes/relocates
> existing money, mints nothing). This is the version that keeps it a *free market* — see below.

## The correction (why the earlier "dial" was wrong)

Earlier drafts proposed a single tunable that *forces* a 90/10 split (90% of profit to
workers by decree). **That is central planning, not a free market** — it's a control, the
very thing we're trying to remove. The right model is the opposite:

> **Don't impose the split. Build a labour market and let the split _emerge_ from firms
> competing for scarce workers.** Whether it lands at 90/10, 70/30, or 50/50 — and how it
> *moves over time* — is the data we're here to observe, not a number we set.

## The principle

The market sets prices **and** wages. We impose **no redistribution and no controls —
except a welfare floor for those who genuinely cannot earn.** Then we let it run and watch.

## The mechanism — a real labour market

- **Labour is scarce** (finite working-age population) and **firms need workers** (output
  scales with headcount). That scarcity is the engine.
- **Firms compete for workers by wage.** A short-staffed firm **bids its wage up** to
  attract or keep staff (poach from rivals, pull from the jobless pool); a firm with
  applicants to spare can **pay less**. Workers move to the best offer (the resident agents
  already chase higher pay).
- **Remove the wage cap** (`MAX_WAGE_MULT` + the absolute `maxWagePerTick` clamp) so wages
  move freely — up *and* down.
- **The split FLOATS, emergently:** scarce labour (low unemployment) → wages bid up → labour
  share rises, **profits fall**; abundant labour (high unemployment) → wages fall →
  **profits rise**. That is exactly "companies compete over available employees and change
  wage levels, which moves their profits up or down" — and it is naturally **cyclical**.
- Eventually remove `PRODUCER_WAGE_FLOOR` (a wage price-control) — carefully; it's
  load-bearing (its removal collapsed the supply chain at seed 7).

## The one control — welfare for the unemployed

The unemployed (and dependents who can't work) receive **~50% of the average worker's
income**, funded by a small levy (the single allowed redistribution). Two reasons it's the
*right* one control:
- It keeps demand from fully collapsing in a downturn (non-earners still spend).
- It acts as a **market-respecting wage floor**: no one takes a job paying less than welfare
  plus the bother of working, so firms must *beat welfare* to hire. That's a floor set by a
  safety net competing for labour — **not** a price control imposed on firms.

## The honest crux — what this experiment actually tests

Removing today's even **dividend** is the real move, and it's a genuine open question:

> **Can a closed, conserved, free-market economy keep money circulating on its own — through
> competitive wages + owners spending their profits — or does it structurally pool and stall?**

Free markets concentrate wealth (money drifts up to capital); the dividend was an artificial
pump fighting that. Without it, two outcomes — **both valuable findings:**

1. **It self-circulates.** Competitive wages + owner consumption keep the loop alive; we
   observe an emergent labour share, real business cycles, and rising-but-functional
   inequality. The free market works in a closed economy.
2. **It pools / stalls.** Competitive wages can't carry enough circulation — because of the
   **affordability ceiling** (a firm cannot pay out more than it earns) — so money drains to
   owners/reserves and demand decays. **That is the empirical signal that a free-market
   economy needs MONEY CREATION (growth / credit) to sustain itself** — i.e., it points
   straight at the `VISION.md` fork. Either way we learn *why real economies are not closed*.

Because of this, we **do not remove the dividend cold.** We **wean**: build the labour market
first (so wages *can* rise to carry the load), measure how much circulation wages actually
carry, then taper the dividend in notches — welfare always the floor — and watch whether the
free market holds or reveals the need for created money.

## The plan (sequence — small, measured increments)

- **S0 — Instrument (no behaviour change). ✅ DONE (`63a4152`).** Added to `MacroSystem`:
  **labour share** (wages ÷ (wages+dividend)), **dividend** flow, **money velocity** (daily
  consumption ÷ `totalMoney`), **Gini** of resident wealth, and **avg wage** — plus HUD vital
  cards for Labour share / Inequality / Velocity. Pure reads, deterministic, round-trip-safe.
  *(Still to add later as the experiment deepens: wage spread, profit margin, cycle amplitude,
  a per-cohort solvency census — defer until S2/S3 need them.)*
- **S1 — Free the wage. ✅ DONE (`f9de674`).** Added `WAGE_CAP_MULT` (default = `MAX_WAGE_MULT`
  = 2 ⇒ byte-identical) threaded `createCity → BusinessAgentSystem`: `setWage` clamps to
  `[base, base*wageCapMult]`, `observe()` surfaces `maxWage`, and the coarse absolute clamp
  lifts in step. The rules brain bids competitively only when the cap is lifted — always ≥ the
  capped baseline, harder when the jobless pool is empty, bounded only by affordability (the
  cash-thin ease-back is the natural brake). Proven: a lifted cap pushes wages above the old
  2× ceiling, conserved + deterministic, and raises the avg wage vs the capped city.
  **The mechanism ships default-OFF; engaging it in the LIVE game is the next step — best paired
  with S2 so the freed market has its one control (welfare) before the dividend is ever weaned.**
- **S2 — Welfare floor (the one control).** Unemployed/dependents at ~50% of the *lagged*
  average worker income, with an absolute subsistence minimum, funded by a small levy.
  Non-worker solvency becomes a hard CI gate.
- **S3 — Wean the dividend.** Taper the even-dividend share in notches (1.0 → 0.5 → 0 of
  today's level), each gated on: demand/GDP within a band, solvency intact, bounded cycle
  amplitude. **Watch whether competitive wages + owner spending replace it.** If it stalls,
  **stop and record it** — that's the money-creation fork's trigger, a result, not a failure.
- **S4 — Relax reserves**; **(later)** remove `PRODUCER_WAGE_FLOOR` once the labour market
  can hold producer wages up organically.
- **(The fork — later, deliberate)** money creation, *if* the experiment shows a closed free
  market can't self-sustain.

## What we deliberately do NOT do (per your direction)

- **No forced wage/profit split** — no decree of 90/10 or anything else.
- **No redistribution except the welfare floor.**
- **No price controls** — remove the wage cap now, the wage floor eventually.

The split, the inequality, the booms and busts — all **emergent and observed, not imposed.**

## What to measure (the observatory)

| Metric | Why |
|---|---|
| **Labour share** = wages ÷ (wages + profit) | the emergent split — watch it float with the labour market, no decree |
| Unemployment rate | the scarcity signal that drives wage competition |
| Avg wage + wage spread | are firms actually competing? is pay differentiating? |
| Profit margin by firm | wages moving profits up/down (the user's core ask) |
| **Money velocity** = consumption ÷ totalMoney | the crux: is the free market circulating, or stalling? |
| **Gini** of resident wealth | inequality rising as we deregulate (expected) — watch it's not terminal |
| Business-cycle amplitude | bounded cycles (good) vs death-spiral (bad) |
| Solvency census (by cohort) | non-workers must stay solvent — hard gate |
| Conservation / determinism | `totalMoney` flat to the cent; same-seed reproducible |

## Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Demand collapse when weaning the dividend | wean gradually; welfare floor; build the labour market first; per-notch GDP/solvency/amplitude gates | restore a dividend notch / `WAGE_CAP` flag off |
| Money pools in owners/reserves (free-market wealth concentration) | owner consumption recirculates; relax reserves; accept Gini as a studied outcome — and if it stalls, that's the money-creation *finding* | restore a dividend notch |
| Affordability ceiling caps wages → wages can't carry circulation | this is the experiment's key observation → signals the money-creation fork | n/a (a result) |
| Producer supply-chain collapse on wage-floor removal | defer to last, behind a working labour market; watch seed 7 | restore `PRODUCER_WAGE_FLOOR` |
| Death-spiral cycles | welfare as counter-cyclical stabilizer; per-notch amplitude gate | drop a notch |
| Conservation / determinism break | transfers only; fixed iteration order; `toBeCloseTo` + snapshot tests | revert slice |

---

*Supersedes the forced-"dial" framing. The labour market makes the wage/profit split an
emergent, observed, free-market outcome; welfare is the sole deliberate intervention; and the
question of whether a closed free market can self-circulate is itself the experiment.*
