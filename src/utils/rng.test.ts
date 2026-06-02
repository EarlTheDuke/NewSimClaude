import { describe, it, expect } from "vitest";
import { SeededRNG } from "./rng";

describe("SeededRNG", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = new SeededRNG(12345);
    const b = new SeededRNG(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new SeededRNG(1);
    const b = new SeededRNG(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("returns floats in [0, 1)", () => {
    const rng = new SeededRNG(99);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() stays within [min, max)", () => {
    const rng = new SeededRNG(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("range() stays within [min, max)", () => {
    const rng = new SeededRNG(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it("pick() throws on empty array", () => {
    const rng = new SeededRNG(1);
    expect(() => rng.pick([])).toThrow();
  });

  it("save/restore state resumes the exact sequence", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 50; i++) rng.next();
    const saved = rng.getState();
    const expected = Array.from({ length: 25 }, () => rng.next());

    const resumed = new SeededRNG(0);
    resumed.setState(saved);
    const actual = Array.from({ length: 25 }, () => resumed.next());

    expect(actual).toEqual(expected);
  });

  it("bool(p) respects probability bounds at extremes", () => {
    const rng = new SeededRNG(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.bool(0)).toBe(false);
      expect(rng.bool(1)).toBe(true);
    }
  });
});
