import { describe, it, expect } from "vitest";
import { clampAction, DEFAULT_LIMITS } from "./clamp";
import { RuleBasedProvider } from "./RuleBasedProvider";
import { MockProvider } from "./MockProvider";
import type { BusinessObservation, DecisionRequest } from "./types";

function obs(over: Partial<BusinessObservation> = {}): BusinessObservation {
  return {
    businessId: "biz_diner",
    name: "The Corner Diner",
    kind: "diner",
    day: 1,
    cash: 4000,
    inventory: 100,
    price: 14,
    employeeCount: 3,
    wagePerTick: 0.5,
    baseWagePerTick: 0.5,
    understaffed: false,
    dayRevenue: 100,
    dayWages: 40,
    dayRent: 120,
    dayProfit: -60,
    unemployedCount: 0,
    ...over,
  };
}

function req(over: Partial<BusinessObservation> = {}): DecisionRequest {
  return { observation: obs(over), limits: DEFAULT_LIMITS };
}

describe("clampAction", () => {
  it("caps a price move to the per-review fraction and absolute bounds", () => {
    // current 14, fraction 0.25 -> max step 3.5 -> ceiling 17.5
    expect(clampAction({ setPrice: 99999 }, 14, DEFAULT_LIMITS).setPrice).toBeCloseTo(17.5, 6);
    expect(clampAction({ setPrice: 0 }, 14, DEFAULT_LIMITS).setPrice).toBeCloseTo(10.5, 6);
  });

  it("never lets price escape the absolute min/max", () => {
    // tiny current price -> step floor of 1; absolute min still wins
    expect(clampAction({ setPrice: -5 }, 1.2, DEFAULT_LIMITS).setPrice).toBe(DEFAULT_LIMITS.minPrice);
  });

  it("bounds and integer-truncates hire", () => {
    expect(clampAction({ hire: 9 }, 14, DEFAULT_LIMITS).hire).toBe(DEFAULT_LIMITS.maxHirePerReview);
    expect(clampAction({ hire: -9 }, 14, DEFAULT_LIMITS).hire).toBe(-DEFAULT_LIMITS.maxHirePerReview);
    expect(clampAction({ hire: 1.9 }, 14, DEFAULT_LIMITS).hire).toBe(1);
  });

  it("drops absent and non-finite levers", () => {
    expect(clampAction({}, 14, DEFAULT_LIMITS)).toEqual({});
    expect(clampAction({ setPrice: NaN, hire: Infinity }, 14, DEFAULT_LIMITS)).toEqual({});
  });

  it("clamps invest to [0, maxInvestPerReview] (Phase 12c)", () => {
    expect(clampAction({ invest: -50 }, 14, DEFAULT_LIMITS).invest).toBe(0);
    expect(clampAction({ invest: 50 }, 14, DEFAULT_LIMITS).invest).toBe(50);
    expect(clampAction({ invest: 999_999 }, 14, DEFAULT_LIMITS).invest).toBe(
      DEFAULT_LIMITS.maxInvestPerReview,
    );
    expect(clampAction({ invest: NaN }, 14, DEFAULT_LIMITS).invest).toBeUndefined();
  });

  it("clamps setWage to the absolute safety band [minWagePerTick, maxWagePerTick] (Phase 15 A)", () => {
    expect(clampAction({ setWage: 5 }, 14, DEFAULT_LIMITS).setWage).toBe(
      DEFAULT_LIMITS.maxWagePerTick,
    );
    expect(clampAction({ setWage: -1 }, 14, DEFAULT_LIMITS).setWage).toBe(
      DEFAULT_LIMITS.minWagePerTick,
    );
    expect(clampAction({ setWage: 0.3 }, 14, DEFAULT_LIMITS).setWage).toBeCloseTo(0.3, 6);
    expect(clampAction({ setWage: NaN }, 14, DEFAULT_LIMITS).setWage).toBeUndefined();
  });
});

