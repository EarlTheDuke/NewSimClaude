# Initiative C / C4 — The Money Fork: three planned paths + a recommendation

> The decision the whole free-market program has been building toward. Read with
> [INITIATIVE-04-GDP-GROWTH.md](INITIATIVE-04-GDP-GROWTH.md), [NORTH-STAR.md](NORTH-STAR.md), and
> the sacred invariants in [CLAUDE.md](CLAUDE.md).

> **DECISION (2026-06-09): the user chose (a) → (b). BOTH ARE NOW BUILT & VERIFIED.**
>
> **THE (a) RESULT** (slices a1–a6; `tradeGrowthSoak.test.ts`, seeds 1 & 7): outside demand lifts
> GDP +25–45% while the port's finite reserve funds it — and the lift **outlives the battery**:
> the export boom finances a ~2× town (in-migration/births/construction) whose own demand holds
> GDP above the C2 plateau after the foreign money is fully spent. Conservation to the cent
> throughout. The bound is real: the battery exhausts in ~1 year and is never refilled.
>
> **THE (b) RESULT** (slices b1–b4; `monetaryGrowthSoak.test.ts`, seeds 1 & 7): the conservation
> invariant was **formally relaxed** to *"totalMoney() = genesis + mintedTotal() − burnedTotal(),
> to the cent"* — one audited doorway (`World.mint`/`burn`), a Monetary Authority, and a bounded
> k-percent helicopter rule. Under a loose rule (0.2%/day, capped $400/day) **the press delivers
> what the port could not: an unbounded lift** — the daily issue compounds with the supply and
> never exhausts; GDP ends ≈ 2.2× the closed control and still climbing, again through the
> structural channel (~2.2× population). A modest drip (0.05%/day) mostly *pools* (velocity
> falls, GDP ≈ control). Model limit, stated plainly: **no price inflation can show** — B2B
> prices are band-clamped and retail reckons against frozen anchors, so new money becomes real
> activity or pooling, never rising prices; true inflation needs unanchored prices (future work).
> The default city and the CEO bench never mint and remain **strictly** conserved.
>
> **The C5 question is thereby answered with evidence:** within strict conservation the ceiling
> lifts *boundedly* (trade); lifting it *without bound* requires money creation, which is now
> available as an explicit, audited, bounded policy — never an accidental leak.
>
> **C4a-C addendum (2026-06-10): trade is no longer terminal — the conserving trade CYCLE.**
> The one-shot battery had an artifact: once the port was broke and the healthy chain needed no
> imports, foreign commerce ended forever ("the world went broke" — the least realistic line in
> the model). Fixed by giving the city an *import appetite*: luxuries carry **imported content**
> (`TRADE_LUXURY_IMPORT_SHARE` = 0.3 — the goods store pays the port a share of each day's
> luxury sales to restock its fineries off the boat, a plain conserving `store→port` transfer
> booked as −M). City money flowing out refills the reserve that funds continuing exports, so
> the current account self-sustains. **Measured (300 days, live):** the port bottoms out at its
> working level and trade settles into *balanced* X ≈ M ≈ $37/day — the textbook transfer
> problem (you can't run a permanent surplus against a broke partner), emergent. Strict
> conservation untouched; the a5 soak pins `luxuryImportShare: 0` to keep the pre-cycle
> battery-death finding reproducible as the control.

## The question, with evidence

Initiative #1 (S3) suspected, and **C2 now proves over a 4-year full-stack soak**: a closed, conserved
free market is **healthy, alive, and self-sustaining — but GDP _plateaus_, it does not compound.**
Population grows then self-limits at its housing/wealth cap, so demand-led growth tops out. **To lift
the GDP ceiling, demand or money must enter from _outside_ the closed loop.** Three ways to do that —
planned below, then a recommendation.

The hard constraint that splits them: **CLAUDE.md makes "the economy is closed — `totalMoney()`
conserved to the cent across any number of ticks" a _sacred invariant_** (breaking it is "a bug, not a
tradeoff"). Path (a) lifts the ceiling **inside** that invariant; path (b) **deliberately relaxes** it;
path (c) **accepts** it.

---

## Path (a) — External trade (a conserving "port")

**Idea.** Add a **port** (`kind: "port"`, a registry entry + role flag — the 4d/4b pattern) that
trades with the rest of the world: it **buys the city's exports** (`port → firm`, injecting outside
**demand**) and **sells imports** (`firm/resident → port`). It is a **conserving holder** counted in
`totalMoney()`, seeded with a large reserve that represents foreign buyers' money in the system. Trade
nets through it: every flow is a `World.transfer`, so `totalMoney()` (city + port) stays conserved to
the cent **across ticks** — the sacred invariant holds. The genesis total is simply higher (city +
port reserve), exactly like seeding any holder.

