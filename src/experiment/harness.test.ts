import { describe, it, expect } from "vitest";
import {
  runTrial,
  runExperiment,
  compareExperiments,
  formatComparison,
  type ExperimentConfig,
} from "./harness";

describe("experiment harness (Phase 7)", () => {
  describe("runTrial", () => {
    it("days=0 is a no-op read: money unchanged, all businesses alive, no disasters", () => {
      const t = runTrial({ seed: 99, disasters: false }, 0);
      expect(t.seed).toBe(99);
      expect(t.days).toBe(0);
      expect(t.finalMoney).toBe(t.startMoney);
      expect(t.moneyDelta).toBe(0);
      expect(t.bankruptcies).toBe(0);
      expect(t.activeBusinesses).toBeGreaterThan(0);
      expect(t.disasters).toBe(0);
    });

    it("conserves money over a long disaster-free run", () => {
      const t = runTrial({ seed: 5 }, 80);
      expect(t.moneyDelta).toBeCloseTo(0, 4);
      expect(t.disasters).toBe(0);
    });

    it("conserves money even with disasters firing every day", () => {
      const t = runTrial({ seed: 5, disasters: { dailyChance: 1, kinds: ["fire"] } }, 40);
      expect(t.moneyDelta).toBeCloseTo(0, 4);
      expect(t.disasters).toBeGreaterThan(0);
    });
  });

  describe("runExperiment", () => {
    const config: ExperimentConfig = {
      label: "baseline",
      options: { disasters: { dailyChance: 1, kinds: ["fire"] } },
      days: 40,
    };

    it("is deterministic: identical config + seeds -> identical result", () => {
      const a = runExperiment(config, [1, 2, 3]);
      const b = runExperiment(config, [1, 2, 3]);
      expect(a).toEqual(b);
    });

    it("runs one trial per seed and stamps each with its seed", () => {
      const r = runExperiment(config, [7, 8, 9]);
      expect(r.trials.map((t) => t.seed)).toEqual([7, 8, 9]);
      expect(r.days).toBe(40);
    });

    it("aggregates mean within [min, max] for every metric", () => {
      const r = runExperiment(config, [1, 2, 3, 4]);
      for (const stat of Object.values(r.aggregate)) {
        expect(stat.min).toBeLessThanOrEqual(stat.mean);
        expect(stat.mean).toBeLessThanOrEqual(stat.max);
      }
    });

    it("with a single seed, min == mean == max == that trial's value", () => {
      const r = runExperiment(config, [3]);
      const only = r.trials[0]!;
      expect(r.aggregate.finalMoney).toEqual({
        mean: only.finalMoney,
        min: only.finalMoney,
        max: only.finalMoney,
      });
    });

    it("throws when given no seeds", () => {
      expect(() => runExperiment(config, [])).toThrow(/seed/);
    });
  });

  describe("compareExperiments (A/B over shared seeds)", () => {
    const seeds = [1, 2, 3];
    const configs: ExperimentConfig[] = [
      { label: "disasters off", options: { disasters: false }, days: 40 },
      { label: "disasters on", options: { disasters: { dailyChance: 1, kinds: ["fire"] } }, days: 40 },
    ];

    it("isolates the config as the only cause of difference", () => {
      const [off, on] = compareExperiments(configs, seeds);

      // The off arm never records a disaster; the on arm always does.
      expect(off!.aggregate.disasters.mean).toBe(0);
      expect(on!.aggregate.disasters.mean).toBeGreaterThan(0);

      // Both arms keep the closed economy closed.
      for (const t of [...off!.trials, ...on!.trials]) {
        expect(t.moneyDelta).toBeCloseTo(0, 4);
      }

      // Same shared seeds drive both arms.
      expect(off!.trials.map((t) => t.seed)).toEqual(seeds);
      expect(on!.trials.map((t) => t.seed)).toEqual(seeds);
    });

    it("formatComparison renders a labelled table of every metric", () => {
      const results = compareExperiments(configs, seeds);
      const table = formatComparison(results);
      expect(table).toContain("disasters off");
      expect(table).toContain("disasters on");
      expect(table).toContain("finalMoney");
      expect(table).toContain("bankruptcies");
      expect(table).toContain(`seeds: ${seeds.length}`);
    });

    it("formatComparison handles the empty case", () => {
      expect(formatComparison([])).toBe("(no experiments)");
    });
  });
});
