import type { System } from "../core/types";
import type { World } from "../world/World";
import type { WorldSnapshot } from "../world/types";

/**
 * Adapter that puts the shared World into the simulation snapshot. The
 * behavioural systems are stateless logic over the World, so this is the only
 * Phase 1 system that serializes anything.
 */
export class WorldSystem implements System {
  readonly id = "world";
  constructor(private readonly world: World) {}

  update(): void {
    // The World is mutated by the behavioural systems; nothing to do per tick.
  }

  serialize(): WorldSnapshot {
    return this.world.serialize();
  }

  restore(state: unknown): void {
    this.world.restore(state as WorldSnapshot);
  }
}
