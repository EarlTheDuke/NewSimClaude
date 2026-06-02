import type {
  ResidentAction,
  ResidentDecision,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
} from "./residentTypes";

/**
 * The deterministic control mind for residents, and the safety net.
 *
 * Legible heuristics over the life levers — no randomness, no I/O — so the same
 * observation always yields the same choice. It is both the A/B baseline a
 * Claude resident is measured against and the invisible fallback when a model
 * call fails.
 *
 * Priorities, in order (the clamp keeps only one structural move regardless):
 *  1. Jobless? Take the best-paying hiring job available.
 *  2. Underpaid relative to a clearly better job, off cooldown? Switch.
 *  3. Paying more rent than a cheaper home, with savings to spare? Re-home.
 *  4. Comfortable and car-less? Buy a vehicle to commute faster.
 *  5. Employed below the wage cap? Ask for a raise.
 */
export class RuleBasedResidentProvider implements ResidentDecisionProvider {
  readonly id = "rules";

  decide(req: ResidentDecisionRequest): ResidentDecision {
    const o = req.observation;
    const action: ResidentAction = {};
    const notes: string[] = [];

    const hiring = o.jobOptions.filter((j) => j.hiring);
    const bestJob = hiring.reduce<typeof hiring[number] | undefined>(
      (best, j) => (!best || j.wagePerTick > best.wagePerTick ? j : best),
      undefined,
    );

    if (!o.employed && bestJob) {
      action.switchJobTo = bestJob.businessId;
      notes.push(`jobless, taking work at ${bestJob.name}`);
    } else if (
      bestJob &&
      bestJob.wagePerTick > o.wagePerTick * 1.15 &&
      o.daysSinceJobChange >= req.limits.jobChangeCooldownDays
    ) {
      action.switchJobTo = bestJob.businessId;
      notes.push(`${bestJob.name} pays better, switching`);
    }

    const cheaper = o.homeOptions
      .filter((h) => h.rent < o.rent)
      .reduce<typeof o.homeOptions[number] | undefined>(
        (best, h) => (!best || h.rent < best.rent ? h : best),
        undefined,
      );
    if (cheaper && o.money > 200) {
      action.reHomeTo = cheaper.homeId;
      notes.push(`cheaper home (${cheaper.name}), moving to save rent`);
    }

    if (
      !o.hasVehicle &&
      o.money >= req.limits.vehicleCost * 1.5 &&
      o.employed
    ) {
      action.buyVehicle = true;
      notes.push("comfortable savings, buying a vehicle");
    }

    if (o.employed && o.jobBaseWage > 0 && o.wagePerTick < o.jobBaseWage * req.limits.maxWageMultiple) {
      action.negotiateRaise = true;
      notes.push("asking for a raise");
    }

    return {
      action,
      reason: notes.length > 0 ? notes.join("; ") : "settled, no change",
    };
  }
}
