import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { occupantsByHome } from "../world/housing";

const THIRTY_DAYS = TICKS_PER_DAY * 30;

describe("PopulationSystem (HP3-1, inert seam)", () => {
  it("createCity exposes the population handle", () => {
    const { population } = createCity({ seed: 1 });
    expect(population).toBeDefined();
    expect(population.id).toBe("population");
  });

  it("with growth off (default), population stays fixed and money is conserved", () => {
    const { sim, world } = createCity({ seed: 1 });
    const startMoney = world.totalMoney();
    const startCount = world.residents.length;
    sim.run(THIRTY_DAYS);
    expect(world.residents).toHaveLength(startCount);
    expect(world.totalMoney()).toBeCloseTo(startMoney, 6);
  });

  it("is byte-identical (off): two same-seed 30-day runs serialize-equal", () => {
    const a = createCity({ seed: 7 });
    const b = createCity({ seed: 7 });
    a.sim.run(THIRTY_DAYS);
    b.sim.run(THIRTY_DAYS);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.sim.serialize()).toEqual(b.sim.serialize());
  });

  it("the disabled system rides the snapshot and round-trips through save/reload", () => {
    const original = createCity({ seed: 42 });
    original.sim.run(TICKS_PER_DAY * 3 + 50);

    const snap = original.sim.serialize();
    expect(snap.systems).toHaveProperty("population");

    const json = snapshotToJSON(snap);
    const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());

    // Continuing both stays in lockstep.
    original.sim.run(TICKS_PER_DAY);
    loaded.sim.run(TICKS_PER_DAY);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });
});

describe("PopulationSystem spawn primitive (HP3-4)", () => {
  it("admits a $0 jobless migrant with a finite numeric id, conserving money", () => {
    const { world, population } = createCity({ seed: 1, populationGrowth: true });
    const before = world.totalMoney();
    const beforeCount = world.residents.length;

    const r = population.spawnMigrant();
    expect(r).toBeDefined();
    // Continues the numeric namespace (12 seeded -> res_12), so the id parses to a
    // finite index everywhere (the NaN-id break the design panel flagged is gone).
    expect(r!.id).toBe("res_12");
    expect(Number.isFinite(Number(r!.id.split("_")[1]))).toBe(true);
    expect(r!.origin).toBe("migrant");
    expect(r!.money).toBe(0);
    expect(r!.jobId).toBe("");
    expect(world.getLocation(r!.homeId).type).toBe("home");
    expect(r!.needs).toEqual({ hunger: 80, energy: 85, social: 70 });

    expect(world.residents).toHaveLength(beforeCount + 1);
    expect(world.getResident("res_12")).toBe(r); // visible after reindex
    expect(world.totalMoney()).toBeCloseTo(before, 6); // $0 entry mints nothing
  });

  it("a migrant is a fully-functional resident: finite demand, eats, conserves money (no NaN)", () => {
    const { sim, world, population } = createCity({ seed: 1, populationGrowth: true });
    const r = population.spawnMigrant()!;
    // Fund it from a business (a transfer, so money stays conserved) and let it live.
    world.transfer("biz_landlord", r.id, 500);
    const startMoney = world.totalMoney();
    sim.run(TICKS_PER_DAY * 5);

    // The decisive NaN-id guard: a `res_mig1`-style id makes consumptionUnits NaN,
    // and the meal transfer then poisons the balance to NaN. res_12 parses to a
    // finite index, so money (and every need) stays finite and in-bounds.
    expect(Number.isFinite(r.money)).toBe(true);
    expect(r.money).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(r.needs)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // It actually eats — hunger doesn't crash to starvation over 5 days (it visits
    // the diner like any resident), which it couldn't if demand computed to NaN/zero.
    expect(r.needs.hunger).toBeGreaterThan(20);
    // And it participated in the economy (spent on meals/goods and/or drew the
    // recirculated dividend) rather than sitting frozen at the funded amount.
    expect(r.money).not.toBe(500);
    expect(world.totalMoney()).toBeCloseTo(startMoney, 6);
  });

  it("returns undefined when every home is full (housing is the hard gate)", () => {
    const { world, population } = createCity({ seed: 1, populationGrowth: true });
    let spawned = 0;
    while (population.spawnMigrant()) spawned++;
    expect(spawned).toBeGreaterThan(0); // HP1 seeded slack to grow into

    // Town is now full: every home at capacity, the next admission refused.
    expect(population.spawnMigrant()).toBeUndefined();
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBe(l.capacity ?? 99);
    }
  });

  it("is deterministic: two same-seed spawns yield identical worlds", () => {
    const a = createCity({ seed: 5, populationGrowth: true });
    const b = createCity({ seed: 5, populationGrowth: true });
    a.population.spawnMigrant();
    b.population.spawnMigrant();
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});
