# Post-Phase-15 tuning study — A/B sweeps + adversarial review

A config-level A/B study of the living firm economy (all firms + all 12 residents agentic, rules
brain, 2 sim-years, seeds 1 & 7 averaged), followed by a 3-agent adversarial review of the
findings. Goal: decide what, if anything, to tune next. **Net result: the economy is already
well-calibrated — the study's main value was *refuting* a tempting tune and producing a verified
roadmap. One clean fix shipped (a test isolation); the rest are characterized recommendations.**

## The data (2yr, seeds 1 & 7, full living economy)

| Sweep | Result |
|---|---|
| **Owner dividend λ** | 0 → gdp 1705, cap 1223, ownerGap 18.8k, price 5.77, deaths 1 · **0.1 → gdp 1769, cap 1616, ownerGap 26k, price 5.21, deaths 1** · 0.2 → gdp 2175, cap 2803, ownerGap 35.2k, **price 10.85**, deaths 0 · 0.35 → **gdp 1171 (collapse)**, cap 970, unemp 4.5 |
| **Business entry** | ON → 7 firms alive, cap 1616 · OFF → **6 alive**, cap 1314 |
| **Wealth elasticity** | 0 → gdp 1226, unemp 6.0 · 1 → gdp 1769, unemp 2.5 · 2 → gdp 2257, unemp 0.0, **price 10.18** |
| **Agentic breadth** | full → **1 firm death / 2yr** · storefronts-only (producers not agentic) → **25 deaths / 2yr** |

## Verified decisions

1. **Keep the owner dividend at λ=0.1.** λ=0.2 *looks* dominant (more GDP, capital, owner reward, zero
   deaths) but the review proved the gain is **input-cost inflation concentrated in ~7 owners**: avg
   resource price hits **96.9% of the hard cap** (vs 46.5% at λ=0.1), crushing storefront margins
   against fixed retail anchors, while the 5 non-owners' demand is starved. The **non-monotonic
   collapse at λ=0.35** confirms λ=0.2 sits on the rising edge of an unstable hump — a real structural
   gain would extend, not crater. λ=0.1 keeps prices below base with headroom and the distribution a
   *broad* demand pump (its design intent). **Refuted the tune.**

2. **Business entry earns its keep** — 7 firms stay alive vs 6 without it, +23% capital. (Confirms D.)

3. **Producers MUST be agentic** — the single biggest structural effect in the data: **25 firm-deaths
   vs 1** when producers can't use `setWage`/`hire`. The live game already runs full-agentic.

## The labour-lever reconciliation (F2 "dormant" vs 25-vs-1 deaths)

Both readings are correct — they measure different regimes. The labour levers are **state-contingent
recovery insurance**: ~$0 in equilibrium (F2's no-churn bench — nothing to recover from, since the A3
hiring cap freezes a fully-crewed firm's headcount), but worth **~24 avoided firm-deaths over 2 years**
during creative-destruction churn. **`setWage` is the load-bearing one** (retention — re-rating a
sitting worker up is the only way a raise reaches them, and keeping the 2nd worker beats re-hiring;
`LABOR_FULL_STAFF=2` makes a lost worker a real half-output loss); `hire` only acts once a seat opens.

## Tuning roadmap (recommendations, ranked)

1. **Sustain the productivity engine — `CAPITAL_DEPRECIATION_RATE` 0.01 → ~0.004** (lifts the capital
   half-life 69d → 173d for a multi-year plateau instead of a ~1-year decay; conservation-safe, frees
   firm cash). **Not shippable as a one-liner:** verified that at 0.004 a producer bankrupts in the
   13c year — holding more capital lowers sustained utilization, sagging producer prices toward the
   band's low edge. **Needs the pricing band (`PRICE_UTIL_LOW/HIGH`) + `INVEST_UTILIZATION_THRESHOLD`
   re-tuned together + a fresh soak** — a small mini-phase. The deeper root (the invest trigger reads
   capital-poisoned utilization) would need a capital-discounted utilization bar.
2. **Harden the wage de-escalation path** (`RuleBasedProvider`): a *persistently*-understaffed firm
   never eases its wage (de-escalation gates on `!understaffed`), a latent city-wide wage-ratchet risk
   during a churn wave. Not observed in practice yet — validate with the study below before changing
   the live labour heuristics.
3. **Next study — the causal control cell:** ablate *only* the producers' `hire`/`setWage` (leave
   their `setPrice`/`invest` on) vs today's all-agentic baseline, over **4–5 sim-years** (past the
   ~day-180 capital peak into the mature low-investment regime) and **≥6 seeds** (the death/thrash
   count is discrete + high-variance). Proves the labour market — not the cost-floor — saves the chain,
   and splits `hire` vs `setWage`. Also cross demand × labour (elasticity=2 × producers-non-agentic is
   the highest-stakes untested cell).

## Shipped from this study

- **Isolated the leisure-elasticity test from the owner dividend** (`elasticity.test.ts`:
  `leisureRevenue` now builds its city with `ownerDividendShare: 0`). The test claims to measure *pure*
  price elasticity, but the dividend's wealth redistribution was confounding it (it broke at λ≥0.2). A
  correct isolation regardless of λ — the same discipline the CEO bench uses.
- Modernized the **Claude CEO provider** (separate commit) so an LM can play the full game (all four
  levers + the strategic observation) — run with `ANTHROPIC_API_KEY=… npx vite-node src/bench/cli.ts --claude`.
