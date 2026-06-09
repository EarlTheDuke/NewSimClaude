import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, ProfitAndLoss } from "../world/types";
import type {
  BusinessDecision,
  BusinessObservation,
  DecisionLimits,
  DecisionLogEntry,
  DecisionProvider,
  DecisionRequest,
} from "../ai/types";
import { clampAction, DEFAULT_LIMITS } from "../ai/clamp";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";
import { BUSINESS_RESERVE, CAPITAL_BASELINE, WAGE_CAP_MULT, RETAIL_REFERENCE_PRICE, BRAND_BASELINE, BRAND_PER_DOLLAR, BRAND_DEMAND_ELASTICITY } from "./constants";
import { ARCHETYPES, desiredHeadcount } from "../world/archetypes";
import type { MarketSystem } from "./MarketSystem";

/** Cumulative readings captured at the previous review, to diff into day deltas. */
interface Bookmark {
  day: number;
  cash: number;
  pnl: ProfitAndLoss;
}

/**
 * The agentic layer: once per sim-day, each opted-in business reviews its day
 * and pulls levers through its {@link DecisionProvider}.
 *
 * Three guarantees hold no matter what the provider returns:
 *  - **Clamped**: every action passes through {@link clampAction} before it
 *    touches the world, so a model can never detonate the economy.
 *  - **Fallible-safe**: if the provider throws or its promise rejects, the
 *    rule-based provider covers invisibly (logged with `fallback: true`).
 *  - **Traceable**: every applied action is recorded in the decision log with
 *    its reason, provider, and (for Claude) token/latency/cost usage.
 *
 * Sync providers (rules, mock) apply the same tick and keep the run fully
 * deterministic. Claude is async: the call fires at the day boundary and its
 * result lands on a later tick — the lone, contained source of non-determinism.
 */
export class BusinessAgentSystem implements System {
  readonly id = "business-agent";
  private readonly fallback = new RuleBasedProvider();
  private readonly limits: DecisionLimits;
  private readonly log: DecisionLogEntry[] = [];
  private readonly marks = new Map<string, Bookmark>();
  /** Businesses with an in-flight async decision — don't double-fire. */
  private readonly pending = new Set<string>();
  /** In-flight async decisions, so a stepping driver can drain them between turns. */
  private inflight: Promise<void>[] = [];

  constructor(
    private readonly world: World,
    private readonly provider: DecisionProvider,
    private readonly agenticBusinessIds: readonly string[],
    limits: DecisionLimits = DEFAULT_LIMITS,
    /**
     * The B2B price book, so a storefront's review can see its own input cost
     * (the floor its price-war discipline reads). Optional — when absent,
     * `unitCost` is simply omitted from the observation and behaviour is
     * unchanged, which keeps existing direct constructions working.
     */
    private readonly market?: MarketSystem,
    /**
     * The effective brand-demand elasticity for this city (Phase 17) — surfaced in
     * the observation so a mind knows whether marketing pays here. Defaults to the
     * live {@link BRAND_DEMAND_ELASTICITY}; the CEO bench passes its frozen 0, which
     * keeps the rules brain from spending on a dead lever (preserving rules>off).
     */
    private readonly brandElasticity: number = BRAND_DEMAND_ELASTICITY,
    /**
     * Free-market wage cap (Initiative #1 S1) — the multiple of base wage a firm may post.
     * Defaults to {@link WAGE_CAP_MULT} (= MAX_WAGE_MULT = 2), keeping the default city
     * byte-identical; raise it to let firms bid above the old 2× ceiling for scarce labour.
     */
    private readonly wageCapMult: number = WAGE_CAP_MULT,
  ) {
    this.limits = limits;
  }

  update(ctx: SystemContext): void {
    // Review at each new day's first tick, after EconomySystem has settled the
    // prior day's rent (this system is registered after EconomySystem).
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();
    for (const id of this.agenticBusinessIds) {
      const biz = this.world.getBusiness(id);
      if (biz) this.review(biz, day);
    }
  }

