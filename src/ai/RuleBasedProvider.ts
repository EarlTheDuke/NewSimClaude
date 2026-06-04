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

    // Price: steer toward the going market rate, not blindly upward. The rate is
    // whatever the competition charges if there's a rivaling storefront of this
    // kind, else the static reference price (the pre-11b, single-store case — so
    // with no rival this block is byte-identical to before). A losing day *above*
    // the rate means we've priced past what shoppers will pay and demand has fled
    // — ease back toward the rate to win them back. *Below* the rate there's
    // headroom, so a loss nudges price up, but a rival caps the raise at parity:
    // matching the competition lets geography split the customers (a stable truce),
    // whereas pricing past them just hands them the volume. A glut of stock and
    // cash always discounts to move inventory. (Producers and the landlord carry
    // neither a reference nor a rival, so they keep the plain raise-on-loss rule.)
    const rate = o.rivalPrice ?? o.referencePrice;
    if (o.dayProfit < 0) {
      if (rate !== undefined && o.price > rate) {
        action.setPrice = Math.max(rate, o.price * 0.95);
        notes.push(
          o.rivalPrice !== undefined
            ? "lost money above the rival's price, easing toward it"
            : "lost money above the market rate, easing price toward it",
        );
      } else {
        const up = o.price * 1.1;
        action.setPrice = o.rivalPrice !== undefined ? Math.min(up, o.rivalPrice) : up;
        notes.push("ran a loss with room to spare, nudging price up");
      }
    } else if (o.inventory > 150 && o.dayProfit > 0) {
      action.setPrice = o.price * 0.95;
      notes.push("overstocked, easing price to sell through");
    }

    // Price-war floor (Phase 11b): with a competitor in town it can be tempting to
    // keep undercutting, but a sale below our own input cost loses money on every
    // unit. Once a rival exists, never let the proposed price fall below unit cost
    // — that's the discipline that stops a price war from turning self-destructive.
    // Gated on a rival being present so the lone-storefront path stays unchanged.
    if (action.setPrice !== undefined && o.rivalPrice !== undefined && o.unitCost !== undefined) {
      action.setPrice = Math.max(action.setPrice, o.unitCost);
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
