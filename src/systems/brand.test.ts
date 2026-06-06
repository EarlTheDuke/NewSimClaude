import { describe, it, expect } from "vitest";
import { brandFactor } from "./EconomySystem";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { MockProvider } from "../ai/MockProvider";
import { clampAction, DEFAULT_LIMITS } from "../ai/clamp";
import { BRAND_BASELINE } from "./constants";

/**
 * Phase 17 — the brand-equity lever (demand-side twin of capital). 17a ships the
 * inert seam: the stock fields, the constants (elasticity 0), the pure `brandFactor`,
 * and the decay block. With the master knob at 0 and the field never seeded, the whole
 * thing is a byte-identical no-op — that is what these tests pin.
 */
describe("Phase 17a — brand seam (inert)", () => {
  it("brandFactor is the hard OFF switch at elasticity 0 (even at huge brand)", () => {
    expect(brandFactor({ brand: 9e9 }, 0)).toBe(1);
    expect(brandFactor({ brand: undefined }, 0)).toBe(1);
    expect(brandFactor({ brand: 0 }, 0)).toBe(1);
  });

  it("brandFactor is unbounded by design — the clamp lives at the call site (Hook A)", () => {
    // (9e9 / 100) ^ 0.3 ≈ 240; pinned as intentional so a careless future caller
    // can't be surprised by an unclamped lift.
    expect(brandFactor({ brand: 9e9 }, 0.3)).toBeGreaterThan(200);
    expect(brandFactor({ brand: 100 }, 0.3)).toBe(1); // exactly 1 at baseline
    expect(brandFactor({ brand: 200 }, 0.3)).toBeCloseTo(Math.pow(2, 0.3), 6); // diminishing returns
    expect(brandFactor({ brand: undefined }, 0.3)).toBe(1); // absent reads as baseline
  });

  it("brand/brandSpent are NEVER seeded — absent on every firm across a brain-off run", () => {
    // The byte-identity guarantee: the field must be genuinely absent so a snapshot
    // (structuredClone) never emits it and a pre-17 save resumes identically.
    const { sim, world } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 30);
    for (const b of world.businesses) {
      expect("brand" in b).toBe(false);
      expect("brandSpent" in b).toBe(false);
    }
  });
});

describe("Phase 17b — Hook A reservation lift", () => {
  // Drive a goods store at a chosen price + brand, brain-off, and read its leisure
  // revenue. Brand lifts residents' reservation prices, so more of them clear the
  // cutoff and buy — the lever's teeth, exercised through the public sim surface.
  const goodsRevenue = (opts: { price: number; brand?: number; brandElasticity: number }) => {
    const { sim, world } = createCity({ seed: 1, brandElasticity: opts.brandElasticity });
    const goods = world.getBusiness("biz_goods")!;
    goods.price = opts.price;
    if (opts.brand !== undefined) goods.brand = opts.brand;
    sim.run(TICKS_PER_DAY * 10);
    return goods.pnl.revenue;
  };

  it("brand lifts willingness-to-pay so more shoppers buy at a premium price", () => {
    const withBrand = goodsRevenue({ price: 44, brand: 1e6, brandElasticity: 0.3 });
    const noBrand = goodsRevenue({ price: 44, brandElasticity: 0.3 }); // brand unset ⇒ no lift
    expect(withBrand).toBeGreaterThan(noBrand);
  });

  it("the lift is clamped to anchor × (1 + LEISURE_PRICE_SPREAD) — no super-premium region", () => {
    // goods anchor 34, spread 0.6 ⇒ ceiling 54.4. Even at max brand a price above the
    // ceiling wins no leisure buyer; just under it, the brand-lifted tiers buy.
    const atCeiling = goodsRevenue({ price: 54, brand: 9e9, brandElasticity: 0.3 });
    const aboveCeiling = goodsRevenue({ price: 60, brand: 9e9, brandElasticity: 0.3 });
    expect(atCeiling).toBeGreaterThan(aboveCeiling);
  });

  it("brandElasticity 0 (the frozen/default knob) leaves revenue byte-identical with or without brand", () => {
    const withBrand = goodsRevenue({ price: 44, brand: 1e6, brandElasticity: 0 });
    const noBrand = goodsRevenue({ price: 44, brandElasticity: 0 });
    expect(withBrand).toBe(noBrand);
  });
});

describe("Phase 17c — the brand lever (action + clamp + apply, conserving)", () => {
  it("clampAction bounds brand to [0, maxBrandPerReview]", () => {
    expect(clampAction({ brand: -50 }, 34, DEFAULT_LIMITS).brand).toBe(0);
    expect(clampAction({ brand: 300 }, 34, DEFAULT_LIMITS).brand).toBe(300);
    expect(clampAction({ brand: 999_999 }, 34, DEFAULT_LIMITS).brand).toBe(DEFAULT_LIMITS.maxBrandPerReview);
    expect(clampAction({ brand: NaN }, 34, DEFAULT_LIMITS).brand).toBeUndefined();
  });

  it("a brand spend is a conserved cash->landlord transfer that builds the stock", () => {
    const provider = new MockProvider({ fixed: { action: { brand: 500 }, reason: "ad" } });
    const { sim, world } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_goods"] });
    const goods = world.getBusiness("biz_goods")!;
    goods.cash = 50_000; // genesis headroom to spend
    const startMoney = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);
    expect(goods.brandSpent ?? 0).toBeGreaterThan(0); // spend recorded
    expect(goods.brand ?? 0).toBeGreaterThan(BRAND_BASELINE); // stock built above baseline
    expect(world.totalMoney()).toBeCloseTo(startMoney, 2); // closed economy holds to the cent
  });

  it("applyBrand never self-transfers — an agentic landlord mints no brand", () => {
    const provider = new MockProvider({ fixed: { action: { brand: 500 }, reason: "ad" } });
    const { sim, world } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_landlord"] });
    const landlord = world.getBusiness("biz_landlord")!;
    landlord.cash = 50_000;
    const startMoney = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);
    expect("brand" in landlord).toBe(false); // sink === self ⇒ guarded ⇒ no stock built
    expect(world.totalMoney()).toBeCloseTo(startMoney, 2);
  });
});
