import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import {
  CREDIT_ENABLED,
  CREDIT_DAILY_INTEREST_RATE,
  CREDIT_SAVINGS_DAILY_RATE,
  BUSINESS_RESERVE,
  LANDLORD_RESERVE,
  BANK_RESERVE,
} from "./constants";
import { ARCHETYPES } from "../world/archetypes";

/**
 * Credit & finance (Initiative C / Phase 18). Once a day it will service outstanding loans —
 * **interest accrual** (`firm→bank` transfer, slice 18d) and optional **savings yield** on idle cash
 * (`bank→firm`, slice 18i) — between the {@link DistributionSystem} and the {@link LifecycleSystem},
 * so a firm's debt service is taken before its dividend and a defaulter settles to the lender first.
 *
 * Slice 18a (this stub): a **no-op**. With {@link CREDIT_ENABLED} off (the default) it does nothing,
 * so the seeded city is byte-identical. It holds **no own state** — debt rides on each
 * {@link Business} in the world snapshot — so it needs no serialize/restore and a save/reload resumes
 * any loan exactly. Money will only ever move via {@link World.transfer}, so `totalMoney()` stays
 * conserved to the cent (a borrow is `bank→firm`, interest/repay `firm→bank`; debt is non-cash).
 */
export class CreditSystem implements System {
  readonly id = "credit";

  constructor(
    private readonly world: World,
    /** Whether credit is live; defaults to {@link CREDIT_ENABLED} (off ⇒ this system is inert). */
    private readonly enabled: boolean = CREDIT_ENABLED,
    /** Flat daily interest rate on outstanding principal; defaults to {@link CREDIT_DAILY_INTEREST_RATE} (0 ⇒ no interest). */
    private readonly rate: number = CREDIT_DAILY_INTEREST_RATE,
    /** Daily yield the bank pays on idle cash; defaults to {@link CREDIT_SAVINGS_DAILY_RATE} (0 ⇒ no savings). */
    private readonly savingsRate: number = CREDIT_SAVINGS_DAILY_RATE,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    if (this.rate > 0) this.accrueInterest();
    if (this.savingsRate > 0) this.paySavings();
  }

  /**
   * Slice 18d — charge daily interest on every outstanding loan as a `firm → bank` transfer. Interest
   * is flat (`principal × rate`, time-independent), capped at the firm's cash; any shortfall is parked
   * in `debt.accruedInterest` (a non-cash claim, never minted money). The bank gains exactly what each
   * firm pays, so `totalMoney()` is conserved. Deterministic: fixed `world.businesses` array order,
   * pure arithmetic, fixed-id bank. Rate 0 ⇒ this never runs ⇒ byte-identical.
   */
  private accrueInterest(): void {
    const bank = this.world.getBusiness("biz_bank");
    if (!bank) return;
    for (const biz of this.world.businesses) {
      if (!biz.active || biz.id === bank.id) continue;
      const principal = biz.debt?.principal ?? 0;
      if (principal <= 0) continue;
      const interest = principal * this.rate;
      const paid = this.world.transfer(biz.id, bank.id, interest); // firm → bank; conserved
      biz.pnl.debtService = (biz.pnl.debtService ?? 0) + paid;
      const shortfall = interest - paid;
      if (shortfall > 0) biz.debt!.accruedInterest += shortfall; // unpaid interest = a non-cash claim
    }
  }

  /**
   * Slice 18i — pay each firm a daily yield on its **idle** cash (above {@link BUSINESS_RESERVE}) as a
   * `bank → saver` transfer, so retained earnings aren't *free* net worth and the CEO faces a real
   * cost-of-carry (the spread between the borrow rate and this savings rate is the bank's margin).
   * Funded from the bank's cash above {@link BANK_RESERVE} — never dipping into its lending float —
   * so when the bank is thin nothing is paid. Conserving (a transfer); deterministic (fixed order,
   * pure arithmetic). Rate 0 ⇒ this never runs ⇒ byte-identical.
   */
  private paySavings(): void {
    const bank = this.world.getBusiness("biz_bank");
    if (!bank) return;
    for (const biz of this.world.businesses) {
      // The Port (C4a) is not a city saver — its reserve is the rest of the world's money, and
      // paying it yield would drain the bank's lending float out of the city economy.
      if (!biz.active || biz.id === bank.id || ARCHETYPES[biz.kind].port) continue;
      const reserve = ARCHETYPES[biz.kind].collectsRent ? LANDLORD_RESERVE : BUSINESS_RESERVE;
      const idle = Math.max(0, biz.cash - reserve); // cash above the firm's own working reserve
      if (idle <= 0) continue;
      const payable = Math.min(idle * this.savingsRate, Math.max(0, bank.cash - BANK_RESERVE));
      if (payable <= 0) continue;
      this.world.transfer(bank.id, biz.id, payable); // bank → saver; conserved
    }
  }
}