  /** The decision trace — newest last. Ephemeral (not part of the snapshot). */
  decisions(): readonly DecisionLogEntry[] {
    return this.log;
  }

  /**
   * Await every async decision fired so far, so it has applied to the world.
   * A no-op for sync providers (which apply inline). A turn-stepping driver
   * calls this between turns so an async mind's (Claude's) move lands before
   * the next day runs; in the normal tick loop nothing calls it and behaviour
   * is unchanged. One review per business per day, so a single drain suffices.
   */
  async settle(): Promise<void> {
    const inflight = this.inflight;
    this.inflight = [];
    await Promise.all(inflight);
  }

  private review(biz: Business, day: number): void {
    if (this.pending.has(biz.id)) return; // previous day's call hasn't landed
    const req: DecisionRequest = { observation: this.observe(biz, day), limits: this.limits };
    // Advance the bookmark now so tomorrow's deltas measure from this instant,
    // regardless of when an async decision actually applies.
    this.marks.set(biz.id, { day, cash: biz.cash, pnl: { ...biz.pnl } });

    let result: BusinessDecision | Promise<BusinessDecision>;
    try {
      result = this.provider.decide(req);
    } catch {
      this.applyFallback(biz, req, day);
      return;
    }

    if (isPromise(result)) {
      this.pending.add(biz.id);
      const settled = result
        .then(
          (decision) => this.apply(biz, decision, day, this.provider.id, false),
          () => this.applyFallback(biz, req, day),
        )
        .finally(() => this.pending.delete(biz.id));
      this.inflight.push(settled);
    } else {
      this.apply(biz, result, day, this.provider.id, false);
    }
  }

  private applyFallback(biz: Business, req: DecisionRequest, day: number): void {
    this.apply(biz, this.fallback.decide(req), day, this.fallback.id, true);
  }

  private apply(
    biz: Business,
    decision: BusinessDecision,
    day: number,
    providerId: string,
    fallback: boolean,
  ): void {
    const clamped = clampAction(decision.action, biz.price, this.limits);
    if (clamped.setPrice !== undefined) biz.price = clamped.setPrice;
    if (clamped.hire !== undefined && clamped.hire !== 0) this.applyHire(biz, clamped.hire);
    if (clamped.brand !== undefined && clamped.brand > 0) {
      clamped.brand = this.applyBrand(biz, clamped.brand); // Phase 17 — brand takes its slice first
    }
    if (clamped.invest !== undefined && clamped.invest > 0) {
      clamped.invest = this.applyInvest(biz, clamped.invest);
    }
    if (clamped.setWage !== undefined) this.applySetWage(biz, clamped.setWage);
    if (clamped.setPayout !== undefined) biz.payoutRate = clamped.setPayout; // Phase 16

    this.log.push({
      day,
      businessId: biz.id,
      providerId,
      fallback,
      action: clamped,
      reason: decision.reason,
      usage: decision.usage,
    });
  }

  /**
   * Phase 12c — buy capital goods from the factory and book them as equipment.
   * The request has already been clamped to {@link DecisionLimits.maxInvestPerReview};
   * this step adds the cash-aware floor that no static clamp can do — never
   * spend below {@link BUSINESS_RESERVE}, so an aggressive pricer can't drive a
   * firm into insolvency on a single review. Money moves only via
   * {@link World.transfer} (so the conservation invariant holds — investment
   * doesn't create or destroy a cent) and capital rises one-for-one with the
   * cash that actually moved. The factory is the canonical seller (the plan's
   * B2B routing — sends money to the producer that would otherwise starve in
   * the P10-7 die-off). Returns the amount actually invested, so the decision
   * log records what hit the world rather than what was asked for.
   */
  private applyInvest(biz: Business, requested: number): number {
    const headroom = Math.max(0, biz.cash - BUSINESS_RESERVE);
    const want = Math.min(requested, headroom);
    if (want <= 0) return 0;
    // The capital-goods seller is whatever factory is currently active — found by
    // kind, not a fixed id, so a respawned factory (Phase 15 D) still takes the
    // payment. No active factory means no one to buy equipment from this review.
    const factory = this.world.businesses.find((b) => b.active && ARCHETYPES[b.kind].capitalGoodsVendor);
    if (!factory) return 0;
    const moved = this.world.transfer(biz.id, factory.id, want);
    if (moved <= 0) return 0;
    biz.capital = (biz.capital ?? CAPITAL_BASELINE) + moved;
    // Book the expenditure so MacroSystem can count it as the investment term in
    // GDP (Phase 12d). Pure bookkeeping of cash that already moved above — no
    // money is created, so conservation is untouched.
    biz.capitalInvested = (biz.capitalInvested ?? 0) + moved;
    return moved;
  }

