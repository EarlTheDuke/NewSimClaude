/**
 * Phase 8 — LLM cost accounting + budgets.
 *
 * The decision logs already carry per-call `usage` (tokens / cost / latency)
 * for any networked provider. This module turns those logs into a single
 * spend/latency summary for the dashboard, and offers a {@link BudgetedProvider}
 * decorator that caps spend by falling back to the deterministic rules provider
 * once a budget is exhausted.
 *
 * Both the business and resident seams report usage with the same four fields,
 * so everything here is structural and works across both.
 */

/** The common shape of a provider-usage record (business + resident alike). */
export interface CostUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

/** The shared, costable shape of a decision-log row from either seam. */
export interface CostableEntry {
  fallback: boolean;
  usage?: CostUsage;
}

/** Aggregate spend + latency over one or more decision logs. */
export interface CostSummary {
  /** Total applied decisions across all logs (paid calls + free fallbacks). */
  calls: number;
  /** Decisions the rule-based fallback covered (free — provider failed or over budget). */
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  /** Mean latency over the calls that reported one; 0 when none did. */
  avgLatencyMs: number;
}

/**
 * Fold any number of decision logs into one {@link CostSummary}. Entries without
 * a `usage` (the sync rules/mock providers) contribute a call but no spend, so a
 * default rules-only run summarizes to all-zero cost — exactly right.
 */
export function summarizeCost(...logs: readonly (readonly CostableEntry[])[]): CostSummary {
  let calls = 0;
  let fallbacks = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCostUsd = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const log of logs) {
    for (const e of log) {
      calls++;
      if (e.fallback) fallbacks++;
      const u = e.usage;
      if (!u) continue;
      inputTokens += u.inputTokens ?? 0;
      outputTokens += u.outputTokens ?? 0;
      totalCostUsd += u.costUsd ?? 0;
      if (typeof u.latencyMs === "number") {
        latencySum += u.latencyMs;
        latencyCount++;
      }
    }
  }

  return {
    calls,
    fallbacks,
    inputTokens,
    outputTokens,
    totalCostUsd,
    avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
  };
}

/** Thrown by {@link BudgetedProvider} once spend reaches the cap. */
export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`LLM budget exhausted: $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

/** A decision (from either seam) carrying optional usage — all we need to meter. */
interface CostedDecision {
  usage?: CostUsage;
}

/** The structural provider seam shared by both business and resident providers. */
interface MeterableProvider<Req, Dec extends CostedDecision> {
  readonly id: string;
  decide(req: Req): Dec | Promise<Dec>;
}

/**
 * Wrap any provider with a spend cap. Each returned decision's `costUsd` is
 * added to a running tally; once the tally reaches the budget the wrapper
 * **throws** on the next call, which the agent systems already treat as a
 * provider failure and cover with the deterministic rules provider. So a blown
 * budget degrades gracefully to free rules-based behaviour for the rest of the
 * run rather than overspending or stalling.
 *
 * The cap is *soft*: async calls already in flight when the budget trips still
 * count their cost on resolution, so spend can overshoot by at most the calls
 * outstanding at the moment it trips. The wrapper preserves the inner provider's
 * `id`, so the decision trace still attributes paid calls to the real model.
 */
export class BudgetedProvider<Req, Dec extends CostedDecision>
  implements MeterableProvider<Req, Dec>
{
  readonly id: string;
  private spent = 0;

  constructor(
    private readonly inner: MeterableProvider<Req, Dec>,
    private readonly budgetUsd: number,
  ) {
    this.id = inner.id;
  }

  /** Cumulative spend metered so far, in USD. */
  spentUsd(): number {
    return this.spent;
  }

  /** True once spend has reached the cap (further calls will fall back to rules). */
  get exhausted(): boolean {
    return this.spent >= this.budgetUsd;
  }

  decide(req: Req): Dec | Promise<Dec> {
    if (this.exhausted) throw new BudgetExceededError(this.spent, this.budgetUsd);
    const result = this.inner.decide(req);
    if (isPromise(result)) {
      return result.then((d) => {
        this.spent += d.usage?.costUsd ?? 0;
        return d;
      });
    }
    this.spent += result.usage?.costUsd ?? 0;
    return result;
  }
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown }).then === "function";
}
