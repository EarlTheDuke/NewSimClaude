import { describe, it, expect } from "vitest";
import { ambient, windowGlow, windowGlowSharp, skyColor, dim, dimInt, hexToRgb, NIGHT_AMBIENT, type Rgb } from "./daynight";

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

  describe("dimInt (Pixi tint parity)", () => {
    const unpack = (n: number): Rgb => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const parseDim = (s: string): Rgb => {
      const m = s.match(/rgb\((\d+), (\d+), (\d+)\)/)!;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };

    it("packs exactly the channels dim() rounds — so a white object tinted by it matches the canvas", () => {
      const samples: Rgb[] = [
        [200, 100, 50],
        [43, 47, 58], // ROAD_RGB
        [31, 74, 122], // a building base
        [174, 180, 189], // LABEL_RGB
        [255, 255, 255],
      ];
      for (const rgb of samples) {
        for (const f of [0, 0.5, NIGHT_AMBIENT, ambient(0), ambient(12), 0.7, 1]) {
          expect(unpack(dimInt(rgb, f))).toEqual(parseDim(dim(rgb, f)));
        }
      }
    });

    it("is black at factor 0, the packed original at 1, and clamps out-of-range", () => {
      expect(dimInt([200, 100, 50], 0)).toBe(0x000000);
      expect(dimInt([200, 100, 50], 1)).toBe((200 << 16) | (100 << 8) | 50);
      expect(dimInt([10, 20, 30], -5)).toBe(0);
      expect(dimInt([10, 20, 30], 5)).toBe((10 << 16) | (20 << 8) | 30);
    });
  });

  describe("hexToRgb", () => {
    it("round-trips channel values", () => {
      expect(hexToRgb("#11131a")).toEqual([17, 19, 26]);
      expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    });
  });

  describe("windowGlowSharp (R3-1 — the home-window evening curve)", () => {
    it("is OFF through the working day and ON through the night", () => {
      for (const h of [8, 10, 12, 14, 16, 17]) expect(windowGlowSharp(h)).toBe(0);
      for (const h of [19.5, 20, 22, 0, 3, 5, 5.4]) expect(windowGlowSharp(h)).toBe(1);
    });

    it("ramps monotonically through the coming-home hours and is strong by 19:00", () => {
      expect(windowGlowSharp(17)).toBe(0);
      const seven = windowGlowSharp(19);
      expect(seven).toBeGreaterThan(0.85); // the fix: near-full when families come home (old curve: ~0.55)
      expect(windowGlowSharp(18)).toBeGreaterThan(windowGlowSharp(17.5));
      expect(seven).toBeGreaterThan(windowGlowSharp(18));
      expect(windowGlowSharp(19.5)).toBe(1);
    });

    it("fades across dawn and wraps any hour like its siblings", () => {
      expect(windowGlowSharp(5.5)).toBeCloseTo(1, 6);
      expect(windowGlowSharp(6.25)).toBeGreaterThan(0);
      expect(windowGlowSharp(6.25)).toBeLessThan(1);
      expect(windowGlowSharp(7)).toBe(0);
      expect(windowGlowSharp(24 + 20)).toBe(1); // 20:00, wrapped
      expect(windowGlowSharp(-2)).toBe(1); // 22:00, wrapped
    });
  });
});
