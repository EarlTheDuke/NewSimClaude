# CityWithLifeClaude — Post-v1 Roadmap (Phase 16+)

Concrete, dependency-ordered phases that grow the sim from a solid **micro** economy
into a **macro** one. Derived from the economic-model audit (2026-06-06) and checked
against [NORTH-STAR.md](NORTH-STAR.md). Phases 0–8 are [MASTER-PLAN.md](MASTER-PLAN.md)
(shipped as v1.0); 9–15 shipped post-v1; **16+ is this document.**

## Standing principles (hold for every phase)

- **Money conserved to the cent** (only via `World.transfer`) and **deterministic from
  seed + snapshot.** Breaking either is a bug, not a tradeoff. New subsystems that move
  money (a bank, a treasury, a port) must be *conserving holders*, never mint/burn.
- **Ship flag-gated, default-OFF/no-op slices** (the 12a/13a/14a/15/16 pattern) — the
  brain-off baseline stays byte-identical until each slice is deliberately engaged.
- **Realism in the world model; benchmark through curated scenarios that freeze most of
  it.** Add the mechanism to the live world, but keep it OFF (or frozen) in the CEO bench
  so the skill signal stays clean. This is the NORTH-STAR tension — honor it every time.

## Where we are (updated 2026-06-08)

**Active direction: the free-market program** — a greenlit, build-all-three sequence that
supersedes the day-to-day track while the structural macro phases (18–21) stay shelved (they
resume *inside* leg C):

| | Initiative | Status | Doc |
|---|---|---|---|
| **#1** | Free labour market (wages emerge, welfare the only control) | **S0–S3 SHIPPED + crux verified** | `INITIATIVE-01-WAGE-CIRCULATION.md` |
| **A** | Business creation & industries (firms *born*, not just healed) | **slice 1 SHIPPED** (opportunity-driven storefront entry) | `INITIATIVE-02-BUSINESS-CREATION.md` |
| **B** | Competition between firms (rivals fight for customers *and* labour) | next | (draft at boundary) |
| **C** | GDP growth & scaling (economy compounds; money-creation fork returns) | then — **resumes phases 18–21 here** | this doc + `PHASE18-CREDIT.md` |

The order is load-bearing: creation makes rivals → competition makes rivalry bite → scaling needs
both, and is where Initiative #1's money-creation fork (closed economy pools/stalls) is answered
by picking the shelved macro phases back up. The phase-16/17 micro work below is the foundation
all of this builds on.

---

**Foundation (pre-program): Phases 16 + 17 shipped; the investment loop is closed; the macro track 18–21 is SHELVED.**

- **Phase 17 — Demand growth (brand lever)** ✅ shipped a–d (`BRAND_DEMAND_ELASTICITY=0.3` live;
  a `brand` lever for the LM CEO, bench-frozen). See [PHASE17-DEMAND-GROWTH.md](PHASE17-DEMAND-GROWTH.md).
- **Sustain-the-engine (Phase 18-pre)** ✅ — the long-standing compounding blocker (engine
  self-extinguished since 13c/14c) was root-caused to shared-labour-pool fragility and fixed
  with `PRODUCER_WAGE_FLOOR=0.12` (a floor sweep found 0.12 dominates). **NORTH-STAR move #3
  (close the investment loop) is structurally achieved** — capital compounds ~25× over 2yr.
- **Phase 16 — Retain vs Distribute** ✅ **COMPLETE** (all four slices): slice 1 (payout seam),
  slice 2 (the `setPayout` retain lever wired for the **LM CEO**; rules brain silent →
  byte-identical), slice 3 (reinvestment compounds — met by the wage-floor fix), slice 4
  (the CEO bench reframed to a hoard-proof **growth score** — `min(cash, reserve) + capital +
  brand + inventory`; opt-in growth mode, classic bench unchanged). See
  [PHASE16-RETAIN-DISTRIBUTE.md](PHASE16-RETAIN-DISTRIBUTE.md).

### ⏸ SHELVED 2026-06-06 — the macro track (Phases 18–21)

The structural macro phases below are a **liked, greenlit direction but deliberately shelved**
while the project moves to a different area. They are documented here at direction level; pick
any of them up later from this roadmap.

- **Phase 18 (Credit & Finance)** is **fully designed** (slice-by-slice, adversarially verified)
  in **[PHASE18-CREDIT.md](PHASE18-CREDIT.md)** — resume straight from that doc when greenlit.
- **Phases 19 (Population), 20 (Government), 21 (Trade)** stay at the direction level below; draft
  their detailed `PHASEN-*.md` at the phase boundary (the house convention) when picked up.

---

## Phase 17 — Demand can grow (the market expands) · ✅ SHIPPED (as the brand lever)

