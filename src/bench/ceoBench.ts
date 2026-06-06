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
import { createCity, type BrainOption, type ResidentBrainOption } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import {
  BENCH_START_CAPITAL,
  BENCH_TURNS,
  BENCH_WEALTH_ELASTICITY,
  BENCH_OWNER_DIVIDEND_SHARE,
  BENCH_BRAND_DEMAND_ELASTICITY,
  CAPITAL_BASELINE,
} from "../systems/constants";
import type {
  BusinessAction,
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
} from "../ai/types";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";

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
  /**
   * Which mind runs opted-in residents (Phase 15 F3). Default "off" — the classic
   * solo bench has no labour churn. Set to "rules" with {@link agenticResidentIds}
   * to create a labour market that can poach the CEO's crew, which is what makes
   * the `hire` and `setWage` levers actually bite.
   */
  residentBrain?: ResidentBrainOption;
  /** Residents the resident brain manages — the churn that exercises hire/setWage. */
  agenticResidentIds?: string[];
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
    // Freeze the benchmark's demand elasticity and owner dividend so live-knob
    // tuning never drifts historical CEO scores, and the firm-net-worth score
    // stays a clean skill signal (all profit stays in the firm).
    wealthElasticity: BENCH_WEALTH_ELASTICITY,
    ownerDividendShare: BENCH_OWNER_DIVIDEND_SHARE,
    brandElasticity: BENCH_BRAND_DEMAND_ELASTICITY,
    residentBrain: config.residentBrain ?? "off",
    agenticResidentIds: config.agenticResidentIds,
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

/**
 * Phase 15 F2 — a provider that runs a base mind but *suppresses one lever*, for
 * the lever-ablation study. It asks the base provider (the rules CEO) for its move,
 * then deletes one field from the action before it is applied — so a run with, say,
 * `invest` ablated is the rules CEO playing exactly as it would, minus the ability
 * to buy equipment. Comparing its final net worth to the full rules CEO's measures
 * what that one lever was worth. Sync only (wraps the deterministic rules mind).
 */
export class AblatedProvider implements DecisionProvider {
  readonly id: string;
  constructor(
    private readonly base: DecisionProvider,
    private readonly drop: keyof BusinessAction,
  ) {
    this.id = `${base.id}-no-${String(drop)}`;
  }
  decide(req: DecisionRequest): BusinessDecision {
    const decision = this.base.decide(req) as BusinessDecision;
    const action: BusinessAction = { ...decision.action };
    delete action[this.drop];
    return { ...decision, action };
  }
}

/** One lever's measured worth: the net worth a CEO gives up by losing it. */
export interface LeverAblation {
  lever: keyof BusinessAction;
  /** Full rules-CEO net worth minus net worth with this lever disabled. Positive = the lever helps. */
  impact: number;
}

export interface AblationStudy {
  /** Final net worth of the full rules CEO (all levers live). */
  fullNetWorth: number;
  /** Final net worth of the no-op baseline, the floor a skilled CEO beats. */
  offNetWorth: number;
  ablations: LeverAblation[];
}

/**
 * Phase 15 F2 — the lever-ablation study, the proof the control surface is *real*.
 * Run the rules CEO with each lever disabled in turn and measure how much net worth
 * it was worth. A lever with a near-zero impact is a **dead control** — it looks
 * like a strategic choice but changes nothing — and this is how we catch one,
 * rather than assuming every lever matters. Which levers bite depends on the
 * scenario: the standard solo bench (no labour churn, a top-paying storefront that
 * never loses staff) exercises pricing and investment; `hire`/`setWage` only earn
 * their keep when the firm faces a labour market that can actually poach its crew
 * (pass `agenticResidentIds` to create that churn).
 */
export function ablationStudy(
  seed: number,
  levers: (keyof BusinessAction)[],
  overrides: Omit<Partial<CeoBenchConfig>, "seed" | "brain"> = {},
): AblationStudy {
  const fullNetWorth = runCeoBenchmark({ ...overrides, seed, brain: "rules" }).finalNetWorth;
  const offNetWorth = runCeoBenchmark({ ...overrides, seed, brain: "off" }).finalNetWorth;
  const ablations = levers.map((lever) => ({
    lever,
    impact:
      fullNetWorth -
      runCeoBenchmark({
        ...overrides,
        seed,
        brain: new AblatedProvider(new RuleBasedProvider(), lever),
      }).finalNetWorth,
  }));
  return { fullNetWorth, offNetWorth, ablations };
}

const signed = (n: number): string => `${n >= 0 ? "+" : "−"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** Render an ablation study as a small table. */
export function formatAblation(study: AblationStudy): string {
  return [
    "──────────────────────────────────────────",
    "  LEVER ABLATION · the worth of each control",
    "──────────────────────────────────────────",
    `  full rules CEO: $${Math.round(study.fullNetWorth).toLocaleString("en-US")}`,
    `  no-op baseline: $${Math.round(study.offNetWorth).toLocaleString("en-US")}`,
    "  ────────────────────────",
    ...study.ablations.map((a) => `  drop ${String(a.lever).padEnd(9)} → ${signed(a.impact)}`),
  ].join("\n");
}
