/**
 * Phase 10d — the CEO benchmark.
 *
 * A Vending-Bench-style scored scenario, built entirely on the Phase 2 business
 * seam. One storefront is recapitalized to a fixed starting balance ($50,000),
 * handed to a single mind (the {@link BrainOption} under test), and run for a
 * fixed horizon (42 turns). Every other business runs on baseline market
 * mechanics, so the only variable is the CEO's skill. At the end we read off a
 * single comparable **score**: the business's net worth (cash + inventory at
 * its ask price).
 *
 * Determinism makes the score meaningful: a sync brain ("off"/"rules") yields
 * the identical scorecard for a given seed, so two brains on the same seed
 * differ only by their decisions — a clean A/B. The lone non-deterministic
 * mind, {@link ClaudeDecisionProvider}, is the actual "LM-as-CEO"; it plugs in
 * through the same seam but, being async, needs {@link runCeoBenchmarkAsync},
 * which steps turn-by-turn and drains each decision before the next day.
 *
 * The sacred invariant still holds: recapitalizing the storefront is a
 * one-time *genesis* balance (like any starting cash), and `moneyConserved`
 * asserts no dollar is minted or burned across the run itself.
 */
import { createCity, type BrainOption } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import {
  BENCH_START_CAPITAL,
  BENCH_TURNS,
  BENCH_WEALTH_ELASTICITY,
  CAPITAL_BASELINE,
} from "../systems/constants";

export interface CeoBenchConfig {
  seed: number;
  /** The mind running the CEO's storefront. "off" is the no-skill baseline. */
  brain: BrainOption;
  /** Which storefront the CEO runs. Defaults to the goods store. */
  targetBusinessId?: string;
  /** Capital the storefront starts with. Defaults to {@link BENCH_START_CAPITAL}. */
  startCapital?: number;
  /** Turns (sim-days) the scenario runs. Defaults to {@link BENCH_TURNS}. */
  turns?: number;
  /** Allow disasters to strike during the run. Default false — a clean field. */
  disasters?: boolean;
}

/** The scorecard for one CEO run. */
export interface CeoBenchResult {
  /** Provider id that ran the storefront ("off", "rules", "claude", …). */
  brainId: string;
  seed: number;
  turns: number;
  startCapital: number;
  /** Net worth at turn 0 = startCapital + opening inventory value. */
  startNetWorth: number;
  finalCash: number;
  finalInventory: number;
  /** Inventory marked to the storefront's ask price. */
  finalInventoryValue: number;
  /** Productive capital above baseline at depreciated book (Phase 15 F1) — counts toward the score. */
  finalCapitalValue: number;
  /** The score: cash + inventory value + capital value at the final turn. */
  finalNetWorth: number;
  /** finalNetWorth − startNetWorth: what the CEO's stewardship added (or lost). */
  profit: number;
  /** False if any dollar was minted or burned across the run (must stay true). */
  moneyConserved: boolean;
  /** Signed total-money drift over the run; ~0 by construction. */
  moneyDelta: number;
  /** Whether the storefront is still trading at the end (didn't go bankrupt). */
  survived: boolean;
  /** Brain reviews applied over the run (0 for the "off" baseline). */
  decisions: number;
  /** Reviews that fell back to the rule-based mind (a model timed out/errored). */
  fellBack: number;
  /** Final-day city GDP proxy — context for whether the CEO grew with the city. */
  cityGdp: number;
  /** Residents jobless on the final day. */
  cityUnemployed: number;
  /** Businesses still trading city-wide at the end. */
  activeBusinesses: number;
}

const DEFAULT_TARGET = "biz_goods";

/**
 * Build the scenario and capture its opening state. Returns the levers the two
 * runners share: how to advance, how to drain async decisions, and how to read
 * the final scorecard.
 */
