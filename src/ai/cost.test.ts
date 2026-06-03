import { describe, it, expect } from "vitest";
import { summarizeCost, BudgetedProvider, BudgetExceededError, type CostableEntry } from "./cost";
import { MockProvider } from "./MockProvider";
import type { BusinessDecision, DecisionRequest } from "./types";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

describe("summarizeCost", () => {
  it("is all-zero for empty logs (the default rules-only run)", () => {
    expect(summarizeCost([], [])).toEqual({
      calls: 0,
      fallbacks: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      avgLatencyMs: 0,
    });
  });

  it("aggregates tokens, cost, fallbacks and mean latency across both seams", () => {
    const biz: CostableEntry[] = [
      { fallback: false, usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01, latencyMs: 200 } },
      { fallback: true }, // rules fallback — free, no usage
    ];
    const res: CostableEntry[] = [
      { fallback: false, usage: { inputTokens: 50, outputTokens: 10, costUsd: 0.005, latencyMs: 400 } },
    ];

    const s = summarizeCost(biz, res);

    expect(s.calls).toBe(3);
    expect(s.fallbacks).toBe(1);
    expect(s.inputTokens).toBe(150);
    expect(s.outputTokens).toBe(30);
    expect(s.totalCostUsd).toBeCloseTo(0.015, 6);
    // Mean of the two rows that *reported* latency (200, 400); the fallback has none.
    expect(s.avgLatencyMs).toBeCloseTo(300, 6);
  });
});

describe("BudgetedProvider", () => {
  const paid = (costUsd: number): BusinessDecision => ({ action: {}, reason: "paid", usage: { costUsd } });

  it("preserves the inner id, meters spend, then throws once exhausted", () => {
    const inner = new MockProvider({ id: "claude", fixed: paid(0.5) });
    const b = new BudgetedProvider<DecisionRequest, BusinessDecision>(inner, 1.0);
    const req = {} as DecisionRequest;

    expect(b.id).toBe("claude"); // paid calls still attribute to the real model

    b.decide(req);
    expect(b.spentUsd()).toBeCloseTo(0.5, 6);
    expect(b.exhausted).toBe(false);

    b.decide(req);
    expect(b.spentUsd()).toBeCloseTo(1.0, 6);
    expect(b.exhausted).toBe(true);

    expect(() => b.decide(req)).toThrow(BudgetExceededError);
    expect(inner.calls).toBe(2); // the throwing call never reached the inner provider
  });

  it("meters async cost on resolution", async () => {
    const inner = new MockProvider({ id: "claude", async: true, fixed: paid(0.7) });
    const b = new BudgetedProvider<DecisionRequest, BusinessDecision>(inner, 1.0);

    await b.decide({} as DecisionRequest);
    expect(b.spentUsd()).toBeCloseTo(0.7, 6);
    expect(b.exhausted).toBe(false);

    await b.decide({} as DecisionRequest);
    expect(b.spentUsd()).toBeCloseTo(1.4, 6);
    expect(b.exhausted).toBe(true);
  });
});

describe("budget cap degrades to rules end-to-end", () => {
  it("falls back to the deterministic rules provider once spend hits the cap", () => {
    const inner = new MockProvider({ id: "claude", fixed: { action: {}, reason: "paid", usage: { costUsd: 0.5 } } });
    const budgeted = new BudgetedProvider<DecisionRequest, BusinessDecision>(inner, 1.0);
    const { sim, agent } = createCity({ seed: 1, brain: budgeted, agenticBusinessIds: ["biz_diner"] });

    sim.run(TICKS_PER_DAY * 5); // five daily reviews of the one agentic business

    const log = agent!.decisions();
    expect(log).toHaveLength(5);

    const paidCalls = log.filter((e) => !e.fallback);
    const fellBack = log.filter((e) => e.fallback);
    expect(paidCalls).toHaveLength(2); // $0.50 × 2 reaches the $1.00 cap
    expect(fellBack.length).toBeGreaterThanOrEqual(3);
    for (const e of fellBack) expect(e.providerId).toBe("rules");

    const summary = summarizeCost(log);
    expect(summary.totalCostUsd).toBeCloseTo(1.0, 6); // only the two paid calls cost anything
    expect(summary.fallbacks).toBe(fellBack.length);
  });
});