- **Gap closed:** the fixed demand ceiling (audit Tier-1 #2, first relief) **and** Phase 16's
  slice 3 ("make reinvestment pay").
- **Why first:** retain, invest, and (later) credit all need somewhere to grow *into*. Today
  demand tops out at 12 residents' wants, so capacity never stays bound and the investment
  engine decays within a year. Everything downstream depends on lifting this.
- **Mechanics:** a firm-level **marketing / quality lever** — spend cash to lift the firm's
  own demand (raise residents' reservation prices toward it, or win share from a rival), so
  `invest → capacity → serve grown demand` finally compounds. Demand-shaping is the real
  "grow the market" decision.
- **Benchmark:** marketing becomes a genuine CEO lever (spend-to-grow vs harvest) — enriches
  the bench rather than muddying it.
- **Conservation/determinism:** marketing spend is a transfer (to an ad channel / as price
  rebate), never burned; the demand lift is a bounded, deterministic function of cumulative
  spend. ✓
- **Then:** finish Phase 16 — slice 3 (retain → reinvest → grow now compounds) and slice 4
  (reframe the CEO bench to reward *growth* from working capital, with an anti-hoard guard).

## Phase 18 — Credit & Finance (banking) · ⏸ SHELVED — fully planned in [PHASE18-CREDIT.md](PHASE18-CREDIT.md)

- **Gap closed:** no finance (audit Tier-1 #1) — the single biggest missing subsystem.
- **Why:** the *other* way to fund growth besides retained earnings; the direct complement
  to Phase 16. "Should I lever up to expand?" is a rich, real CEO decision.
- **Mechanics:** a **Bank** as a money-conserving holder; firms borrow to invest beyond
  cash-on-hand; interest accrues as borrower→bank transfers; debt service + default feed
  `LifecycleSystem`. Optional: **savings interest** so idle cash isn't free net worth — which
  also fixes the hoarding exploit the retain lever exposes.
- **Benchmark:** frozen off in the simple bench; a leverage scenario can spotlight it.
- **Risk (high):** credit is where conservation is easiest to break — interest must move from
  a holder, never be minted; insolvency must settle, not vanish. NORTH-STAR gates this as a
  later, careful item.
- **Depends on:** Phase 17 (credit only pays if there's growth to fund).

## Phase 19 — Population & Demographics · ⏸ SHELVED (direction-level; draft detail at boundary)

- **Gap closed:** fixed population (audit Tier-1 #2, structural) — the hardest ceiling.
- **Why:** births / deaths / aging / migration / household formation let the market and
  labour force *broaden*, not just deepen. NORTH-STAR calls this "the most genuinely alive,
  and a clean growth driver."
- **Mechanics:** residents age; households form and have children (new labour + demand
  entrants); residents retire and die (estate transfers to heirs/owner — conserved); in/out
  migration responds to wages and vacancies. All demographic events deterministic (seeded,
  no wall-clock).
- **Benchmark:** population frozen in the bench (determinism); growth shows in the live sim
  and long soak.
- **Risk:** determinism (deterministic demographic schedule only) and conservation (a death's
  cash is transferred, never lost).

## Phase 20 — Government & Fiscal · ⏸ SHELVED (direction-level; draft detail at boundary)

- **Gap closed:** no government (audit Tier-1 #3) — adds the missing **G** to GDP.
- **Mechanics:** a **Treasury** holder; taxes (sales / income / corporate) as transfers in;
  public spending + transfers/welfare as transfers out (welfare smooths the demand floor);
  optionally public goods. A real fiscal-policy lever.
- **Benchmark:** enables a *new* scenario type ("balance the city budget"), but stays OFF in
  the firm-CEO bench so it doesn't perturb that skill signal.
- **Risk:** conservation (every tax/transfer routes through the treasury holder).

## Phase 21 — External Trade · ⏸ SHELVED (direction-level; draft detail at boundary)

- **Gap closed:** closed economy (audit Tier-1 #4).
- **Mechanics:** a **port** that buys exports and sells imports at world prices — injects
  outside demand and breaks the internal ceiling, giving the city an external growth/shock
  channel.
- **Risk:** the closed-money invariant — model the port as a conserving current-account
  holder (trade nets through it), or make any outside money in/outflow explicit, bounded, and
  measured, so `totalMoney()` stays auditable.
- **Benchmark:** off in the bench; a growth + volatility driver in the live world.

---

## Texture track (interleavable — depth, not ceilings)

Lighter additions that make the world feel like an economy rather than a mechanism; slot any
of them between the structural phases whenever the world feels thin:

- **Goods & services variety** — a services sector (health / education / entertainment-as-
  service), product differentiation + quality tiers, substitution between goods. More demand
  surface and more for a CEO to navigate.
- **Human capital** — worker skills / education / specialization; productivity heterogeneity;
  training as a form of investment. Turns interchangeable labour into a real factor.
- **Asset markets** — a housing market (buy/sell homes, land value), tradeable firm **equity**
  (value and sell a business — makes `ownerId` mean something liquid), savings vehicles.
  (Overlaps Phase 18's finance work.)

## Sequencing rationale

**17 first** because demand growth unblocks Phase 16's invest loop and is the prerequisite for
everything — capital, credit, and population all need somewhere to grow into. **18 (credit)**
is the next funding lever once growth pays. **19 (population)** is the structural ceiling lift
(broaden, not just deepen). **20 (government)** and **21 (trade)** add the remaining macro
sectors (the G and the NX in GDP = C + I + G + NX). Texture interleaves. Every structural
phase is OFF in the benchmark — the live sim is where the macro economy comes alive, the
curated scenarios are where skill is measured.
