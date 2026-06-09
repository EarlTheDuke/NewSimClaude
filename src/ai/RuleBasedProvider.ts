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
  BRAND_SURPLUS_FRACTION,
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

    // Brand (Phase 17d): grow demand when capacity-bound + profitable. GOODS-ONLY —
    // only the goods storefront has a demand hook (meals are inelastic), so a
    // producer/diner brand spend can never pay back; the rules CEO must not burn cash
    // on a dead lever. Gated on a live brand elasticity (o.brandElasticity > 0) so the
    // frozen CEO bench — where marketing has no payoff — never spends on it (which keeps
    // the sacred rules>off ordering). Brand takes its slice of the surplus BEFORE invest
    // so the two levers split the cash-minus-reserve pool instead of fighting over it.
    if (
      o.kind === "goods" &&
      o.referencePrice !== undefined &&
      o.brandElasticity !== undefined &&
      o.brandElasticity > 0 &&
      o.capacityUtilization !== undefined &&
      o.capacityUtilization > INVEST_UTILIZATION_THRESHOLD &&
      o.cash > BUSINESS_RESERVE + INVEST_MIN_SURPLUS
    ) {
      action.brand = (o.cash - BUSINESS_RESERVE) * BRAND_SURPLUS_FRACTION;
      notes.push("capacity-bound + profitable, spending on brand to grow demand");
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
    // The wage ceiling this firm may post. Defaults to the old fixed 2× cap; in a freed-wage
    // city (Initiative #1 S1) o.maxWage is higher, opening real headroom to bid for scarce labour.
    const wageCap = o.maxWage ?? base * MAX_WAGE_MULT;
    const freeMarket = wageCap > base * MAX_WAGE_MULT; // the cap has been lifted past the old ceiling
    if (freeMarket) {
      // Free labour market (S1) with the S3 anti-spiral guard. A firm bids the wage up for scarce
      // labour ONLY while it can afford it (cash above its working-capital reserve) — harder when
      // the jobless pool is empty. The moment a firm runs cash-thin it eases wages back toward
      // base **even if still understaffed**. Without that, an understaffed-and-broke firm ratchets
      // its wage toward the high cap every day and can never recover — the runaway wage spiral that
      // drained firms and collapsed circulation once the dividend pump was weaned (verified via the
      // S3 weaning experiment + an adversarial review of RuleBasedProvider). Affordability, not a
      // fixed ceiling, sets the wage.
      const canAfford = o.cash > BUSINESS_RESERVE;
      // Initiative B slice 2 — the strongest same-kind rival wage. Undefined when labour
      // competition is off or there's no rival, in which case every branch below collapses to
      // the pre-B2 logic (byte-identical).
      const rival = o.rivalWage;
      if (o.understaffed && o.wagePerTick < wageCap && canAfford) {
        const scarce = o.unemployedCount === 0;
        let bid = o.wagePerTick * (scarce ? 1.25 : 1.1);
        // Poach (B2): to pull staff from a higher-paying rival, bid up to AT LEAST its wage.
        const poaching = rival !== undefined && rival > bid;
        if (poaching) bid = rival!;
        action.setWage = Math.min(wageCap, bid);
        notes.push(
          poaching
            ? "short-handed — bidding to a rival's wage to poach staff"
            : scarce
              ? "labour scarce — bidding the wage up to compete"
              : "short-handed, raising the wage",
        );
      } else if (rival !== undefined && rival > o.wagePerTick && o.wagePerTick < wageCap && canAfford) {
        // Match-to-retain (B2): a rival pays more and could poach my crew — match it, but DON'T
        // exceed (the truce), so wages converge at a shared competitive level instead of my staff
        // walking or both firms ratcheting to the cap.
        action.setWage = Math.min(wageCap, rival);
        notes.push("a rival pays more — matching its wage to keep my crew");
      } else if (o.cash < BUSINESS_RESERVE && o.wagePerTick > base) {
        action.setWage = Math.max(base, o.wagePerTick * 0.95);
        notes.push("cash-thin — easing wages back toward base to stay solvent");
      }
    } else if (o.understaffed && o.wagePerTick < wageCap) {
      // Original capped market (default ⇒ byte-identical): short-handed firms bid +10% toward the
      // fixed 2× cap; a fully-staffed cash-thin firm eases back. Unchanged from Phase 15 A.
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
