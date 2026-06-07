# Housing & Population (HP) track

> The "living city" track: give homes real capacity, then let the population
> *grow* over time so firms have real customers and the labour pool can staff
> every firm. Discipline is the standard one — every slice flag-gated /
> default-OFF / byte-identical until engaged; money conserved to the cent
> (only via `World.transfer`); deterministic from seed + snapshot; rendering
> only reads. Read alongside `NORTH-STAR.md` (this advances the spirit of the
> shelved Phase 19 *population* move) and `CLAUDE.md`.

## Track map

| Slice | What | Status |
|---|---|---|
| **HP1** | Home capacity (cheap=small, premium=big; ~18 slots for 12 people = slack) + vacancy-aware re-homing. Fixes the "everyone piles into Home 6" bug. | ✅ Shipped (`fedcefb`, `f20ae72`) |
| **HP2** | Housing scarcity / dynamic rent / landlord meaning. | Deferred |
| **HP3** | **Population growth — in-migration → births.** (this doc) | 📋 Designed, awaiting build approval |
| **HP4** | Housing construction when the town fills (built on HP3's `isHousingConstrained()` trigger). | Deferred |

---

# HP3 — Population Growth (In-Migration → Births): The Living City

> Designed via a 10-agent panel (3 grounded readers → 3 approaches → adversarial
> conservation/determinism/stability verification → synthesis). All three
> approaches scored identically and converged on the same defects; the synthesis
> below is the hybrid spine with the births realism staged behind in-migration.

## 1. Where we are

The sim is **static-population by construction**. Everything about people is decided once, at seed, in `buildCity()` (`src/world/cityGen.ts:95–226`), and nothing in the running simulation ever creates or removes a person.

- **12 residents** (`cityGen.ts:96`), each seeded with `$500`, randomized needs, and a staggered shift schedule via `scheduleFor(i)`. Resident shape lives in `src/world/types.ts:200–227` (no `age`, no `householdId` today).
- **Housing is the population gate (HP1, just shipped).** 6 homes, capacities `[5,4,3,2,2,2]` = **18 slots**, occupancy 12 → **~6 vacant slots of slack**. Occupancy is computed at query time (`occupantsByHome`, `src/world/housing.ts:10–14`) and re-homing is vacancy-gated via `hasVacancy` (`housing.ts:17–19`).
- **Labour is exactly balanced at seed.** 6 staffable producers × `DESIRED_HEADCOUNT=2` = **12 seats**, filled by the 12 residents round-robin (`cityGen.ts:186–198`). The landlord runs crewless (`maxPerDay=0` → `desiredHeadcount=0`).
- **Output is labour-gated.** `effectiveCapacity = floor(maxPerDay · min(1, employees/LABOR_FULL_STAFF=2) · capitalFactor)` (`MarketSystem.ts:224–229`). 1 worker → 50% output; 2 → 100%. When the diner/goods poach a farm worker, the farm halves to ~18 grain/day and the grain→food→diner chain starves.
- **The hiring gate keeps firms from over-crewing.** A firm advertises `hiring: employeeIds.length < desiredHeadcount(kind)` (`ResidentAgentSystem.ts:212`); agentic residents only switch into `hiring:true` firms.
- **Demand is capped at 12 appetites.** `consumptionUnits` and the meal/leisure loops iterate `world.residents` (`EconomySystem.ts:87–137, 223–242`); total demand is exactly N people's wants. `DistributionSystem` splits each firm's surplus `(budget − ownerCut) / residents.length` (`DistributionSystem.ts:75`).
- **Runtime resident addition is mechanically supported but unwired.** `world.residents.push(...)` + `world.reindex()` (`World.ts:30`) makes a new person visible to every system; residents persist for free in `WorldSnapshot.residents` (`World.ts:158/168`). No system does this today.

**Bottom line:** 12 people are simultaneously the entire workforce *and* the entire customer base, against ~12–14 producer seats. The farm starves under churn and demand can't grow. HP3 closes both gaps by adding people over time, gated on housing.

---

## 2. What happens as the population slowly grows — the honest analysis

Adding people, one at a time, into a **fixed money supply** produces three coupled effects. Two are the intended wins; the third is the stability risk we must engineer around.

### Win 1 — Growth staffs the supply chain
A new jobless person ($0, `jobId:""`) is exactly what the existing labour market consumes. The brain-off staffing loop in `BusinessEntrySystem.found` (`BusinessEntrySystem.ts:121–131`) already pulls the jobless pool, lowest-index first, into open seats — and the agentic `ResidentAgentSystem`/`BusinessAgentSystem` paths do the same for `hiring:true` firms. **The farm finally gets its 2nd worker and runs at 100%.** This is the headline win: growth fixes the chronic under-staffing the closed loop can't fix at N=12. (Caveat — this only fires today inside `BusinessEntrySystem` when a niche is *empty*, or in brain-on runs for residents on the agentic roster. HP3 must add a deterministic placement step so it fires for migrants in every config; see §3, mustFix #2.)

### Win 2 — Firms gain real customers
Per-resident consumption is fixed, so total meal + leisure demand scales **~linearly with N** (the `EconomySystem` loops over all residents). A 12→18 city is a 50% bigger customer base — the real demand the storefronts were built for. (Caveat — only true if the newcomer can actually *eat*; see the id break in §3, mustFix #1. With the wrong id, `consumptionUnits` returns `NaN` and a migrant buys zero meals forever, inverting this win into pure dividend dilution.)

### Risk — money-per-capita dilution against a fixed supply
This is the real economics, stated honestly. The money supply is fixed (~$20k: 12·$500 + business reserves). New people enter at **$0** (they must — minting is a sacred-invariant break). So:

- **$/capita falls** as N rises: `$500 + reserves/N`. At N=12 ≈ $1,700/head; at N=40 ≈ $500/head.
- **The elasticity curve compresses.** `consumptionUnits` pivots on `ratio = money/WEALTH_BASELINE(500)` (`EconomySystem.ts:232`). Once per-capita drops below $500, the "rich residents buy >1 unit" cushion the design leans on evaporates *exactly as N grows*. Total demand still rises (more mouths) but per-capita softens.
- **Each dividend slice shrinks.** `DistributionSystem` divides by `residents.length` (`DistributionSystem.ts:75`): a firm's fixed daily surplus spread over more heads means each resident's dividend falls (~$67→$20→$10 as N goes 12→40→80). **This is correct closed-economy behaviour, not a bug** — a fixed profit pie shared by more people — and it is the natural anti-runaway brake. But pushed too far it drives newcomers below rent-paying solvency (rent ~62/day) and can starve the entrepreneur pool below `ENTREPRENEUR_MIN_SAVINGS` so `BusinessEntrySystem` can no longer refound dead niches — a second-order collapse.

**Does the money supply need to grow with people?** No — and it must not (minting breaks conservation). The deflationary pressure is real but is countered structurally, not with a printing press:
1. **Grow productively, not dilutively.** Pace growth so every new mouth has a *job* (wage income), not just a shrinking dividend. Gate immigration on **open producer seats**, and *actually seat the migrant*. A staffed migrant raises real output/GDP, so the pie the distributor splits grows alongside the headcount.
2. **Grow slowly.** A long per-arrival cooldown lets wages/dividends/output re-equilibrate between arrivals, so per-capita never free-falls.
3. **Hard ceiling at housing.** Growth halts at the 18-slot cap (HP4 builds more), bounding N — and therefore dilution — by construction.

**Deflation/unemployment verdict:** with a naïve "add mouths" design you get deflation and a permanent jobless underclass (mouths that pay rent + take dividends but earn no wage). With the **job-gated + actually-seated** design, growth is productive: output rises in step with headcount, the farm staffs, GDP grows, and per-capita wealth holds above a documented floor.

---

## 3. The recommended approach

**Primary design: one flag-gated `PopulationSystem`, in-migration first, with births as a follow-on slice reusing the *same* spawn primitive.**

This is the **hybrid spine** (Design 3), upgraded with the births realism the user explicitly wants (Design 2) staged behind in-migration so the risky demographic state (age/death/households) ships only after the simple, conservation-trivial path is proven. All three designs scored 52 and converged on identical defects; the hybrid's "one engine, two flavours" structure resolves them with the least surface area.

**Why in-migration first, then births:**
- **Conservation is trivial on entry** ($0 mint = $0), and in-migration has **no exit**, so there is no inheritance question to get wrong in the first build. Births add the *want* (real people appearing over time) but on the same `spawn()` primitive — only *naming* and *who-funds-it* differ.
- **Births fit as HP3-7**, reusing the identical trigger + spawn primitive: a birth places the newborn in the **parent's** home, funded by a parent→child `World.transfer(parent, child, BIRTH_GIFT)` (or $0), id from the same serialized counter. Death + inheritance (HP3-6) precedes births so exit-conservation is proven before the population can grow unbounded. **Full demographic depth (households as real lineages, coming-of-age household formation) is HP3-8+/HP4** — flagged, not first.

### Resolving every mustFix from the verdicts

All three verdicts raised the same six concrete breaks. The recommended design fixes each:

1. **NEVER encode the index in the id string** (the #1 break in all three). `res_mig${n}`/`res_gen${n}` makes `Number(id.split("_")[1])` return `NaN` at 5 verified production sites — `EconomySystem.ts:147` (leisure), `EconomySystem.ts:239` (consumption), `BrainSystem.ts:72` (social venue), `BusinessEntrySystem.ts:20` and `BusinessAgentSystem.ts:347` (residentIndex sort). `NaN` makes migrants buy zero meals, route only to goods, and silently corrupt the founder/hiring sort order. **Fix:** continue the numeric `res_${n}` namespace from a serialized monotonic counter seeded at the initial resident count: `id = ` + "`res_${baseCount + spawnCount}`" + `. Carry origin/naming in a separate non-id field (e.g. `origin?: "migrant"|"born"`). **Regression test:** every resident id yields a finite `residentIndex`, finite `consumptionUnits`, finite `leisureReservation`.

2. **Implement the migrant hiring path** (the headline win has no mechanism today for non-agentic residents). **Fix:** add a deterministic placement step in `PopulationSystem` immediately after spawn — seat the jobless newcomer into the lowest-index active producer with `employeeIds.length < desiredHeadcount(kind)`, setting `jobId`/`wagePerTick`/`employeeIds` (the exact loop from `BusinessEntrySystem.ts:121–131`). This works brain-off, so the soak and determinism tests (which run brain-off) can prove "farm reaches 2 workers, 100% capacity."

3. **Fix the prosperity-gate / plateau contradiction.** Gate on open seats *and* fill them, so the signal the gate reads is one the city can actually satisfy → N self-limits when every firm is crewed.

4. **Make eviction capacity-aware** (existing bug, confirmed). `LifecycleSystem.reviewHousing` (`LifecycleSystem.ts:65–73`) re-homes to `cheapestHome()` (`LifecycleSystem.ts:75–87`) with **no vacancy check** — under growth this stacks $0 evictees past capacity, breaking the housing invariant the whole gate rests on. **Fix:** add a shared `cheapestVacantHome(residents, locations)` helper to `housing.ts` and route both immigration placement *and* `reviewHousing` through it.

5. **Solve per-capita deflation explicitly** (§7), and **prove it** — soak-assert a per-capita money floor and that the entrepreneur pool stays above `ENTREPRENEUR_MIN_SAVINGS`. Pace growth to actual employment headroom, not just savings.

6. **Add semantic-determinism tests beyond serialize-equality** — assert the founder/hiring sort still selects the true lowest index with migrants present (the NaN-comparator corruption passes serialize-equality but is semantically wrong).

Plus the births-track mustFixes (deferred to HP3-6/7/8): default `age` on restore/spawn; wire or drop the macro-health gate (read prior-day snapshot, acknowledge one-day staleness); ground households in lineage not co-tenancy; forbid a $0 newborn from holding `ownerId`.

---

## 4. Dependency-ordered slices

1. **HP3-1 — Inert seam.** `src/systems/PopulationSystem.ts` (no-op behind `POPULATION_GROWTH=false`), constants, register in `src/createCity.ts` **after MacroSystem**, option `populationGrowth?` — byte-identical when off.
2. **HP3-2 — Capacity helper.** `cheapestVacantHome()` in `src/world/housing.ts` (pure, unused-export → byte-identical).
3. **HP3-3 — Fix eviction.** Route `LifecycleSystem.reviewHousing` (`src/systems/LifecycleSystem.ts`) through `cheapestVacantHome` (real-bug fix, gated/tested).
4. **HP3-4 — Spawn primitive.** Private `spawn()` in `PopulationSystem`: numeric `res_${base+n}` id, $0, jobless, housing-gated, `push`+`reindex`. Reachable only via test seam.
5. **HP3-5 — Wire the trigger + seat the migrant.** Daily growth-pressure (housing slack + open seats + prosperity), then deterministic placement into the lowest-index open producer seat.
6. **HP3-6 — Exit path: death + inheritance.** `age` on `src/world/types.ts`; transfer-to-heir-before-splice in `LifecycleSystem`/`PopulationSystem`.
7. **HP3-7 — Births reuse the engine.** Same trigger + `spawn()`; newborn in parent's home, parent→child `World.transfer` gift, `res_${base+n}` id.
8. **HP3-8 — Housing-full → HP4 seam + economic-stability soak.** `isHousingConstrained()`, clamped accumulator, and the multi-year growth-on soak that proves the whole stability story.

---

## 5. Sub-slices

### HP3-1 — Inert `PopulationSystem`
- **Builds:** `PopulationSystem implements System`, `readonly id="population"`, `constructor(world, enabled=POPULATION_GROWTH)`, `update()` early-returns when `!enabled` (the `BusinessEntrySystem` guard). `serialize()`/`restore()` return/read `{spawnCount:0, pressureAccumulator:0, lastSpawnDay:-COOLDOWN}` so the snapshot shape is locked from day one. Add constants (`POPULATION_GROWTH=false`, `IN_MIGRATION_COOLDOWN_DAYS`, `MIGRATION_RATE_PER_DAY`, `MIGRATION_PROSPERITY_FLOOR`, `NEWCOMER_NEEDS`). Register in `createCity.ts` **after MacroSystem** (so a same-day arrival never perturbs the sample Macro just took); thread `populationGrowth?` through `CitySimOptions`; return the handle.
- **Flag:** `POPULATION_GROWTH` (false) + `populationGrowth?`.
- **Conservation:** no-op body; `totalMoney()` trivially unchanged.
- **Determinism:** `Simulation.serialize` auto-keys systems by id and `restore` restores by id, so the zeroed state round-trips with zero extra wiring; disabled `update()` is truly inert.
- **Gate:** new `population.test.ts` — two same-seed 30-day runs serialize-equal; `createCity` returns the handle. Re-run `city.test.ts`/`soak.test.ts` determinism + serialize-equality GREEN with **zero re-baselining**.

### HP3-2 — `cheapestVacantHome` helper
- **Builds:** pure `cheapestVacantHome(residents, locations): string | undefined` in `housing.ts` — homes only, `occupantsByHome` + `hasVacancy`, lowest rent, ties by location id; `undefined` when all full.
- **Flag:** none (unused export = byte-identical).
- **Conservation:** reads only homeId/capacity/rent; never touches money.
- **Determinism:** sorted scan by rent then id; no RNG, no Map-iteration hazard.
- **Gate:** unit tests — full town → undefined; one vacancy → that home; equal-rent tie → lower id; cheapest full but pricier vacant → the pricier vacant.

### HP3-3 — Capacity-aware eviction
- **Builds:** `LifecycleSystem.reviewHousing` calls `cheapestVacantHome` instead of `cheapestHome`; if none, keep current home (never homeless).
- **Flag:** none — it's a latent-bug fix; guard behavior parity with a test rather than a flag.
- **Conservation:** changes `homeId` only; no money.
- **Determinism:** deterministic vacant-home pick; no RNG.
- **Gate:** test that a soak never produces `occupants > capacity`; existing lifecycle eviction tests stay GREEN (re-baseline only if an eviction target home id changes, documented).

### HP3-4 — Spawn primitive
- **Builds:** `private spawn(): Resident | undefined` — `cheapestVacantHome`; if undefined return undefined (housing-full → defer, don't advance `lastSpawnDay`); else `spawnCount++`, build a Resident exactly like `cityGen.ts:200–221` but `id="res_${baseCount+spawnCount}"`, `origin:"migrant"`, `money:0`, `homeId=home`, `jobId:""`, `wagePerTick:0`, fixed `NEWCOMER_NEEDS` (no RNG draw → seeded population byte-identical), `schedule=scheduleFor(baseCount+spawnCount)`, anchored at the home node; `push`+`reindex`. **No transfer.**
- **Flag:** `POPULATION_GROWTH` still false; reachable only via a forced-on test.
- **Conservation:** $0 construction, zero transfers → `totalMoney()` provably unchanged. Invalid-`homeId` `collectRent` throw (`EconomySystem.ts:164`) excluded by the housing gate.
- **Determinism:** counter id, index-derived name/schedule, fixed needs, deterministic home; `reindex` makes it visible; `spawnCount` serialized.
- **Gate:** forced-on test — id is `res_12` (finite index!), `consumptionUnits>=1` and `leisureReservation` finite (the mustFix #1 regression), `money===0`, valid `homeId`, occupants+1, `totalMoney` conserved, two same-seed runs serialize-equal; pre-fill all homes → `spawn` returns undefined.

### HP3-5 — Trigger + seat the migrant
- **Builds:** real `update()` on day boundaries: compute `housingSlack` (Σ free slots), `labourPull` (Σ open producer seats via `desiredHeadcount`), median resident money (sorted), unemployment (recompute inline from `world.residents`, **not** stale `macro.latest()`). Gate on cooldown + prosperity + `housingSlack>=1` + `labourPull>=1`; accumulate `pressureAccumulator += MIGRATION_RATE_PER_DAY`; spawn `min(floor(accumulator), housingSlack)`. **After each spawn, seat the migrant** into the lowest-index active producer with an open seat (the `BusinessEntrySystem.ts:121–131` loop).
- **Flag:** `populationGrowth` on via option; `POPULATION_GROWTH` default stays false.
- **Conservation:** $0 entry; hiring sets `jobId`/`wagePerTick` only (no money at hire). `totalMoney()` conserved across the run.
- **Determinism:** all inputs are pure reads of the settled world + serialized accumulator; recompute-unemployed-inline avoids the one-day-stale macro read; `floor` deterministic; multi-spawn loop order deterministic.
- **Gate:** prosperous city, growth on, ~1 year — N grows monotonically, never exceeds capacity, `totalMoney` conserved, **farm reaches `employeeIds.length===2` and 100% `effectiveCapacity`**, storefront revenue rises after spawns (the load-bearing demand check), N plateaus when fully crewed. Semantic-determinism: founder/hiring sort still picks the true lowest index with migrants present.

### HP3-6 — Death + inheritance
- **Builds:** `age?:number` on `Resident` (defaulted on restore **and** spawn); increment per sim-year (`TICKS_PER_DAY*365`); at `age>=MAX_AGE`: `world.transfer(dead.id, heir.id, dead.money)` (heir = lowest-id living resident; never the landlord, to avoid pooling) **before** splice; lay off (clear from `employeeIds`); reassign any owned business's `ownerId` to a living heir (never a $0 newborn); `splice`+`reindex`. Deaths in ascending id order.
- **Flag:** `POPULATION_MORTALITY` (default false).
- **Conservation:** transfer drains decedent to exactly $0 before removal — `totalMoney()` conserved across death (mirrors `LifecycleSystem.ts:59` liquidation).
- **Determinism:** `age>=MAX_AGE`, lowest-id tie-break, lowest-id heir — no RNG; `age` rides the snapshot; defaulted on restore so pre-HP3 saves load.
- **Gate:** seed a resident at `MAX_AGE`, step one year — gone from residents, heir +exactly their balance, owned biz has a living `ownerId>0` money, `totalMoney` unchanged; mid-life save/restore resumes identical death day.

### HP3-7 — Births reuse the engine
- **Builds:** same trigger + `spawn()` in birth mode (`POPULATION_BIRTHS`): parent = lowest-index employed, prosperous, home-has-slot resident; newborn placed in **parent's** home, id `res_${base+n}` (numeric!), `origin:"born"`, funded by `world.transfer(parent, child, BIRTH_GIFT)` (or $0), jobless, `age:0`, `parentId` set.
- **Flag:** `POPULATION_BIRTHS` (default false) selects birth flavour.
- **Conservation:** gift is a parent→child transfer capped at parent balance — no mint; $0 gift also conserves.
- **Determinism:** lowest-index parent, counter id, parent's home; survives restore via `spawnCount` + snapshot residents.
- **Gate:** prosperous city — newborns appear with **numeric** ids and finite `consumptionUnits`, live in parent's home, parent −exactly `BIRTH_GIFT` / child +exactly that, `totalMoney` conserved, determinism + round-trip over a year.

### HP3-8 — Housing-full seam + stability soak
- **Builds:** `isHousingConstrained()` getter (serialized), accumulator clamp so blocked pressure can't explode the day a home opens, read-only demography line on `MacroSystem` (N, births, deaths, $/capita). Then the multi-year growth-on soak (extends `soak.test.ts`).
- **Flag:** same growth flag; macro additions read-only.
- **Conservation:** soak asserts `totalMoney()` conserved to float tolerance across births+deaths+migration+disasters.
- **Determinism:** two same-seed soak instances serialize-equal at the end; mid-soak save/restore resumes identically.
- **Gate:** N plateaus at/under cap; every home `occupants<=capacity`; farm at full staffing/100%; GDP>0; **$/capita stays above a documented floor**; entrepreneur pool never drops below `ENTREPRENEUR_MIN_SAVINGS`; `activeKinds` doesn't collapse; no NaN, no negative balances.

---

## 6. Conservation & determinism proof-sketches

- **Entry (migration):** newcomer constructed with `money:0`, **zero** `World.transfer` calls at spawn. `world.totalMoney() = Σ residents.money + Σ businesses.cash` gains `+0` at the `push` instant. Minting is impossible because no assignment to `.money` occurs except the literal `0`.
- **Entry (birth):** the only money movement is `world.transfer(parent, child, gift)`, capped at the parent's balance by `World.transfer`. Money relocates between two existing holders; the sum is invariant. A $0 gift is the degenerate safe case.
- **Exit (death/inheritance):** `world.transfer(dead, heir, dead.money)` drains the decedent to exactly $0 **before** the splice; we never remove a non-zero holder. Owned-business cash stays with the firm (only `ownerId` reassigns). Identical discipline to the proven `LifecycleSystem.ts:59` husk liquidation.
- **Seeded schedule (who/when):** no `Math.random`, no wall-clock. **WHO** = numeric counter id (migration) / lowest-index eligible parent (birth) / `age>=MAX_AGE` lowest-id (death). **WHEN** = pure function of serialized `pressureAccumulator` + `lastSpawnDay` + the fully-settled day's vitals (slack, open seats via `desiredHeadcount`, sorted-median money, inline-recomputed unemployment). The only RNG is fixed `NEWCOMER_NEEDS` constants → **no draw consumed** → the seeded population's RNG stream is byte-identical.
- **Serialize/restore:** system state (`spawnCount`, `pressureAccumulator`, `lastSpawnDay`, `housingConstrained`) rides `Simulation.serialize().systems["population"]` (auto-keyed by id). Per-resident `age`/`parentId`/`origin` ride `WorldSnapshot.residents` via `structuredClone` (absent optional fields ⇒ byte-identical when off; **defaulted on restore** so the next death day reproduces). `reindex()` after every add/remove rebuilds lookups deterministically. Each slice ships a round-trip test proving the next spawn/death reproduces exactly.

---

## 7. Economic-stability plan

- **Money supply stays fixed** — never mint. $0 entry + transfer-funded birth + transfer-to-heir exit keep `totalMoney()` constant by construction.
- **The `residents.length` divisor is correct, not a bug.** `(budget − ownerCut)/residents.length` thinning per-head dividends as N rises is honest closed-economy behaviour and the natural anti-runaway brake. We do **not** touch the divisor.
- **Counter the dilution productively.** Gate immigration on **open producer seats** *and seat the migrant* — every new mouth becomes a wage-earner, raising real output/GDP so the pie grows with the headcount. Growth that doesn't staff is forbidden by the gate.
- **Grow slowly.** A small `MIGRATION_RATE_PER_DAY` + per-arrival cooldown lets wages/dividends/output re-equilibrate between arrivals so $/capita never free-falls. The soak asserts a documented per-capita floor that *actually holds in the tested config* (proven, not assumed).
- **Jobs vs people.** Pace to employment headroom: stop admitting once every firm is at `desiredHeadcount`. N self-limits near labour saturation (~one mouth per open seat), bounding dilution.
- **Guard the entrepreneur pool.** Soak-assert savings never drop below `ENTREPRENEUR_MIN_SAVINGS`, so `BusinessEntrySystem` can still refound dead niches under growth.
- **Housing-full → HP4.** When `housingSlack===0`, do not spawn; clamp the accumulator and expose `isHousingConstrained()` as HP4's build trigger. The 18-slot cap is the hard ceiling that bounds N until HP4 builds more homes.

---

## 8. Test impact

**Stays sacred (must not re-baseline):** every existing determinism + serialize-equality test runs with `POPULATION_GROWTH` **off**, so they remain byte-identical — `city.test.ts:116/126`, `soak.test.ts:144` (`ALL_RESIDENTS` length 12), `elasticity.test.ts:76–82/164–172`, `businessAgent.test.ts:97–113`, `persistence.test.ts`, `lifecycle.test.ts`, `capital.test.ts`. HP3-1's inert-seam claim is verified: a present-but-disabled system adds a constant `systems["population"]` key on both sides of any a/b compare, so `toEqual` still holds.

**Re-baselines only if a future config sets `residentCount > 12` or flips growth on in an existing test:** anything pinning N=12 — `soak.test.ts:71` (`ALL_RESIDENTS`), the elasticity tier assertions, and the per-capita dividend numbers. These get **new growth-on variants**, not edits to the existing N=12 cases.

**Numerically tolerant (hold regardless):** money-conservation `toBeCloseTo` assertions, GDP/macro sums (grow bigger but stay finite), `activeKinds>=4` (re-check at higher N).

**One existing-bug touch:** HP3-3 changes the eviction re-home target; any lifecycle test asserting a specific evicted `homeId` re-baselines with a documented one-line reason.

---

## 9. Risks & rollback

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| `NaN` id break (can't eat / corrupt sort) | High if ignored | Demand dead on arrival; nondeterministic sort | Numeric `res_${base+n}` id + regression test on finite `consumptionUnits` | n/a — fixed in HP3-4 by design |
| Migrant never hired (jobless underclass) | High | Headline win false; pure dilution | Deterministic seat-into-open-producer step (HP3-5) | Flag off → no spawns |
| Eviction overfills cheap home | Medium (existing bug) | Housing invariant broken | `cheapestVacantHome` on the eviction path (HP3-3) | Revert HP3-3; flag off |
| Per-capita deflation → eviction churn / starved entrepreneurs | Medium | Stability collapse | Job-gated slow growth + soak-asserted floors (HP3-5/8) | Lengthen cooldown / lower rate (constants) |
| Stale `macro.latest()` over-admits | Medium | Burst of jobless before gate sees them | Recompute unemployment inline + clamp same-day spawns | Drop the macro term, keep open-seat gate |
| Newborn/age `NaN` on restore | Medium | Deaths silently never fire | Default `age` on restore + spawn; round-trip test | Flag `POPULATION_MORTALITY` off |
| Baby inherits a firm | Low | Wealth in a non-actor | Forbid $0 newborn `ownerId`; pass to richest living lineage member | Open question resolved in HP3-6 slice |
| Inert seam not byte-identical | Low | Existing tests fail | Default-OFF early-return; HP3-1 serialize-equality gate | Revert the registration line |

Every slice is flag-gated/default-OFF and committed separately, so rollback is a single revert; the master `POPULATION_GROWTH=false` disables the entire feature at once.

---

## 10. Definition of Done

1. `npm run typecheck && npm run test:run && npm run build` GREEN at **every** slice.
2. With `POPULATION_GROWTH` **off**: all existing tests byte-identical, `world.serialize()` unchanged vs pre-HP3 — the inert seam proven (HP3-1).
3. With it **on**: population grows deterministically from the economic-health trigger, **never exceeds housing capacity**, and every home satisfies `occupants <= capacity` (eviction fixed).
4. **Every resident id yields a finite `residentIndex`/`consumptionUnits`/`leisureReservation`** — the NaN break is gone; storefront revenue measurably rises after spawns (demand actually scales).
5. The previously-unfilled **farm reaches `DESIRED_HEADCOUNT` and 100% `effectiveCapacity`** once migrants are seated (the headline win, in a brain-off test).
6. `world.totalMoney()` conserved across **every** migration, birth, and death (HP3-4/6/7), to float tolerance over a 3-year soak through disasters.
7. **Births over time** ship on the same engine (HP3-7): newborns appear in their parent's home, transfer-funded, numeric ids — the user's explicit real-world want, delivered.
8. Death routes all cash via `World.transfer` to a living heir; every active `biz.ownerId` names a living resident (HP3-6).
9. All new state survives serialize/restore with round-trip tests; two same-seed growth-on runs serialize-equal, with mid-run save/restore continuing bit-for-bit; a **semantic**-determinism test confirms the founder/hiring sort still selects the true lowest index with migrants present.
10. Soak: N plateaus at/under the housing cap, GDP>0, **$/capita above a documented floor**, entrepreneur pool above `ENTREPRENEUR_MIN_SAVINGS`, no NaN, no negative balances.
11. `isHousingConstrained()` exposed as HP4's build trigger (HP3-8).
12. Every economic-design choice ($0 entry, inheritance transfer, the `residents.length` divisor, the job/housing gates, the HP4 deferral) carries a plain real-world explanation in code comments and this doc, per the working agreement.
