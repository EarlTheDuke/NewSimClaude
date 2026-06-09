import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, Resident } from "../world/types";
import {
  BANKRUPT_CASH_FLOOR,
  BANKRUPT_GRACE_DAYS,
  EVICTION_GRACE_DAYS,
  RECYCLE_BANKRUPT_ASSETS,
  CREDIT_ENABLED,
} from "./constants";
import { cheapestVacantHome } from "../world/housing";
import { ARCHETYPES } from "../world/archetypes";

/**
 * Business and resident lifecycle (Phase 4c). Runs once per sim-day, after the
 * economy and market have settled, so it reads each holder's true end-of-day
 * position:
 *
 *  - Bankruptcy: a business below the cash floor for BANKRUPT_GRACE_DAYS running
 *    is declared inactive and lays off its staff (who become jobless, not
 *    homeless). The MarketSystem already skips inactive businesses, so a bankrupt
 *    firm simply stops trading and producing.
 *  - Safe eviction: a resident who can't cover full rent for EVICTION_GRACE_DAYS
 *    running is re-homed to the cheapest home. Nobody is ever made homeless — the
 *    worst case is a lateral stay when no cheaper home exists.
 *
 * Streak counters live on the entities (Business.insolventDays,
 * Resident.rentMissedDays), so they ride along in the world snapshot and this
 * system holds no state of its own. Deterministic: fixed iteration order, no RNG.
 */
export class LifecycleSystem implements System {
  readonly id = "lifecycle";
  constructor(
    private readonly world: World,
    /** Whether credit default-settlement is live (Phase 18f); defaults to {@link CREDIT_ENABLED} (off ⇒ Phase-15-D liquidation, byte-identical). */
    private readonly creditEnabled: boolean = CREDIT_ENABLED,
  ) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    for (const biz of this.world.businesses) this.reviewSolvency(biz);
    for (const resident of this.world.residents) this.reviewHousing(resident);
  }

  private reviewSolvency(biz: Business): void {
    if (!biz.active) return;
    // The Bank is never bankrupted (Initiative C / Phase 18b) — a central financial holder doesn't
    // liquidate to its owner and silently kill the credit subsystem. Its solvency is managed by its
    // reserve + (later) interest income, not the ordinary cash-floor streak.
    // Nor is the Port (C4a): an empty port means FOREIGN DEMAND IS EXHAUSTED (exports pause until
    // imports refill it) — not a business failure to liquidate to a resident owner, which would
    // hand the rest of the world's remaining money to the city and kill imports for good.
    if (ARCHETYPES[biz.kind].bank || ARCHETYPES[biz.kind].port) return;
    const days = biz.cash < BANKRUPT_CASH_FLOOR ? (biz.insolventDays ?? 0) + 1 : 0;
    biz.insolventDays = days;
    if (days < BANKRUPT_GRACE_DAYS) return;
    // Bankrupt: stop trading and release every employee to the jobless pool.
    biz.active = false;
    for (const id of biz.employeeIds) {
      const worker = this.world.getResident(id);
      if (!worker) continue;
      worker.jobId = "";
      worker.wagePerTick = 0;
    }
    biz.employeeIds = [];

    // Default settlement (Phase 18f): a bankrupt debtor settles to the BANK *first*, before its
    // owner — recovery = min(husk cash, owed), interest then principal. Any unrecovered debt is a
    // real bank capital loss (the bank paid out the cash at borrow time and simply doesn't get it
    // back); written off as a non-cash claim, so the total is untouched — priority changes only WHO
    // receives. Gated on credit; a debt-free firm is byte-identical to the Phase-15-D liquidation.
    if (this.creditEnabled && biz.debt) {
      const bank = this.world.getBusiness("biz_bank");
      if (bank && bank.id !== biz.id) {
        const owed = biz.debt.principal + biz.debt.accruedInterest;
        const recovered = this.world.transfer(biz.id, bank.id, Math.min(biz.cash, owed)); // husk → bank
        const interestRecovered = Math.min(recovered, biz.debt.accruedInterest);
        biz.debt.accruedInterest -= interestRecovered;
        biz.debt.principal -= recovered - interestRecovered;
      }
      delete biz.debt; // the firm is dead; whatever's left unrecovered is the bank's loss, written off
    }

    // Liquidation (Phase 15 D): the husk's residual cash goes to its owner as
    // recouped equity — returning that money to circulation instead of freezing it
    // in a dead firm — and its non-cash stock is written off. Money moves only via
    // transfer (which drains biz.cash to exactly 0), so the closed economy holds.
    if (RECYCLE_BANKRUPT_ASSETS) {
      this.world.transfer(biz.id, biz.ownerId, biz.cash);
      biz.inventory = 0;
      biz.resources = {};
    }
  }

  private reviewHousing(resident: Resident): void {
    if ((resident.rentMissedDays ?? 0) < EVICTION_GRACE_DAYS) return;
    // Re-home to the cheapest home WITH A FREE SLOT (HP3-3), then reset the streak.
    // Respecting the HP1 capacity cap is what stops eviction from stacking people
    // past a dwelling's size — the old cheapestHome() picked the globally cheapest
    // home regardless of occupancy, so under population growth it would overfill
    // it. If no home has room the resident keeps their current home: eviction
    // never produces a homeless resident, and never overfills one. Occupancy is
    // non-cash, so this never touches the money invariant.
    const target = cheapestVacantHome(this.world.residents, this.world.locations);
    if (target && target !== resident.homeId) resident.homeId = target;
    resident.rentMissedDays = 0;
  }
}
