import { describe, it, expect } from "vitest";
import { brandFactor } from "./EconomySystem";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

/**
 * Phase 17 — the brand-equity lever (demand-side twin of capital). 17a ships the
 * inert seam: the stock fields, the constants (elasticity 0), the pure `brandFactor`,
 * and the decay block. With the master knob at 0 and the field never seeded, the whole
 * thing is a byte-identical no-op — that is what these tests pin.
 */
describe("Phase 17a — brand seam (inert)", () => {
  it("brandFactor is the hard OFF switch at elasticity 0 (even at huge brand)", () => {
    expect(brandFactor({ brand: 9e9 }, 0)).toBe(1);
    expect(brandFactor({ brand: undefined }, 0)).toBe(1);
    expect(brandFactor({ brand: 0 }, 0)).toBe(1);
  });

  it("brandFactor is unbounded by design — the clamp lives at the call site (Hook A)", () => {
    // (9e9 / 100) ^ 0.3 ≈ 240; pinned as intentional so a careless future caller
    // can't be surprised by an unclamped lift.
    expect(brandFactor({ brand: 9e9 }, 0.3)).toBeGreaterThan(200);
    expect(brandFactor({ brand: 100 }, 0.3)).toBe(1); // exactly 1 at baseline
    expect(brandFactor({ brand: 200 }, 0.3)).toBeCloseTo(Math.pow(2, 0.3), 6); // diminishing returns
    expect(brandFactor({ brand: undefined }, 0.3)).toBe(1); // absent reads as baseline
  });

  it("brand/brandSpent are NEVER seeded — absent on every firm across a brain-off run", () => {
    // The byte-identity guarantee: the field must be genuinely absent so a snapshot
    // (structuredClone) never emits it and a pre-17 save resumes identically.
    const { sim, world } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 30);
    for (const b of world.businesses) {
      expect("brand" in b).toBe(false);
      expect("brandSpent" in b).toBe(false);
    }
  });
});
