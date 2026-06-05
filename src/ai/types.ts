/**
 * Phase 2 — the model-agnostic decision seam.
 *
 * Every business "mind" decides through one {@link DecisionProvider}. The
 * simulation hands a provider a {@link DecisionRequest} (what the business sees
 * plus the hard limits it must stay within) and gets back a
 * {@link BusinessDecision} (a clamped-then-applied action plus a reason). The
 * core never knows whether a rule set, a mock, or Claude produced it — swapping
 * providers changes behaviour, not wiring.
 */

import type { BusinessKind } from "../world/types";

/**
 * What a business mind gets to see at review time. A flat, serializable
 * snapshot — never a live reference into the World — so a provider (including a
 * remote model) can reason over it without reaching into simulation internals.
 */
export interface BusinessObservation {
  businessId: string;
  name: string;
  kind: BusinessKind;
  /** Sim day index this review is for (the day that just ended). */
  day: number;
  cash: number;
  inventory: number;
  price: number;
  /**
   * The "going market rate" for this storefront — the anchor that price-elastic
   * resident demand is reckoned against. Present only for retail kinds (diner,
   * goods); undefined for producers and the landlord. A mind can use it to tell
   * "I'm overpriced and shedding customers" from "I have headroom to mark up."
   */
  referencePrice?: number;
  /**
   * The average asking price of the *other* active storefronts of this kind —
   * what the competition across town charges (Phase 11b). Present only when a
   * rival actually exists; undefined for a sole storefront, so the single-store
   * path is unchanged. A mind uses it to tell "I'm priced above the competition
   * and bleeding customers to them" from "I'm the only game in town."
   */
  rivalPrice?: number;
  /**
   * The marginal input cost of one sellable unit — the wholesale price this
   * storefront pays for the one resource it turns 1:1 into inventory (a diner's
   * `food`, a goods store's `wares`). The floor below which a sale loses money on
   * every unit. Present only for kinds that buy an input; undefined otherwise.
   */
  unitCost?: number;
  employeeCount: number;
  wagePerTick: number;
  /** Revenue booked during the day that just ended. */
  dayRevenue: number;
  /** Wages paid during the day that just ended. */
  dayWages: number;
  /** Rent paid (negative cash) during the day that just ended. */
  dayRent: number;
  /** Net cash change over the day that just ended (revenue - wages - rent). */
  dayProfit: number;
  /** Residents currently available to hire (jobId === ""). */
  unemployedCount: number;
  /**
   * Current capital stock — equipment owned by the business. Output scales with
   * capital via 12b's `capitalFactor`; a mind uses this to tell "I'm
   * capital-light, investing will lift my output" from "I have plenty of
   * equipment, more won't help." Present only for kinds with capital
   * (producers); undefined otherwise.
   */
  capital?: number;
  /**
   * How fully this producer ran on the day that just ended, 0..1 — production
   * actually delivered divided by `effectiveCapacity`. Near 1.0 means the
   * business is shipping everything it can make and capital investment would
   * pay off; near 0 means it has slack and investment is dead weight. Present
   * only for producer kinds; undefined otherwise.
   */
  capacityUtilization?: number;
}

/**
 * The three levers a business mind may pull. Every field is optional; an
 * omitted field means "leave it alone". Values are *proposals* — they are
 * clamped to {@link DecisionLimits} before they ever touch the world.
 */
export interface BusinessAction {
  /** Proposed new unit price. */
  setPrice?: number;
  /** Net headcount change: +N hires from the jobless pool, -N lays off. */
  hire?: number;
  /** Units of inventory to produce (added to stock on hand). */
  produce?: number;
  /**
   * Cash to spend buying capital goods (equipment) wholesale from the factory
   * this review. Raises future output via 12b's `capitalFactor`. Routed through
   * {@link DecisionLimits.maxInvestPerReview} *and* a business-reserve floor —
   * over-investing into insolvency is on the provider to avoid.
   */
  invest?: number;
}

/**
 * Hard bounds enforced on every action, no matter who proposed it. This is the
 * safety rail: a model (or a buggy rule) cannot detonate the economy because
 * the clamp sits between the decision and the world.
 */
export interface DecisionLimits {
  minPrice: number;
  maxPrice: number;
  /** Max single-review price move, as a fraction of the current price. */
  maxPriceChangeFraction: number;
  /** Max net hires or layoffs per review (absolute). */
  maxHirePerReview: number;
  /** Max units produced per review. */
  maxProducePerReview: number;
  /** Max cash a business may spend on capital goods in one review. */
  maxInvestPerReview: number;
}

/** A provider's verdict: what to do, and why. */
export interface BusinessDecision {
  action: BusinessAction;
  /** Plain-language rationale. Required — explainability is a Phase 2 goal. */
  reason: string;
  /** Filled in by networked providers (Claude); absent for sync providers. */
  usage?: ProviderUsage;
}

/** Everything a provider needs to decide for one business. */
export interface DecisionRequest {
  observation: BusinessObservation;
  limits: DecisionLimits;
}

/** Token / latency / cost accounting for a single provider call. */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Estimated cost of the call, in USD. */
  costUsd?: number;
  /** Wall-clock latency of the call, in milliseconds. */
  latencyMs?: number;
}

/**
 * The seam. Sync providers (rules, mock) are deterministic and applied the same
 * tick; an async provider (Claude) resolves on a later tick — the LLM is the
 * only sanctioned source of non-determinism, and it lives entirely behind here.
 */
export interface DecisionProvider {
  readonly id: string;
  decide(req: DecisionRequest): BusinessDecision | Promise<BusinessDecision>;
}

/** One row of the decision trace — the action that actually hit the world. */
export interface DecisionLogEntry {
  day: number;
  businessId: string;
  providerId: string;
  /** True if the primary provider failed and the rule-based fallback covered. */
  fallback: boolean;
  /** The action *after* clamping — exactly what was applied. */
  action: BusinessAction;
  reason: string;
  usage?: ProviderUsage;
}
