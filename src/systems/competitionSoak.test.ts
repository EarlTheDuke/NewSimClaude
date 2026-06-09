import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

/**
 * Initiative B slice 3 — competitive churn (ties A ↔ B). The whole free-market program engaged at
 * once: free wages + welfare (Initiative #1), producer competition + the wage war (B1+B2), business
 * entry + new rivals (A), population growth, and both brains. The loop under test is *enter →
 * compete → win or die → re-enter*. This soak locks that the full stack holds every invariant —
 * money conserved, nobody underwater, no NaN, the economy still alive and producing — across years
 * of competition and churn.
 */
const AGENTIC_BIZ = ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"];

function competitiveCity(seed: number) {
  return createCity({
    seed,
    brain: "rules",
    residentBrain: "rules",
    agenticBusinessIds: AGENTIC_BIZ,
    agenticResidentIds: "all", // every worker an agent ⇒ they actually move to the better-paying winner
    disasters: true,
    // The full free-market + competition + creation stack, all engaged at once:
    wageCapMult: 8, // Initiative #1 S1 — free the wage
    welfareRatio: 0.5, // S2 — the one control
    welfareSubsistence: 2,
    dividendWean: 0.5, // S3 — half-weaned dividend
    producerCompetition: 2, // B1 — efficient suppliers win share
    labourCompetition: true, // B2 — the wage war + truce
    opportunityEntry: true, // A — busy niches draw rivals
    populationGrowth: true,
    populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
  });
}

function assertHealthy(world: ReturnType<typeof competitiveCity>["world"], start: number) {
  expect(world.totalMoney()).toBeCloseTo(start, 2); // closed economy held through competition + churn
  for (const r of world.residents) {
    expect(Number.isFinite(r.money)).toBe(true);
    expect(r.money).toBeGreaterThanOrEqual(0);
    for (const [need, v] of Object.entries(r.needs)) {
      expect(Number.isFinite(v), `${r.id} ${need} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }
  for (const b of world.businesses) {
    expect(Number.isFinite(b.cash), `${b.id} cash finite`).toBe(true);
    expect(b.cash).toBeGreaterThanOrEqual(0); // never drives a holder underwater
  }
  // Still a living, competitive city — a spread of kinds still served, still producing.
  const activeKinds = new Set(world.businesses.filter((b) => b.active).map((b) => b.kind));
  expect(activeKinds.size).toBeGreaterThanOrEqual(4);
}

describe("Initiative B slice 3 — competitive-economy soak (the whole free-market program)", () => {
  it(
    "holds every invariant across 3 years of competition + churn, on seeds 1 & 7",
    () => {
      for (const seed of [1, 7]) {
        const { sim, world, macro } = competitiveCity(seed);
        const start = world.totalMoney();
        sim.run(TICKS_PER_DAY * 365 * 3);

        expect(sim.time.time().day).toBe(365 * 3);
        assertHealthy(world, start);
        expect(macro.latest()?.gdp ?? 0).toBeGreaterThan(0); // still producing on the final day
        // Creative destruction fired: entry founded firms beyond the seeded seven (rivals + new
        // industries), so the economy genuinely churned/expanded rather than sitting frozen.
        expect(world.businesses.length).toBeGreaterThan(7);
      }
    },
    180_000,
  );

  it(
    "is deterministic across a full year of the competitive economy (seed 1)",
    () => {
      const run = () => {
        const c = competitiveCity(1);
        c.sim.run(TICKS_PER_DAY * 365);
        return c.world.serialize();
      };
      expect(run()).toEqual(run());
    },
    120_000,
  );

  it(
    "round-trips mid-run — save then reload reproduces the competitive economy exactly",
    () => {
      const original = competitiveCity(1);
      original.sim.run(TICKS_PER_DAY * 200);
      const json = snapshotToJSON(original.sim.serialize());

      const loaded = competitiveCity(99); // different seed; restore overwrites
      loaded.sim.restore(snapshotFromJSON(json));
      expect(loaded.world.serialize()).toEqual(original.world.serialize());

      // And they stay in lockstep when run on — the whole competitive stack is snapshot-complete.
      original.sim.run(TICKS_PER_DAY * 30);
      loaded.sim.run(TICKS_PER_DAY * 30);
      expect(loaded.world.serialize()).toEqual(original.world.serialize());
    },
    120_000,
  );
});
