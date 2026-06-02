import type { System, SystemContext } from "../core/types";
import type { World } from "../world/World";
import type { Activity, Resident } from "../world/types";
import {
  SLEEP_START_HOUR,
  WAKE_HOUR,
  WORK_START_HOUR,
  WORK_END_HOUR,
  HUNGRY_THRESHOLD,
  TIRED_THRESHOLD,
  LONELY_THRESHOLD,
} from "./constants";

export interface Decision {
  destinationId: string;
  /** What the resident intends to do once it arrives. */
  activity: Activity;
}

/**
 * The decision layer — and the seam where Claude plugs in later (Phase 2).
 *
 * For the MVP every mind is rule-based: a daily schedule that needs can
 * hijack. The simulation only ever sees a {@link Decision}; it neither knows
 * nor cares whether a rule set or a model produced it. Swapping in a
 * DecisionProvider here changes nothing downstream.
 */
export class BrainSystem implements System {
  readonly id = "brain";
  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    const { hour } = ctx.time.time();
    for (const resident of this.world.residents) {
      const decision = this.decide(resident, hour);
      resident.destinationId = decision.destinationId;
      resident.activity = decision.activity; // MovementSystem refines to "commuting" if not yet there
    }
  }

  /** Rule-based mind. Replace with a DecisionProvider call in Phase 2. */
  private decide(resident: Resident, hour: number): Decision {
    const { hunger, energy, social } = resident.needs;
    const isNight = hour >= SLEEP_START_HOUR || hour < WAKE_HOUR;
    const isWorkTime = hour >= WORK_START_HOUR && hour < WORK_END_HOUR;

    // 1. Sleep — at night, or when running on empty.
    if (isNight || energy < TIRED_THRESHOLD) {
      return { destinationId: resident.homeId, activity: "sleeping" };
    }
    // 2. Eat — hunger overrides work and leisure.
    if (hunger < HUNGRY_THRESHOLD) {
      return { destinationId: "loc_diner", activity: "eating" };
    }
    // 3. Work — the weekday grind.
    if (isWorkTime) {
      const job = this.world.getBusiness(resident.jobId);
      if (job) return { destinationId: job.locationId, activity: "working" };
    }
    // 4. Free time — socialize if lonely, otherwise relax at home.
    if (social < LONELY_THRESHOLD) {
      return { destinationId: this.socialVenue(resident), activity: "socializing" };
    }
    return { destinationId: resident.homeId, activity: "idle" };
  }

  /** Spread leisure spend across the diner and the goods store. */
  private socialVenue(resident: Resident): string {
    const idx = Number(resident.id.split("_")[1] ?? 0);
    return idx % 2 === 0 ? "loc_diner" : "loc_goods";
  }
}
