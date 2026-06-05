import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import {
  DINER_MEAL_PRICE,
  GOODS_PRICE,
  LEISURE_PRICE_SPREAD,
  WEALTH_BASELINE,
  WEALTH_DEMAND_CAP,
} from "./constants";
import { consumptionUnits } from "./EconomySystem";

const THIRTY_DAYS = TICKS_PER_DAY * 30;

/**
 * Leisure revenue booked at the goods store over `days`, with the store priced
 * at `price`. Brain + residentBrain are both OFF, so the store never re-prices
 * and residents buy no luxuries/vehicles — goods.pnl.revenue is then *pure*
 * leisure spend, the clean signal for measuring discretionary demand.
 */
function leisureRevenue(price: number, days = 30): number {
  const { sim, world } = createCity({ seed: 1 });
  world.getBusiness("biz_goods")!.price = price;
  sim.run(TICKS_PER_DAY * days);
  return world.getBusiness("biz_goods")!.pnl.revenue;
}

describe("Phase 11a price-elastic leisure demand", () => {
  describe("a higher price sheds buyers", () => {
    it("leisure revenue falls monotonically as the store prices above its anchor", () => {
      const atAnchor = leisureRevenue(GOODS_PRICE); // 34
      const midway = leisureRevenue(48);
      const steep = leisureRevenue(60);
      expect(atAnchor).toBeGreaterThan(midway);
      expect(midway).toBeGreaterThan(steep);
    });

    it("vanishes once priced past the top reservation, anchor*(1+spread)", () => {
      const ceiling = GOODS_PRICE * (1 + LEISURE_PRICE_SPREAD); // 54.4
      // A dollar past the ceiling: no resident's willingness-to-pay reaches it.
      expect(leisureRevenue(ceiling + 1)).toBe(0);
      // But at the anchor, leisure trade is alive and well.
      expect(leisureRevenue(GOODS_PRICE)).toBeGreaterThan(0);
    });
  });

  describe("neutral at and below the anchor (the back-compat band)", () => {
    it("demand is saturated — the buyer count matches at the anchor and just below", () => {
      const buyers = (price: number) => Math.round(leisureRevenue(price, 10) / price);
      // Tier-0 residents reserve exactly the anchor, so they still buy AT it;
      // dropping a dollar below changes no one. Flat demand across this band is
      // the pre-11a behaviour, reproduced exactly.
      expect(buyers(GOODS_PRICE)).toBe(buyers(GOODS_PRICE - 1));
      expect(buyers(GOODS_PRICE)).toBeGreaterThan(0);
    });
  });

  describe("invariants hold under elastic demand + the agentic pricer", () => {
    const product = (seed: number) =>
      createCity({
        seed,
        brain: "rules",
        residentBrain: "rules",
        agenticResidentIds: ["res_0", "res_1", "res_2", "res_3"],
      });

    it("conserves total money over 60 days", () => {
      const { sim, world } = product(1);
      const start = world.totalMoney();
      sim.run(TICKS_PER_DAY * 60);
      expect(world.totalMoney()).toBeCloseTo(start, 4);
    });

    it("is deterministic: identical seed -> identical world after 40 days", () => {
      const a = product(7);
      const b = product(7);
      a.sim.run(TICKS_PER_DAY * 40);
      b.sim.run(TICKS_PER_DAY * 40);
      expect(a.world.serialize()).toEqual(b.world.serialize());
    });

    it("keeps storefront prices in a sane band — no runaway to the clamp cap", () => {
      const { sim, world } = product(1);
      sim.run(TICKS_PER_DAY * 120);
      const diner = world.getBusiness("biz_diner")!.price;
      const goods = world.getBusiness("biz_goods")!.price;
      // Anchored near their references (18, 34), nowhere near the cap (100).
      // The old loss-chases-price-up rule pinned both here within ~90 days.
      expect(diner).toBeGreaterThan(DINER_MEAL_PRICE * 0.5);
      expect(diner).toBeLessThan(DINER_MEAL_PRICE * 2);
      expect(goods).toBeGreaterThan(GOODS_PRICE * 0.5);
      expect(goods).toBeLessThan(GOODS_PRICE * 2);
    });
  });

  describe("the no-agency baseline never moves off its anchor", () => {
    it("with brain off, retail prices are unchanged from their seeds after 30 days", () => {
      const { sim, world } = createCity({ seed: 1 }); // brain off, residentBrain off
      sim.run(THIRTY_DAYS);
      expect(world.getBusiness("biz_diner")!.price).toBe(DINER_MEAL_PRICE);
      expect(world.getBusiness("biz_goods")!.price).toBe(GOODS_PRICE);
    });
  });
});

