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

  it("keeps produce non-negative and capped", () => {
    expect(clampAction({ produce: -50 }, 14, DEFAULT_LIMITS).produce).toBe(0);
    expect(clampAction({ produce: 9999 }, 14, DEFAULT_LIMITS).produce).toBe(DEFAULT_LIMITS.maxProducePerReview);
  });

  it("drops absent and non-finite levers", () => {
    expect(clampAction({}, 14, DEFAULT_LIMITS)).toEqual({});
    expect(clampAction({ setPrice: NaN, hire: Infinity }, 14, DEFAULT_LIMITS)).toEqual({});
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

  it("produces when inventory runs low", () => {
    const d = rules.decide(req({ inventory: 20 }));
    expect(d.action.produce).toBeGreaterThan(0);
  });

  it("always gives a reason", () => {
    expect(rules.decide(req()).reason.length).toBeGreaterThan(0);
  });
});

describe("MockProvider", () => {
  it("returns its fixed decision and counts calls", () => {
    const m = new MockProvider({ fixed: { action: { produce: 10 }, reason: "x" } });
    expect((m.decide(req()) as { action: { produce?: number } }).action.produce).toBe(10);
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
