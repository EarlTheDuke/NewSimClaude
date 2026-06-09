import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { BANK_SEED_CASH } from "./constants";

/**
 * Initiative C / Phase 18a — the inert credit seam. The CreditSystem is registered (between
 * distribution and lifecycle) but does nothing: no Bank is seeded, no debt is booked, no money
 * moves. The default city must be byte-identical, and even with `creditEnabled` on the 18a stub is
 * still a true no-op. Re-grounded against the post-4d code: no BusinessKind/record change here — the
 * bank arrives as a registry entry with a role flag in 18b.
 */
describe("CreditSystem — inert seam (Phase 18a)", () => {
  it("the default city carries no debt and conserves money over 30 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    for (const b of world.businesses) {
      expect("debt" in b).toBe(false); // never booked
      expect(b.pnl.debtService).toBeUndefined();
    }
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("round-trips: serialize → restore deep-equals (CreditSystem is stateless)", () => {
    const original = createCity({ seed: 1 });
    original.sim.run(TICKS_PER_DAY * 20);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 99 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });

  it("is deterministic with creditEnabled set: seed 7 twice → identical world", () => {
    const run = () => {
      const c = createCity({ seed: 7, creditEnabled: true }); // enabled, but the 18a stub does nothing
      c.sim.run(TICKS_PER_DAY * 20);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });

  it("creditEnabled:true is byte-identical to off in 18a (the stub is a true no-op)", () => {
    const off = createCity({ seed: 1 });
    off.sim.run(TICKS_PER_DAY * 20);
    const on = createCity({ seed: 1, creditEnabled: true });
    on.sim.run(TICKS_PER_DAY * 20);
    expect(on.world.serialize()).toEqual(off.world.serialize());
  });
});

/**
 * Phase 18b — seed the Bank as a conserving holder (no lending yet). It exists, is counted in
 * `totalMoney()`, keeps its reserve (not swept), and is never bankrupted. Strictly opt-in: the
 * default city has no bank and exactly seven businesses.
 */
describe("CreditSystem — seed the Bank (Phase 18b)", () => {
  it("seeds the bank carved from the landlord, so the genesis total is unchanged", () => {
    const plain = createCity({ seed: 1 });
    const banked = createCity({ seed: 1, includeBank: true });

    const bank = banked.world.getBusiness("biz_bank")!;
    expect(bank).toBeDefined();
    expect(bank.kind).toBe("bank");
    expect(bank.cash).toBe(BANK_SEED_CASH);
    // The seed was carved from the landlord, not minted — genesis total matches the default city.
    expect(banked.world.getBusiness("biz_landlord")!.cash).toBe(
      plain.world.getBusiness("biz_landlord")!.cash - BANK_SEED_CASH,
    );
    expect(banked.world.totalMoney()).toBeCloseTo(plain.world.totalMoney(), 6);
  });

  it("runs 60 days with a bank: conserved, bank stays solvent + never swept below its seed", () => {
    const { sim, world } = createCity({ seed: 1, includeBank: true });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 60);
    const bank = world.getBusiness("biz_bank")!;
    expect(bank.active).toBe(true); // never bankrupted
    expect(bank.cash).toBeGreaterThanOrEqual(BANK_SEED_CASH); // below its reserve ⇒ not swept by distribution
    expect(bank.employeeIds.length).toBe(0); // non-producing ⇒ never staffed
    expect(world.totalMoney()).toBeCloseTo(start, 4);
  });

  it("is strictly opt-in: the default city has no bank and exactly seven businesses", () => {
    const { world } = createCity({ seed: 1 });
    expect(world.getBusiness("biz_bank")).toBeUndefined();
    expect(world.businesses.filter((b) => b.active).length).toBe(7); // protects macro.test's count
  });

  it("is deterministic with includeBank: same seed twice → identical world", () => {
    const run = () => {
      const c = createCity({ seed: 7, includeBank: true });
      c.sim.run(TICKS_PER_DAY * 30);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});
