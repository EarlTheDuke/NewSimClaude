import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

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
