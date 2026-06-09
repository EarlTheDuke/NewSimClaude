import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { BANK_SEED_CASH, BANKRUPT_GRACE_DAYS } from "./constants";
import type {
  BusinessDecision,
  BusinessObservation,
  DecisionProvider,
  DecisionRequest,
} from "../ai/types";

/** A test mind that does nothing but ask to borrow a fixed amount every review. */
class BorrowProvider implements DecisionProvider {
  readonly id = "borrow-test";
  constructor(private readonly amount: number) {}
  decide(): BusinessDecision {
    return { action: { borrow: this.amount }, reason: "borrow test" };
  }
}

/** A test mind that repays a fixed fraction of its debt every review. */
class RepayProvider implements DecisionProvider {
  readonly id = "repay-test";
  constructor(private readonly fraction: number) {}
  decide(): BusinessDecision {
    return { action: { repay: this.fraction }, reason: "repay test" };
  }
}

/** Records the last observation it saw, so a test can assert what the mind was shown. */
class CaptureProvider implements DecisionProvider {
  readonly id = "capture";
  last: BusinessObservation | undefined;
  decide(req: DecisionRequest): BusinessDecision {
    this.last = req.observation;
    return { action: {}, reason: "capture" };
  }
}

/** Borrows once (first review), then just records the observation — to test financing netting. */
class BorrowOnceThenCapture implements DecisionProvider {
  readonly id = "borrow-once-capture";
  last: BusinessObservation | undefined;
  private borrowed = false;
  constructor(private readonly amount: number) {}
  decide(req: DecisionRequest): BusinessDecision {
    this.last = req.observation;
    if (!this.borrowed) {
      this.borrowed = true;
      return { action: { borrow: this.amount }, reason: "borrow once" };
    }
    return { action: {}, reason: "observe" };
  }
}

/** Conservingly originate a loan on a business: move cash bank→firm and book the debt. */
function lendTo(
  world: ReturnType<typeof createCity>["world"],
  firmId: string,
  principal: number,
  accruedInterest = 0,
): void {
  world.transfer("biz_bank", firmId, principal); // bank → firm (conserved)
  world.getBusiness(firmId)!.debt = { principal, accruedInterest, originDay: 0, borrowed: principal };
}

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

/**
 * Phase 18c — the borrow lever. A firm draws cash from the Bank (`bank→firm` transfer) and books
 * `debt.principal`; money is conserved (debt is non-cash). The per-firm principal ceiling and the
 * bank's own cash both bound the draw. Tests keep the ceiling **below** the bank's seed (1500) so
 * the bank stays under its reserve and the distribution sweep never moves its cash — letting us
 * assert exact balances.
 */
