# A Life, Traced — res_12, "Ivo" (born day 11, died day 29,200)

Seed 1, the full live config (rules brains · all residents agentic · disasters ·
population growth + births + mortality + construction + dynamic rent). I followed the
**first child born into the town** from birth to death and logged a yearly data series,
a life-event timeline, and tallies. (Instrumented headless via a throwaway harness,
since the on-screen sim runs at game speed; the harness was deleted after the run.)

## The one-line story
Ivo was **born on day 11**, was **put to work at the farm one day later — at age 0**,
and then **farmed at Greenfield Farm for all 80 years of his life**, never once
changing jobs, his wage flat at the cap after year 1, his savings bobbing around
~$950 the entire time as he spent every surplus on small luxuries — until he **died
at 80 and his estate passed to an heir.**

It is a *stable, conserved, watchable* life — and a revealing one. It exposed one real
bug and several design questions worth deciding together.

---

## The data

### Net worth (savings) across the 80-year life
Average savings per decade (each █ ≈ $100):

```
 0s  ████                $407   ← ramp-up from $77 (volatile early years)
10s  █████████▌          $953
20s  █████████▌          $960
30s  █████████▌          $957
40s  █████████▋          $970
50s  █████████▌          $960
60s  █████████▉          $989
70s  █████████▊          $981     (died at 80 with ~$890)
```
Peak ever: **$1,292.** Shape: a brief climb in the first ~6 years, then a **flat
plateau for 70+ years**. He never builds wealth — every surplus is spent (see luxuries).

### Wage (per tick) over life
```
age 0:  0.150  ┐
age 1:  0.24   ┘ ── then 0.24 (the 2× cap) FLAT for the remaining 79 years
```
A one-time climb to the wage cap in year 1 (the farm re-rating its staff up), then
**no wage progression for the rest of his working life.**

### Needs (sampled yearly — healthy, cyclical, never critical)
- hunger: swings 19–91 (the normal eat-when-hungry cycle)
- energy: 46–64 (sleeps it back each night)
- social: 28–100 (visits the social venue when lonely)
Never bottomed out; the minute-to-minute needs loop kept him fed, rested, and social
his whole life.

### Housing (dynamic rent visible)
- Born in **Home 2** (rent drifted 60 → 76 as the town filled — HP2 scarcity).
- age ~8 → moved to **Home 7** (rent 65) — re-homed for a cheaper rent.
- age ~60 → moved to **Home 5** (rent 56–59) — re-homed again.
Rents visibly breathe with scarcity (56–76 across his life), and he twice downsized to
save — the housing market is doing real work.

### Lifetime tallies
| Metric | Value |
|---|---|
| Lifespan | **80 years** (day 11 → 29,200) |
| Jobs held | **1** (Greenfield Farm, the whole life) |
| Job switches | **0** |
| Raises | 5 (all in year 1, to the cap) |
| Home moves | 2 (both downsizes) |
| Vehicle | 1 (bought at age ~24) |
| Luxuries bought | **899** (~11/year — every surplus, for life) |
| Death | age 80, estate inherited (money conserved) |

### Life-event timeline
```
y0.0  BORN as res_12
y0.0  hired at Greenfield Farm — AT AGE 0  (← the bug, see below)
y0–1  five raises to the wage cap (0.24)
y8.3  moved home → Home 7 (rent 65)
y23.7 bought a vehicle
y60.0 moved home → Home 5 (rent 58)
y80.0 DIED — estate inherited by an heir
…plus 899 luxury purchases sprinkled across the working years.
```

---

## Findings

