import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { CAPITAL_BASELINE } from "./constants";
import type { BusinessObservation, DecisionProvider } from "../ai/types";

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
