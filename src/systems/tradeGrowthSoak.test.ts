import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { PORT_SEED_CASH } from "./constants";

/**
 * Initiative C / C4 slice a5 — ENGAGE the port on the whole free-market stack and answer the fork
 * doc's question: **does outside demand lift GDP within conservation?**
 *
 * **THE FINDING (measured on seeds 1 & 7, recorded honestly):** Yes — twice over.
 * 1. **While the demand battery funds it** (~the first year), exports run at the daily cap and GDP
 *    sits well above the closed-economy control (≈ +25–45% in days 61–90).
 * 2. **After the battery dies** (port cash ≈ $0 by ~day 400 — foreign demand is finite and is NOT
 *    refilled; that would be money creation, path b), GDP does *not* fall back to the C2 plateau.
 *    The export income financed a **structurally bigger town** — roughly twice the population
 *    (in-migration, births, home construction all fed by the export boom) — and the bigger town's
 *    own consumption outlives the foreign demand that paid for it. A one-time, bounded,
 *    conservation-respecting wealth injection converts into a *permanent* lift in the city's
 *    steady state: export-led growth bootstrapping structure, not just riding the subsidy.
 * 3. Trade then quiets down (the broke port can't buy; the healthy chain doesn't need imports) —
 *    the city banks the gain and returns to closed-economy behaviour at the higher level.
 *
 * Conservation holds to the cent the entire way: every trade flow is a World.transfer between
 * holders counted in totalMoney(); the genesis total is simply (city + port reserve). This is the
 * evidence the C5 money decision asked for: the ceiling CAN be lifted inside the sacred invariant,
 * but the lift is **bounded by the battery** — *unbounded* growth still needs path (b).
 */
const STACK = (seed: number, port: boolean) =>
  createCity({
    seed,
    brain: "rules",
    residentBrain: "rules",
    agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
    agenticResidentIds: "all",
    secondDiner: true,
    // Initiative #1 free market + A creation + B competition + C1 credit — the C2 stack:
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
    populationGrowth: true,
    populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
    // C4a — the only difference between the arms:
    includePort: port,
    tradeEnabled: port,
  });

/** Mean GDP over the next `days` sim-days (smooths daily noise). */
function meanGdp(city: ReturnType<typeof STACK>, days: number): number {
  let sum = 0;
  for (let d = 0; d < days; d++) {
    city.sim.run(TICKS_PER_DAY);
    sum += city.macro.latest()?.gdp ?? 0;
  }
  return sum / days;
}

describe("Initiative C slice C4a5 — export demand lifts GDP within conservation (engage + soak)", () => {
  it(
    "the port arm out-grows the closed control while the battery runs AND after it dies (seeds 1 & 7)",
    () => {
      for (const seed of [1, 7]) {
        const closed = STACK(seed, false);
        const ported = STACK(seed, true);
        const closedStart = closed.world.totalMoney();
        const portedStart = ported.world.totalMoney();
        expect(portedStart).toBeCloseTo(closedStart + PORT_SEED_CASH, 2); // genesis = city + reserve

        // Battery phase — days 61–90: exports run at the cap, outside demand in full effect.
        closed.sim.run(TICKS_PER_DAY * 60);
        ported.sim.run(TICKS_PER_DAY * 60);
        const earlyClosed = meanGdp(closed, 30);
        const earlyPorted = meanGdp(ported, 30);
        expect(earlyPorted).toBeGreaterThan(earlyClosed * 1.1); // measured +25–45%

        // Run on to 18 months — the battery is long dead by here (~day 400).
        closed.sim.run(TICKS_PER_DAY * (510 - 90));
        ported.sim.run(TICKS_PER_DAY * (510 - 90));
        const lateClosed = meanGdp(closed, 30);
        const latePorted = meanGdp(ported, 30);

        const port = ported.world.getBusiness("biz_port")!;
        // The battery exhausted (finite foreign demand — the honest bound of path a) but the port
        // is never bankrupted and never goes negative: trade simply quieted down.
        expect(port.cash).toBeLessThan(PORT_SEED_CASH * 0.05);
        expect(port.cash).toBeGreaterThanOrEqual(0);
        expect(port.active).toBe(true);
        // The battery actually flowed through trade (≈ the full reserve, plus what imports refilled).
        const cumExports = ported.world.businesses.reduce((s, b) => s + (b.pnl.exportRevenue ?? 0), 0);
        expect(cumExports).toBeGreaterThan(PORT_SEED_CASH * 0.9);

        // THE STRUCTURAL FINDING: the lift OUTLIVES the battery. The export boom financed a
        // bigger town (population ≈ 2× the control), whose own demand holds GDP above the
        // closed-economy plateau even with the foreign money fully spent.
        expect(ported.world.residents.length).toBeGreaterThan(closed.world.residents.length * 1.3);
        expect(latePorted).toBeGreaterThan(lateClosed * 1.05);

        // The sacred invariant, across the whole arc, both arms, to the cent.
        expect(closed.world.totalMoney()).toBeCloseTo(closedStart, 2);
        expect(ported.world.totalMoney()).toBeCloseTo(portedStart, 2);
        for (const r of ported.world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
        for (const b of ported.world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
      }
    },
    300_000,
  );
});
