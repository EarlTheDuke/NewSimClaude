import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { ARCHETYPES } from "../world/archetypes";
import { MACRO_HISTORY_DAYS, CAPITAL_BASELINE } from "./constants";
import type { MarketSystem } from "./MarketSystem";

/** One sim-day's macro vitals — a single point on every chartable curve. */
export interface MacroSample {
  /** 1-indexed sim-day this sample closes. */
  day: number;
  /** Total money across residents + businesses (the conservation invariant). */
  totalMoney: number;
  /**
   * Output that day by the expenditure approach: consumption + investment
   * (Phase 12d) + exports (C4a). Before the invest lever this was consumption
   * alone; in a city where nobody invests or exports the terms are 0, so the
   * number is unchanged there.
   */
  gdp: number;
  /** Final consumption that day: resident spend at storefronts. */
  consumption: number;
  /** Investment that day: business spend on capital goods via the invest lever. */
  investment: number;
  /**
   * Exports that day (C4a): city output sold to the rest of the world via the port — the
   * outside-demand term that can lift GDP past the closed-economy ceiling. 0 in a portless or
   * trade-off city, so gdp reads exactly as before there.
   */
  exports: number;
  /**
   * Imports that day (C4a slice a3): inputs firms bought from the port when the local chain left
   * them short. Subtracts from GDP (the standard −M: imported content isn't city output, and it
   * later appears inside C). 0 in a portless or trade-off city.
   */
  imports: number;
  /**
   * NEW money created that day by the Monetary Authority (C4b) — the day-over-day delta of the
   * World's audited mint ledger, net of burns. NOT a GDP term (money isn't output); recorded so
   * the b3 measurement can chart supply growth against GDP and prices. 0 in any
   * strictly-conserved city.
   */
  minted: number;
  /** Cash paid to residents as WAGES that day (dividends are tracked separately in {@link dividend}). */
  payroll: number;
  /** Rent collected that day. */
  rent: number;
  /** Residents with no job at day's end. */
  unemployed: number;
  /** Businesses still trading. */
  activeBusinesses: number;
  /** Mean of the four resource prices. */
  avgResourcePrice: number;
  /**
   * Productive capital stock across all businesses (sum of each firm's
   * `capital`, a dimensionless index where {@link CAPITAL_BASELINE} = today's
   * output). Climbs as businesses invest; flat at baseline where nobody does.
   * Not a dollar figure.
   */
  totalCapital: number;
  // --- Observatory metrics (free-market study; read-only, no behaviour change) ---
  /** Dividend / recirculation paid to residents that day (the distribution pump). */
  dividend: number;
  /**
   * The emergent **labour-vs-capital split**: wages ÷ (wages + dividend) that day (0..1).
   * The headline reading for the free-market initiative — watch it float as wages compete
   * and the dividend is weaned. 0 when no money was paid out that day.
   */
  labourShare: number;
  /** Gini coefficient of resident wealth that day (0 = perfectly equal, →1 = concentrated). */
  gini: number;
  /** Money velocity proxy: consumption ÷ total money that day (is the economy circulating?). */
  velocity: number;
  /** Mean wage/tick across employed residents that day — the going wage level. */
  avgWage: number;
}

/** Running cumulative totals, differenced into per-day flows. */
interface Cumulative {
  consumption: number;
  payroll: number;
  rent: number;
  investment: number;
  distributed: number;
  exports: number;
  imports: number;
  minted: number;
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
  private prev: Cumulative = { consumption: 0, payroll: 0, rent: 0, investment: 0, distributed: 0, exports: 0, imports: 0, minted: 0 };

  constructor(
    private readonly world: World,
    private readonly market: MarketSystem,
  ) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;

