import { describe, it, expect } from "vitest";
import { ClaudeDecisionProvider, type MessagesClient } from "./ClaudeDecisionProvider";
import { DEFAULT_LIMITS } from "./clamp";
import type { BusinessObservation } from "./types";

/** A full retail observation with every strategic signal present. */
function obs(over: Partial<BusinessObservation> = {}): BusinessObservation {
  return {
    businessId: "biz_goods",
    name: "Maker Goods Co.",
    kind: "goods",
    day: 5,
    cash: 4200,
    inventory: 18,
    price: 34,
    referencePrice: 34,
    rivalPrice: 33,
    unitCost: 11,
    employeeCount: 2,
    wagePerTick: 0.2,
    baseWagePerTick: 0.2,
    understaffed: false,
    dayRevenue: 200,
    dayWages: 40,
    dayRent: 60,
    dayProfit: 100,
    unemployedCount: 1,
    capital: 250,
    capacityUtilization: 0.95,
    ...over,
  };
}

/** A captured-request stub client that returns one fixed tool call — no key, no network. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stub(input: Record<string, unknown>): { client: MessagesClient; captured: () => any } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req: any;
  const client = {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (r: any) => {
        req = r;
        return {
          content: [{ type: "tool_use", id: "t", name: "set_business_plan", input }],
          usage: { input_tokens: 12, output_tokens: 6 },
        };
      },
    },
  } as unknown as MessagesClient;
  return { client, captured: () => req };
}

describe("ClaudeDecisionProvider (modernized — the LM-as-CEO mind)", () => {
  it("offers all four levers and parses each one the model returns", async () => {
    const { client, captured } = stub({ setPrice: 30, hire: 1, invest: 150, setWage: 0.3, reason: "grow" });
    const provider = new ClaudeDecisionProvider({ client });
    const decision = await provider.decide({ observation: obs(), limits: DEFAULT_LIMITS });

    const props = captured().tools[0].input_schema.properties as Record<string, unknown>;
    for (const lever of ["setPrice", "hire", "invest", "setWage"]) expect(props).toHaveProperty(lever);
    expect(decision.action).toMatchObject({ setPrice: 30, hire: 1, invest: 150, setWage: 0.3 });
    expect(decision.reason).toBe("grow");
    expect(decision.usage?.inputTokens).toBe(12);
  });

  it("offers the retain-vs-distribute lever (setPayout) and parses it (Phase 16)", async () => {
    const { client, captured } = stub({ setPayout: 0.5, reason: "retain to fund growth" });
    const provider = new ClaudeDecisionProvider({ client });
    const decision = await provider.decide({ observation: obs({ payoutRate: 0.6 }), limits: DEFAULT_LIMITS });

    const props = captured().tools[0].input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("setPayout"); // the lever is offered
    expect(decision.action.setPayout).toBe(0.5); // and parsed back
    // the firm's current retain stance is surfaced so the CEO can change it deliberately
    expect(captured().messages[0].content as string).toMatch(/retain/i);
  });

  it("surfaces the strategic signals in the observation it sends", async () => {
    const { client, captured } = stub({ reason: "hold" });
    const provider = new ClaudeDecisionProvider({ client });
    await provider.decide({ observation: obs({ understaffed: true }), limits: DEFAULT_LIMITS });
    const msg = captured().messages[0].content as string;
    expect(msg).toMatch(/capacity/i); // utilization → invest signal
    expect(msg).toMatch(/SHORT-HANDED/); // understaffed → hire/wage signal
    expect(msg).toMatch(/base/i); // base wage → setWage anchor
    expect(msg).toMatch(/competitor|going rate/i); // pricing signals
  });

  it("F2+F4: warns when spending is locked, and reports real unit economics", async () => {
    const { client, captured } = stub({ reason: "hold" });
    const provider = new ClaudeDecisionProvider({ client });
    await provider.decide({
      observation: obs({ spendLocked: true, dayUnitsSold: 14, dayGrossMargin: 140 }),
      limits: DEFAULT_LIMITS,
    });
    const msg = captured().messages[0].content as string;
    expect(msg).toMatch(/SPENDING LOCKED/); // the cash shield made visible
    expect(msg).toMatch(/14 units sold/);
    expect(msg).toMatch(/gross margin 140/);
    // a healthy firm's message carries no lock warning
    const healthy = stub({ reason: "hold" });
    await new ClaudeDecisionProvider({ client: healthy.client }).decide({
      observation: obs(),
      limits: DEFAULT_LIMITS,
    });
    expect(healthy.captured().messages[0].content as string).not.toMatch(/SPENDING LOCKED/);
  });

  it("drops levers the model omits, keeping the reason", async () => {
    const { client } = stub({ setPrice: 28, reason: "just price" });
    const provider = new ClaudeDecisionProvider({ client });
    const decision = await provider.decide({ observation: obs(), limits: DEFAULT_LIMITS });
    expect(decision.action).toEqual({ setPrice: 28 });
  });

  it("carries the CEO's own ledger across turns — and only their own (memory, Pilot-A fix)", async () => {
    const { client, captured } = stub({ setPrice: 38, reason: "probe upward" });
    const provider = new ClaudeDecisionProvider({ client });

    // Turn 1: no history yet — the prompt is just today's books (amnesia-free baseline).
    await provider.decide({ observation: obs({ day: 5 }), limits: DEFAULT_LIMITS });
    expect(captured().messages[0].content as string).not.toMatch(/YOUR LEDGER/);

    // Turn 2: the ledger appears, carrying day 5's figures AND the choice + reason made then.
    await provider.decide({ observation: obs({ day: 6, price: 38 }), limits: DEFAULT_LIMITS });
    const msg = captured().messages[0].content as string;
    expect(msg).toMatch(/YOUR LEDGER/);
    expect(msg).toMatch(/Day 5/);
    expect(msg).toMatch(/setPrice":38/);
    expect(msg).toMatch(/probe upward/);
    expect(msg).toMatch(/TODAY:/);

    // A different business shares the provider but never sees this firm's ledger.
    await provider.decide({
      observation: obs({ businessId: "biz_diner", name: "The Corner Diner", day: 6 }),
      limits: DEFAULT_LIMITS,
    });
    expect(captured().messages[0].content as string).not.toMatch(/YOUR LEDGER/);
  });

  it("memoryTurns: 0 restores the stateless provider", async () => {
    const { client, captured } = stub({ reason: "hold" });
    const provider = new ClaudeDecisionProvider({ client, memoryTurns: 0 });
    await provider.decide({ observation: obs({ day: 1 }), limits: DEFAULT_LIMITS });
    await provider.decide({ observation: obs({ day: 2 }), limits: DEFAULT_LIMITS });
    expect(captured().messages[0].content as string).not.toMatch(/YOUR LEDGER/);
  });

  it("the briefing is the system prompt: mechanics disclosed, no strategy coaching", async () => {
    const { client, captured } = stub({ reason: "hold" });
    const provider = new ClaudeDecisionProvider({ client });
    await provider.decide({ observation: obs(), limits: DEFAULT_LIMITS });
    const system = captured().system as string;
    expect(system).toMatch(/YOUR OBJECTIVE/);
    expect(system).toMatch(/STANDING POLICIES/i); // the firm's own bylaws — fair disclosure
    expect(system).toMatch(/WHAT YOU DO NOT KNOW/i); // market behaviour withheld
    expect(system).toMatch(/up to you/i); // no coaching
    expect(system).not.toMatch(/capacity-bound .* pay off|price near the going/i); // the old coaching is gone
  });

  it("rejects (so the agent falls back to rules) when the model returns no tool call", async () => {
    const client = {
      messages: {
        create: async () => ({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1, output_tokens: 1 } }),
      },
    } as unknown as MessagesClient;
    const provider = new ClaudeDecisionProvider({ client });
    await expect(provider.decide({ observation: obs(), limits: DEFAULT_LIMITS })).rejects.toThrow();
  });
});
