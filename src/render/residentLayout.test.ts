import { describe, it, expect } from "vitest";
import { fanOutOffset } from "./residentLayout";

const dist = (o: { dx: number; dy: number }) => Math.hypot(o.dx, o.dy);

describe("fanOutOffset (co-located resident fan-out)", () => {
  it("gives no offset to a lone resident (byte-identical to stacking)", () => {
    expect(fanOutOffset(0, 1)).toEqual({ dx: 0, dy: 0 });
    expect(fanOutOffset(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("places a pair on opposite sides of the ring", () => {
    const a = fanOutOffset(0, 2);
    const b = fanOutOffset(1, 2);
    expect(dist(a)).toBeCloseTo(7, 6);
    expect(dist(b)).toBeCloseTo(7, 6);
    // opposite points: their midpoint is the node centre.
    expect(a.dx + b.dx).toBeCloseTo(0, 6);
    expect(a.dy + b.dy).toBeCloseTo(0, 6);
  });

  it("spreads every member onto a common ring with distinct positions", () => {
    const n = 4;
    const pts = Array.from({ length: n }, (_, i) => fanOutOffset(i, n));
    const r = dist(pts[0]!);
    for (const p of pts) expect(dist(p)).toBeCloseTo(r, 6); // same radius
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        expect(Math.hypot(pts[i]!.dx - pts[j]!.dx, pts[i]!.dy - pts[j]!.dy)).toBeGreaterThan(1); // distinct
  });

  it("grows the ring radius as the crowd grows (so dots don't overlap)", () => {
    expect(dist(fanOutOffset(0, 12))).toBeGreaterThan(dist(fanOutOffset(0, 3)));
  });
});