    const cum: Cumulative = { consumption: 0, payroll: 0, rent: 0, investment: 0, distributed: 0, exports: 0, imports: 0, minted: 0 };
    // The day's net money creation — the audited ledger's delta (0 in a strictly-conserved run).
    cum.minted = this.world.mintedTotal() - this.world.burnedTotal();
    let totalCapital = 0;
    for (const b of this.world.businesses) {
      cum.payroll += b.pnl.wagesPaid;
      cum.rent += b.pnl.rentCollected;
      cum.investment += b.capitalInvested ?? 0;
      cum.distributed += b.pnl.distributed;
      cum.exports += b.pnl.exportRevenue ?? 0;
      cum.imports += b.pnl.importSpend ?? 0;
      if (ARCHETYPES[b.kind].sellsToResidents) cum.consumption += b.pnl.revenue;
      totalCapital += b.capital ?? CAPITAL_BASELINE;
    }

    // Day-over-day flows. GDP by expenditure = C + I + X − M; in the seeded city
    // X and M are 0 and I is 0 until someone invests, so gdp == consumption and
    // the metric stays byte-identical to its pre-12d (consumption-only) self.
    // (Exports never double-count into consumption: only non-storefront producers
    // sell to the port, and their revenue isn't in the consumption sum. Imports
    // subtract because the landed content isn't city output, yet shows up later
    // inside C when the processed good retails.)
    const consumption = cum.consumption - this.prev.consumption;
    const investment = cum.investment - this.prev.investment;
    const exported = cum.exports - this.prev.exports;
    const imported = cum.imports - this.prev.imports;
    const wages = cum.payroll - this.prev.payroll;
    const dividend = cum.distributed - this.prev.distributed;
    const totalMoney = this.world.totalMoney();
    const employed = this.world.residents.filter((r) => r.jobId !== "");
    const prices = Object.values(this.market.priceBook());
    const sample: MacroSample = {
      day: ctx.totalTicks / TICKS_PER_DAY,
      totalMoney,
      gdp: consumption + investment + exported - imported,
      consumption,
      investment,
      exports: exported,
      imports: imported,
      minted: cum.minted - this.prev.minted,
      payroll: wages,
      rent: cum.rent - this.prev.rent,
      unemployed: this.world.residents.filter((r) => r.jobId === "").length,
      activeBusinesses: this.world.businesses.filter((b) => b.active).length,
      avgResourcePrice: prices.reduce((s, p) => s + p, 0) / prices.length,
      totalCapital,
      // Observatory metrics — pure reads of the settled day; deterministic, no RNG.
      dividend,
      labourShare: wages + dividend > 0 ? wages / (wages + dividend) : 0,
      gini: giniOf(this.world.residents.map((r) => r.money)),
      velocity: totalMoney > 0 ? consumption / totalMoney : 0,
      avgWage: employed.length > 0 ? employed.reduce((s, r) => s + r.wagePerTick, 0) / employed.length : 0,
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
      ? {
          consumption: s.prev.consumption,
          payroll: s.prev.payroll,
          rent: s.prev.rent,
          investment: s.prev.investment ?? 0, // pre-12d saves carry no investment baseline
          distributed: s.prev.distributed ?? 0, // pre-observatory saves carry no dividend baseline
          exports: s.prev.exports ?? 0, // pre-C4a saves carry no exports baseline
          imports: s.prev.imports ?? 0, // pre-a3 saves carry no imports baseline
          minted: s.prev.minted ?? 0, // pre-C4b saves carry no mint baseline
        }
      : { consumption: 0, payroll: 0, rent: 0, investment: 0, distributed: 0, exports: 0, imports: 0, minted: 0 };
  }
}

/**
 * Gini coefficient of a wealth distribution (0 = perfectly equal, →1 = all held by one).
 * Standard sorted-rank formula — deterministic (a sort + arithmetic, no RNG). Negative
 * balances can't occur (the closed economy never lets a holder go below 0), but we guard
 * anyway; an all-zero or empty distribution reads as 0 (perfectly equal).
 */
function giniOf(values: readonly number[]): number {
  const xs = values.filter((v) => v >= 0).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const sum = xs.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * xs[i]!;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}
