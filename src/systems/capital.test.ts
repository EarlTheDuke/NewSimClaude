import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { BUSINESS_RESERVE, CAPITAL_BASELINE } from "./constants";
import type { BusinessAction, BusinessObservation, DecisionProvider } from "../ai/types";
import { DEFAULT_LIMITS } from "../ai/clamp";

/**
 * Tiny test-only provider: captures the observation the brain receives and
 * returns a no-op decision. Lets a test assert on what the agent layer surfaces
 * without coupling to any real provider's pricing/hiring logic.
 */
function captureProvider(): { provider: DecisionProvider; seen: BusinessObservation[] } {
  const seen: BusinessObservation[] = [];
  const provider: DecisionProvider = {
    id: "capture",
    decide(req) {
      seen.push(req.observation);
      return { action: {}, reason: "capture" };
    },
  };
  return { provider, seen };
}

/**
 * Phase 12a — the capital data model in isolation.
 *
 * This slice only *adds the field*: city-gen seeds every business at
 * {@link CAPITAL_BASELINE}, and the snapshot carries it. Nothing reads or mutates
 * capital yet (production stays labour-/capital-independent until 12b), so these
 * tests pin two things: the field exists everywhere it should, and adding it is a
 * genuine no-op — capital never moves and the closed economy still balances.
 */
