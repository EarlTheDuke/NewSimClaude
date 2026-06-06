import type { BusinessAction, DecisionLimits } from "./types";

/**
 * Default safety rails for the three levers. Conservative on purpose: a single
 * review can only nudge the economy, never lurch it.
 */
export const DEFAULT_LIMITS: DecisionLimits = {
  minPrice: 1,
  maxPrice: 100,
  maxPriceChangeFraction: 0.25,
  maxHirePerReview: 2,
  maxInvestPerReview: 500,
  // Phase 15 A — coarse detonation guard on the posted wage; the real per-firm
  // cap [base, base*MAX_WAGE_MULT] is enforced in BusinessAgentSystem.apply().
  minWagePerTick: 0,
  maxWagePerTick: 1,
};

/**
 * Squeeze a proposed action into safe bounds before it touches the world. This
 * is the guarantee that a model — or a buggy rule — can never detonate the
 * economy: price moves are capped per review and absolutely bounded, hires are
 * integer-bounded, production is non-negative and capped.
 *
 * Non-finite or absent fields are dropped, so the result contains only the
 * levers that actually change something.
 */
export function clampAction(
  action: BusinessAction,
  currentPrice: number,
  limits: DecisionLimits,
): BusinessAction {
  const out: BusinessAction = {};

  if (action.setPrice !== undefined && Number.isFinite(action.setPrice)) {
    const maxStep = Math.max(1, currentPrice * limits.maxPriceChangeFraction);
    const stepped = clamp(action.setPrice, currentPrice - maxStep, currentPrice + maxStep);
    out.setPrice = clamp(stepped, limits.minPrice, limits.maxPrice);
  }

  if (action.hire !== undefined && Number.isFinite(action.hire)) {
    out.hire = Math.trunc(clamp(action.hire, -limits.maxHirePerReview, limits.maxHirePerReview));
  }

  if (action.invest !== undefined && Number.isFinite(action.invest)) {
    // Phase 12c — pure per-review cap. The cash-vs-reserve floor is applied
    // later in BusinessAgentSystem.apply(), where current cash is known.
    out.invest = clamp(action.invest, 0, limits.maxInvestPerReview);
  }

  if (action.setWage !== undefined && Number.isFinite(action.setWage)) {
    // Phase 15 A — coarse absolute safety band. The real, per-business cap
    // [base, base*MAX_WAGE_MULT] is applied later in BusinessAgentSystem.apply(),
    // where the firm's base wage is known.
    out.setWage = clamp(action.setWage, limits.minWagePerTick, limits.maxWagePerTick);
  }

  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
