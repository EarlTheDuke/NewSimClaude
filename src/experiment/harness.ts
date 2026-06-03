import { createCity, type CitySimOptions } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

/**
 * Phase 7 — the experiment harness. The deterministic sim's whole payoff is
 * reproducibility: the same seed and options always play out bit-for-bit the
 * same. This headless runner cashes that in. It builds cities with
 * {@link createCity}, runs each for a fixed number of sim-days, and reads off a
 * fixed set of end-of-run metrics. Run a config across many seeds and you get a
 * stable distribution; run two configs across the *same* seeds and any
 * difference in the aggregates is caused by the configs, not by luck — a clean
 * A/B (e.g. "disasters on" vs "disasters off").
 *
 * Nothing here is random on its own: all randomness lives inside the seeded
 * sim, so a harness call is itself a pure function of (config, seeds).
 */

/** End-of-run metrics for a single deterministic trial. */
export interface TrialMetrics {
  seed: number;
  days: number;
  startMoney: number;
  finalMoney: number;
  /** finalMoney − startMoney. ~0 unless a god act or LLM minted/burned money. */
  moneyDelta: number;
  /** Businesses still trading at the end. */
  activeBusinesses: number;
  /** Businesses that went inactive over the run (started − still active). */
  bankruptcies: number;
  /** Disasters retained in the events log (0 when disasters are off; capped by the log's ring buffer). */
  disasters: number;
  /** Residents with no job at the end. */
  unemployed: number;
  /** Final-day GDP proxy (resident consumption). */
  gdp: number;
  /** Final-day payroll distributed to residents. */
  payroll: number;
  /** Mean B2B resource price on the final day. */
  avgResourcePrice: number;
}

/** A named configuration to run across a set of seeds. */
export interface ExperimentConfig {
  /** Human label, e.g. "disasters on". */
  label: string;
  /** City options applied to every trial. Any `seed` here is overridden per trial. */
  options?: CitySimOptions;
  /** Sim-days each trial runs. */
  days: number;
}

/** Mean / min / max of one numeric metric across a config's trials. */
export interface Stat {
  mean: number;
  min: number;
  max: number;
}

/** Per-metric aggregates over every trial in an experiment. */
export type Aggregate = Record<keyof Omit<TrialMetrics, "seed" | "days">, Stat>;

export interface ExperimentResult {
  label: string;
  days: number;
  trials: TrialMetrics[];
  aggregate: Aggregate;
}

/** The numeric metrics we aggregate, in display order. */
const METRIC_KEYS: (keyof Aggregate)[] = [
  "startMoney",
  "finalMoney",
  "moneyDelta",
  "activeBusinesses",
  "bankruptcies",
  "disasters",
  "unemployed",
  "gdp",
  "payroll",
  "avgResourcePrice",
];

/** Run one city for `days` sim-days and read off its end-of-run metrics. */
export function runTrial(options: CitySimOptions, days: number): TrialMetrics {
  if (days < 0) throw new Error("runTrial: days must be >= 0");
  const { sim, world, macro, events } = createCity(options);

  const startMoney = world.totalMoney();
  const startedBusinesses = world.businesses.length;

  sim.run(TICKS_PER_DAY * days);

  const finalMoney = world.totalMoney();
  const activeBusinesses = world.businesses.filter((b) => b.active).length;
  const m = macro.latest();

  return {
    seed: options.seed ?? 1,
    days,
    startMoney,
    finalMoney,
    moneyDelta: finalMoney - startMoney,
    activeBusinesses,
    bankruptcies: startedBusinesses - activeBusinesses,
    disasters: events?.events().length ?? 0,
    unemployed: m?.unemployed ?? world.residents.filter((r) => r.jobId === "").length,
    gdp: m?.gdp ?? 0,
    payroll: m?.payroll ?? 0,
    avgResourcePrice: m?.avgResourcePrice ?? 0,
  };
}

/** Run a config across `seeds` and aggregate the per-trial metrics. */
export function runExperiment(config: ExperimentConfig, seeds: number[]): ExperimentResult {
  if (seeds.length === 0) throw new Error("runExperiment: need at least one seed");
  const trials = seeds.map((seed) => runTrial({ ...config.options, seed }, config.days));
  return { label: config.label, days: config.days, trials, aggregate: aggregate(trials) };
}

/**
 * Run several configs across the *same* seeds. Sharing seeds is what makes the
 * comparison fair: trial i of every config starts from the identical city, so
 * differences in the aggregates are attributable to the configs alone.
 */
export function compareExperiments(
  configs: ExperimentConfig[],
  seeds: number[],
): ExperimentResult[] {
  return configs.map((c) => runExperiment(c, seeds));
}

function aggregate(trials: TrialMetrics[]): Aggregate {
  const out = {} as Aggregate;
  for (const key of METRIC_KEYS) out[key] = stat(trials.map((t) => t[key]));
  return out;
}

function stat(values: number[]): Stat {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { mean: sum / values.length, min, max };
}

/**
 * Render a compact, fixed-width comparison table — one row per metric, one
 * column per config (showing each metric's mean). Handy for a console dump or a
 * <pre> panel in the UI.
 */
export function formatComparison(results: ExperimentResult[]): string {
  if (results.length === 0) return "(no experiments)";

  const header = ["metric", ...results.map((r) => r.label)];
  const rows = METRIC_KEYS.map((key) => [
    key,
    ...results.map((r) => formatNumber(r.aggregate[key].mean)),
  ]);

  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => row[col]!.length)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();

  const seedLine = `seeds: ${results[0]!.trials.length} · days: ${results[0]!.days}`;
  return [seedLine, pad(header), pad(widths.map((w) => "-".repeat(w))), ...rows.map(pad)].join("\n");
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