describe("Phase 12a — capital data model (inert no-op slice)", () => {
  it("seeds every business at the capital baseline", () => {
    const { world } = createCity({ seed: 1, secondDiner: true });
    expect(world.businesses.length).toBeGreaterThan(0);
    for (const b of world.businesses) expect(b.capital).toBe(CAPITAL_BASELINE);
  });

  it("is inert: capital never moves and money stays conserved over 30 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    // Production now *reads* capital (12b), but nothing *writes* it in the default
    // city — no business invests, and only above-baseline capital depreciates — so
    // every business must still sit at exactly the baseline. A regression guard
    // that 12b stayed a pure no-op for the seeded town.
    for (const b of world.businesses) expect(b.capital).toBe(CAPITAL_BASELINE);
    // ...and the closed loop still balances to the cent.
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("survives a full save -> reload round-trip", () => {
    const original = createCity({ seed: 42, secondDiner: true });
    original.sim.run(TICKS_PER_DAY * 3 + 137);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    for (const b of loaded.world.businesses) expect(b.capital).toBe(CAPITAL_BASELINE);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });

  it("restores a pre-12 save that predates the field (capital absent)", () => {
    // Simulate an old snapshot by stripping the new field, proving back-compat:
    // a save written before Phase 12 reloads without error, capital simply absent
    // (12b reads `capital ?? CAPITAL_BASELINE`, so old towns resume at baseline).
    const { world } = createCity({ seed: 1 });
    const snap = world.serialize();
    for (const b of snap.businesses) delete b.capital;
    expect(() => world.restore(snap)).not.toThrow();
    expect(world.businesses.every((b) => b.capital === undefined)).toBe(true);
  });
});

/**
 * Phase 12b — production now bends with labour and capital. For the seeded city
 * (every producer staffed, capital at baseline) the formula returns exactly the
 * old maxPerDay, so these tests pin the *new* behaviour at the edges: the labour
 * gate that fixes empty producers (P10-3), capital depreciation, and output
 * tracking the capital factor.
 */
describe("Phase 12b — production responds to labour & capital", () => {
  it("a producer with no staff produces nothing (P10-3 fix)", () => {
    const idle = createCity({ seed: 1 });
    const idleFarm = idle.world.getBusiness("biz_farm")!;
    idleFarm.employeeIds = [];
    for (const r of idle.world.residents)
      if (r.jobId === "biz_farm") {
        r.jobId = "";
        r.wagePerTick = 0;
      }
    idleFarm.resources.grain = 0;
    idle.sim.run(TICKS_PER_DAY);
    expect(idleFarm.resources.grain).toBe(0);

    const staffed = createCity({ seed: 1 });
    const staffedFarm = staffed.world.getBusiness("biz_farm")!;
    expect(staffedFarm.employeeIds.length).toBeGreaterThan(0);
    staffedFarm.resources.grain = 0;
    staffed.sim.run(TICKS_PER_DAY);
    expect(staffedFarm.resources.grain!).toBeGreaterThan(0);
  });

  it("above-baseline capital depreciates toward baseline; baseline capital is untouched", () => {
    const { sim, world } = createCity({ seed: 1 });
    const factory = world.getBusiness("biz_factory")!;
    const diner = world.getBusiness("biz_diner")!;
    factory.capital = 200;
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);
    expect(factory.capital!).toBeLessThan(200);
    expect(factory.capital!).toBeGreaterThan(CAPITAL_BASELINE);
    expect(diner.capital).toBe(CAPITAL_BASELINE);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("output tracks the capital factor: a capital-starved producer is capacity-limited", () => {
    const { sim, world } = createCity({ seed: 1 });
    const farm = world.getBusiness("biz_farm")!;
    expect(farm.employeeIds.length).toBeGreaterThan(0);
    farm.capital = 10;
    farm.resources.grain = 0;
    sim.run(TICKS_PER_DAY);
    expect(farm.resources.grain!).toBeGreaterThan(0);
    expect(farm.resources.grain!).toBeLessThan(50);
  });
});

/**
 * Phase 12c step 2 — the agent's observation now carries the two signals the
 * invest lever will read: `capital` (how much equipment the firm owns) and
 * `capacityUtilization` (how hard it ran yesterday against its effective ceiling).
 * Nothing acts on them yet — that arrives in 12c step 3 — but these tests pin
 * the metric semantics so the wiring underneath the invest decision is locked.
 */
describe("Phase 12c step 2 — observations surface capital + utilization", () => {
  it("a staffed producer's observation carries baseline capital and a defined utilization in [0,1]", () => {
    const { provider, seen } = captureProvider();
    const { sim } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_farm"] });
    sim.run(TICKS_PER_DAY);
    expect(seen).toHaveLength(1);
    const obs = seen[0]!;
    expect(obs.capital).toBe(CAPITAL_BASELINE);
    expect(obs.capacityUtilization).toBeDefined();
    expect(obs.capacityUtilization!).toBeGreaterThanOrEqual(0);
    expect(obs.capacityUtilization!).toBeLessThanOrEqual(1);
  });

  it("a capacity-bound producer (capital-starved) reports utilization at the ceiling (≈1)", () => {
    const { provider, seen } = captureProvider();
    const { sim, world } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_farm"] });
    const farm = world.getBusiness("biz_farm")!;
    // Crater capital to a level so low the capacity formula falls well below
    // the daily refill target — the produce step will hit the capacity cap, not
    // the target cap. That's exactly the "needs more equipment" signal the
    // rules provider will key off in step 3.
    farm.capital = 1;
    farm.resources.grain = 0;
    sim.run(TICKS_PER_DAY);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.capacityUtilization!).toBeCloseTo(1, 3);
  });

  it("an unstaffed producer reports undefined utilization (capacity is zero, not a capital problem)", () => {
    const { provider, seen } = captureProvider();
    const { sim, world } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_farm"] });
    const farm = world.getBusiness("biz_farm")!;
    for (const r of world.residents)
      if (r.jobId === "biz_farm") {
        r.jobId = "";
        r.wagePerTick = 0;
      }
    farm.employeeIds = [];
    sim.run(TICKS_PER_DAY);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.capacityUtilization).toBeUndefined();
  });

  it("the landlord (a non-producer) reports undefined utilization", () => {
    const { provider, seen } = captureProvider();
    const { sim } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_landlord"] });
    sim.run(TICKS_PER_DAY);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.capacityUtilization).toBeUndefined();
    // Landlord still has capital seeded by 12a; only utilization is missing.
    expect(seen[0]!.capital).toBe(CAPITAL_BASELINE);
  });
});

/**
 * Phase 12c step 3 — the invest lever actually moves money and equipment.
 * A request is clamped twice: first by {@link DEFAULT_LIMITS.maxInvestPerReview}
 * (static, pre-known) and then by the runtime cash-vs-reserve floor (so an
 * aggressive request can't bankrupt the firm). The cash flows to the factory
 * via {@link World.transfer}, and capital rises one-for-one with what actually
 * moved — total money is invariant across any invest run.
 */
function fixedActionProvider(action: BusinessAction): DecisionProvider {
  return {
    id: "fixed",
    decide: () => ({ action, reason: "fixed" }),
  };
}

