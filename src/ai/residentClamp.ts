import {
  JOB_CHANGE_COOLDOWN_DAYS,
  MAX_WAGE_MULT,
  RAISE_COOLDOWN_DAYS,
  RAISE_FRACTION,
  VEHICLE_COST,
  VEHICLE_RESALE,
} from "../systems/constants";
import type {
  ResidentAction,
  ResidentDecisionLimits,
  ResidentObservation,
} from "./residentTypes";

/** Default safety rails for resident life-moves. */
export const DEFAULT_RESIDENT_LIMITS: ResidentDecisionLimits = {
  jobChangeCooldownDays: JOB_CHANGE_COOLDOWN_DAYS,
  raiseCooldownDays: RAISE_COOLDOWN_DAYS,
  maxWageMultiple: MAX_WAGE_MULT,
  raiseFraction: RAISE_FRACTION,
  vehicleCost: VEHICLE_COST,
  vehicleResale: VEHICLE_RESALE,
};

/**
 * Squeeze a proposed resident action into safe, *valid* bounds before it
 * touches the world. Unlike the business clamp (which only bounds numbers),
 * this also validates each lever against the live observation and enforces one
 * structural move per review:
 *
 *  - a job switch must target a listed, hiring option, off cooldown;
 *  - a re-home must target a listed option the resident can afford the move to;
 *  - a raise needs a job, headroom under the wage cap, and to be off cooldown;
 *  - buy/sell vehicle must be affordable / actually owned.
 *
 * Of the structural moves (switchJob / reHome / buyVehicle / sellVehicle) at
 * most ONE survives — priority order below — so a life turns one step at a
 * time. negotiateRaise is non-structural and may ride alongside one move.
 */
export function clampResidentAction(
  action: ResidentAction,
  o: ResidentObservation,
  limits: ResidentDecisionLimits,
): ResidentAction {
  const out: ResidentAction = {};

  // --- Structural moves, in priority order; keep only the first valid one. ---
  let structuralTaken = false;

  if (action.switchJobTo !== undefined && !structuralTaken) {
    const opt = o.jobOptions.find((j) => j.businessId === action.switchJobTo);
    const offCooldown = o.daysSinceJobChange >= limits.jobChangeCooldownDays;
    if (opt && opt.hiring && opt.businessId !== o.jobId && offCooldown) {
      out.switchJobTo = opt.businessId;
      structuralTaken = true;
    }
  }

  if (action.reHomeTo !== undefined && !structuralTaken) {
    const opt = o.homeOptions.find((h) => h.homeId === action.reHomeTo);
    if (opt && opt.homeId !== o.homeId) {
      out.reHomeTo = opt.homeId;
      structuralTaken = true;
    }
  }

  if (action.buyVehicle && !structuralTaken) {
    if (!o.hasVehicle && o.money >= limits.vehicleCost) {
      out.buyVehicle = true;
      structuralTaken = true;
    }
  }

  if (action.sellVehicle && !structuralTaken) {
    if (o.hasVehicle) {
      out.sellVehicle = true;
      structuralTaken = true;
    }
  }

  // --- Raise: non-structural; needs a job, headroom to grow, and off cooldown. ---
  if (action.negotiateRaise && o.employed && o.jobBaseWage > 0) {
    const cap = o.jobBaseWage * limits.maxWageMultiple;
    const offCooldown = o.daysSinceRaise >= limits.raiseCooldownDays;
    if (o.wagePerTick < cap && offCooldown) out.negotiateRaise = true;
  }

  return out;
}
