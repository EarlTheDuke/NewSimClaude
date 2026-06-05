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

describe("Phase 13 — wealth-elastic consumption (wants grow with wealth)", () => {
  // consumptionUnits is the pure, RNG-free core: the richer a resident, the
  // bigger their order. Phase 13b ships WEALTH_ELASTICITY = 1, so the default-arg
  // call engages; an explicit 0 is the hard off switch the frozen-baseline tests
  // use. Tests pass an explicit elasticity to pin the curve precisely.
  describe("consumptionUnits()", () => {
    it("is ON at the shipped default, with an explicit off switch that returns 1", () => {
      expect(consumptionUnits({ id: "res_0", money: 1000 })).toBe(2); // default knob (1.0): rich -> 2
      expect(consumptionUnits({ id: "res_0", money: WEALTH_BASELINE })).toBe(1); // at baseline -> 1
      expect(consumptionUnits({ id: "res_3", money: 100_000 }, 0)).toBe(1); // explicit off -> 1
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

  it("every resident starts at WEALTH_BASELINE — the pivot drift guard", () => {
    // The whole mechanism rests on the pivot equalling the seeded starting money.
    // If cityGen ever changes the $500 start, this fails loudly so WEALTH_BASELINE
    // gets updated in lockstep.
    const { world } = createCity({ seed: 1 });
    for (const r of world.residents) expect(r.money).toBe(WEALTH_BASELINE);
  });

  it("stays deterministic with the keystone on: same seed -> identical world after 30 days", () => {
    // consumptionUnits is pure and draws nothing from ctx.rng, so EconomySystem
    // stays RNG-free and a wealth-elastic city still reproduces exactly.
    const a = createCity({ seed: 1 });
    const b = createCity({ seed: 1 });
    a.sim.run(THIRTY_DAYS);
    b.sim.run(THIRTY_DAYS);
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });

  it("13b: lifts storefront revenue above the keystone-off baseline (the demand ceiling rose)", () => {
    // The whole point: once residents bank a surplus above $500 they order more,
    // so the same seeded city books more consumption with the knob on than off
    // (probed at ~+22% total storefront revenue over 90 brain-off days).
    const storefrontRevenue = (wealthElasticity: number) => {
      const { sim, world } = createCity({ seed: 1, wealthElasticity });
      sim.run(TICKS_PER_DAY * 60);
      return (
        world.getBusiness("biz_diner")!.pnl.revenue + world.getBusiness("biz_goods")!.pnl.revenue
      );
    };
    const off = storefrontRevenue(0);
    const on = storefrontRevenue(1); // the shipped default
    expect(on).toBeGreaterThan(off * 1.05); // a clear, real lift — not noise
  });
});
