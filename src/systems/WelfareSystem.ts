import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { ARCHETYPES } from "../world/archetypes";
import {
  BUSINESS_RESERVE,
  LANDLORD_RESERVE,
  WELFARE_RATIO,
  WELFARE_SUBSISTENCE_MIN,
} from "./constants";

/**
 * Welfare floor (Initiative #1 S2) — the single deliberate control in the free-market
 * experiment. Once per day each non-earning resident (`jobId === ""` — the unemployed plus
 * dependents who can't work) receives a transfer targeting {@link WELFARE_RATIO} of the average
 * worker's daily income (floored at {@link WELFARE_SUBSISTENCE_MIN}), funded by a levy on
 * businesses' above-reserve cash. Default `ratio = 0` (and subsistence 0) ⇒ the system is inert
 * ⇒ the seeded/brain-off baseline is byte-identical.
 *
 * **Why a levy on capital, not on wages.** Welfare is funded from the economy's surplus, so a
 * worker's take-home wage — and thus the labour-share metric — stays clean, and the safety net
 * survives the later weaning of the even dividend (S3, when the dividend that currently floors
 * the unemployed goes away). Real-world: a profits-funded unemployment benefit.
 *
 * **Conservation & determinism.** Every cent moves only via {@link World.transfer} (capped at the
 * payer's balance), so `totalMoney()` is unchanged. The per-firm levy is bounded by that firm's
 * headroom (`cash − reserve`), so no firm is pushed below its reserve. Iteration is over the
 * fixed business and resident arrays; there is no RNG. Runs right after profit distribution, so
 * it reads the day's fully-settled business cash.
 */
export class WelfareSystem implements System {
  readonly id = "welfare";
  /** Cumulative welfare actually disbursed (diagnostic — not part of the snapshot). */
  private paid = 0;

  constructor(
    private readonly world: World,
    private readonly ratio: number = WELFARE_RATIO,
    private readonly subsistence: number = WELFARE_SUBSISTENCE_MIN,
  ) {}

  /** Total welfare paid to non-workers over the run so far ($). 0 while the floor is disengaged. */
  paidTotal(): number {
    return this.paid;
  }

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    if (this.ratio <= 0 && this.subsistence <= 0) return; // inert by default ⇒ byte-identical

    const residents = this.world.residents;
    const workers = residents.filter((r) => r.jobId !== "");
    const nonWorkers = residents.filter((r) => r.jobId === "");
    if (nonWorkers.length === 0) return;

    // Target daily income per non-worker: a share of the average worker's daily wage flow,
    // floored at subsistence. (Uses today's wage level; lagging it a day to damp oscillation
    // is a later refinement, noted in INITIATIVE-01.)
    const avgWorkerDaily =
      workers.length > 0
        ? (workers.reduce((s, r) => s + r.wagePerTick, 0) / workers.length) * TICKS_PER_DAY
        : 0;
    const targetPer = Math.max(this.ratio * avgWorkerDaily, this.subsistence);
    if (targetPer <= 0) return;
    const targetTotal = targetPer * nonWorkers.length;

    // Levy on businesses' above-reserve cash — capital funds the net. Two passes: sum the
    // headroom, then collect pro-rata, so no firm is driven below its reserve and we raise no
    // more than is needed. levy_i = levyTotal·(headroom_i / totalHeadroom) ≤ headroom_i.
    // The Port (C4a) is exempt: its cash is the rest of the world's money, not city surplus —
    // taxing it would smuggle foreign money into the city outside the trade channel.
    const contributors = this.world.businesses
      .filter((b) => b.active && !ARCHETYPES[b.kind].port)
      .map((b) => ({
        b,
        headroom: Math.max(0, b.cash - (ARCHETYPES[b.kind].collectsRent ? LANDLORD_RESERVE : BUSINESS_RESERVE)),
      }))
      .filter((c) => c.headroom > 0);
    const totalHeadroom = contributors.reduce((s, c) => s + c.headroom, 0);
    if (totalHeadroom <= 0) return; // no surplus to levy — the net can't pay this day

    const levyTotal = Math.min(targetTotal, totalHeadroom);
    for (const { b, headroom } of contributors) {
      const levy = levyTotal * (headroom / totalHeadroom);
      const per = levy / nonWorkers.length;
      if (per <= 0) continue;
      for (const nw of nonWorkers) {
        this.paid += this.world.transfer(b.id, nw.id, per);
      }
    }
  }
}
