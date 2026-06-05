import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { ARCHETYPES, PRODUCER_OF } from "../world/archetypes";
import {
  BASE_RESOURCE_PRICE,
  PRICE_MIN_MULT,
  PRICE_MAX_MULT,
} from "./constants";
import type { ResourceKind } from "../world/types";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];
const HUNDRED_DAYS = TICKS_PER_DAY * 100;

describe("MarketSystem (Phase 4 B2B layer)", () => {
  it("starts every resource at its base price", () => {
    const { market } = createCity({ seed: 1 });
    for (const r of RESOURCES) {
      expect(market.priceBook()[r]).toBe(BASE_RESOURCE_PRICE[r]);
    }
  });

  describe("supply chain runs", () => {
    it("producers earn B2B revenue (the chain actually trades)", () => {
      const { sim, world } = createCity({ seed: 1 });
      sim.run(TICKS_PER_DAY * 5);
      // Primary producers and processors only ever earn via B2B sales.
      for (const id of ["biz_farm", "biz_mine", "biz_bakery", "biz_factory"]) {
        expect(world.getBusiness(id)!.pnl.revenue).toBeGreaterThan(0);
      }
    });

    it("keeps storefronts stocked and processors producing", () => {
      const { sim, world } = createCity({ seed: 1 });
      sim.run(TICKS_PER_DAY * 10);
      // Storefronts hold resident-sellable inventory.
      expect(world.getBusiness("biz_diner")!.inventory).toBeGreaterThan(0);
      expect(world.getBusiness("biz_goods")!.inventory).toBeGreaterThan(0);
      // Processors hold a stock of the output they make.
      expect(world.getBusiness("biz_bakery")!.resources.food ?? 0).toBeGreaterThan(0);
      expect(world.getBusiness("biz_factory")!.resources.wares ?? 0).toBeGreaterThan(0);
    });
  });

  describe("pricing", () => {
    it("keeps every price inside [base*MIN, base*MAX] over 100 days", () => {
      const { sim, market } = createCity({ seed: 2 });
      for (let d = 0; d < 100; d++) {
        sim.run(TICKS_PER_DAY);
        for (const r of RESOURCES) {
          const p = market.priceBook()[r];
          expect(p).toBeGreaterThanOrEqual(BASE_RESOURCE_PRICE[r] * PRICE_MIN_MULT - 1e-9);
          expect(p).toBeLessThanOrEqual(BASE_RESOURCE_PRICE[r] * PRICE_MAX_MULT + 1e-9);
        }
      }
    });

    it("input prices stay below the storefront retail prices (margin preserved)", () => {
      const { sim, world, market } = createCity({ seed: 2 });
      sim.run(HUNDRED_DAYS);
      const diner = world.getBusiness("biz_diner")!;
      const goods = world.getBusiness("biz_goods")!;
      expect(market.priceBook().food).toBeLessThan(diner.price);
      expect(market.priceBook().wares).toBeLessThan(goods.price);
    });

    it("only re-prices at day boundaries, never mid-day", () => {
      const { sim, market } = createCity({ seed: 1 });
      sim.run(TICKS_PER_DAY); // settle one day so prices can move off base
      const snapshot = { ...market.priceBook() };
      for (let t = 0; t < TICKS_PER_DAY - 1; t++) {
        sim.step();
        for (const r of RESOURCES) expect(market.priceBook()[r]).toBe(snapshot[r]);
      }
      // The day-closing tick is allowed to move them.
      sim.step();
    });
  });

  describe("100+ day stability (Phase 4 DoD)", () => {
    it("conserves total money with the market active", () => {
      const { sim, world } = createCity({ seed: 1 });
      const start = world.totalMoney();
      sim.run(HUNDRED_DAYS);
      expect(world.totalMoney()).toBeCloseTo(start, 4);
    });

    it("no business dies — all stay solvent and active", () => {
      const { sim, world } = createCity({ seed: 1 });
      sim.run(HUNDRED_DAYS);
      for (const b of world.businesses) {
        expect(b.active).toBe(true);
        // Working capital intact: nobody is scraping the bankruptcy floor.
        expect(b.cash).toBeGreaterThan(1);
      }
    });

    it("reaches a steady state (prices flat, flows alive)", () => {
      const { sim, world, market } = createCity({ seed: 1 });
      sim.run(HUNDRED_DAYS);
      const pricesAt100 = { ...market.priceBook() };
      const wagesAt100 = world.businesses.reduce((s, b) => s + b.pnl.wagesPaid, 0);
      sim.run(TICKS_PER_DAY * 50);
      const wagesAt150 = world.businesses.reduce((s, b) => s + b.pnl.wagesPaid, 0);
      // Prices have settled — unchanged across the final 50 days.
      for (const r of RESOURCES) expect(market.priceBook()[r]).toBeCloseTo(pricesAt100[r], 6);
      // The economy is not dead — wages keep flowing every day.
      expect(wagesAt150 - wagesAt100).toBeGreaterThan(0);
    });

    it("mean-reverts every price to base, not to a drifted floor (P9-9)", () => {
      // The restoring force (Phase 10f) makes base the unique attractor: with
      // utilization in the neutral band the price drifts back toward base and
      // snaps to it, instead of freezing wherever an early-ramp transient left
      // it — the old bug that ran the city at a persistent low-grade deflation.
      for (const seed of [1, 2, 7]) {
        // Pin demand neutral (keystone off): P9-9 is about the price *restoring
        // force*, which is orthogonal to wealth-elastic demand. With the knob on,
        // higher demand legitimately firms prices above base (covered separately
        // in elasticity.test) — that would mask the reversion mechanism here.
        const { sim, market } = createCity({ seed, wealthElasticity: 0 });
        sim.run(TICKS_PER_DAY * 120);
        for (const r of RESOURCES) {
          expect(market.priceBook()[r]).toBeCloseTo(BASE_RESOURCE_PRICE[r], 6);
        }
      }
    });
  });

  describe("determinism & persistence", () => {
    it("identical seed -> identical price book after 40 days", () => {
      const a = createCity({ seed: 7 });
      const b = createCity({ seed: 7 });
      a.sim.run(TICKS_PER_DAY * 40);
      b.sim.run(TICKS_PER_DAY * 40);
      expect(a.market.priceBook()).toEqual(b.market.priceBook());
    });

    it("save -> reload restores the price book", () => {
      const original = createCity({ seed: 5 });
      original.sim.run(TICKS_PER_DAY * 30 + 200);
      const before = { ...original.market.priceBook() };
      const json = snapshotToJSON(original.sim.serialize());

      const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
      loaded.sim.restore(snapshotFromJSON(json));
      expect(loaded.market.priceBook()).toEqual(before);

      // And the two stay in lockstep when run on.
      original.sim.run(TICKS_PER_DAY * 5);
      loaded.sim.run(TICKS_PER_DAY * 5);
      expect(loaded.market.priceBook()).toEqual(original.market.priceBook());
    });
  });

  describe("archetype wiring", () => {
    it("maps every resource to an active producer", () => {
      const { world } = createCity({ seed: 1 });
      for (const r of RESOURCES) {
        const producer = world.getBusiness(PRODUCER_OF[r]);
        expect(producer).toBeDefined();
        expect(ARCHETYPES[producer!.kind].produces).toBe(r);
      }
    });
  });
});