describe("Phase 12c step 3 — invest lever wiring", () => {
  // Note on what these tests assert: the day-boundary tick runs *every*
  // economic system (rent, procurement, profit distribution, agent review),
  // so raw cash deltas across `sim.run(TICKS_PER_DAY)` reflect a whole day's
  // flows — not just the invest move. The reliable signals are (a) the
  // agent decision log, which records exactly what the lever applied,
  // (b) the business's `capital` field (only the invest lever mutates it
  // for a baseline-capital firm), and (c) `world.totalMoney()`, which the
  // invest must never disturb.
  it("an invest request moves money to the factory and raises capital one-for-one", () => {
    const want = 200;
    const provider = fixedActionProvider({ invest: want });
    const { sim, world, agent } = createCity({
      seed: 1,
      brain: provider,
      agenticBusinessIds: ["biz_diner"],
    });
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = 50_000; // well above reserve — only the per-review cap could bind
    const capitalBefore = diner.capital!;
    const totalBefore = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(agent!.decisions()[0]!.action.invest).toBeCloseTo(want, 6);
    expect(diner.capital!).toBeCloseTo(capitalBefore + want, 6);
    expect(world.totalMoney()).toBeCloseTo(totalBefore, 6);
  });

  it("a request over `maxInvestPerReview` is clamped to the per-review cap", () => {
    const cap = DEFAULT_LIMITS.maxInvestPerReview;
    const provider = fixedActionProvider({ invest: cap * 10 });
    const { sim, world, agent } = createCity({
      seed: 1,
      brain: provider,
      agenticBusinessIds: ["biz_diner"],
    });
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = 100_000; // headroom non-binding
    const capitalBefore = diner.capital!;
    const totalBefore = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(agent!.decisions()[0]!.action.invest).toBeCloseTo(cap, 6);
    expect(diner.capital!).toBeCloseTo(capitalBefore + cap, 6);
    expect(world.totalMoney()).toBeCloseTo(totalBefore, 6);
  });

  it("an under-reserve business invests nothing (reserve floor guards solvency)", () => {
    // Drain the diner to zero so daily revenue can't lift it anywhere near
    // BUSINESS_RESERVE by the time the agent reviews — headroom is zero, the
    // invest lever skips, and capital sits unchanged regardless of the request.
    const provider = fixedActionProvider({ invest: DEFAULT_LIMITS.maxInvestPerReview });
    const { sim, world, agent } = createCity({
      seed: 1,
      brain: provider,
      agenticBusinessIds: ["biz_diner"],
    });
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = 0;
    const capitalBefore = diner.capital!;
    const totalBefore = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(diner.cash).toBeLessThan(BUSINESS_RESERVE); // confirm setup held
    expect(agent!.decisions()[0]!.action.invest ?? 0).toBe(0);
    expect(diner.capital!).toBe(capitalBefore);
    expect(world.totalMoney()).toBeCloseTo(totalBefore, 6);
  });

  it("money is conserved across a multi-day, multi-business invest run", () => {
    // The keystone invariant — even with the lever firing every day on two
    // different businesses, total money must not drift by a cent.
    const provider = fixedActionProvider({ invest: 50 });
    const { sim, world } = createCity({
      seed: 1,
      brain: provider,
      agenticBusinessIds: ["biz_diner", "biz_goods"],
    });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    expect(world.totalMoney()).toBeCloseTo(start, 4);
  });
});

/**
 * Phase 12c step 5 — end-to-end behaviour with the rules brain pulling the
 * lever. Step 4's unit tests proved the heuristic; these prove it composes
 * with the live sim: conservation holds under a long agentic soak, and the
 * reserve floor keeps even an aggressively-investing firm solvent.
 *
 * Note on the heuristic firing in the seeded city: the daily profit
 * distribution drains business cash to the reserve every day, so a default
 * city rarely *has* a cushion above 1.5x reserve at agent-review time. The
 * test below inflates cash to engineer the cushion (lasting several days at
 * the ~$900/day distribution cap), which exercises the lever in a live mix.
 * Tuning the heuristic so it fires more naturally in steady state — possibly
 * by reordering invest-before-distribute — is a 12e job.
 */
