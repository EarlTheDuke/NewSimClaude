import type { TimeSystem, TimeSnapshot, TimeOfDay } from "./TimeSystem";
import type { SeededRNG } from "../utils/rng";
import type { EventBus } from "../utils/EventBus";

/** Bumped whenever the snapshot shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/** Domain events systems may emit and rendering/UI may observe. */
export interface SimulationEvents {
  tick: { totalTicks: number };
  hourElapsed: TimeOfDay;
  dayRolled: { day: number };
}

/** Read-only services handed to every system on each update. */
export interface SystemContext {
  readonly totalTicks: number;
  readonly time: TimeSystem;
  readonly rng: SeededRNG;
  readonly bus: EventBus<SimulationEvents>;
}

/**
 * A focused unit of simulation logic. Systems mutate the world during update()
 * and contribute their state to the snapshot via serialize()/restore().
 */
export interface System {
  readonly id: string;
  update(ctx: SystemContext): void;
  serialize?(): unknown;
  restore?(state: unknown): void;
}

/** The single, complete, serializable description of the world. */
export interface SimulationSnapshot {
  version: number;
  seed: number;
  rngState: number;
  time: TimeSnapshot;
  systems: Record<string, unknown>;
}
