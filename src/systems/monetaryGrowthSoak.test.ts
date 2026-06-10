import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

/**
 * Initiative C / C4 slice b3 — ENGAGE the monetary authority on the whole free-market stack and
 * measure what bounded money creation buys, against the closed-economy control.
 *
 * **THE FINDING (measured on seeds 1 & 7 over 18 months, recorded honestly):**
 * 1. **The press delivers what the port could not: an UNBOUNDED lift.** Under a loose k-percent
 *    rule (0.2%/day, hard-capped $400/day) the daily issue compounds with the supply ($79/day in
 *    month 3 → $194/day by month 18 — it never exhausts, unlike the port's finite battery), and
 *    GDP ends ≈ 2.2× the closed control (4280 vs 1974 / 3173 vs 1407) — still climbing.
 * 2. **The mechanism is structural again**: the helicopter income funds in-migration, births, and
 *    construction — population ≈ 2.2× the control — so real capacity grows with nominal demand.
 * 3. **A modest drip (0.05%/day) mostly POOLS** (measured separately): velocity falls, GDP ≈
 *    control. Below a threshold, helicopter money sits in wallets instead of becoming demand.
 * 4. **No price inflation shows in the B2B book — a model limit, stated plainly:** resource
 *    prices are clamped to their [0.4×, 1.6×] band and retail demand reckons against frozen
 *    reference prices, so the sim's nominal anchors convert new money into *real* activity (or
 *    pooling) rather than rising prices. A true inflation dynamic would need unanchored prices —
 *    future work, deliberately out of C4b's scope.
 * 5. **The audit holds to the cent** across 540 days of compounding daily mints + the full live
 *    economy: totalMoney() === genesis + mintedTotal() − burnedTotal() (error ~1e-7).
 *
 * Real-world: this is the fiat answer — a central bank growing the money supply lifts nominal
 * demand without an external trading partner, and in a capacity-elastic economy that demand
 * becomes real growth. The cost in realism (inflation) is bounded here by the model's anchors.
 */
const STACK = (seed: number, mint: boolean) =>
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
    // C4b — the only difference between the arms: a loose-but-bounded k-percent rule.
    includeAuthority: mint,
    monetaryEnabled: mint,
    monetaryGrowthRate: mint ? 0.002 : 0, // 0.2%/day ≈ 107%/yr — deliberately loose, to see the ceiling move
    monetaryDailyCap: mint ? 400 : 0, // the hard bound no rule may break
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

describe("Initiative C slice C4b3 — bounded money creation lifts GDP unboundedly, audited to the cent", () => {
  it(
    "the minting arm compounds past the closed control; the audit identity survives 540 days (seeds 1 & 7)",
    () => {
      for (const seed of [1, 7]) {
        const closed = STACK(seed, false);
        const minting = STACK(seed, true);
        const closedGenesis = closed.world.totalMoney();
        const mintingGenesis = minting.world.totalMoney();
        expect(mintingGenesis).toBeCloseTo(closedGenesis, 2); // the authority brings NO genesis cash

        closed.sim.run(TICKS_PER_DAY * 510);
        minting.sim.run(TICKS_PER_DAY * 510);
        const lateClosed = meanGdp(closed, 30);
        const lateMinting = meanGdp(minting, 30);

        // The press never exhausts: the supply has compounded far past genesis and is still
        // being fed daily (the k-percent rule reads the GROWN supply).
        const minted = minting.world.mintedTotal();
        expect(minted).toBeGreaterThan(mintingGenesis); // more than the whole genesis, created anew
        const latestIssue = minting.macro.latest()!.minted;
        expect(latestIssue).toBeGreaterThan(mintingGenesis * 0.002); // today's mint > day one's

        // THE LIFT: GDP ≈ 2.2× the closed control (measured), through the structural channel —
        // helicopter income financed a bigger town. Bars set conservatively under the measurement.
        expect(lateMinting).toBeGreaterThan(lateClosed * 1.5);
        expect(minting.world.residents.length).toBeGreaterThan(closed.world.residents.length * 1.5);

        // THE AUDIT — the relaxed invariant, exact across 540 days of compounding daily mints:
        // totalMoney === genesis + minted − burned, to the cent; the control stays STRICTLY
        // conserved (its counters never moved).
        expect(minting.world.totalMoney()).toBeCloseTo(
          mintingGenesis + minting.world.mintedTotal() - minting.world.burnedTotal(),
          2,
        );
        expect(closed.world.mintedTotal()).toBe(0);
        expect(closed.world.totalMoney()).toBeCloseTo(closedGenesis, 2);
        for (const r of minting.world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
        for (const b of minting.world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
      }
    },
    300_000,
  );
});
