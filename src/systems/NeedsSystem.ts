import type { System } from "../core/types";
import type { World } from "../world/World";
import type { Resident } from "../world/types";
import {
  HUNGER_DECAY,
  HUNGER_DECAY_ASLEEP,
  ENERGY_DECAY,
  ENERGY_RESTORE,
  SOCIAL_DECAY,
} from "./constants";

const clamp = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/**
 * Drains needs over time and applies the restorative effect of the resident's
 * current activity. Runs last each tick so it reads the settled activity
 * (after the brain decided and movement refined it).
 */
export class NeedsSystem implements System {
  readonly id = "needs";
  constructor(private readonly world: World) {}

  update(): void {
    for (const resident of this.world.residents) {
      this.tickNeeds(resident);
    }
  }

  private tickNeeds(resident: Resident): void {
    const n = resident.needs;
    const asleep = resident.activity === "sleeping";

    n.hunger = clamp(n.hunger - (asleep ? HUNGER_DECAY_ASLEEP : HUNGER_DECAY));
    n.social = clamp(n.social - SOCIAL_DECAY);
    n.energy = clamp(
      asleep ? n.energy + ENERGY_RESTORE : n.energy - ENERGY_DECAY,
    );
  }
}
