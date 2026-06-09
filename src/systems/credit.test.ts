import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

/**
 * Initiative C / Phase 18a — the inert credit seam. The CreditSystem is registered (between
 * distribution and lifecycle) but does nothing: no Bank is seeded, no debt is booked, no money
 * moves. The default city must be byte-identical, and even with `creditEnabled` on the 18a stub is
 * still a true no-op. Re-grounded against the post-4d code: no BusinessKind/record change here — the
 * bank arrives as a registry entry with a role flag in 18b.
 */
describe("CreditSystem — inert seam (Phase 18a)", () => {
  it("the default city carries no debt and conserves money over 30 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    for (const b of world.businesses) {
      expect("debt" in b).toBe(false); // never booked
      expect(b.pnl.debtService).toBeUndefined();
    }
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("round-trips: serialize → restore deep-equals (CreditSystem is stateless)", () => {
    const original = createCity({ seed: 1 });
    original.sim.run(TICKS_PER_DAY * 20);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 99 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });

  it("is deterministic with creditEnabled set: seed 7 twice → identical world", () => {
    const run = () => {
      const c = createCity({ seed: 7, creditEnabled: true }); // enabled, but the 18a stub does nothing
      c.sim.run(TICKS_PER_DAY * 20);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });

  it("creditEnabled:true is byte-identical to off in 18a (the stub is a true no-op)", () => {
    const off = createCity({ seed: 1 });
    off.sim.run(TICKS_PER_DAY * 20);
    const on = createCity({ seed: 1, creditEnabled: true });
    on.sim.run(TICKS_PER_DAY * 20);
    expect(on.world.serialize()).toEqual(off.world.serialize());
  });
});
