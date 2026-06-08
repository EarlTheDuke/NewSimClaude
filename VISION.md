# VISION — A Free-Market Economy Observatory

> Working title; the project folder is `NewSimClaude` (rename pending). This is the
> forward direction for the new project, **forked from CityWithLifeClaude**. It
> supersedes the inherited CityWithLife docs (kept as the foundation's lineage/reference).

## What we're building

An **open, free-market, dynamic economy** built as an **observatory** — a deterministic
instrument we run and *watch* to study how real-world economic phenomena emerge from the
behaviour of individual agents in markets.

The foundation (CityWithLifeClaude) proved out the hard engineering: a deterministic
seeded engine, a model-agnostic decision seam for AI agents, a living population with a
full life-cycle, and a watchable renderer. **That was a city that lives. This is an
economy we study.** We repurpose the same machinery toward economic realism and scale.

## The goal: real-economy outputs, *emergent* (not scripted)

Success is when the sim **produces the same kinds of outputs a real economy does** — as
emergent results of agents acting, not as numbers we hard-code:

- **GDP growth** (real output rising over time)
- **Inflation** (a price level that moves)
- **Business cycles** (booms and recessions)
- **Unemployment, wage and price dynamics, wealth distribution**

If we can reproduce those dynamics from micro-behaviour, we have an instrument for asking
"what if?" about the real world.

## Four pillars

1. **Earned circulation (the free market).** Money should reach people primarily as
   **earned income** — wages, profit, ownership — and flow back through **spending and
   investment**, the way a real economy actually circulates. Today the foundation uses a
   *sealed* equal-dividend pump (an emergent UBI) to keep money moving. We shift toward
   earned circulation. **Initiative #1 begins exactly this.**
2. **Indefinite scale.** Population grows without bound; businesses are created freely;
   **B2B markets and competition emerge among business types.** Nothing hard-capped — the
   sim should keep working at 20, 200, or 2,000 agents.
3. **Real money dynamics.** Sustained real growth *and* inflation are **impossible under a
   fixed money supply** — so the money supply must be able to **grow (and contract)**,
   through *accounted* mechanisms (value-add, credit, a monetary authority). This is the
   deliberate departure from the foundation's fixed/conserved money (see "the fork" below).
4. **Observability.** The sim is an instrument, so it needs **rich macro measurement** (GDP,
   a price index / inflation, employment, money velocity, inequality) and the deterministic
   **experiment harness**, so the effect of every change is measurable.

## The method: small, tested increments

This project is a sequence of **experiments**, not a feature checklist. We move in **tiny,
flag-gated steps and measure the outcome of each before taking the next.** We keep what
produces realistic dynamics and revert what doesn't. Every step preserves determinism so
results are reproducible and A/B-comparable.

## What we inherit, and what changes

**Keep (the foundation's strengths):**
- Deterministic seeded engine + tick loop + snapshot save/load.
- The model-agnostic **`DecisionProvider` seam** — agents run on rules or Claude, swappable.
- The renderer + observability tooling (HUD, ticker, toasts, demography, sparklines).
- The systems kit: agents, population/life-cycle, market, lifecycle, distribution.
- The **flag-gated, byte-identical-until-engaged** incremental discipline + test/soak harness.

**Evolve (the departures):**
- **Closed/sealed economy → open economy.** Circulation becomes earned (wages → spending →
  investment), not a balancing dividend pump.
- **"Money conserved to the cent" → "money is *accounted*."** Money may be created and
  destroyed, but *only* through explicit, logged, intentional mechanisms — never a leak or a
  bug. Conservation becomes **accounting integrity**.
- **Fixed roster → unbounded population + free business creation + B2B markets + competition.**

## Invariants that stay sacred

- **Determinism.** Same seed + snapshot ⇒ identical run. Non-negotiable — it is what makes
  this an *instrument* (repeatable studies, clean A/B experiments). The only sanctioned
  non-determinism remains a networked LLM behind the seam.
- **Accounting integrity.** Every dollar's creation, movement, and destruction is explicit
  and traceable. (The grown-up successor to "conserved to the cent.")
- **Observability / legibility.** You can always see *why* an agent acted and *measure* what
  the economy did.
- **Incrementalism.** Small, flag-gated, measured steps. No big-bang rewrites.

## Roadmap shape (initiative-driven, indicative)

Not "phases to completion" — a backlog of small experiments, each measured:

1. **Initiative #1 — Earned circulation: shift money from the even dividend → wages.**
   (Detailed plan + critique in `INITIATIVE-01-WAGE-CIRCULATION.md`.)
2. Market-determined wages + a real labour market (firms bid for scarce labour).
3. A **price index + measured inflation**; money velocity.
4. **Money creation** (credit / value-add / monetary authority) — the unlock for inflation
   + indefinite real growth.
5. B2B markets + competition among business types.
6. Unbounded population & firm scaling (performance + dynamics).

## The fork in the road (the user's call, named up front)

The vision's headline outputs — **inflation and indefinite real growth — cannot exist under
a fixed, conserved money supply** (more people + more output against the same dollars only
*dilutes*; a price level can't trend up). Achieving them **requires relaxing the foundation's
"money conserved to the cent" invariant** into accounted money creation. Initiative #1 stays
conservation-safe (it only *rebalances* existing money from dividend to wages), but it points
straight at this fork. **We cross it deliberately — as its own decided experiment — when the
measurements show the sealed model is the thing holding realism back.**
