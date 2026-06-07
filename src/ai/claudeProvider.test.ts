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

  it("drops levers the model omits, keeping the reason", async () => {
    const { client } = stub({ setPrice: 28, reason: "just price" });
    const provider = new ClaudeDecisionProvider({ client });
    const decision = await provider.decide({ observation: obs(), limits: DEFAULT_LIMITS });
    expect(decision.action).toEqual({ setPrice: 28 });
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
