import type {
  BusinessAction,
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
} from "./types";
import {
  BUSINESS_RESERVE,
  INVEST_MIN_SURPLUS,
  INVEST_UTILIZATION_THRESHOLD,
  MAX_WAGE_MULT,
} from "../systems/constants";

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

    // Staff: hire when profitable, short-handed, and there are people to hire;
    // trim when cash is thin. Capping hiring at the firm's desired headcount
    // (o.understaffed) stops a profitable storefront from vacuuming up the whole
    // jobless pool — workers freed by churn flow back to the under-staffed
    // producers instead of ballooning one store (Phase 15 A).
    if (o.dayProfit > 50 && o.unemployedCount > 0 && o.understaffed) {
      action.hire = 1;
      notes.push("profitable and short-handed, hiring 1");
    } else if (o.cash < 200 && o.employeeCount > 1) {
      action.hire = -1;
      notes.push("cash low, laying off 1");
    }

    // Invest (Phase 12c, fired by 13c): buy equipment when the firm is
    // *capacity-bound* — utilization near the ceiling, so more machines would
    // actually pay off — AND it turned a real profit today. After the 13c reorder
    // the agent reviews *before* the daily dividend, so cash above reserve is the
    // day's undistributed operating profit; a fat day clears INVEST_MIN_SURPLUS, a
    // thin one doesn't. Plain-English: "I'm slammed and I earned well today, so I'll
    // plough half of today's takings back into equipment and pay the rest out."
    // (The old `dayProfit > 50` gate is gone: under the pre-13c ordering the
    // dividend drained cash to reserve *before* review, so that signal was always
    // distribution-dominated and negative and the lever never fired.) The per-review
    // cap and the reserve floor downstream in BusinessAgentSystem.apply() still
    // bound the ask, so the provider can request freely and trust the clamps.
    if (
      o.capacityUtilization !== undefined &&
      o.capacityUtilization > INVEST_UTILIZATION_THRESHOLD &&
      o.cash > BUSINESS_RESERVE + INVEST_MIN_SURPLUS
    ) {
      // Reinvest half of today's surplus; the rest flows out as the dividend.
      action.invest = (o.cash - BUSINESS_RESERVE) / 2;
      notes.push("capacity-bound + profitable, reinvesting half the day's surplus");
    }

    // Wage: compete for labour (Phase 15 A). A short-handed firm bids its wage up
    // toward the cap to attract and keep staff — the lever that stops a low-paying
    // producer from bleeding its crew to the storefronts and starving the chain
    // (P10-3). Raising the *offer* is cheap (you only pay it once someone takes the
    // seat), so it isn't gated on today's profit; but a fully-staffed firm that has
    // run its cash below reserve eases back toward base, so wages settle where
    // vacancies clear instead of ratcheting to the ceiling and sticking there.
    const base = o.baseWagePerTick;
    const wageCap = base * MAX_WAGE_MULT;
    if (o.understaffed && o.wagePerTick < wageCap) {
      action.setWage = Math.min(wageCap, o.wagePerTick * 1.1);
      notes.push("short-handed, raising the wage to attract staff");
    } else if (!o.understaffed && o.cash < BUSINESS_RESERVE && o.wagePerTick > base) {
      action.setWage = Math.max(base, o.wagePerTick * 0.95);
      notes.push("fully staffed but cash-thin, easing wages back toward base");
    }

    return {
      action,
      reason: notes.length > 0 ? notes.join("; ") : "steady state, no change",
    };
  }
}
