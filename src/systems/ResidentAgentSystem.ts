import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Resident } from "../world/types";
import type {
  HomeOption,
  JobOption,
  ResidentDecision,
  ResidentDecisionLimits,
  ResidentDecisionLogEntry,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
  ResidentObservation,
} from "../ai/residentTypes";
import { clampResidentAction, DEFAULT_RESIDENT_LIMITS } from "../ai/residentClamp";
import { RuleBasedResidentProvider } from "../ai/RuleBasedResidentProvider";

/**
 * The agentic layer for people: once per sim-day, each opted-in resident
 * reviews their life and pulls a strategic lever through its
 * {@link ResidentDecisionProvider} — switch jobs, move home, buy/sell a
 * vehicle, ask for a raise. The minute-to-minute BrainSystem is untouched.
 *
 * Same three guarantees as the business agent:
 *  - **Clamped & validated**: every action passes {@link clampResidentAction},
 *    which both bounds it and checks it against the live world (valid option,
 *    off cooldown, affordable), and keeps at most one structural move.
 *  - **Fallible-safe**: a provider throw / rejection is covered invisibly by
 *    the rule-based provider (logged with `fallback: true`).
 *  - **Traceable**: every applied move is logged with its reason and usage.
 */
export class ResidentAgentSystem implements System {
  readonly id = "resident-agent";
  private readonly fallback = new RuleBasedResidentProvider();
  private readonly limits: ResidentDecisionLimits;
  private readonly log: ResidentDecisionLogEntry[] = [];
  /** Day each resident last switched jobs, for the cooldown. */
  private readonly lastJobChangeDay = new Map<string, number>();
  /** Day each resident last won a raise, for the raise cooldown. */
  private readonly lastRaiseDay = new Map<string, number>();
  /** Residents with an in-flight async decision — don't double-fire. */
  private readonly pending = new Set<string>();

  constructor(
    private readonly world: World,
    private readonly provider: ResidentDecisionProvider,
    private readonly agenticResidentIds: readonly string[],
    limits: ResidentDecisionLimits = DEFAULT_RESIDENT_LIMITS,
  ) {
    this.limits = limits;
  }

  update(ctx: SystemContext): void {
    // Review at each new day's first tick, after the prior day's rent settled.
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();
    for (const id of this.agenticResidentIds) {
      const r = this.world.getResident(id);
      if (r) this.review(r, day);
    }
  }

  /** The decision trace — newest last. Ephemeral (not part of the snapshot). */
  decisions(): readonly ResidentDecisionLogEntry[] {
    return this.log;
  }

  private review(r: Resident, day: number): void {
    if (this.pending.has(r.id)) return; // previous day's call hasn't landed
    const req: ResidentDecisionRequest = { observation: this.observe(r, day), limits: this.limits };

    let result: ResidentDecision | Promise<ResidentDecision>;
    try {
      result = this.provider.decide(req);
    } catch {
      this.applyFallback(r, req, day);
      return;
    }

    if (isPromise(result)) {
      this.pending.add(r.id);
      result
        .then(
          (decision) => this.apply(r, decision, req, day, this.provider.id, false),
          () => this.applyFallback(r, req, day),
        )
        .finally(() => this.pending.delete(r.id));
    } else {
      this.apply(r, result, req, day, this.provider.id, false);
    }
  }

  private applyFallback(r: Resident, req: ResidentDecisionRequest, day: number): void {
    this.apply(r, this.fallback.decide(req), req, day, this.fallback.id, true);
  }

  private apply(
    r: Resident,
    decision: ResidentDecision,
    req: ResidentDecisionRequest,
    day: number,
    providerId: string,
    fallback: boolean,
  ): void {
    // Re-clamp against the observation the decision was made from. (For async
    // decisions the world may have moved on, but the clamp re-validates every
    // lever against that snapshot, and money transfers cap at live balances.)
    const clamped = clampResidentAction(decision.action, req.observation, this.limits);

    if (clamped.switchJobTo !== undefined) this.applyJobSwitch(r, clamped.switchJobTo, day);
    if (clamped.reHomeTo !== undefined) r.homeId = clamped.reHomeTo;
    if (clamped.buyVehicle) this.applyBuyVehicle(r);
    if (clamped.sellVehicle) this.applySellVehicle(r);
    if (clamped.negotiateRaise) this.applyRaise(r, req.observation.jobBaseWage, day);

    this.log.push({
      day,
      residentId: r.id,
      residentName: r.name,
      providerId,
      fallback,
      action: clamped,
      reason: decision.reason,
      usage: decision.usage,
    });
  }