describe("CreditSystem — borrow lever (Phase 18c)", () => {
  const borrowCity = (over = {}) =>
    createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: true,
      creditMaxPrincipal: 1000, // below BANK_SEED_CASH (1500) ⇒ bank stays below reserve ⇒ no sweep
      brain: new BorrowProvider(1000),
      agenticBusinessIds: ["biz_diner"],
      ...over,
    });

  it("borrows from the bank — principal booked, bank funds it exactly, money conserved", () => {
    const { sim, world } = borrowCity();
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY); // one review → one borrow

    const diner = world.getBusiness("biz_diner")!;
    expect(diner.debt?.principal).toBe(1000);
    expect(diner.debt?.borrowed).toBe(1000);
    expect(world.getBusiness("biz_bank")!.cash).toBe(BANK_SEED_CASH - 1000); // 1500 − 1000 = 500
    expect(world.totalMoney()).toBeCloseTo(start, 6); // a transfer, not a mint
  });

  it("stops at the per-firm principal ceiling", () => {
    const { sim, world } = borrowCity();
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 10); // many reviews, but the ceiling is 1000

    expect(world.getBusiness("biz_diner")!.debt?.principal).toBe(1000); // capped at the ceiling
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("books no phantom debt when the bank can't fund the draw", () => {
    // Ceiling above the bank's cash: the diner asks for more than the bank holds.
    const { sim, world } = borrowCity({ creditMaxPrincipal: 5000, brain: new BorrowProvider(5000) });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);

    const diner = world.getBusiness("biz_diner")!;
    expect(diner.debt?.principal).toBe(BANK_SEED_CASH); // only what the bank actually had (1500)
    expect(world.getBusiness("biz_bank")!.cash).toBe(0); // lent its float dry, no further debt booked
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("books no debt when credit is disabled (byte-identical lever)", () => {
    const { sim, world } = borrowCity({ creditEnabled: false });
    sim.run(TICKS_PER_DAY * 5);
    expect("debt" in world.getBusiness("biz_diner")!).toBe(false);
  });

  it("is deterministic with borrowing: same seed twice → identical world", () => {
    const run = () => {
      const c = borrowCity({ seed: 7 });
      c.sim.run(TICKS_PER_DAY * 10);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});

/**
 * Phase 18d — interest accrual. The CreditSystem stub goes live: each day every loan is charged
 * `principal × rate` as a `firm→bank` transfer (capped at the firm's cash; any shortfall parks in
 * `accruedInterest`). Money is conserved (the bank gains exactly what firms pay). Rate 0 ⇒ no-op.
 */
describe("CreditSystem — interest accrual (Phase 18d)", () => {
  const lend = (over = {}) =>
    createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: true,
      creditMaxPrincipal: 1000, // < bank seed (1500) ⇒ bank stays below reserve ⇒ no sweep
      brain: new BorrowProvider(1000),
      agenticBusinessIds: ["biz_diner"],
      ...over,
    });

  it("charges daily interest as a firm→bank transfer; the bank recoups it; money conserved", () => {
    const { sim, world } = lend({ creditDailyRate: 0.01 });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);

    const diner = world.getBusiness("biz_diner")!;
    expect(diner.debt?.principal).toBe(1000);
    expect(diner.pnl.debtService).toBeGreaterThan(0); // paid interest over the month
    expect(world.getBusiness("biz_bank")!.cash).toBeGreaterThan(BANK_SEED_CASH - 1000); // float back + interest
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("parks unpayable interest in accruedInterest (a non-cash claim), money conserved", () => {
    const { sim, world } = lend({ creditDailyRate: 0.5 }); // a brutal rate to force a shortfall
    sim.run(TICKS_PER_DAY); // borrow + first charge
    const diner = world.getBusiness("biz_diner")!;
    diner.cash = 0; // now broke — it can't pay the next charges
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);

    expect(diner.debt!.accruedInterest).toBeGreaterThan(0); // unpayable interest piled up as a claim
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("rate 0 ⇒ byte-identical: borrowed, but no interest and no debtService field", () => {
    const { sim, world } = lend({ creditDailyRate: 0 });
    sim.run(TICKS_PER_DAY * 20);
    const diner = world.getBusiness("biz_diner")!;
    expect(diner.debt?.principal).toBe(1000);
    expect(diner.pnl.debtService).toBeUndefined();
  });

  it("save/reload resumes mid-loan: interest keeps accruing identically", () => {
    const original = lend({ creditDailyRate: 0.01 });
    original.sim.run(TICKS_PER_DAY * 10);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = lend({ seed: 42, creditDailyRate: 0.01 });
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());

    original.sim.run(TICKS_PER_DAY * 10);
    loaded.sim.run(TICKS_PER_DAY * 10);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });
});

/**
 * Phase 18e — the repay lever. A firm pays the Bank a fraction of what it owes (`firm→bank`,
 * cash-capped), interest-first then principal; an emptied loan is deleted to restore the
 * byte-identical debt-free shape. Conserving (the write-down is non-cash).
 */
describe("CreditSystem — repay lever (Phase 18e)", () => {
  const credit = (brain: DecisionProvider) =>
    createCity({ seed: 1, includeBank: true, creditEnabled: true, brain, agenticBusinessIds: ["biz_diner"] });

  it("full repay clears interest + principal and deletes the debt; money conserved", () => {
    const { sim, world } = credit(new RepayProvider(1));
    lendTo(world, "biz_diner", 1000, 50); // 1000 principal + 50 accrued interest
    const start = world.totalMoney();
    const bankBefore = world.getBusiness("biz_bank")!.cash;

    sim.run(TICKS_PER_DAY); // one review → full repay

    expect(world.getBusiness("biz_diner")!.debt).toBeUndefined(); // loan cleared, shape restored
    expect(world.getBusiness("biz_bank")!.cash).toBeCloseTo(bankBefore + 1050, 6); // principal + interest recouped
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("partial repay follows the waterfall — interest first, then principal", () => {
    const { sim, world } = credit(new RepayProvider(0.5));
    lendTo(world, "biz_diner", 1000, 100); // owed 1100 ⇒ repay half = 550
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    const debt = world.getBusiness("biz_diner")!.debt!;
    expect(debt.accruedInterest).toBeCloseTo(0, 6); // the 100 interest cleared first
    expect(debt.principal).toBeCloseTo(550, 6); // then 450 off the 1000 principal
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("books no repayment when credit is disabled", () => {
    const { sim, world } = createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: false,
      brain: new RepayProvider(1),
      agenticBusinessIds: ["biz_diner"],
    });
    lendTo(world, "biz_diner", 1000, 0);
    sim.run(TICKS_PER_DAY * 3);
    expect(world.getBusiness("biz_diner")!.debt?.principal).toBe(1000); // untouched (repay off)
  });

  it("is deterministic with repayment: same seed twice → identical world", () => {
    const run = () => {
      const c = createCity({
        seed: 7,
        includeBank: true,
        creditEnabled: true,
        brain: new RepayProvider(0.3),
        agenticBusinessIds: ["biz_diner"],
      });
      lendTo(c.world, "biz_diner", 1200, 80);
      c.sim.run(TICKS_PER_DAY * 8);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});

/**
 * Phase 18f — default settlement. When a debtor goes bankrupt, the husk's residual cash settles to
 * the Bank FIRST (interest then principal), before the owner; any unrecovered debt is a real bank
 * capital loss, written off as a non-cash claim. Conserving — priority changes who receives, not the
 * total. Off ⇒ the Phase-15-D liquidation (husk → owner).
 */
describe("CreditSystem — default settlement (Phase 18f)", () => {
  /** A farm one day from bankruptcy, holding cash in (0,1) so it both fails AND has cash to recover, with debt. */
  function bankruptFarm(creditEnabled: boolean) {
    const c = createCity({ seed: 1, includeBank: true, creditEnabled, businessEntry: false });
    const farm = c.world.getBusiness("biz_farm")!;
    for (const id of farm.employeeIds) {
      const w = c.world.getResident(id);
      if (w) { w.jobId = ""; w.wagePerTick = 0; }
    }
    farm.employeeIds = []; // no crew ⇒ no production
    farm.resources = {}; // no stock to sell ⇒ no income
    farm.inventory = 0;
    farm.debt = { principal: 1000, accruedInterest: 0, originDay: 0, borrowed: 1000 };
    farm.cash = 0.5; // in (0,1): below the bankruptcy floor (1) yet leaves 0.5 to recover
    farm.insolventDays = BANKRUPT_GRACE_DAYS - 1; // next day-boundary tips it over
    return { c, farm, bank: c.world.getBusiness("biz_bank")! };
  }

  it("pays the bank first; unrecovered debt is a written-off bank loss; money conserved", () => {
    const { c, farm, bank } = bankruptFarm(true);
    const start = c.world.totalMoney();
    const bankBefore = bank.cash; // the bank doesn't trade, so its cash moves only via the recovery

    c.sim.run(TICKS_PER_DAY); // one boundary → bankrupt + settle

    expect(farm.active).toBe(false);
    expect(farm.debt).toBeUndefined(); // the 999.5 unrecovered is the bank's loss, written off
    expect(bank.cash).toBeCloseTo(bankBefore + 0.5, 6); // the husk's 0.5 went to the BANK (paid first)
    expect(c.world.totalMoney()).toBeCloseTo(start, 6); // conserved through the default
  });

  it("control — credit off: the bank recovers nothing (Phase-15-D liquidation to the owner)", () => {
    const { c, farm, bank } = bankruptFarm(false);
    const start = c.world.totalMoney();
    const bankBefore = bank.cash;

    c.sim.run(TICKS_PER_DAY);

    expect(farm.active).toBe(false);
    expect(bank.cash).toBeCloseTo(bankBefore, 6); // settlement skipped — bank got nothing; husk → owner
    expect(c.world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("is deterministic through a debtor bankruptcy", () => {
    const run = () => {
      const { c } = bankruptFarm(true);
      c.sim.run(TICKS_PER_DAY * 3);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});

/**
 * Phase 18g — surface credit state in the observation (read-only) and net financing out of
 * `dayProfit`/`dayRent`, so a mind sees its debt and isn't fooled into reading a loan as profit or
 * debt service as rent. Credit-free observations are unchanged (the netting is zero).
 */
describe("CreditSystem — observation + financing netting (Phase 18g)", () => {
  it("surfaces the debt fields and the rate from the ledger", () => {
    const capture = new CaptureProvider();
    const { sim, world } = createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: true,
      creditDailyRate: 0.02,
      brain: capture,
      agenticBusinessIds: ["biz_diner"],
    });
    lendTo(world, "biz_diner", 800, 30);
    sim.run(TICKS_PER_DAY); // the diner's review shows the loan (interest accrues after the review)

    expect(capture.last?.debtPrincipal).toBe(800);
    expect(capture.last?.debtInterest).toBe(30);
    expect(capture.last?.borrowed).toBe(800);
    expect(capture.last?.creditRate).toBe(0.02);
  });

  it("a debt-free firm omits the debt fields but still sees the rate (the lever is available)", () => {
    const capture = new CaptureProvider();
    const { sim } = createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: true,
      creditDailyRate: 0.02,
      brain: capture,
      agenticBusinessIds: ["biz_diner"],
    });
    sim.run(TICKS_PER_DAY);
    expect(capture.last?.debtPrincipal).toBeUndefined();
    expect(capture.last?.debtServicePaid).toBeUndefined();
    expect(capture.last?.creditRate).toBe(0.02); // credit engaged ⇒ a mind can tell
  });

  it("omits credit fields entirely when credit is off (byte-identical observation)", () => {
    const capture = new CaptureProvider();
    const { sim } = createCity({ seed: 1, brain: capture, agenticBusinessIds: ["biz_diner"] });
    sim.run(TICKS_PER_DAY);
    expect(capture.last?.creditRate).toBeUndefined();
    expect(capture.last?.debtPrincipal).toBeUndefined();
  });

  it("surfaces the day's debt service for a firm carrying debt; money conserved", () => {
    const capture = new CaptureProvider();
    const { sim, world } = createCity({
      seed: 1,
      includeBank: true,
      creditEnabled: true,
      creditDailyRate: 0.05,
      brain: capture,
      agenticBusinessIds: ["biz_diner"],
    });
    lendTo(world, "biz_diner", 1000, 0);
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 3);

    expect(capture.last?.debtPrincipal).toBe(1000);
    expect(capture.last?.debtServicePaid).toBeGreaterThan(0); // interest paid this day, surfaced
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("nets a same-review borrow out of dayProfit — a loan isn't read as profit", () => {
    // Two identical cities; in one the diner borrows once. With financing netted, the borrowing
    // firm's reported dayProfit must NOT jump by ~the loan — the gap stays far below the draw.
    const make = (borrow: boolean) => {
      const cap = borrow ? new BorrowOnceThenCapture(1000) : new CaptureProvider();
      const { sim } = createCity({
        seed: 1,
        includeBank: true,
        creditEnabled: true,
        creditDailyRate: 0.01,
        creditMaxPrincipal: 5000,
        brain: cap,
        agenticBusinessIds: ["biz_diner"],
      });
      sim.run(TICKS_PER_DAY * 2);
      return cap.last!.dayProfit;
    };
    expect(Math.abs(make(true) - make(false))).toBeLessThan(500); // not ~1000 (the borrow)
  });
});
