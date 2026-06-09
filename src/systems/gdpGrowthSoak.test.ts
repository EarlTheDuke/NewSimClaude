import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

/**
 * Initiative C slice 2 — does the economy COMPOUND? The whole free-market program engaged at once
 * (free wages + welfare, A creation + B competition, C1 credit, population growth) run for years.
 *
 * **FINDING (the C2 result, honestly recorded):** it does NOT compound within conservation — GDP
 * **plateaus**. The town grows (HP3 births + migration) but **self-limits at its housing/wealth
 * cap**, so demand-led growth tops out and GDP settles into a band rather than rising over time.
 * The economy stays **conserved, alive, and self-sustaining** the whole way — but lifting the GDP
 * ceiling needs an *external* demand channel (C4 trade) and/or the money-creation fork (C5). This
 * plateau is the empirical motivation for C4/C5. The test below locks the truth: invariants hold,
 * population grows, GDP stays healthy (doesn't collapse) — and is roughly flat, not compounding.
 */
const YEAR = TICKS_PER_DAY * 365;

function fullStackCity(seed: number) {
  return createCity({
    seed,
    brain: "rules",
    residentBrain: "rules",
    agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
    agenticResidentIds: "all",
    secondDiner: true,
    // Initiative #1 free market + A creation + B competition + C1 credit, all engaged:
    wageCapMult: 8,
    welfareRatio: 0.5,
    welfareSubsistence: 2,
    dividendWean: 0.5,
    producerCompetition: 2,
    labourCompetition: true,
    opportunityEntry: true,
    includeBank: true,
    creditEnabled: true,
    creditDailyRate: 0.003,
    creditMaxPrincipal: 4000,
    // The growth driver — the town broadens:
    populationGrowth: true,
    populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
  });
}

/** Mean GDP across a sampled window (smooths daily noise). */
function meanGdpOverWindow(macro: ReturnType<typeof fullStackCity>["macro"], sim: ReturnType<typeof fullStackCity>["sim"], days: number): number {
  let sum = 0;
  for (let d = 0; d < days; d++) {
    sim.run(TICKS_PER_DAY);
    sum += macro.latest()?.gdp ?? 0;
  }
  return sum / days;
}

describe("Initiative C slice 2 — GDP plateaus under conservation (full-stack soak)", () => {
  it(
    "stays conserved, alive, and self-sustaining over 4 years; population grows; GDP plateaus (seeds 1 & 7)",
    () => {
      for (const seed of [1, 7]) {
        const { sim, world, macro } = fullStackCity(seed);
        const startMoney = world.totalMoney();
        const startPop = world.residents.length;

        sim.run(YEAR); // warm up a year
        const earlyGdp = meanGdpOverWindow(macro, sim, 30); // mean GDP early (year ~1)
        sim.run(YEAR * 2); // run on to ~year 3.1
        const lateGdp = meanGdpOverWindow(macro, sim, 30); // mean GDP late (year ~4)

        // The closed economy held across four years of the full stack.
        expect(world.totalMoney()).toBeCloseTo(startMoney, 2);
        for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
        for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
        // The town broadened (HP3 population growth fired).
        expect(world.residents.length).toBeGreaterThan(startPop);
        // Still a living, varied economy producing real output.
        const activeKinds = new Set(world.businesses.filter((b) => b.active).map((b) => b.kind));
        expect(activeKinds.size).toBeGreaterThanOrEqual(4);
        expect(lateGdp).toBeGreaterThan(0);
        // THE FINDING: GDP does not compound — it plateaus. Late GDP stays in a band around early
        // GDP (neither a collapse nor sustained growth), because population self-limits at its cap.
        // Lifting this ceiling is the job of C4 (external trade) / C5 (the money-creation fork).
        expect(lateGdp).toBeGreaterThan(earlyGdp * 0.6); // doesn't collapse
        expect(lateGdp).toBeLessThan(earlyGdp * 1.4); // doesn't compound — the plateau
      }
    },
    180_000,
  );
});