describe("Phase 13a — wealth-elastic consumption (inert no-op scaffold)", () => {
  // consumptionUnits is the pure, RNG-free core of "wants grow with wealth". At
  // the shipped default (WEALTH_ELASTICITY = 0) it returns 1 for everyone — the
  // byte-identity guarantee. These tests pass an explicit elasticity to exercise
  // the curve that 13b will turn on city-wide.
  describe("consumptionUnits()", () => {
    it("returns 1 for any wealth at the shipped default (the keystone is off)", () => {
      expect(consumptionUnits({ id: "res_0", money: WEALTH_BASELINE })).toBe(1);
      expect(consumptionUnits({ id: "res_3", money: 100_000 })).toBe(1); // rich, but knob off
    });

    it("buys exactly one at or below the baseline even with elasticity on", () => {
      expect(consumptionUnits({ id: "res_0", money: WEALTH_BASELINE }, 1)).toBe(1);
      expect(consumptionUnits({ id: "res_0", money: 200 }, 1)).toBe(1); // ratio < 1 -> mult floored to 1
      expect(consumptionUnits({ id: "res_0", money: 0 }, 1)).toBe(1);
    });

    it("a richer resident orders more once elasticity is on", () => {
      // res_0 has phase 0 (idx 0), so units == floor(mult).
      expect(consumptionUnits({ id: "res_0", money: 1000 }, 1)).toBe(2); // ratio 2 -> mult 2
      expect(consumptionUnits({ id: "res_0", money: 1500 }, 1)).toBe(3); // ratio 3 -> mult 3
    });

    it("clamps the rich tail at WEALTH_DEMAND_CAP", () => {
      expect(consumptionUnits({ id: "res_0", money: 1_000_000 }, 1)).toBe(WEALTH_DEMAND_CAP);
    });

    it("is monotone non-decreasing in wealth", () => {
      let prev = 0;
      for (const money of [0, 400, 500, 600, 800, 1000, 2000, 5000, 50_000]) {
        const u = consumptionUnits({ id: "res_2", money }, 1);
        expect(u).toBeGreaterThanOrEqual(prev);
        prev = u;
      }
    });

    it("spreads the fractional unit across the town by index (deterministic, no RNG)", () => {
      // At ratio 1.5 (mult 1.5) the half-unit splits the population: low-phase
      // residents round down to 1, high-phase residents round up to 2 — and the
      // same id always yields the same answer.
      const at = (id: string) => consumptionUnits({ id, money: 750 }, 1);
      expect(at("res_0")).toBe(1); // phase 0    -> floor(1.5)       = 1
      expect(at("res_5")).toBe(2); // phase 5/6  -> floor(1.5 + 0.83) = 2
      expect(at("res_0")).toBe(at("res_0")); // repeatable
    });
  });

  it("ships inert: every resident starts at WEALTH_BASELINE (drift guard)", () => {
    // The whole no-op rests on the pivot equalling the seeded starting money. If
    // cityGen ever changes the $500 start, this fails loudly so WEALTH_BASELINE
    // gets updated in lockstep.
    const { world } = createCity({ seed: 1 });
    for (const r of world.residents) expect(r.money).toBe(WEALTH_BASELINE);
  });

  it("leaves the no-agency baseline byte-identical: same seed -> identical world after 30 days", () => {
    // EconomySystem stays RNG-free (the loop draws nothing from ctx.rng), so the
    // seeded stream is untouched and a 13a city reproduces exactly. The cross-check
    // against the pre-13a numbers is the rest of this suite (and city/macro/soak)
    // staying green.
    const a = createCity({ seed: 1 });
    const b = createCity({ seed: 1 });
    a.sim.run(THIRTY_DAYS);
    b.sim.run(THIRTY_DAYS);
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});
