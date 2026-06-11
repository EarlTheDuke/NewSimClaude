import type { BusinessDecision, DecisionProvider, DecisionRequest } from "./types";

/**
 * The provider router (benchmark Pilot B) — gives each firm its OWN mind. The agentic seam
 * takes one {@link DecisionProvider} for every managed business; this one fans requests out by
 * `observation.businessId`, so a duel can pit model A's diner against model B's diner, and the
 * 6-CEO melee can seat six different models in six firms.
 *
 * Information hygiene: each inner provider only ever receives its own firm's requests — a
 * routed mind cannot see (or remember, via its ledger) another firm's books. An unmapped firm
 * throws, which the BusinessAgentSystem catches and covers with the rules fallback (logged
 * `fallback: true`) — so a mis-wired seat degrades loudly in the logs, never silently.
 */
export class PerBusinessProvider implements DecisionProvider {
  readonly id: string;

  constructor(
    private readonly routes: Record<string, DecisionProvider>,
    /** Optional catch-all for unmapped firms; omit to let unmapped requests reject → rules. */
    private readonly fallback?: DecisionProvider,
  ) {
    const inner = Object.entries(routes)
      .map(([biz, p]) => `${biz}→${p.id}`)
      .join(", ");
    this.id = `router(${inner})`;
  }

  decide(req: DecisionRequest): BusinessDecision | Promise<BusinessDecision> {
    const provider = this.routes[req.observation.businessId] ?? this.fallback;
    if (!provider) {
      throw new Error(`PerBusinessProvider: no provider routed for "${req.observation.businessId}"`);
    }
    return provider.decide(req);
  }
}
