/**
 * Seeded, deterministic pseudo-random number generator (mulberry32).
 *
 * Determinism is a core project principle: identical seed -> identical run.
 * The full generator state is a single uint32, so it serializes trivially as
 * part of the simulation snapshot and a run can be resumed bit-for-bit.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let a = (this.state + 0x6d2b79f5) | 0;
    this.state = a >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  /** True with probability p (default 0.5). */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Uniformly pick an element. Throws on empty arrays. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("SeededRNG.pick: cannot pick from an empty array");
    }
    return items[this.int(0, items.length)]!;
  }

  /** Current internal state — include this in snapshots. */
  getState(): number {
    return this.state;
  }

  /** Restore a previously captured state. */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}
