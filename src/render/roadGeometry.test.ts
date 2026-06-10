import { describe, it, expect } from "vitest";
import { rightOf, dashes, LANE_OFFSET, PATH_OFFSET, ROAD_WIDTH } from "./roadGeometry";

describe("roadGeometry (R3-2/R3-3)", () => {
  describe("rightOf", () => {
    it("points right of travel in screen coords (y down)", () => {
      // Heading east (+x): right of travel is DOWN the screen (+y).
      const east = rightOf(1, 0);
      expect(east.x).toBeCloseTo(0, 9);
      expect(east.y).toBeCloseTo(1, 9);
      // Heading west (−x): right of travel is UP the screen (−y).
      const west = rightOf(-1, 0);
      expect(west.x).toBeCloseTo(0, 9);
      expect(west.y).toBeCloseTo(-1, 9);
      // Heading south (+y, down-screen): right of travel is −x.
      const south = rightOf(0, 1);
      expect(south.x).toBeCloseTo(-1, 9);
      expect(south.y).toBeCloseTo(0, 9);
    });

    it("normalizes any magnitude and is safe on a zero heading", () => {
      const r = rightOf(0, 250);
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 9);
      expect(rightOf(0, 0)).toEqual({ x: 0, y: 0 });
    });

    it("two cars passing each other sit in different lanes (opposite offsets)", () => {
      const east = rightOf(1, 0);
      const west = rightOf(-1, 0);
      expect(east.y * LANE_OFFSET + west.y * LANE_OFFSET).toBeCloseTo(0, 9); // mirrored
      expect(east.y).not.toBeCloseTo(west.y, 9); // genuinely apart
    });
  });

  describe("dashes", () => {
    it("covers the segment with on/off runs and clips the last dash to the end", () => {
      const d = dashes(0, 0, 100, 0, 6, 8);
      expect(d.length).toBe(Math.ceil(100 / 14));
      for (const seg of d) {
        expect(seg.x2).toBeGreaterThan(seg.x1);
        expect(seg.x2).toBeLessThanOrEqual(100 + 1e-9);
        expect(seg.x2 - seg.x1).toBeLessThanOrEqual(6 + 1e-9);
      }
    });

    it("handles diagonal segments and degenerate inputs", () => {
      const d = dashes(0, 0, 30, 40, 5, 5); // length 50
      expect(d.length).toBe(5);
      const last = d[d.length - 1]!;
      expect(Math.hypot(last.x2, last.y2)).toBeLessThanOrEqual(50 + 1e-9);
      expect(dashes(5, 5, 5, 5, 6, 8)).toEqual([]);
      expect(dashes(0, 0, 10, 0, 0, 8)).toEqual([]);
    });
  });

  it("the layout constants nest: lane inside the asphalt, footpath outside it", () => {
    expect(LANE_OFFSET).toBeLessThan(ROAD_WIDTH / 2);
    expect(PATH_OFFSET).toBeGreaterThan(ROAD_WIDTH / 2);
  });
});
