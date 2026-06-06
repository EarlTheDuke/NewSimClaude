import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, Resident } from "../world/types";
import {
  BANKRUPT_CASH_FLOOR,
  BANKRUPT_GRACE_DAYS,
  EVICTION_GRACE_DAYS,
  RECYCLE_BANKRUPT_ASSETS,
} from "./constants";

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
  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    for (const biz of this.world.businesses) this.reviewSolvency(biz);
    for (const resident of this.world.residents) this.reviewHousing(resident);
  }

  private reviewSolvency(biz: Business): void {
    if (!biz.active) return;
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
    // Re-home to the cheapest home, then reset the streak for a fresh start.
    // Already in the cheapest home? There's nowhere cheaper, so they keep it —
    // eviction never produces a homeless resident.
    const cheapest = this.cheapestHome();
    if (cheapest && cheapest !== resident.homeId) resident.homeId = cheapest;
    resident.rentMissedDays = 0;
  }

  private cheapestHome(): string | undefined {
    let bestId: string | undefined;
    let bestRent = Infinity;
    for (const loc of this.world.locations) {
      if (loc.type !== "home") continue;
      const rent = loc.rent ?? 0;
      if (rent < bestRent) {
        bestRent = rent;
        bestId = loc.id;
      }
    }
    return bestId;
  }
}
