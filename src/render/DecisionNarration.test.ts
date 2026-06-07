import { describe, it, expect } from "vitest";
import {
  summarizeBusinessAction,
  summarizeResidentAction,
  tickerItems,
  latestBusinessDecisions,
  latestDecisionFor,
} from "./DecisionNarration";
import type { DecisionLogEntry } from "../ai/types";
import type { ResidentDecisionLogEntry } from "../ai/residentTypes";

function biz(over: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return {
    day: 1,
    businessId: "biz_goods",
    providerId: "rules",
    fallback: false,
    action: {},
    reason: "steady",
    ...over,
  };
}

function res(over: Partial<ResidentDecisionLogEntry> = {}): ResidentDecisionLogEntry {
  return {
    day: 1,
    residentId: "res_0",
    residentName: "Ada",
    providerId: "rules",
    fallback: false,
    action: {},
    reason: "content",
    ...over,
  };
}

describe("summarizeBusinessAction", () => {
  it("renders each lever and joins them in a fixed, deterministic order", () => {
    const s = summarizeBusinessAction({
      setPrice: 18,
      hire: 1,
      invest: 250,
      brand: 120,
      setWage: 0.2,
      setPayout: 0.5,
    });
    expect(s).toBe("price→$18, +1 hire, invest $250, brand $120, wage→0.200, payout→50%");
  });

  it("shows a layoff as a negative count", () => {
    expect(summarizeBusinessAction({ hire: -1 })).toBe("-1 layoff");
  });

  it("reads an empty action as 'hold'", () => {
    expect(summarizeBusinessAction({})).toBe("hold");
  });

  it("omits a zero hire/invest/brand (no-op levers don't clutter the feed)", () => {
    expect(summarizeBusinessAction({ hire: 0, invest: 0, brand: 0 })).toBe("hold");
  });
});

describe("summarizeResidentAction", () => {
  const resolve = (id: string) => ({ biz_diner: "The Corner Diner", loc_home_2: "Home 3" }[id] ?? id);

  it("renders life moves with resolved names", () => {
    expect(summarizeResidentAction({ switchJobTo: "biz_diner" }, resolve)).toBe("job→The Corner Diner");
    expect(summarizeResidentAction({ reHomeTo: "loc_home_2" }, resolve)).toBe("home→Home 3");
    expect(summarizeResidentAction({ buyVehicle: true }, resolve)).toBe("buy vehicle");
    expect(summarizeResidentAction({ negotiateRaise: true }, resolve)).toBe("ask for raise");
  });

  it("falls back to the raw id when a name is unknown, and 'hold' when empty", () => {
    expect(summarizeResidentAction({ switchJobTo: "biz_x" }, resolve)).toBe("job→biz_x");
    expect(summarizeResidentAction({}, resolve)).toBe("hold");
  });
});

describe("tickerItems", () => {
  const resolvers = {
    businessName: (id: string) => ({ biz_goods: "Maker Goods", biz_diner: "Corner Diner" }[id] ?? id),
    resolveName: (id: string) => ({ biz_diner: "Corner Diner" }[id] ?? id),
  };

  it("merges both logs newest-first, with businesses before residents within a day", () => {
    const business = [biz({ day: 1, businessId: "biz_goods", action: { setPrice: 34 } }), biz({ day: 2, businessId: "biz_diner", action: { hire: 1 } })];
    const resident = [res({ day: 1 }), res({ day: 2, residentId: "res_1", residentName: "Bea", action: { negotiateRaise: true } })];
    const feed = tickerItems(business, resident, resolvers);

    // Day 2 first; within day 2, the business (Corner Diner) precedes the resident (Bea).
    expect(feed.map((i) => `${i.day}:${i.kind}:${i.actorName}`)).toEqual([
      "2:business:Corner Diner",
      "2:resident:Bea",
      "1:business:Maker Goods",
      "1:resident:Ada",
    ]);
    expect(feed[0]!.summary).toBe("+1 hire");
  });

  it("honours the limit, keeping only the most recent rows", () => {
    const business = [biz({ day: 1 }), biz({ day: 2 }), biz({ day: 3 })];
    const feed = tickerItems(business, [], resolvers, 2);
    expect(feed.map((i) => i.day)).toEqual([3, 2]);
  });

  it("carries the fallback flag through", () => {
    const feed = tickerItems([biz({ fallback: true })], [], resolvers);
    expect(feed[0]!.fallback).toBe(true);
  });

  it("is pure: identical inputs yield identical output and the inputs are untouched", () => {
    const business = [biz({ day: 2 }), biz({ day: 1 })];
    const resident = [res({ day: 1 })];
    const a = tickerItems(business, resident, resolvers);
    const b = tickerItems(business, resident, resolvers);
    expect(a).toEqual(b);
    expect(business.map((e) => e.day)).toEqual([2, 1]); // input order unchanged
  });
});

describe("latestBusinessDecisions", () => {
  it("keeps the most recent decision per business", () => {
    const log = [
      biz({ day: 1, businessId: "biz_goods", action: { setPrice: 30 } }),
      biz({ day: 3, businessId: "biz_goods", action: { setPrice: 36 } }),
      biz({ day: 2, businessId: "biz_diner", action: { hire: 1 } }),
    ];
    const latest = latestBusinessDecisions(log);
    expect(latest.size).toBe(2);
    expect(latest.get("biz_goods")!.action.setPrice).toBe(36);
    expect(latest.get("biz_diner")!.day).toBe(2);
  });
});

describe("latestDecisionFor", () => {
  const business = [biz({ day: 1, businessId: "biz_goods" }), biz({ day: 4, businessId: "biz_goods", reason: "newest" })];
  const resident = [res({ day: 5, residentId: "res_0", reason: "res newest" })];

  it("finds the latest business decision for a business id", () => {
    expect(latestDecisionFor("biz_goods", business, resident)!.reason).toBe("newest");
  });

  it("finds the latest resident decision for a resident id", () => {
    expect(latestDecisionFor("res_0", business, resident)!.reason).toBe("res newest");
  });

  it("returns undefined for an unknown id", () => {
    expect(latestDecisionFor("nobody", business, resident)).toBeUndefined();
  });
});