**How it lifts the ceiling.** Export demand is a *new demand source* on top of capped resident wants:
a storefront/producer can sell to the port at world prices, so its revenue and output rise → GDP rises
(the exports term). The port's reserve is a **demand battery** — GDP stays elevated while it funds
exports; as the city net-exports, money moves port→city (the city's wealth grows, the port's shrinks).
Growth is **real but bounded** by the port's reserve (finite foreign demand) — which is *realistic*.
Refilling the port indefinitely *would* be money creation (that's path b).

**Slices (flag-gated, default byte-identical — the house pattern).**
- **a1** Inert port seam: `port` registry entry + `includePort` option + a no-op `TradeSystem` stub.
- **a2** Export demand: `TradeSystem` buys a bounded daily quantity of storefront/producer output at a
  world price (`port → firm`), capped by the port's reserve. World prices are a frozen table.
- **a3** Imports / current account: residents or firms buy imports (`→ port`) so the account two-ways;
  net exports drain the port (deterministically), net imports refill it.
- **a4** A CEO **export lever** — a firm decides how much to serve export vs. local demand (a new
  observation field + action), gated like the other levers.
- **a5** Engage + soak: does export demand lift GDP **within conservation**? Measure the lift and how
  long the port sustains it; falsifiable bar like 18h.
- **a6** Benchmark freeze: port OFF in the CEO bench.

**Conservation / determinism.** ✅ Sacred invariant intact (port is a conserving holder; all flows are
transfers). Deterministic (world prices fixed, quantities integer, fixed order, no RNG). Snapshot-
complete (port is a `Business`).

**NORTH-STAR fit.** Directly the listed lever: *"a port that buys exports — injects outside demand,
breaks the closed ceiling."* Adds a real CEO decision ("when/how much do I export?") → benchmark depth.
Serves all three goals (realism, growth, benchmark) **without touching a sacred invariant.**

**Risk.** Medium. The current-account bookkeeping must net cleanly; world prices need calibration so
exports neither trivially dominate nor never fire. Bounded by design, so no runaway.

---

## Path (b) — Bounded money creation (a monetary authority)

**Idea.** Introduce an explicit **monetary authority** (central bank / treasury) that **mints** money
into circulation (and can **burn** it), expanding the money supply so demand — and GDP — can grow
without an external trading partner. This is how real fiat economies grow.

**The cost: it deliberately relaxes a _sacred_ invariant.** `totalMoney()` would no longer be constant
— it changes by exactly the minted/burned amount. To do it *responsibly* (not as an accidental leak):
- A new **audited primitive** — `World.mint(toId, amount)` / `World.burn(fromId, amount)` — separate
  from `transfer`, that **logs every operation**. `totalMoney()` becomes **auditable**: `genesis +
  Σmint − Σburn`, asserted to the cent. The invariant changes from *"conserved"* to *"conserved except
  through the logged monetary authority, which is explicit, bounded, and measured."*
- Minting is **bounded** (a rule, e.g. money supply grows with measured GDP/population, capped per day)
  and **deterministic** (seeded/derived, no wall-clock).

**How it lifts the ceiling.** Unbounded (by policy): more money → more nominal demand → more GDP. It
also re-opens *inflation* as a real dynamic (and a CEO/benchmark surface). It's the most powerful and
most realistic-at-scale lever.

**Slices.** b1 audited `mint`/`burn` + the relaxed-but-audited conservation test harness; b2 the
monetary-authority holder + a bounded supply rule; b3 engage + measure (GDP lift vs. inflation); b4
benchmark freeze (the bench stays **strictly** conserved — no minting).

**Conservation / determinism.** ⚠️ **Breaks the strict sacred invariant by design.** Mitigated to
"audited + bounded + measured," but the headline guarantee changes. Determinism preserved.

**NORTH-STAR fit.** The listed *"banking/credit — flexes the money supply… but threatens the
conservation invariant — needs careful design,"* taken to its conclusion. Highest realism-at-scale and
highest blast radius. The *benchmark* must stay strictly conserved (freeze it off), or skill scores
drift with the money supply — the realism-vs-benchmark tension at its sharpest.

**Risk.** **High** — and it requires your **explicit decision to relax a sacred invariant** (per the
working agreement, breaking a sacred invariant is a stop-and-ask). Not an autonomous default.

---

## Path (c) — Accept the plateau (declare the result, pivot)

**Idea.** Treat the C2 finding as **the result**: a closed, conserved, free-market economy with
creation, competition, and credit reaches a **stable, self-sustaining steady state** — it does not grow
without bound, which is *honest and realistic* (closed economies don't). Write it up like the S3 result,
and **pivot** the project's energy to the high-value tracks that don't need ceiling-lifting:
- **Benchmark depth** — curated CEO scenarios (pricing, investment, market entry, the wage war), the
  NORTH-STAR's "clean LLM-benchmark environment" goal. The determinism + seam are already the gold.
- **The visualization track** (`VISION-RENDER.md` / `PHASE-RENDER.md`) — "10× more watchable."
- **"Claude plays"** — the observation/action surface + the existing brain seam.
- **Texture** — services, human capital, asset markets (depth, not ceilings).

**Slices.** Mostly a documented finding + a deliberate re-pointing of `NORTH-STAR`/`ROADMAP`. No
invariant risk, no new subsystem.

**Conservation / determinism.** ✅ Untouched.

**NORTH-STAR fit.** Honors realism and the benchmark goal; concedes the "compound GDP" ambition as
*not achievable within a closed economy* — which is itself a real economic truth worth stating.

**Risk.** None technically. The "cost" is leaving the growth ambition unrealized (until/unless a future
session picks up (a) or (b)).

---

## Comparison

| | (a) External trade | (b) Money creation | (c) Accept plateau |
|---|---|---|---|
| Lifts GDP ceiling | **Yes, bounded** (port reserve) | **Yes, unbounded** (policy) | No (by choice) |
| Sacred conservation invariant | ✅ **intact** | ⚠️ **relaxed** (audited) | ✅ intact |
| Realism | High (trade is real) | Highest at scale (fiat) | High (closed economies plateau) |
| New CEO/benchmark decision | "when to export?" | inflation / supply policy | (pivots to other benchmarks) |
| Determinism | ✅ | ✅ | ✅ |
| Risk | Medium | **High** + needs your invariant call | None |
| Your decision required first | No (conserving default) | **Yes** (relax a sacred invariant) | Yes (a direction pivot) |

## Recommendation

**Do (a) external trade first.** It is the *only* path that **lifts the GDP ceiling while keeping the
sacred conservation invariant intact**, it's the exact NORTH-STAR lever for breaking the closed ceiling,
and it adds a genuine "should I export?" benchmark decision — serving all three goals at once. Its
bounded growth (the port's finite reserve) is realistic, and it answers the C2 question cleanly: *does
outside demand compound GDP within conservation?*

**Then, if you want _unbounded_ growth, (b) money creation is the deliberate next escalation** — but
only as an **explicit decision to relax a sacred invariant**, done the audited/bounded/measured way, and
with the benchmark kept strictly conserved. It should not be entered autonomously or before (a) shows
its limit.

**(c) is the honest fallback** if you'd rather bank the closed-economy result and pour the energy into
the benchmark and visualization tracks — both of which are high-value and need no ceiling-lifting.

**Suggested sequence:** build **(a)** → measure its lift → revisit the (b)-vs-(c) choice *with that
evidence in hand*. That keeps every step conserving and reversible until you deliberately choose to
relax the invariant.