  /**
   * Phase 17 — spend cash on brand/marketing, building the firm's brand-equity stock
   * (the demand-side twin of {@link applyInvest}). The spend goes to the landlord — a
   * real, existing conserving holder that recirculates above-reserve cash to residents
   * daily, so marketing money re-enters the economy like an ad channel — resolved by
   * its fixed id. Guards: never spend below {@link BUSINESS_RESERVE} (no self-bankruptcy);
   * never self-transfer (a hypothetically-agentic landlord can't mint brand for free);
   * and the `moved <= 0` check stays ABOVE the stock writes so a no-op transfer records
   * no phantom spend. Money moves only via {@link World.transfer}; brand/brandSpent are
   * non-cash, so conservation holds. Returns the cash actually spent. Deterministic.
   */
  private applyBrand(biz: Business, requested: number): number {
    const headroom = Math.max(0, biz.cash - BUSINESS_RESERVE);
    const want = Math.min(requested, headroom);
    if (want <= 0) return 0;
    const sink = this.world.getBusiness("biz_landlord");
    if (!sink || sink.id === biz.id) return 0; // never self-transfer
    const moved = this.world.transfer(biz.id, sink.id, want);
    if (moved <= 0) return 0; // keep above the stock writes — no phantom spend
    biz.brand = (biz.brand ?? BRAND_BASELINE) + moved * BRAND_PER_DOLLAR;
    biz.brandSpent = (biz.brandSpent ?? 0) + moved;
    return moved;
  }

  /**
   * Phase 15 A — post a new wage and bring the team along. The proposal is clamped
   * to `[base, base*wageCapMult]`: a firm competes by paying *above* the role's
   * base, never below it, never past the cap (the cap is {@link WAGE_CAP_MULT} by
   * default = the old fixed 2×; a freed-wage city raises it — Initiative #1 S1).
   * Sitting staff are re-rated *up* to
   * the new posted rate (you can compete for the workers you already have, not just
   * new hires — the wage actually paid lives on the resident, so without this a
   * raise wouldn't reach them) but never cut below what they already earn — no
   * clawing back a wage. Moves no cash: wages keep flowing through EconomySystem,
   * now at the new rate, so the closed economy is untouched. Deterministic — fixed
   * employee order, no RNG.
   */
  private applySetWage(biz: Business, wage: number): void {
    const base = biz.baseWagePerTick ?? biz.wagePerTick;
    const posted = Math.max(base, Math.min(base * this.wageCapMult, wage));
    biz.wagePerTick = posted;
    for (const id of biz.employeeIds) {
      const r = this.world.getResident(id);
      if (r && r.wagePerTick < posted) r.wagePerTick = posted;
    }
  }

