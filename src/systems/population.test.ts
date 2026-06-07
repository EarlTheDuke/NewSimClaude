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

describe("PopulationSystem growth trigger (HP3-5)", () => {
  const homeCapacity = (world: ReturnType<typeof createCity>["world"]) =>
    world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0);

  it("a prosperous town grows to fill its housing, then plateaus at the cap", () => {
    // prosperityFloor 0 => the wealth gate is always open, isolating the growth loop.
    const { sim, world } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { prosperityFloor: 0 },
    });
    const start = world.totalMoney();
    const cap = homeCapacity(world); // 18 for the default town

    sim.run(TICKS_PER_DAY * 200);
    expect(world.residents.length).toBe(cap); // grew to the housing ceiling
    expect(cap).toBeGreaterThan(12);

    // No home was ever pushed past its capacity.
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }

    // Plateau: another full year admits no one (housing is the hard ceiling -> HP4),
    // and the closed economy still balances despite a 50% bigger population.
    sim.run(TICKS_PER_DAY * 365);
    expect(world.residents.length).toBe(cap);
    expect(world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("seats a newcomer into a short-staffed producer (the headline win)", () => {
    // residentCount 11 leaves the factory one seat short, with nobody jobless.
    const { sim, world } = createCity({
      seed: 1,
      residentCount: 11,
      populationGrowth: true,
      populationOptions: { prosperityFloor: 0 },
    });
    expect(world.getBusiness("biz_factory")!.employeeIds.length).toBe(1); // short at seed

    sim.run(TICKS_PER_DAY * 200);

    // The newcomer took the open seat, so the producer is fully crewed (=> full
    // output): growth is productive, not just more mouths. Every producer crewed.
    for (const id of ["biz_farm", "biz_mine", "biz_bakery", "biz_factory"]) {
      expect(world.getBusiness(id)!.employeeIds.length).toBe(2);
    }
  });

  it("growth is deterministic and money-conserving", () => {
    const opts = { seed: 4, populationGrowth: true, populationOptions: { prosperityFloor: 0 } };
    const a = createCity(opts);
    const b = createCity(opts);
    const start = a.world.totalMoney();
    a.sim.run(TICKS_PER_DAY * 150);
    b.sim.run(TICKS_PER_DAY * 150);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.world.residents.length).toBeGreaterThan(12); // it actually grew
    expect(a.world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("the real (agentic) economy grows to capacity on the live default floor and stays healthy", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      populationGrowth: true,
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
    });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 365 * 2);

    expect(world.residents.length).toBe(homeCapacity(world)); // reaches the cap on the real economy
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
    // Healthy: the supply chain survives the bigger population, money is conserved,
    // and nobody is in the red.
    expect(new Set(world.businesses.filter((b) => b.active).map((b) => b.kind)).size).toBeGreaterThanOrEqual(4);
    expect(world.totalMoney()).toBeCloseTo(start, 2);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});
