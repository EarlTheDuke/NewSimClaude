import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import {
  LANDLORD_RESERVE,
  BUSINESS_RESERVE,
  PROFIT_DISTRIBUTION_CAP,
  OWNER_DIVIDEND_SHARE,
  DIVIDEND_WEAN,
} from "./constants";

/**
 * Profit distribution — the feedback that keeps the closed loop alive (was a step
 * inside {@link MarketSystem} through Phase 13b; split out in 13c). Each day every
 * business pays cash above its working-capital reserve back to residents (the
 * owner's dividend + an even recirculation, recorded in `pnl.distributed`, NOT as
 * wages), capped per business. In a closed supply chain B2B transfers
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
  constructor(
    private readonly world: World,
    /**
     * Fraction of each firm's profit paid to its owner before the even split
     * (Phase 15 C). Defaults to the live-game {@link OWNER_DIVIDEND_SHARE}; the CEO
     * benchmark passes 0 so its firm-net-worth score stays a clean skill signal.
     */
    private readonly ownerDividendShare: number = OWNER_DIVIDEND_SHARE,
    /**
     * Even-dividend weaning factor (Initiative #1 S3). Scales the even recirculation only;
     * defaults to the live {@link DIVIDEND_WEAN} (1.0 ⇒ byte-identical). Taper toward 0 to test
     * whether the freed wage market + welfare can circulate the closed economy without the pump.
     */
    private readonly dividendWean: number = DIVIDEND_WEAN,
  ) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const residents = this.world.residents;
    if (residents.length === 0) return;
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const reserve = biz.kind === "landlord" ? LANDLORD_RESERVE : BUSINESS_RESERVE;
      // Phase 16 — the firm pays out only `payoutRate` of its capped surplus; the
      // rest is retained as cash to reinvest. Default 1.0 ⇒ full distribution,
      // byte-identical to pre-Phase-16.
      const payoutRate = biz.payoutRate ?? 1;
      const budget = Math.min(biz.cash - reserve, PROFIT_DISTRIBUTION_CAP) * payoutRate;
      if (budget <= 0) continue;

      // Owner's dividend first (Phase 15 C): a share λ of the day's profit goes to
      // the firm's owner as personal income, so owning a thriving business pays.
      // The owner is also a resident, so they additionally take their even slice of
      // the remainder below — exactly like everyone else. With λ = 0 this whole
      // branch is skipped and the split is the old even payout, byte-identical.
      const ownerCut = budget * this.ownerDividendShare;
      if (ownerCut > 0) {
        biz.pnl.distributed += this.world.transfer(biz.id, biz.ownerId, ownerCut);
      }

      // The rest recirculates evenly to all residents — the closed economy's primary demand
      // pump. Scaled by the S3 weaning factor: at 1.0 the full even dividend flows (today's
      // behaviour); below 1.0 only that fraction recirculates and the remainder stays as firm
      // cash, so we can watch whether wages + welfare carry circulation without the pump.
      const share = ((budget - ownerCut) * this.dividendWean) / residents.length;
      if (share > 0) {
        for (const r of residents) {
          biz.pnl.distributed += this.world.transfer(biz.id, r.id, share);
        }
      }
    }
  }
}
