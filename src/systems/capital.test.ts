import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { CAPITAL_BASELINE } from "./constants";

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