describe("Phase 12c step 5 — rules-brain invest in a live sim", () => {
  it("the keystone invariant holds: a 200-day agentic soak with cushion-driven invest conserves money to the cent", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory"],
    });
    // Inflate cushion on the storefronts so the rules brain triggers the
    // invest path through the run instead of sitting idle at reserve.
    world.getBusiness("biz_diner")!.cash = 30_000;
    world.getBusiness("biz_goods")!.cash = 30_000;

    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 200);

    expect(world.totalMoney()).toBeCloseTo(start, 3);
    // No firm bankrupted itself via the lever — the reserve floor + clamp held.
    for (const b of world.businesses) {
      expect(b.cash).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("13c reorder fires the invest lever: a capacity-bound, profitable firm reinvests (was the seeded city's blocker)", () => {
    // The Phase 13c reorder moved profit distribution to a DistributionSystem that
    // runs *after* the agent review (it used to run inside MarketSystem, before
    // it). So the agent now sees its full day's surplus when it decides, instead
    // of cash already drained to reserve. That was the blocker that pinned
    // investedDays at 0 and capital at baseline — it is gone.
    //
    // A capital-starved diner (low capital => capacity-bound, high utilization)
    // sitting on a fat cushion now ploughs surplus into equipment, and money
    // stays conserved (invest is a transfer to the factory; nothing is minted).
    const { sim, world, agent } = createCity({
      seed: 1,
      brain: "rules",
      agenticBusinessIds: ["biz_diner"],
    });
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = 50_000;
    diner.capital = 30; // capacity-bound by design (low capital -> utilization at the ceiling)
    const startCapital = diner.capital;
    const startMoney = world.totalMoney();

    sim.run(TICKS_PER_DAY * 30);

    const investedDays = agent!.decisions().filter((d) => (d.action.invest ?? 0) > 0).length;
    expect(investedDays).toBeGreaterThan(0); // the lever fires now (was locked at 0 pre-13c)
    expect(diner.capital!).toBeGreaterThan(startCapital); // capital actually deepened
    expect(world.totalMoney()).toBeCloseTo(startMoney, 3); // conservation still holds
  });

  it("the reserve floor protects solvency: a low-cash diner doesn't get invested into bankruptcy", () => {
    // Even running the rules brain for months on a diner that starts already
    // at the edge of solvency, the apply() reserve floor must hold the line —
    // cash never crosses BUSINESS_RESERVE in a way the invest lever caused.
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      agenticBusinessIds: ["biz_diner"],
    });
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = BUSINESS_RESERVE; // exactly at the floor; any cushion is daily revenue
    const totalBefore = world.totalMoney();

    sim.run(TICKS_PER_DAY * 100);

    // Conservation is still the keystone.
    expect(world.totalMoney()).toBeCloseTo(totalBefore, 3);
    // The firm survived (didn't disappear) and didn't go negative.
    expect(diner.active).toBe(true);
    expect(diner.cash).toBeGreaterThanOrEqual(-1e-6);
  });
});

/**
 * Phase 13c — the invest loop closes end-to-end. With the reorder (the agent
 * reviews before the daily dividend) and the demand keystone on, a full agentic
 * city now books real investment over a year and ends with more capital than it
 * started: the Phase 12 engine is no longer inert. (Capital-deepening is modest
 * in the current calibration — utilization structurally peaks ~0.5, so businesses
 * are never hard capacity-bound; pushing toward a true Solow engine is a later
 * capacity-calibration phase. What this pins is that the lever fires, capital
 * responds, and conservation holds.)
 */
describe("Phase 13c — the invest loop closes", () => {
  it("a sustained agentic year books investment, deepens capital, and conserves money", () => {
    const { sim, world, agent } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
    });
    const startMoney = world.totalMoney();
    const capital = () => world.businesses.reduce((s, b) => s + (b.capital ?? CAPITAL_BASELINE), 0);
    const startCapital = capital();

    sim.run(TICKS_PER_DAY * 365);

    const investedDays = agent!.decisions().filter((d) => (d.action.invest ?? 0) > 0).length;
    expect(investedDays).toBeGreaterThan(0); // the lever fired during the year (was 0 pre-13c)
    expect(capital()).toBeGreaterThan(startCapital); // capital deepened above baseline
    expect(world.totalMoney()).toBeCloseTo(startMoney, 2); // the closed economy still balances
    for (const b of world.businesses) expect(b.active).toBe(true); // nobody collapsed
  });
});