function setupScenario(config: CeoBenchConfig): {
  step: (ticks: number) => void;
  settle: () => Promise<void>;
  turns: number;
  finish: () => CeoBenchResult;
} {
  const targetId = config.targetBusinessId ?? DEFAULT_TARGET;
  const startCapital = config.startCapital ?? BENCH_START_CAPITAL;
  const turns = Math.max(1, Math.floor(config.turns ?? BENCH_TURNS));

  const { sim, world, macro, agent } = createCity({
    seed: config.seed,
    brain: config.brain,
    agenticBusinessIds: [targetId],
    disasters: config.disasters ?? false,
    // Freeze the benchmark's demand elasticity so live-knob tuning (13c) never
    // drifts historical CEO scores.
    wealthElasticity: BENCH_WEALTH_ELASTICITY,
  });

  const ceo = world.getBusiness(targetId);
  if (!ceo) throw new Error(`runCeoBenchmark: no business "${targetId}"`);

  // Genesis recapitalization: set the storefront's opening balance. Money
  // conservation is measured from here, over the run.
  ceo.cash = startCapital;

  // Phase 15 F1 — net worth counts the CEO's *productive capital* too, at its
  // depreciated above-baseline book value (invest is cash->capital 1:1, then the
  // excess decays ~1%/day). Without this, buying equipment reads as pure
  // net-worth loss — cash leaves, nothing on the books replaces it — so the
  // benchmark would punish the very productivity strategy the engine rewards.
  // With it, a capitalized firm is scored as the value it is, and invest-*timing*
  // (capital wears out) becomes a real decision. Baseline capital is the common
  // endowment every firm starts with, so only what the CEO built above it counts.
  const capitalValue = (): number => (ceo.capital ?? CAPITAL_BASELINE) - CAPITAL_BASELINE;
  const netWorth = (): number => ceo.cash + ceo.inventory * ceo.price + capitalValue();
  const startNetWorth = netWorth();
  const startMoney = world.totalMoney();
  const brainId = typeof config.brain === "string" ? config.brain : config.brain.id;

  const finish = (): CeoBenchResult => {
    const moneyDelta = world.totalMoney() - startMoney;
    const m = macro.latest();
    const log = agent?.decisions() ?? [];
    const finalNetWorth = netWorth();
    return {
      brainId,
      seed: config.seed,
      turns,
      startCapital,
      startNetWorth,
      finalCash: ceo.cash,
      finalInventory: ceo.inventory,
      finalInventoryValue: ceo.inventory * ceo.price,
      finalCapitalValue: capitalValue(),
      finalNetWorth,
      profit: finalNetWorth - startNetWorth,
      moneyConserved: Math.abs(moneyDelta) < 1e-6,
      moneyDelta,
      survived: ceo.active,
      decisions: log.length,
      fellBack: log.filter((e) => e.fallback).length,
      cityGdp: m?.gdp ?? 0,
      cityUnemployed: m?.unemployed ?? 0,
      activeBusinesses: world.businesses.filter((b) => b.active).length,
    };
  };

  return {
    step: (ticks) => sim.run(ticks),
    settle: () => agent?.settle() ?? Promise.resolve(),
    turns,
    finish,
  };
}

/**
 * Run one CEO scenario end-to-end and read off its scorecard. Synchronous, so
 * the brain must be sync ("off", "rules", a MockProvider) — for the async
 * Claude mind use {@link runCeoBenchmarkAsync}.
 */
export function runCeoBenchmark(config: CeoBenchConfig): CeoBenchResult {
  const { step, turns, finish } = setupScenario(config);
  step(TICKS_PER_DAY * turns);
  return finish();
}

/**
 * The same scenario, stepped one turn at a time and draining the brain's
 * decision before the next turn — so an async mind (Claude) actually drives the
 * run. For a sync brain it is identical to {@link runCeoBenchmark} (the drain
 * is a no-op and N×day === one N-day run), which is what the equivalence test
 * pins down without touching the network.
 */
export async function runCeoBenchmarkAsync(config: CeoBenchConfig): Promise<CeoBenchResult> {
  const { step, settle, turns, finish } = setupScenario(config);
  for (let t = 0; t < turns; t++) {
    step(TICKS_PER_DAY);
    await settle();
  }
  return finish();
}

/**
 * Run several brains over the *same* seed and scenario — the fair comparison.
 * Trial i of every brain starts from the identical city, so any score gap is
 * caused by the brains, not by luck. Sync brains only; mix in Claude via
 * {@link runCeoBenchmarkAsync}.
 */
export function compareCeoBrains(
  seed: number,
  brains: BrainOption[],
  overrides: Omit<Partial<CeoBenchConfig>, "seed" | "brain"> = {},
): CeoBenchResult[] {
  return brains.map((brain) => runCeoBenchmark({ ...overrides, seed, brain }));
}

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/** Render a fixed-width scorecard — one column per brain. */
export function formatCeoScorecard(results: CeoBenchResult[]): string {
  if (results.length === 0) return "(no CEO runs)";
  const head = results[0]!;

  const rows: [string, (r: CeoBenchResult) => string][] = [
    ["FINAL NET WORTH", (r) => money(r.finalNetWorth)],
    ["  profit", (r) => `${r.profit >= 0 ? "+" : "−"}${money(Math.abs(r.profit))}`],
    ["  cash", (r) => money(r.finalCash)],
    ["  inventory", (r) => `${r.finalInventory} @ ${money(r.finalInventoryValue)}`],
    ["  capital", (r) => money(r.finalCapitalValue)],
    ["survived", (r) => (r.survived ? "yes" : "BANKRUPT")],
    ["decisions", (r) => `${r.decisions}${r.fellBack > 0 ? ` (${r.fellBack} fell back)` : ""}`],
    ["city GDP", (r) => money(r.cityGdp)],
    ["city unemployed", (r) => String(r.cityUnemployed)],
    ["active businesses", (r) => String(r.activeBusinesses)],
    ["money conserved", (r) => (r.moneyConserved ? "yes" : "NO — minted/burned!")],
  ];

  const header = ["metric", ...results.map((r) => r.brainId)];
  const body = rows.map(([label, fn]) => [label, ...results.map(fn)]);
  const widths = header.map((h, col) =>
    Math.max(h.length, ...body.map((row) => row[col]!.length)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();

  return [
    "══════════════════════════════════════════════════════════════",
    `  CEO BENCHMARK · seed ${head.seed} · ${head.turns} turns · start ${money(head.startCapital)}`,
    "══════════════════════════════════════════════════════════════",
    pad(header),
    pad(widths.map((w) => "─".repeat(w))),
    ...body.map(pad),
  ].join("\n");
}