### 🐞 1. There is no childhood — firms hire newborns (real bug)
Ivo was hired **the day after he was born, at age 0.** I traced the cause: the
coming-of-age model I built gates the **resident/supply side** correctly (the agentic
resident brain and the population system's employ-step both skip anyone under 18 — the
trace confirms **0 agentic reviews** of Ivo as a baby). But the **firm/demand side has
no age gate**: `BusinessAgentSystem.applyHire` (a firm's `hire` lever) pulls the
lowest-index *jobless* resident into an open seat regardless of age, and
`BusinessEntrySystem` staffs new firms the same way. So the moment a seat opened, a firm
grabbed the nearest jobless body — a baby. The entire dependency → coming-of-age →
first-job arc is dead on arrival in the live economy.
- **Consequence:** the "🎓 came of age" toast/feed event still fires at 18, even though
  the resident has been working since age 0 — visibly inconsistent.
- **Fix to consider:** add the same working-age gate to `applyHire` and
  `BusinessEntrySystem` staffing (only hire residents with `age >= COMING_OF_AGE_YEARS`,
  or unset age). Small, conservation-neutral. This is the same class of gap as the
  dependent-rent quirk (the demand/firm side not respecting the new life-stage model).

### 📉 2. A career with no progression — 80 years, one farm, one wage
Zero job changes in 80 years; the wage hit the 2× cap in year 1 and never moved again.
Even after Ivo became an adult agent (and *could* job-switch), he never did — the farm
paid the cap and no better-paying open seat ever cleared the rules brain's "switch only
for >15% more" bar. A real working life has promotions, career changes, and a wage that
grows with experience. Right now a life's economic arc is essentially flat after year 1.
- **To consider:** seniority/experience wage growth; occasional career moves; or
  age-linked productivity so a worker's value (and pay) rises then tapers.

### 💸 3. Wealth never accumulates — every surplus becomes a luxury
Savings flat-lined at ~$950 for 70 years because the rules resident **spends 100% of
the surplus above its savings goal on luxuries** (899 of them!). Money recirculates
beautifully (great for demand + conservation) but there's **no wealth-building arc** —
no saving toward a goal, no getting richer or poorer over a life. Combined with #2, a
life has little economic *narrative*: you're comfortable on day 400 and comfortable on
day 29,000.
- **To consider:** a savings goal that grows with life stage (save for a home, for
  children, for old age); inheritance actually compounding across generations.

### ✅ 4. What's genuinely working well
- **Mortality + inheritance is clean:** Ivo died exactly at 80, his estate transferred
  to an heir, money conserved to the cent. The demographic cycle closes properly.
- **The needs loop is alive his whole life** — he eats, sleeps, socializes, never
  flat-lines. The minute-to-minute "person" is convincing.
- **Dynamic rent + re-homing read as real housing behavior** — rents rose with scarcity,
  and he twice downsized to save. The HP2 market is visible at the level of one life.
- **Determinism + conservation held across 29,200 days** — an 80-year single-resident
  trace stayed perfectly reproducible and balanced.

### ⚠️ 5. A measurement caveat
My activity tally was sampled at the day boundary (midnight) so it read "sleeping" every
time — a harness flaw, not a sim bug. A proper activity breakdown needs intra-day
sampling; I didn't want to over-claim a "spends X% working" figure from bad data.

---

## What I'd put to us to decide
1. **Fix the childhood bug?** Add a working-age gate to firm hiring + business-entry
   staffing so children aren't conscripted. (Recommended — it makes the coming-of-age
   feature we just built actually mean something. Low-risk, conservation-neutral.)
2. **Give a life an arc?** Pick one of: experience/seniority wage growth, occasional
   career changes, or life-stage savings goals — so a life isn't economically flat from
   year 1 to year 80.
3. **Leave consumption as-is?** The "spend every surplus" behavior is great for keeping
   the economy circulating; the question is whether we *want* some residents to build
   wealth (and pass more on) for a richer multi-generational story.

The bones are strong: a person is born, lives a needs-driven daily life, ages, navigates
a real housing market, and dies leaving an inheritance — all conserved and deterministic.
The gaps are about **life-stage realism** (childhood) and **a life having a story arc**
(career + wealth), not about correctness.

---

## The emergent citizen's dividend (a UBI)

Ivo never went broke despite a flat, low wage — because the economy quietly pays
**everyone** a daily dividend. `DistributionSystem` splits each firm's daily surplus
(cash above its working-capital reserve, capped) two ways: **~10% to the owner**
(`OWNER_DIVIDEND_SHARE`), and **the rest equally to every resident** — employed,
jobless, newborn, or elderly. That even share is a **universal basic income** by
definition; in flavour it's a *citizen's / social dividend* (a share of the
commonwealth's profits), not tax-funded welfare. It exists because the economy is a
**closed money loop** — without returning firm surpluses to people, money would pool in
a few firms and everyone else would go broke and stop spending. The UBI is the
**demand pump** that keeps the loop alive; it was never designed in — it *emerged*.

**Measured (20-resident steady state):**
| | per day |
|---|---|
| Dividend pool moved to people | ~$1,102 |
| **Dividend per resident** (even 90% ÷ 20) | **~$50 / head** |
| Wage per worker | ~$93 |
| Dividend as a share of a **worker's** income | ~35% |
| Dividend as a share of a **non-worker's** income | **100%** |

So ~1/3 of the town (children, jobless, elderly) lives *entirely* on the dividend, and
even workers draw a third of their income from it. It explains the "nobody goes broke"
floor, why population growth stayed stable (newcomers/kids are instantly solvent), the
compressed wealth distribution, and per-capita dilution (the pool ÷ a growing N).

**Could wages replace it?** To move the same ~$1,100/day to people through paychecks,
the total wage bill would have to **roughly double** (+91%, ≈ +$85/worker/day,
≈ +$0.21/tick — from ~$0.23 to ~$0.44/tick). Two blockers: (1) wages are capped at 2×
base and already sit near the cap, so it's not even possible without raising the cap;
and (2) wages reach only the ~13 workers, leaving the ~7 non-workers (kids, jobless,
elderly) with **$0** — the same money, but it abandons exactly the third of the town the
dividend keeps afloat. The dividend reaches people wages structurally can't.

**Status:** working as intended and **kept** — a distinctive, emergent feature of the
economy. (Tunable via `OWNER_DIVIDEND_SHARE`; could be surfaced explicitly in the UI as
a "citizen's dividend" later if desired.)
