import { describe, it, expect } from "vitest";
import {
  runCeoBenchmark,
  runCeoBenchmarkAsync,
  compareCeoBrains,
  formatCeoScorecard,
} from "./ceoBench";
import { BENCH_START_CAPITAL, BENCH_TURNS } from "../systems/constants";

const SEED = 9;

describe("CEO benchmark (Phase 10d)", () => {
  describe("scorecard shape & invariants", () => {
    it("stamps the run with its brain, seed, horizon, and starting capital", () => {
      const r = runCeoBenchmark({ seed: SEED, brain: "rules" });
      expect(r.brainId).toBe("rules");
      expect(r.seed).toBe(SEED);
      expect(r.turns).toBe(BENCH_TURNS);
      expect(r.startCapital).toBe(BENCH_START_CAPITAL);
    });

    it("opens at net worth >= the recapitalized cash (cash + opening inventory)", () => {
      const r = runCeoBenchmark({ seed: SEED, brain: "rules" });
      expect(r.startNetWorth).toBeGreaterThanOrEqual(BENCH_START_CAPITAL);
    });

    it("net worth is exactly cash plus marked-to-ask inventory; profit is the delta from open", () => {
      for (const brain of ["off", "rules"] as const) {
        const r = runCeoBenchmark({ seed: SEED, brain });
        expect(r.finalCash).toBeGreaterThanOrEqual(0);
        expect(r.finalInventory).toBeGreaterThanOrEqual(0);
        expect(r.finalInventoryValue).toBeGreaterThanOrEqual(0);
        expect(r.finalNetWorth).toBeCloseTo(r.finalCash + r.finalInventoryValue, 6);
        expect(r.profit).toBeCloseTo(r.finalNetWorth - r.startNetWorth, 6);
      }
    });
  });

  describe("money conservation (the sacred invariant)", () => {
    it("neither baseline mints nor burns a dollar across the run", () => {
      for (const brain of ["off", "rules"] as const) {
        const r = runCeoBenchmark({ seed: SEED, brain });
        expect(r.moneyConserved).toBe(true);
        expect(r.moneyDelta).toBeCloseTo(0, 4);
      }
    });
  });

  describe("survival & decision accounting", () => {
    it("both baselines survive the 42-turn horizon (still trading)", () => {
      expect(runCeoBenchmark({ seed: SEED, brain: "off" }).survived).toBe(true);
      expect(runCeoBenchmark({ seed: SEED, brain: "rules" }).survived).toBe(true);
    });

    it("the no-op baseline takes zero decisions; the rules CEO reviews every turn without falling back", () => {
      const off = runCeoBenchmark({ seed: SEED, brain: "off" });
      expect(off.decisions).toBe(0);
      expect(off.fellBack).toBe(0);

      const rules = runCeoBenchmark({ seed: SEED, brain: "rules" });
      expect(rules.decisions).toBe(BENCH_TURNS);
      expect(rules.fellBack).toBe(0);
    });
  });

  describe("determinism", () => {
    it("a sync brain yields the identical scorecard for a given seed (a clean A/B)", () => {
      const a = runCeoBenchmark({ seed: SEED, brain: "rules" });
      const b = runCeoBenchmark({ seed: SEED, brain: "rules" });
      expect(a).toEqual(b);
    });
  });

  describe("skill discriminates", () => {
    it("the rules CEO outperforms the no-op baseline on final net worth", () => {
      const [off, rules] = compareCeoBrains(SEED, ["off", "rules"]);
      expect(rules!.finalNetWorth).toBeGreaterThan(off!.finalNetWorth);
    });
  });

  describe("async runner matches the sync one for a sync brain (no network)", () => {
    it("turn-stepping + settle() drains to the identical scorecard", async () => {
      const viaSync = runCeoBenchmark({ seed: SEED, brain: "rules" });
      const viaAsync = await runCeoBenchmarkAsync({ seed: SEED, brain: "rules" });
      expect(viaAsync).toEqual(viaSync);
    });
  });

  describe("formatCeoScorecard", () => {
    it("renders a titled column per brain", () => {
      const card = formatCeoScorecard(compareCeoBrains(SEED, ["off", "rules"]));
      expect(card).toContain("CEO BENCHMARK");
      expect(card).toContain(`seed ${SEED}`);
      expect(card).toContain("FINAL NET WORTH");
      expect(card).toContain("off");
      expect(card).toContain("rules");
    });

    it("handles the empty case", () => {
      expect(formatCeoScorecard([])).toBe("(no CEO runs)");
    });
  });
});
