import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { DINER_MEAL_PRICE, GOODS_PRICE, LEISURE_PRICE_SPREAD } from "./constants";

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
