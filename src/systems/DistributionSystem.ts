import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { LANDLORD_RESERVE, BUSINESS_RESERVE, PROFIT_DISTRIBUTION_CAP } from "./constants";

/**
 * Profit distribution — the feedback that keeps the closed loop alive (was a step
 * inside {@link MarketSystem} through Phase 13b; split out in 13c). Each day every
 * business pays cash above its working-capital reserve back to residents (evenly,
 * as wages/dividends), capped per business. In a closed supply chain B2B transfers
 * net to zero, so any per-business surplus would otherwise pool forever in one
 * holder (the rent-collecting landlord, a busy diner). Returning it to people who
 * re-spend it at the shops recirculates the money instead of letting it stagnate.
 *
 * **Why it is its own system, running AFTER the business agent (Phase 13c).** This
 * is the change that finally closes the Phase 12 invest loop. While distribution
 * ran *before* the agent (inside MarketSystem), it drained every business to its
 * reserve before the agent ever reviewed — so the agent always saw cash pinned at
 * reserve and a distribution-dominated day-profit, and the invest lever could
 * never fire (locked by capital.test.ts's `investedDays===0`). Running it after
 * the agent means a business reviews its day with its full operating profit still
 * in hand: it can reinvest part of that surplus in equipment first, and only the
 * remainder flows out as dividends — the real-world retain-vs-distribute decision.
 *
 * Ordering is otherwise unchanged: distribution still touches only business cash
 * (never prices, inventory, or capital), so moving it past MarketSystem's price
 * step is a no-op for any city with no agent — the seeded/brain-off baseline is
 * byte-identical. The transfer cap already prevents a business paying out cash it
 * doesn't have, so conservation is untouched.
 */
export class DistributionSystem implements System {
  readonly id = "distribution";
  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const residents = this.world.residents;
    if (residents.length === 0) return;
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const reserve = biz.kind === "landlord" ? LANDLORD_RESERVE : BUSINESS_RESERVE;
      const budget = Math.min(biz.cash - reserve, PROFIT_DISTRIBUTION_CAP);
      if (budget <= 0) continue;
      const share = budget / residents.length;
      for (const r of residents) {
        biz.pnl.wagesPaid += this.world.transfer(biz.id, r.id, share);
      }
    }
  }
}
