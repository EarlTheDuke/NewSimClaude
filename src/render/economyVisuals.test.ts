import { describe, it, expect } from "vitest";
import { prosperityT, fillFraction, GLOW_FULL_CAPITAL, FILL_FULL_INVENTORY } from "./economyVisuals";

describe("economyVisuals (R3 economic→visual mappings)", () => {
  describe("prosperityT", () => {
    it("is 0 at or below baseline and 1 once capital is GLOW_FULL above it", () => {
      expect(prosperityT(100, 100)).toBe(0);
      expect(prosperityT(50, 100)).toBe(0); // below baseline clamps to 0
      expect(prosperityT(100 + GLOW_FULL_CAPITAL, 100)).toBe(1);
      expect(prosperityT(100 + GLOW_FULL_CAPITAL * 2, 100)).toBe(1); // saturates
    });

    it("rises monotonically through the band", () => {
      const mid = prosperityT(100 + GLOW_FULL_CAPITAL / 2, 100);
      expect(mid).toBeCloseTo(0.5, 6);
      expect(prosperityT(100 + GLOW_FULL_CAPITAL * 0.25, 100)).toBeLessThan(mid);
    });
  });

  describe("fillFraction", () => {
    it("clamps to [0,1] and is full at the reference cap", () => {
      expect(fillFraction(0, FILL_FULL_INVENTORY)).toBe(0);
      expect(fillFraction(FILL_FULL_INVENTORY / 2, FILL_FULL_INVENTORY)).toBeCloseTo(0.5, 6);
      expect(fillFraction(FILL_FULL_INVENTORY, FILL_FULL_INVENTORY)).toBe(1);
      expect(fillFraction(FILL_FULL_INVENTORY * 3, FILL_FULL_INVENTORY)).toBe(1);
    });

    it("is 0 for a non-positive cap", () => {
      expect(fillFraction(50, 0)).toBe(0);
    });
  });
});
