/**
 * Phase 3 — the resident decision seam.
 *
 * Mirrors the Phase 2 business seam ({@link ./types}) but for the strategic
 * life choices of a single person: where to work, where to live, whether to own
 * a vehicle, and what wage to ask for. The minute-to-minute tactical brain
 * (BrainSystem) is untouched; this seam fires once a day for the slow,
 * consequential moves.
 *
 * As before, the core never knows whether a rule set, a mock, or Claude
 * produced a decision — swapping providers changes behaviour, not wiring.
 */

/** A job a resident could switch to, as seen at review time. */
export interface JobOption {
  businessId: string;
  name: string;
  /** Base wage per tick the job pays a new hire. */
  wagePerTick: number;
  /** Whether the business currently has room to take this resident on. */
  hiring: boolean;
}

/** A home a resident could move to, as seen at review time. */
export interface HomeOption {
  homeId: string;
  name: string;
  /** Daily rent. */
  rent: number;
}

/**
 * What a resident's mind gets to see at review time. A flat, serializable
 * snapshot — never a live reference into the World.
 */
export interface ResidentObservation {
  residentId: string;
  name: string;
  /** Sim day index this review is for (the day that just ended). */
  day: number;
  money: number;
  needs: { hunger: number; energy: number; social: number };
  employed: boolean;
  jobId: string;
  jobName: string;
  /** Current wage per tick (0 when jobless). */
  wagePerTick: number;
  /** Base wage the current employer pays a fresh hire — the raise reference. */
  jobBaseWage: number;
  homeId: string;
  homeName: string;
  rent: number;
  hasVehicle: boolean;
  /** Days since this resident last switched jobs (large when never). */
  daysSinceJobChange: number;
  /** Days since this resident last won a raise (large when never). */
  daysSinceRaise: number;
  /** Jobs the resident could switch to (excludes the current job). */
  jobOptions: JobOption[];
  /** Homes the resident could move to (excludes the current home). */
  homeOptions: HomeOption[];
}

/**
 * The levers a resident's mind may pull in a daily review. Every field is
 * optional ("leave it alone"); values are *proposals*, clamped to
 * {@link ResidentDecisionLimits} before they touch the world. At most one
 * structural move (job/home/vehicle) is honoured per review by the agent — the
 * clamp drops the rest — so a life changes one deliberate step at a time.
 */
export interface ResidentAction {
  /** Business id to take a job at (from jobOptions). */
  switchJobTo?: string;
  /** Home id to move to (from homeOptions). */
  reHomeTo?: string;
  /** Ask the current employer for a raise. */
  negotiateRaise?: boolean;
  /** Buy a vehicle. */
  buyVehicle?: boolean;
  /** Sell the owned vehicle back. */
  sellVehicle?: boolean;
}

/** Hard bounds on resident moves, enforced no matter who proposed them. */
export interface ResidentDecisionLimits {
  /** Min days between job switches. */
  jobChangeCooldownDays: number;
  /** Min days between raise requests. */
  raiseCooldownDays: number;
  /** A wage may not exceed this multiple of the job's base wage. */
  maxWageMultiple: number;
  /** Fraction a granted raise lifts the wage by. */
  raiseFraction: number;
  /** Price to buy a vehicle. */
  vehicleCost: number;
  /** Refund when selling a vehicle. */
  vehicleResale: number;
}

/** A provider's verdict for one resident: what to do, and why. */
export interface ResidentDecision {
  action: ResidentAction;
  /** Plain-language rationale. Required — explainability is the point. */
  reason: string;
  /** Filled in by networked providers (Claude); absent for sync providers. */
  usage?: ResidentProviderUsage;
}

/** Everything a provider needs to decide for one resident. */
export interface ResidentDecisionRequest {
  observation: ResidentObservation;
  limits: ResidentDecisionLimits;
}

/** Token / latency / cost accounting for a single provider call. */
export interface ResidentProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

/**
 * The seam. Sync providers (rules, mock) are deterministic and applied the same
 * tick; an async provider (Claude) resolves on a later tick.
 */
export interface ResidentDecisionProvider {
  readonly id: string;
  decide(req: ResidentDecisionRequest): ResidentDecision | Promise<ResidentDecision>;
}

/** One row of the resident decision trace — the move that actually happened. */
export interface ResidentDecisionLogEntry {
  day: number;
  residentId: string;
  residentName: string;
  providerId: string;
  /** True if the primary provider failed and the rule-based fallback covered. */
  fallback: boolean;
  /** The action *after* clamping — exactly what was applied. */
  action: ResidentAction;
  reason: string;
  usage?: ResidentProviderUsage;
}
