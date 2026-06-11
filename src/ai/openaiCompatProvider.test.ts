import { describe, it, expect } from "vitest";
import { OpenAICompatProvider, extractJsonObject, type FetchLike } from "./OpenAICompatProvider";
import { DEFAULT_LIMITS } from "./clamp";
import type { BusinessObservation } from "./types";

function obs(over: Partial<BusinessObservation> = {}): BusinessObservation {
  return {
    businessId: "biz_diner",
    name: "The Corner Diner",
    kind: "diner",
    day: 3,
    cash: 4000,
    inventory: 12,
    price: 12,
    referencePrice: 12,
    unitCost: 4,
    employeeCount: 2,
    wagePerTick: 0.2,
    baseWagePerTick: 0.2,
    understaffed: false,
    dayRevenue: 150,
    dayWages: 80,
    dayRent: 30,
    dayProfit: 40,
    unemployedCount: 0,
    ...over,
  };
}

/** A captured-request fetch stub returning a fixed completion body. */
function stub(content: string, status = 200): { fetchImpl: FetchLike; captured: () => any } {
  let req: any;
  const fetchImpl: FetchLike = async (url, init) => {
    req = { url, body: JSON.parse(init.body), headers: init.headers };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    };
  };
  return { fetchImpl, captured: () => req };
}

const make = (fetchImpl: FetchLike) =>
  new OpenAICompatProvider({ baseUrl: "http://localhost:3000/api/", model: "nemotron-3", apiKey: "sk-test", fetchImpl });

describe("OpenAICompatProvider — the local/third-party adapter (first live duel)", () => {
  it("sends the SHARED contract: briefing as system, observation + JSON spec as user", async () => {
    const { fetchImpl, captured } = stub('{"setPrice": 13, "reason": "probe"}');
    const provider = make(fetchImpl);
    const d = await provider.decide({ observation: obs(), limits: DEFAULT_LIMITS });

    const req = captured();
    expect(req.url).toBe("http://localhost:3000/api/chat/completions"); // trailing slash normalized
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    expect(req.body.model).toBe("nemotron-3");
    expect(req.body.messages[0].role).toBe("system");
    expect(req.body.messages[0].content).toMatch(/YOUR OBJECTIVE/); // the shared briefing, verbatim
    expect(req.body.messages[0].content).toMatch(/STANDING POLICIES/);
    expect(req.body.messages[1].content).toMatch(/The Corner Diner/);
    expect(req.body.messages[1].content).toMatch(/Reply with ONLY a JSON object/);
    expect(d.action).toEqual({ setPrice: 13 });
    expect(d.reason).toBe("probe");
    expect(d.usage?.inputTokens).toBe(100);
    expect(d.usage?.costUsd).toBe(0);
  });

  it("parses a reply wrapped in reasoning traces, prose, and a code fence (local-model reality)", async () => {
    const messy =
      "<think>Maybe {\"setPrice\": 99} is too greedy… let me reconsider the books.</think>\n" +
      "Looking at yesterday I should retain cash.\n```json\n" +
      '{"setPayout": 0, "invest": 100, "reason": "retain and grow"}\n```\nGood luck!';
    const { fetchImpl } = stub(messy);
    const d = await make(fetchImpl).decide({ observation: obs(), limits: DEFAULT_LIMITS });
    expect(d.action).toEqual({ setPayout: 0, invest: 100 }); // the think-draft was stripped, the real object won
    expect(d.reason).toBe("retain and grow");
  });

  it("carries the shared ledger across turns, like the Claude adapter", async () => {
    const { fetchImpl, captured } = stub('{"setPrice": 13, "reason": "up a notch"}');
    const provider = make(fetchImpl);
    await provider.decide({ observation: obs({ day: 3 }), limits: DEFAULT_LIMITS });
    await provider.decide({ observation: obs({ day: 4, price: 13 }), limits: DEFAULT_LIMITS });
    const msg = captured().body.messages[1].content as string;
    expect(msg).toMatch(/YOUR LEDGER/);
    expect(msg).toMatch(/Day 3/);
    expect(msg).toMatch(/up a notch/);
  });

  it("rejects on HTTP errors and on replies with no JSON (→ rules fallback covers, logged)", async () => {
    const bad = stub("", 500);
    await expect(make(bad.fetchImpl).decide({ observation: obs(), limits: DEFAULT_LIMITS })).rejects.toThrow(/HTTP 500/);
    const noJson = stub("I think you should raise prices, boss!");
    await expect(make(noJson.fetchImpl).decide({ observation: obs(), limits: DEFAULT_LIMITS })).rejects.toThrow(/no JSON/);
  });
});

describe("extractJsonObject — tolerant JSON fishing", () => {
  it("takes the LAST balanced object and survives strings with braces", () => {
    expect(extractJsonObject('first {"a": 1} then {"b": "curly } inside", "c": 2}')).toEqual({
      b: "curly } inside",
      c: 2,
    });
  });
  it("returns undefined when nothing parses", () => {
    expect(extractJsonObject("no json here { broken")).toBeUndefined();
  });
});
