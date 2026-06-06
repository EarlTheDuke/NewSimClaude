import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";
import { DEFAULT_LIMITS } from "../ai/clamp";
import type { BusinessObservation } from "../ai/types";
import { DINER_MEAL_PRICE } from "./constants";

const BOTH_DINERS = ["biz_diner", "biz_diner_2", "biz_goods"];
/** Meals sold = revenue booked / asking price (exact while price is fixed). */
const meals = (b: { pnl: { revenue: number }; price: number }) => Math.round(b.pnl.revenue / b.price);

/**
 * A minimal retail observation with sane defaults, so each pricer unit test only
 * has to name the fields it cares about. Defaults describe a calm break-even
 * diner at its anchor with no rival — the pricer leaves that alone.
 */
function dinerObs(over: Partial<BusinessObservation> = {}): BusinessObservation {
  return {
    businessId: "biz_diner",
    name: "The Corner Diner",
    kind: "diner",
    day: 1,
    cash: 4000,
    inventory: 40,
    price: 18,
    referencePrice: 18,
    employeeCount: 1,
    wagePerTick: 0.17,
    baseWagePerTick: 0.17,
    understaffed: false,
    dayRevenue: 0,
    dayWages: 0,
    dayRent: 0,
    dayProfit: 0,
    unemployedCount: 0,
    ...over,
  };
}

