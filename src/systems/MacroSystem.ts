import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { ARCHETYPES } from "../world/archetypes";
import { MACRO_HISTORY_DAYS } from "./constants";
import type { MarketSystem } from "./MarketSystem";

/** One sim-day's macro vitals — a single point on every chartable curve. */
export interface MacroSample {
  /** 1-indexed sim-day this sample closes. */
  day: number;
  /** Total money across residents + businesses (the conservation invariant). */
  totalMoney: number;
  /** Final consumption that day: resident spend at storefronts (a GDP proxy). */
  gdp: number;
  /** Cash distributed to residents that day (wages + dividends). */
  payroll: number;
  /** Rent collected that day. */
  rent: number;
  /** Residents with no job at day's end. */
  unemployed: number;
  /** Businesses still trading. */
  activeBusinesses: number;
  /** Mean of the four resource prices. */
  avgResourcePrice: number;
}

/** Running cumulative totals, differenced into per-day flows. */
interface Cumulative {
  consumption: number;
  payroll: number;
  rent: number;
}

/**
 * Macro vitals (Phase 4d). Once per sim-day — running last, so it reads the
 * fully-settled day including any layoffs the LifecycleSystem just made — it
 * appends one {@link MacroSample} to a ring buffer capped at
 * {@link MACRO_HISTORY_DAYS}. Flow metrics (gdp, payroll, rent) are day-over-day
 * deltas of the businesses' cumulative P&L; the rest are point-in-time reads.
 *
 * Pure derivation: no RNG, mutates nothing. Both the buffer and the delta
 * baseline are serialized, so reload reproduces the next day's flows exactly.
 */
export class MacroSystem implements System {
  readonly id = "macro";
  private samples: MacroSample[] = [];
  private prev: Cumulative = { consumption: 0, payroll: 0, rent: 0 };

  constructor(
    private readonly world: World,
    private readonly market: MarketSystem,
  ) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;

    const cum: Cumulative = { consumption: 0, payroll: 0, rent: 0 };
    for (const b of this.world.businesses) {
      cum.payroll += b.pnl.wagesPaid;
      cum.rent += b.pnl.rentCollected;
      if (ARCHETYPES[b.kind].sellsToResidents) cum.consumption += b.pnl.revenue;
    }

    const prices = Object.values(this.market.priceBook());
    const sample: MacroSample = {
      day: ctx.totalTicks / TICKS_PER_DAY,
      totalMoney: this.world.totalMoney(),
      gdp: cum.consumption - this.prev.consumption,
      payroll: cum.payroll - this.prev.payroll,
      rent: cum.rent - this.prev.rent,
      unemployed: this.world.residents.filter((r) => r.jobId === "").length,
      activeBusinesses: this.world.businesses.filter((b) => b.active).length,
      avgResourcePrice: prices.reduce((s, p) => s + p, 0) / prices.length,
    };
    this.prev = cum;

    this.samples.push(sample);
    if (this.samples.length > MACRO_HISTORY_DAYS) this.samples.shift();
  }

  /** The retained time series, oldest first. */
  history(): readonly MacroSample[] {
    return this.samples;
  }

  /** The most recent day's vitals, if any have been recorded. */
  latest(): MacroSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  serialize(): unknown {
    return { samples: [...this.samples], prev: { ...this.prev } };
  }

  restore(state: unknown): void {
    const s = state as { samples?: MacroSample[]; prev?: Cumulative } | undefined;
    this.samples = Array.isArray(s?.samples) ? s!.samples.map((x) => ({ ...x })) : [];
    this.prev = s?.prev
      ? { consumption: s.prev.consumption, payroll: s.prev.payroll, rent: s.prev.rent }
      : { consumption: 0, payroll: 0, rent: 0 };
  }
}
