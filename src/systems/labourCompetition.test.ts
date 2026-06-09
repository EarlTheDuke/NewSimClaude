import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";
import { DEFAULT_LIMITS } from "../ai/clamp";
import type { BusinessObservation } from "../ai/types";

/**
 * Initiative B slice 2 — rival-aware wages (the wage war + a truce). A firm that sees a
 * higher-paying same-kind rival (`rivalWage`) either **matches to retain** its crew (don't exceed —
 * the truce, so wages converge) or, when short-handed, **poaches** (bids up to at least the rival's
 * wage). With `rivalWage` absent (feature off / no rival) the wage logic is byte-identical to S1.
 */
describe("RuleBasedProvider — rival-aware wages (Initiative B slice 2)", () => {
  const provider = new RuleBasedProvider();
  /** A freed-wage diner (maxWage = base×8 > base×2 ⇒ free market), fully staffed, solvent. */
  const obs = (over: Partial<BusinessObservation> = {}): BusinessObservation => ({
    businessId: "biz_diner",
    name: "Diner",
    kind: "diner",
    day: 1,
    cash: 5000,
    inventory: 40,
    price: 18,
    referencePrice: 18,
    employeeCount: 2,
    wagePerTick: 0.17,
    baseWagePerTick: 0.17,
    maxWage: 0.17 * 8,
    understaffed: false,
    dayRevenue: 0,
    dayWages: 0,
    dayRent: 0,
    dayProfit: 0,
    unemployedCount: 0,
    ...over,
  });
  const wage = (o: BusinessObservation) => provider.decide({ observation: o, limits: DEFAULT_LIMITS }).action.setWage;

  it("match-to-retain: a fully-staffed firm matches a higher-paying rival — exactly, not above (truce)", () => {
    expect(wage(obs({ rivalWage: 0.4 }))).toBe(0.4);
  });

  it("doesn't chase a rival that pays the same or less", () => {
    expect(wage(obs({ rivalWage: 0.17 }))).toBeUndefined();
    expect(wage(obs({ rivalWage: 0.1 }))).toBeUndefined();
  });

  it("won't match a rival it can't afford (eased back to solvency instead)", () => {
    // Cash below reserve ⇒ no match-to-retain; the solvency ease-down owns the lever.
    expect(wage(obs({ rivalWage: 0.4, cash: 0, wagePerTick: 0.3 }))).toBeLessThan(0.3);
  });

  it("poach: an understaffed firm bids up to at least the rival's wage", () => {
    expect(wage(obs({ understaffed: true, unemployedCount: 2, rivalWage: 0.4 }))).toBe(0.4);
  });

  it("an understaffed bid below the rival's wage is unaffected by a cheaper rival", () => {
    // rival 0.15 < the plain +10% bump (0.187) ⇒ no poach lift; the S1 raise stands.
    expect(wage(obs({ understaffed: true, unemployedCount: 2, rivalWage: 0.15 }))).toBeCloseTo(0.17 * 1.1, 6);
  });

  it("is byte-identical with rivalWage absent — the pre-B2 S1 logic", () => {
    expect(wage(obs({}))).toBeUndefined(); // fully staffed, no rival ⇒ no move
    expect(wage(obs({ understaffed: true, unemployedCount: 2 }))).toBeCloseTo(0.17 * 1.1, 6); // plain raise
    expect(wage(obs({ understaffed: true, unemployedCount: 0 }))).toBeCloseTo(0.17 * 1.25, 6); // scarce bid
  });
});

describe("labour competition — rival diners' wages converge (Initiative B slice 2)", () => {
  function wageWar(labourCompetition: boolean) {
    const c = createCity({
      seed: 1,
      secondDiner: true,
      brain: "rules",
      agenticBusinessIds: ["biz_diner", "biz_diner_2"],
      residentCount: 16, // staff both diners fully, so wage moves come from rivalry, not understaffing
      wageCapMult: 8, // free the wage so there's headroom to compete
      labourCompetition,
    });
    const d1 = c.world.getBusiness("biz_diner")!;
    const d2 = c.world.getBusiness("biz_diner_2")!;
    d1.wagePerTick = 0.5; // d1 the high payer
    d1.cash = 30_000;
    d2.cash = 30_000; // d2 sits at its low seeded base
    return { c, d1, d2 };
  }

  it("on: the low-paying diner matches its richer rival, wages converge, money conserved", () => {
    const { c, d1, d2 } = wageWar(true);
    const startGap = Math.abs(d1.wagePerTick - d2.wagePerTick);
    const startMoney = c.world.totalMoney();

    c.sim.run(TICKS_PER_DAY * 20);

    expect(d2.wagePerTick).toBeGreaterThan(0.22); // d2 chased the rival up (match-to-retain)
    expect(Math.abs(d1.wagePerTick - d2.wagePerTick)).toBeLessThan(startGap); // converged (the truce)
    expect(c.world.totalMoney()).toBeCloseTo(startMoney, 4);
  });

  it("off: the low payer never chases the rival (byte-identical wage logic)", () => {
    const { c, d2 } = wageWar(false);
    c.sim.run(TICKS_PER_DAY * 20);
    expect(d2.wagePerTick).toBeLessThan(0.25); // no rivalWage ⇒ no match; stays near base
  });

  it("is deterministic: the same wage war serializes identically", () => {
    const build = () => {
      const { c } = wageWar(true);
      c.sim.run(TICKS_PER_DAY * 15);
      return c.world.serialize();
    };
    expect(build()).toEqual(build());
  });
});
