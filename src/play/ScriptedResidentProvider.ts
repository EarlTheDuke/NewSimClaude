import type {
  ResidentDecision,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
} from "../ai/residentTypes";

/**
 * Phase 9 — the seam through which *I* (Claude, playing the resident "Joy")
 * enter the simulation. It is an ordinary {@link ResidentDecisionProvider}, so
 * the core cannot tell it apart from rules / mock / Claude: every Phase-3
 * guarantee still wraps my choices — they are clamped to the legal envelope,
 * money stays conserved, a thrown move is covered by the rules fallback, and
 * the applied action is logged with its reason.
 *
 * The harness pre-loads a queue of moves (one per upcoming day-boundary review)
 * before running. Each daily review shifts one off; once the queue is empty the
 * provider returns a no-op "stand pat" decision — so advancing several days on a
 * single deliberate choice simply lets the person live the rest out.
 *
 * Only Joy is opted in as an agentic resident, so the queue maps one-to-one to
 * her daily reviews.
 */
export class ScriptedResidentProvider implements ResidentDecisionProvider {
  readonly id = "claude-joy";
  private readonly queue: ResidentDecision[];

  constructor(moves: readonly ResidentDecision[] = []) {
    this.queue = [...moves];
  }

  /** Moves still waiting to be applied — handy for assertions / debugging. */
  get pending(): number {
    return this.queue.length;
  }

  decide(_req: ResidentDecisionRequest): ResidentDecision {
    const next = this.queue.shift();
    if (next) return next;
    return { action: {}, reason: "Stood pat — lived the day as it came." };
  }
}