describe("RuleBasedProvider", () => {
  const rules = new RuleBasedProvider();

  it("is deterministic: same observation, same decision", () => {
    const a = rules.decide(req());
    const b = rules.decide(req());
    expect(a).toEqual(b);
  });

  it("leaves the landlord alone", () => {
    const d = rules.decide(req({ kind: "landlord" }));
    expect(d.action).toEqual({});
  });

  it("raises price after a losing day", () => {
    const d = rules.decide(req({ dayProfit: -60 }));
    expect(d.action.setPrice).toBeGreaterThan(14);
  });

  it("eases price back toward the reference after a loss above it", () => {
    // Overpriced (30 > anchor 18) and bleeding: under elastic demand the high
    // price is *causing* the loss (shoppers walked), so cut toward the going
    // rate instead of chasing the loss upward into a death spiral.
    const d = rules.decide(req({ price: 30, referencePrice: 18, dayProfit: -60 }));
    expect(d.action.setPrice!).toBeLessThan(30);
    expect(d.action.setPrice!).toBeCloseTo(28.5, 6); // max(18, 30*0.95)
  });

  it("never eases below the reference price (floors at the going rate)", () => {
    // A 5% cut from 18.2 would undershoot the anchor; it floors at 18 instead.
    const d = rules.decide(req({ price: 18.2, referencePrice: 18, dayProfit: -60 }));
    expect(d.action.setPrice!).toBe(18);
  });

  it("still raises after a loss below the reference (headroom to mark up)", () => {
    const d = rules.decide(req({ price: 14, referencePrice: 18, dayProfit: -60 }));
    expect(d.action.setPrice!).toBeGreaterThan(14);
  });

  it("always gives a reason", () => {
    expect(rules.decide(req()).reason.length).toBeGreaterThan(0);
  });

  // Phase 12c invest heuristic, fired by the 13c reorder.
  //
  // The rule fires when two conditions hold: the firm is capacity-bound
  // (utilization above INVEST_UTILIZATION_THRESHOLD) AND it is sitting on a real
  // surplus above its working-capital reserve. After the 13c reorder the agent
  // reviews *before* the daily dividend, so that surplus is the day's operating
  // profit — the old separate "dayProfit > 50" gate was always distribution-
  // dominated and has been removed. A slack-capacity or under-cushioned firm
  // still gets nothing.
  const investContext = {
    capacityUtilization: 0.95,
    dayProfit: 200,
    cash: 10_000,
  };

  it("invests when capacity-bound and sitting on a surplus", () => {
    const d = rules.decide(req(investContext));
    expect(d.action.invest).toBeGreaterThan(0);
    expect(d.reason).toMatch(/invest/i);
  });

  it("does NOT invest when not capacity-bound (slack capacity)", () => {
    const d = rules.decide(req({ ...investContext, capacityUtilization: 0.4 }));
    expect(d.action.invest).toBeUndefined();
  });

  it("does NOT invest when capacityUtilization is undefined (non-producer)", () => {
    const d = rules.decide(req({ ...investContext, capacityUtilization: undefined }));
    expect(d.action.invest).toBeUndefined();
  });

  it("does NOT invest when cash is barely above reserve (no surplus to deploy)", () => {
    // BUSINESS_RESERVE is 3000; the lever needs cash above reserve +
    // INVEST_MIN_SURPLUS (200) = 3200, so a firm at 3100 stays put even when
    // capacity-bound.
    const d = rules.decide(req({ ...investContext, cash: 3100 }));
    expect(d.action.invest).toBeUndefined();
  });

  // Phase 15 A4 — the wage lever, the firm's move in the labour market.
  it("raises the wage when short-handed, capped at base*MAX_WAGE_MULT (Phase 15 A4)", () => {
    const d = rules.decide(req({ understaffed: true, wagePerTick: 0.1, baseWagePerTick: 0.1 }));
    expect(d.action.setWage!).toBeGreaterThan(0.1);
    expect(d.action.setWage!).toBeLessThanOrEqual(0.2 + 1e-9); // base * MAX_WAGE_MULT (2)
    expect(d.reason).toMatch(/wage|staff/i);
  });

  it("holds wages when fully staffed and solvent", () => {
    const d = rules.decide(req({ understaffed: false, cash: 5000, wagePerTick: 0.12, baseWagePerTick: 0.1 }));
    expect(d.action.setWage).toBeUndefined();
  });

  it("eases wages back toward base when fully staffed but cash-thin (no ratchet to the cap)", () => {
    const d = rules.decide(req({ understaffed: false, cash: 100, wagePerTick: 0.18, baseWagePerTick: 0.1 }));
    expect(d.action.setWage!).toBeLessThan(0.18);
    expect(d.action.setWage!).toBeGreaterThanOrEqual(0.1); // never below base
  });
});

describe("MockProvider", () => {
  it("returns its fixed decision and counts calls", () => {
    const m = new MockProvider({ fixed: { action: { hire: 1 }, reason: "x" } });
    expect((m.decide(req()) as { action: { hire?: number } }).action.hire).toBe(1);
    expect(m.calls).toBe(1);
  });

  it("walks a queue, repeating the last entry", () => {
    const m = new MockProvider({
      decisions: [
        { action: { hire: 1 }, reason: "a" },
        { action: { hire: -1 }, reason: "b" },
      ],
    });
    expect((m.decide(req()) as { action: { hire?: number } }).action.hire).toBe(1);
    expect((m.decide(req()) as { action: { hire?: number } }).action.hire).toBe(-1);
    expect((m.decide(req()) as { action: { hire?: number } }).action.hire).toBe(-1);
  });

  it("throws synchronously when told to fail", () => {
    const m = new MockProvider({ fail: true });
    expect(() => m.decide(req())).toThrow();
  });

  it("rejects when failing in async mode", async () => {
    const m = new MockProvider({ async: true, fail: true });
    await expect(m.decide(req())).rejects.toThrow();
  });
});
