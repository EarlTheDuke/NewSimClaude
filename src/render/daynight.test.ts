import { describe, it, expect } from "vitest";
import { ambient, windowGlow, skyColor, dim, hexToRgb, NIGHT_AMBIENT } from "./daynight";

const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe("daynight palette (Phase 5)", () => {
  describe("ambient", () => {
    it("is darkest at midnight and full at noon", () => {
      expect(ambient(0)).toBeCloseTo(NIGHT_AMBIENT, 6);
      expect(ambient(12)).toBeCloseTo(1, 6);
    });

    it("stays within [NIGHT_AMBIENT, 1] across the whole day", () => {
      for (let h = 0; h <= 24; h += 0.25) {
        const a = ambient(h);
        expect(a).toBeGreaterThanOrEqual(NIGHT_AMBIENT - 1e-9);
        expect(a).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it("rises monotonically from midnight to noon, then falls to midnight", () => {
      for (let h = 1; h <= 12; h++) expect(ambient(h)).toBeGreaterThanOrEqual(ambient(h - 1));
      for (let h = 13; h <= 24; h++) expect(ambient(h)).toBeLessThanOrEqual(ambient(h - 1));
    });

    it("wraps continuously: hour 24 equals hour 0", () => {
      expect(ambient(24)).toBeCloseTo(ambient(0), 9);
    });
  });

  describe("windowGlow", () => {
    it("is full at midnight and off at noon", () => {
      expect(windowGlow(0)).toBeCloseTo(1, 6);
      expect(windowGlow(12)).toBeCloseTo(0, 6);
    });

    it("stays within [0, 1]", () => {
      for (let h = 0; h <= 24; h += 0.5) {
        expect(windowGlow(h)).toBeGreaterThanOrEqual(-1e-9);
        expect(windowGlow(h)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  });

  describe("skyColor", () => {
    it("always returns a valid #rrggbb string", () => {
      for (let h = 0; h <= 24; h += 0.3) {
        expect(skyColor(h)).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it("is brighter at noon than at midnight", () => {
      expect(luminance(skyColor(12))).toBeGreaterThan(luminance(skyColor(0)));
    });

    it("carries a warm tint at dusk (more red-over-blue than noon)", () => {
      const redBias = (hex: string) => {
        const [r, , b] = hexToRgb(hex);
        return r - b;
      };
      expect(redBias(skyColor(18))).toBeGreaterThan(redBias(skyColor(12)));
    });

    it("wraps continuously: hour 24 equals hour 0", () => {
      expect(skyColor(24)).toBe(skyColor(0));
    });
  });

  describe("dim", () => {
    it("returns black at factor 0 and the original at factor 1", () => {
      expect(dim([200, 100, 50], 0)).toBe("rgb(0, 0, 0)");
      expect(dim([200, 100, 50], 1)).toBe("rgb(200, 100, 50)");
    });

    it("clamps factors outside [0, 1]", () => {
      expect(dim([10, 20, 30], -5)).toBe("rgb(0, 0, 0)");
      expect(dim([10, 20, 30], 5)).toBe("rgb(10, 20, 30)");
    });
  });

  describe("hexToRgb", () => {
    it("round-trips channel values", () => {
      expect(hexToRgb("#11131a")).toEqual([17, 19, 26]);
      expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    });
  });
});