  private applyJobSwitch(r: Resident, newJobId: string, day: number): void {
    const newBiz = this.world.getBusiness(newJobId);
    if (!newBiz) return;
    const oldBiz = this.world.getBusiness(r.jobId);
    if (oldBiz) {
      const i = oldBiz.employeeIds.indexOf(r.id);
      if (i >= 0) oldBiz.employeeIds.splice(i, 1);
    }
    if (!newBiz.employeeIds.includes(r.id)) newBiz.employeeIds.push(r.id);
    r.jobId = newBiz.id;
    r.wagePerTick = newBiz.wagePerTick;
    this.lastJobChangeDay.set(r.id, day);
  }

  private applyBuyVehicle(r: Resident): void {
    const goods = this.world.getBusiness("biz_goods");
    if (!goods || !goods.active) return; // can't buy from a closed store
    const paid = this.world.transfer(r.id, goods.id, this.limits.vehicleCost);
    if (paid >= this.limits.vehicleCost) {
      r.hasVehicle = true;
      goods.pnl.revenue += paid;
    } else if (paid > 0) {
      this.world.transfer(goods.id, r.id, paid); // couldn't afford in full; refund
    }
  }

  private applySellVehicle(r: Resident): void {
    const goods = this.world.getBusiness("biz_goods");
    if (!goods || goods.cash < this.limits.vehicleResale) return; // store can't buy it back
    const paid = this.world.transfer(goods.id, r.id, this.limits.vehicleResale);
    if (paid > 0) r.hasVehicle = false;
  }

  private applyRaise(r: Resident, jobBaseWage: number, day: number): void {
    if (jobBaseWage <= 0) return;
    const cap = jobBaseWage * this.limits.maxWageMultiple;
    r.wagePerTick = Math.min(cap, r.wagePerTick * (1 + this.limits.raiseFraction));
    this.lastRaiseDay.set(r.id, day);
  }

  private observe(r: Resident, day: number): ResidentObservation {
    const employed = r.jobId !== "";
    const job = employed ? this.world.getBusiness(r.jobId) : undefined;
    const home = this.world.getLocation(r.homeId);

    const jobOptions: JobOption[] = this.world.businesses
      .filter((b) => b.id !== r.jobId)
      .map((b) => ({ businessId: b.id, name: b.name, wagePerTick: b.wagePerTick, hiring: true }));

    const homeOptions: HomeOption[] = this.world.locations
      .filter((l) => l.type === "home" && l.id !== r.homeId)
      .map((l) => ({ homeId: l.id, name: l.name, rent: l.rent ?? 0 }));

    const vehicleSellerOpen = this.world.getBusiness("biz_goods")?.active ?? false;

    const last = this.lastJobChangeDay.get(r.id);
    const daysSinceJobChange = last === undefined ? this.limits.jobChangeCooldownDays : day - last;
    const lastRaise = this.lastRaiseDay.get(r.id);
    const daysSinceRaise = lastRaise === undefined ? this.limits.raiseCooldownDays : day - lastRaise;

    return {
      residentId: r.id,
      name: r.name,
      day,
      money: r.money,
      needs: { ...r.needs },
      employed,
      jobId: r.jobId,
      jobName: job?.name ?? "—",
      wagePerTick: r.wagePerTick,
      jobBaseWage: job?.wagePerTick ?? 0,
      homeId: r.homeId,
      homeName: home.name,
      rent: home.rent ?? 0,
      hasVehicle: r.hasVehicle,
      vehicleSellerOpen,
      daysSinceJobChange,
      daysSinceRaise,
      jobOptions,
      homeOptions,
    };
  }

  serialize(): unknown {
    return {
      lastJobChangeDay: Array.from(this.lastJobChangeDay.entries()),
      lastRaiseDay: Array.from(this.lastRaiseDay.entries()),
    };
  }

  restore(state: unknown): void {
    const s = state as
      | { lastJobChangeDay?: [string, number][]; lastRaiseDay?: [string, number][] }
      | undefined;
    this.lastJobChangeDay.clear();
    for (const [id, d] of s?.lastJobChangeDay ?? []) this.lastJobChangeDay.set(id, d);
    this.lastRaiseDay.clear();
    for (const [id, d] of s?.lastRaiseDay ?? []) this.lastRaiseDay.set(id, d);
  }
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown }).then === "function";
}