  /** Move residents in/out of the jobless pool. Deterministic ordering. */
  private applyHire(biz: Business, delta: number): void {
    if (delta > 0) {
      const pool = this.world.residents
        .filter((r) => r.jobId === "")
        .sort((a, b) => residentIndex(a.id) - residentIndex(b.id));
      const hires = Math.min(delta, pool.length);
      for (let i = 0; i < hires; i++) {
        const r = pool[i]!;
        r.jobId = biz.id;
        r.wagePerTick = biz.wagePerTick;
        biz.employeeIds.push(r.id);
      }
    } else {
      const layoffs = Math.min(-delta, biz.employeeIds.length);
      for (let i = 0; i < layoffs; i++) {
        const id = biz.employeeIds.pop()!; // last hired, first out
        const r = this.world.getResident(id);
        if (r) {
          r.jobId = "";
          r.wagePerTick = 0;
        }
      }
    }
  }

  private observe(biz: Business, day: number): BusinessObservation {
    const mark = this.marks.get(biz.id);
    const prevPnl = mark?.pnl ?? { revenue: 0, wagesPaid: 0, rentCollected: 0, distributed: 0 };
    const prevCash = mark?.cash ?? biz.cash;

    const dayRevenue = biz.pnl.revenue - prevPnl.revenue;
    const dayWages = biz.pnl.wagesPaid - prevPnl.wagesPaid;
    const dayDistributed = biz.pnl.distributed - prevPnl.distributed;
    const dayProfit = biz.cash - prevCash; // cash identity for non-landlords
    const dayRent = dayRevenue - dayWages - dayDistributed - dayProfit;

    // What the competing storefronts of this kind charge, averaged. Undefined
    // when this business is the only one of its kind (the pre-11b norm), so the
    // observation — and every mind reading it — is unchanged without a rival.
    const rivals = this.world.businesses.filter(
      (b) => b.kind === biz.kind && b.active && b.id !== biz.id,
    );
    const rivalPrice =
      rivals.length > 0 ? rivals.reduce((s, b) => s + b.price, 0) / rivals.length : undefined;

    // The wholesale price of the one input this kind turns 1:1 into a sellable
    // unit — its marginal cost, and the floor below which a sale loses money.
    const consumes = ARCHETYPES[biz.kind].consumes;
    const unitCost = consumes ? this.market?.priceBook()[consumes] : undefined;

    return {
      businessId: biz.id,
      name: biz.name,
      kind: biz.kind,
      day,
      cash: biz.cash,
      inventory: biz.inventory,
      price: biz.price,
      referencePrice: RETAIL_REFERENCE_PRICE[biz.kind],
      rivalPrice,
      unitCost,
      employeeCount: biz.employeeIds.length,
      wagePerTick: biz.wagePerTick,
      baseWagePerTick: biz.baseWagePerTick ?? biz.wagePerTick,
      maxWage: (biz.baseWagePerTick ?? biz.wagePerTick) * this.wageCapMult, // S1 — the effective wage ceiling (base × cap)
      understaffed: biz.employeeIds.length < desiredHeadcount(biz.kind),
      dayRevenue,
      dayWages,
      dayRent,
      dayProfit,
      dayDistributed,
      payoutRate: biz.payoutRate, // Phase 16 — current retain-vs-distribute stance (undefined ⇒ full payout)
      unemployedCount: this.world.residents.filter((r) => r.jobId === "").length,
      // Phase 12c — surface the two signals the invest lever reads: how much
      // equipment this firm owns, and how hard it ran yesterday relative to
      // what that equipment + staffing allowed. Both are undefined-safe: a
      // pre-12 save has no capital field, and the landlord/an unstaffed firm
      // has no utilization reading.
      capital: biz.capital,
      capacityUtilization: this.market?.capacityUtilizationFor(biz.id),
      brand: biz.brand,
      brandSpent: biz.brandSpent,
      brandElasticity: this.brandElasticity,
    };
  }

  serialize(): unknown {
    return { marks: Array.from(this.marks.entries()) };
  }

  restore(state: unknown): void {
    const s = state as { marks?: [string, Bookmark][] } | undefined;
    this.marks.clear();
    for (const [id, mark] of s?.marks ?? []) this.marks.set(id, mark);
  }
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown }).then === "function";
}

function residentIndex(id: string): number {
  return Number(id.split("_")[1] ?? 0);
}
