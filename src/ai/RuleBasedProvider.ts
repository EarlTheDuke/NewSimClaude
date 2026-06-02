import type {
  BusinessAction,
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
} from "./types";

/**
 * The deterministic control mind, and the safety net.
 *
 * Simple, legible heuristics over the three levers — no randomness, no I/O, so
 * the same observation always yields the same decision. It plays two roles:
 * the baseline an LLM is measured against in an A/B run, and the invisible
 * fallback when a model call times out or errors.
 */
export class RuleBasedProvider implements DecisionProvider {
  readonly id = "rules";

  decide(req: DecisionRequest): BusinessDecision {
    const o = req.observation;

    // The landlord has no price, stock, or storefront staff to tune.
    if (o.kind === "landlord") {
      return { action: {}, reason: "Landlord holds steady; rent is fixed." };
    }

    const action: BusinessAction = {};
    const notes: string[] = [];

    // Price: chase profit. A loss nudges price up; a glut of cash and stock
    // eases it down to move inventory.
    if (o.dayProfit < 0) {
      action.setPrice = o.price * 1.1;
      notes.push("ran a loss, raising price");
    } else if (o.inventory > 150 && o.dayProfit > 0) {
      action.setPrice = o.price * 0.95;
      notes.push("overstocked, easing price to sell through");
    }

    // Produce: restock when the shelves run low.
    if (o.inventory < 60) {
      action.produce = 80;
      notes.push("low inventory, producing 80");
    }

    // Staff: hire when profitable with people to hire; trim when cash is thin.
    if (o.dayProfit > 50 && o.unemployedCount > 0 && o.employeeCount < 6) {
      action.hire = 1;
      notes.push("profitable, hiring 1");
    } else if (o.cash < 200 && o.employeeCount > 1) {
      action.hire = -1;
      notes.push("cash low, laying off 1");
    }

    return {
      action,
      reason: notes.length > 0 ? notes.join("; ") : "steady state, no change",
    };
  }
}
