import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import {
  BroadcastModel,
  ThoughtCam,
  DramaDetector,
  chipify,
  runway,
  towerHTML,
  thoughtCardHTML,
  bannerHTML,
  winProbability,
  evalBarHTML,
  reportCardHTML,
  type FirmCard,
} from "./broadcast";
import type { DecisionLogEntry } from "../ai/types";

function card(over: Partial<FirmCard> = {}): FirmCard {
  return {
    id: "biz_a",
    name: "A Diner",
    kind: "diner",
    active: true,
    score: 0,
    rank: 1,
    rankDelta: 0,
    momentum: 0,
    runwayDays: Infinity,
    staff: 2,
    wageMult: 1,
    pricePosture: 0,
    brandValue: 0,
    ...over,
  };
}

describe("broadcast (R4 wave 1+2) — read-only presentation over the world", () => {
  it("runway: needs a trend, reads burn, Infinity when not burning", () => {
    expect(runway(100, [100, 90])).toBe(Infinity); // two samples = not a trend yet
    expect(runway(80, [100, 90, 80])).toBeCloseTo(8, 5); // burning $10/day → 8 days
    expect(runway(120, [100, 110, 120])).toBe(Infinity); // growing
  });

  it("chipify: actions become broadcast chips; empty action reads HOLD", () => {
    expect(chipify({ setPrice: 14, hire: 1, setPayout: 0 })).toEqual([
      "PRICE → $14",
      "HIRE +1",
      "RETAIN 100%",
    ]);
    expect(chipify({ hire: -2 })).toEqual(["CUT 2"]);
    expect(chipify({})).toEqual(["HOLD"]);
  });

  it("the model ranks players by growth score and never mutates the sim", () => {
    const { sim, world } = createCity({ seed: 9, secondDiner: true });
    const players = ["biz_diner", "biz_diner_2", "biz_goods"];
    const model = new BroadcastModel(world, players);
    model.sampleDay(world);
    const before = JSON.stringify(world.serialize());
    sim.run(TICKS_PER_DAY * 3);
    for (let i = 0; i < 3; i++) model.sampleDay(world);
    const cards = model.cards(world);
    const after = world.serialize();
    expect(cards.length).toBe(3);
    expect(cards[0]!.rank).toBe(1);
    expect(cards.map((c) => c.rank)).toEqual([1, 2, 3]);
    // determinism guard: the same run with no broadcast produces the same world
    const twin = createCity({ seed: 9, secondDiner: true });
    twin.sim.run(TICKS_PER_DAY * 3);
    expect(after).toEqual(twin.world.serialize());
    expect(before).not.toBe(""); // (lint appeasement: before captured)
    expect(towerHTML(cards)).toContain("tw-row");
  });

  it("the drama booth: anchors silently, then catches bankruptcies, poaches, and records", () => {
    const { world } = createCity({ seed: 9, secondDiner: true });
    const players = ["biz_diner", "biz_diner_2"];
    const drama = new DramaDetector(players);
    // Day 0 anchors — a fresh watch must not invent phantom drama.
    expect(drama.sampleDay(world, 0)).toEqual([]);

    // A poach between the two player diners (test-side mutation; the detector only reads).
    const worker = world.residents.find((r) => r.jobId === "biz_diner")!;
    worker.jobId = "biz_diner_2";
    // A bankruptcy among the cast crew.
    const bakery = world.getBusiness("biz_bakery")!;
    bakery.active = false;
    // A record revenue day for a player.
    const diner = world.getBusiness("biz_diner")!;
    diner.pnl.revenue += 400;

    const events = drama.sampleDay(world, 1);
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(["bankrupt", "poach", "record"]);
    const poach = events.find((e) => e.kind === "poach")!;
    expect(poach.headline).toContain(worker.name);
    expect(poach.severity).toBe(2);
    expect(bannerHTML(poach)).toContain("bn-s2");

    // No repeats: the same world state next day produces no fresh drama.
    expect(drama.sampleDay(world, 2)).toEqual([]);

    // A move from a NON-player firm into a player firm is a plain hire, not a poach banner.
    const farmhand = world.residents.find((r) => r.jobId === "biz_farm")!;
    farmhand.jobId = "biz_diner";
    expect(drama.sampleDay(world, 3)).toEqual([]);
  });

  it("the eval bar: symmetric, score- and momentum-sensitive, decisive on bankruptcy", () => {
    const even = winProbability(card(), card({ id: "biz_b" }));
    expect(even).toBeCloseTo(0.5, 5);
    const ahead = winProbability(card({ score: 300 }), card({ id: "biz_b" }));
    expect(ahead).toBeGreaterThan(0.7);
    // symmetry: P(A beats B) + P(B beats A) = 1
    expect(ahead + winProbability(card({ id: "biz_b" }), card({ score: 300 }))).toBeCloseTo(1, 9);
    // momentum matters: same gap, but B is climbing fast → B's chances improve
    const calm = winProbability(card({ score: 100 }), card({ id: "biz_b" }));
    const charging = winProbability(card({ score: 100 }), card({ id: "biz_b", momentum: 200 }));
    expect(charging).toBeLessThan(calm);
    // a bankrupt contestant has lost
    expect(winProbability(card({ active: false }), card({ id: "biz_b" }))).toBeLessThan(0.05);
    expect(evalBarHTML(card({ score: 300 }), card({ id: "biz_b" }))).toContain("ev-fill");
  });

  it("the report card declares the right winner and survives a bankruptcy verdict", () => {
    const a = { ...card({ score: 500 }), decisions: 30, missed: 0 };
    const b = { ...card({ id: "biz_b", name: "B Diner", score: 200 }), decisions: 28, missed: 2 };
    const html = reportCardHTML(a, b, 90);
    expect(html).toContain("A Diner WINS");
    expect(html).toContain("2 missed");
    // bankruptcy overrides score: the survivor wins even from behind
    const broke = { ...card({ score: 900, active: false }), decisions: 30, missed: 0 };
    expect(reportCardHTML(broke, b, 90)).toContain("B Diner WINS");
  });

  it("the drama booth: regime banners fire once (press on, first sail)", () => {
    const { sim, world } = createCity({
      seed: 9,
      includePort: true,
      tradeEnabled: true,
      includeAuthority: true,
      monetaryEnabled: true,
    });
    const drama = new DramaDetector(["biz_diner"]);
    drama.sampleDay(world, 0); // anchor before any trade lands
    sim.run(TICKS_PER_DAY + 10); // day boundary: the port's first export buy happens
    const events = drama.sampleDay(world, 1);
    expect(events.some((e) => e.kind === "trade")).toBe(true);
    // And never again.
    sim.run(TICKS_PER_DAY);
    expect(drama.sampleDay(world, 2).some((e) => e.kind === "trade")).toBe(false);
  });

  it("the thought cam shows only the LLM seats, with think time and missed turns", () => {
    const { world } = createCity({ seed: 9, secondDiner: true });
    const cam = new ThoughtCam(new Set(["biz_diner_2"]), "test-model");
    const log: DecisionLogEntry[] = [
      { day: 1, businessId: "biz_diner", providerId: "rules", fallback: false, action: { setPrice: 11 }, reason: "rules move" },
      { day: 1, businessId: "biz_diner_2", providerId: "router", fallback: false, action: { hire: 1, setPayout: 0 }, reason: "retain and staff up", usage: { latencyMs: 157000 } },
    ];
    const cards = cam.poll(log, world);
    expect(cards.length).toBe(1); // the rules firm stays quiet
    expect(cards[0]!.chips).toEqual(["HIRE +1", "RETAIN 100%"]);
    expect(cards[0]!.thinkSeconds).toBeCloseTo(157, 1);
    expect(thoughtCardHTML(cards[0]!)).toContain("deliberated 2.6m");
    // nothing new since last poll → no cards
    expect(cam.poll(log, world).length).toBe(0);
    // a fallback entry on the LLM seat reads as a missed turn
    const missed = cam.poll(
      [...log, { day: 2, businessId: "biz_diner_2", providerId: "rules", fallback: true, action: {}, reason: "covered" }],
      world,
    );
    expect(missed.length).toBe(1);
    expect(missed[0]!.missedTurn).toBe(true);
    expect(thoughtCardHTML(missed[0]!)).toContain("missed the turn");
  });
});
