import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { LUXURY_COST } from "./constants";

const YEAR = TICKS_PER_DAY * 365;

/**
 * Phase 15 C — the owner dividend. A slice (λ) of each firm's daily distributable
 * profit goes to its owner before the rest recirculates evenly to everyone. It is
 * a *split*, not a re-route: the even payout is the closed economy's primary
 * demand pump, so λ is kept modest and the bulk still spreads across town. What
 * these tests pin is that owning a firm now pays — and that the closed economy
 * still balances to the cent through the split.
 */
describe("Phase 15 C — owner dividend", () => {
  it("owners accumulate more wealth than non-owners over a year", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
    });
    const startMoney = world.totalMoney();
    sim.run(YEAR);

    const ownerIds = new Set(world.businesses.map((b) => b.ownerId));
    // Total wealth = cash plus the luxuries it was spent into — a rich owner draws
    // the dividend down into luxuries, so cash alone understates the gap.
    const wealth = (r: { money: number; luxuriesOwned?: number }) =>
      r.money + (r.luxuriesOwned ?? 0) * LUXURY_COST;
    const avg = (rs: typeof world.residents) => rs.reduce((s, r) => s + wealth(r), 0) / rs.length;
    const owners = world.residents.filter((r) => ownerIds.has(r.id));
    const nonOwners = world.residents.filter((r) => !ownerIds.has(r.id));

    expect(owners.length).toBeGreaterThan(0);
    expect(nonOwners.length).toBeGreaterThan(0);
    expect(avg(owners)).toBeGreaterThan(avg(nonOwners)); // owning a firm pays
    // ...and the closed economy still balances to the cent through the split.
    expect(world.totalMoney()).toBeCloseTo(startMoney, 2);
  });

  it("the dividend itself widens the owner/non-owner wealth gap (vs share frozen to 0)", () => {
    // Isolate the dividend's contribution: run the identical city with the live
    // share and with it frozen to 0. The owner-vs-non-owner wealth gap is larger
    // with the dividend on — proof the gap is the dividend's doing, not just an
    // artifact of which residents happen to hold which jobs.
    const ownerGap = (ownerDividendShare: number | undefined): number => {
      const { sim, world } = createCity({
        seed: 1,
        brain: "rules",
        residentBrain: "rules",
        ownerDividendShare,
        agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
        agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
      });
      sim.run(YEAR);
      const ownerIds = new Set(world.businesses.map((b) => b.ownerId));
      const wealth = (r: { money: number; luxuriesOwned?: number }) =>
        r.money + (r.luxuriesOwned ?? 0) * LUXURY_COST;
      const avg = (rs: typeof world.residents) => rs.reduce((s, r) => s + wealth(r), 0) / rs.length;
      const owners = world.residents.filter((r) => ownerIds.has(r.id));
      const nonOwners = world.residents.filter((r) => !ownerIds.has(r.id));
      return avg(owners) - avg(nonOwners);
    };
    expect(ownerGap(undefined)).toBeGreaterThan(ownerGap(0)); // undefined = the live share
  });
});

describe("Phase 16 — retain vs distribute (payoutRate)", () => {
  it("a low payoutRate retains surplus instead of distributing it; default 1.0 unchanged + conserved", () => {
    const run = (payoutRate: number | undefined) => {
      const { sim, world } = createCity({ seed: 1 });
      const goods = world.getBusiness("biz_goods")!;
      goods.cash = 50_000; // genesis surplus, so there is plenty to distribute or retain
      if (payoutRate !== undefined) goods.payoutRate = payoutRate;
      const startMoney = world.totalMoney();
      sim.run(TICKS_PER_DAY * 30);
      return { cash: goods.cash, money: world.totalMoney(), startMoney };
    };
    const retained = run(0); // keep all surplus
    const distributed = run(undefined); // default = full distribution (drains the capped surplus daily)
    expect(retained.cash).toBeGreaterThan(distributed.cash + 10_000);
    expect(retained.money).toBeCloseTo(retained.startMoney, 2); // closed economy still balances
    expect(distributed.money).toBeCloseTo(distributed.startMoney, 2);
  });
});
