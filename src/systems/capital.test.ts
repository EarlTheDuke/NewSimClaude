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
    // No system reads or writes capital yet, so every business must still sit at
    // exactly the baseline — a regression guard that 12a stayed a pure no-op.
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