describe("Phase 11b storefront competition", () => {
  // --- The pricer in isolation (deterministic, no world) ------------------
  describe("rival-aware, cost-floored rules pricer", () => {
    const provider = new RuleBasedProvider();
    const price = (o: BusinessObservation) =>
      provider.decide({ observation: o, limits: DEFAULT_LIMITS }).action.setPrice;

    it("eases toward an undercutting rival when a day loses money", () => {
      // Priced (18) above the rival (14) and losing: step down by 5%, no further
      // than the rival's price. The going rate is the competitor, not the anchor.
      const p = price(dinerObs({ price: 18, rivalPrice: 14, unitCost: 8, dayProfit: -10 }));
      expect(p).toBeCloseTo(Math.max(14, 18 * 0.95), 6); // 17.1
    });

    it("never proposes a price below unit cost once a rival exists", () => {
      // Rival (6) sits below our own input cost (8). Easing toward it would price
      // every meal below what the food costs — the floor lifts it back to cost.
      const p = price(dinerObs({ price: 8.2, rivalPrice: 6, unitCost: 8, dayProfit: -10 }));
      expect(p).toBe(8);
    });

    it("caps a headroom raise at the rival's price (won't price past the competition)", () => {
      // Below the rival (16) and losing, the plain rule would raise 10% to 17.05;
      // matching the rival is the ceiling, so it stops at 16 and keeps the volume.
      const p = price(dinerObs({ price: 15.5, rivalPrice: 16, unitCost: 8, dayProfit: -10 }));
      expect(p).toBe(16);
    });

    it("is byte-identical to the anchor-only rule when there is no rival", () => {
      // unitCost is present but must be ignored without a rival, and the going
      // rate falls back to the static reference — exactly the Phase 11a behaviour.
      const above = price(dinerObs({ price: 22, referencePrice: 18, rivalPrice: undefined, unitCost: 8, dayProfit: -10 }));
      expect(above).toBeCloseTo(Math.max(18, 22 * 0.95), 6); // 20.9
      const below = price(dinerObs({ price: 14, referencePrice: 18, rivalPrice: undefined, unitCost: 8, dayProfit: -10 }));
      expect(below).toBeCloseTo(14 * 1.1, 6); // 15.4
    });
  });

  // --- Where the town shops: price + distance (brain off, prices fixed) ----
  describe("customers split on price and distance", () => {
    function twoDiners(diner2Price: number, days = 30) {
      // wealthElasticity 0: these tests measure how geography + price split a
      // FIXED pool of food demand. With wealth-elastic demand on, a price cut
      // leaves residents richer and they buy more — a real effect, but one that
      // confounds the price-inelasticity claim, so it is exercised separately in
      // elasticity.test (Phase 13b). Here we hold demand neutral.
      const { sim, world } = createCity({ seed: 1, secondDiner: true, wealthElasticity: 0 }); // brain off
      world.getBusiness("biz_diner_2")!.price = diner2Price;
      sim.run(TICKS_PER_DAY * days);
      return { d1: world.getBusiness("biz_diner")!, d2: world.getBusiness("biz_diner_2")! };
    }

    it("at equal prices, geography alone splits the lunch crowd (both fed)", () => {
      const { d1, d2 } = twoDiners(DINER_MEAL_PRICE); // 18 vs 18
      expect(meals(d1)).toBeGreaterThan(0);
      expect(meals(d2)).toBeGreaterThan(0);
      // The original diner sits nearest more homes, so it draws the larger share.
      expect(meals(d1)).toBeGreaterThan(meals(d2));
    });

    it("an undercut pulls customers across town, even to the farther store", () => {
      // diner_2 is the geographically disadvantaged one, yet a $2 undercut wins it
      // the majority — proof that price, not just location, moves the crowd.
      const { d1, d2 } = twoDiners(16);
      expect(meals(d2)).toBeGreaterThan(meals(d1));
    });

    it("total meals are unchanged by the split — demand for food is price-inelastic", () => {
      const even = twoDiners(DINER_MEAL_PRICE);
      const cut = twoDiners(16);
      const totalEven = meals(even.d1) + meals(even.d2);
      const totalCut = meals(cut.d1) + meals(cut.d2);
      // Where people eat shifts with price; that they eat does not.
      expect(Math.abs(totalEven - totalCut)).toBeLessThanOrEqual(2);
    });
  });

  // --- Two trading minds in the same market (both diners agentic) ----------
  describe("rival diners under the rules brain reach a truce, not a monopoly", () => {
    const city = (seed: number, mutate?: (id: string) => number) => {
      const c = createCity({ seed, secondDiner: true, brain: "rules", agenticBusinessIds: BOTH_DINERS });
      if (mutate) c.world.getBusiness("biz_diner_2")!.price = mutate("biz_diner_2");
      return c;
    };

    it("converges to a shared price after a deep undercut — both survive", () => {
      // diner_2 opens with a deep but *viable* undercut (14 vs the 18 anchor).
      // A below-cost war price (e.g. 12) is no longer survivable now that the
      // free-restock produce exploit is gone (Phase 15 E1): an underwater diner
      // correctly bleeds out as the distribution system skims its good days but
      // not its bad ones. So the truce is tested at a price a rival can actually
      // hold — they still converge to a single shared price and both survive.
      const { sim, world } = city(1, () => 14);
      sim.run(TICKS_PER_DAY * 90);
      const d1 = world.getBusiness("biz_diner")!;
      const d2 = world.getBusiness("biz_diner_2")!;
      // The war ends in a matched price (geography then splits the customers),
      // not in one store driving the other out of business.
      expect(Math.abs(d1.price - d2.price)).toBeLessThan(0.5);
      expect(d1.active).toBe(true);
      expect(d2.active).toBe(true);
    });

    it("an overpriced rival is arbitraged back down toward the market", () => {
      const { sim, world } = city(1, () => 30); // diner_2 opens way overpriced
      sim.run(TICKS_PER_DAY * 90);
      const d2 = world.getBusiness("biz_diner_2")!;
      // It can't hold 30 against a cheaper neighbour; it eases back into the pack.
      expect(d2.price).toBeLessThan(28);
      expect(d2.active).toBe(true);
    });

    it("both stores outlast a 120-day soak (no instant monopoly), money conserved", () => {
      const { sim, world, market } = city(1);
      const start = world.totalMoney();
      sim.run(TICKS_PER_DAY * 120);
      const d1 = world.getBusiness("biz_diner")!;
      const d2 = world.getBusiness("biz_diner_2")!;
      expect(d1.active).toBe(true);
      expect(d2.active).toBe(true);
      // The closed loop still balances to the cent.
      expect(world.totalMoney()).toBeCloseTo(start, 4);
      // And neither store is ever caught selling a meal below what food costs.
      const foodCost = market.priceBook().food;
      expect(d1.price + 1e-9).toBeGreaterThanOrEqual(foodCost);
      expect(d2.price + 1e-9).toBeGreaterThanOrEqual(foodCost);
    });

    it("is deterministic: identical seed -> identical world after 60 days", () => {
      const a = city(7, () => 12);
      const b = city(7, () => 12);
      a.sim.run(TICKS_PER_DAY * 60);
      b.sim.run(TICKS_PER_DAY * 60);
      expect(a.world.serialize()).toEqual(b.world.serialize());
    });
  });

  // --- The flag is genuinely opt-in --------------------------------------
  describe("the second diner is opt-in", () => {
    it("adds biz_diner_2 only when secondDiner is set", () => {
      expect(createCity({ seed: 1 }).world.getBusiness("biz_diner_2")).toBeUndefined();
      expect(createCity({ seed: 1, secondDiner: true }).world.getBusiness("biz_diner_2")).toBeDefined();
    });
  });
});
