import { TimeSystem } from "./TimeSystem";
import { SeededRNG } from "../utils/rng";
import { EventBus } from "../utils/EventBus";
import {
  SNAPSHOT_VERSION,
  type System,
  type SystemContext,
  type SimulationEvents,
  type SimulationSnapshot,
} from "./types";

export const DEFAULT_SEED = 1;

export interface SimulationOptions {
  seed?: number;
}

/**
 * The orchestrator. Owns the world's shared services (time, RNG, event bus),
 * holds the ordered list of systems, and drives the tick loop. It is fully
 * headless and deterministic — rendering and UI live in outer layers and only
 * read from it.
 */
export class Simulation {
  readonly time = new TimeSystem();
  readonly bus = new EventBus<SimulationEvents>();
  readonly rng: SeededRNG;

  private seed: number;
  private readonly systems: System[] = [];
  private readonly systemsById = new Map<string, System>();

  constructor(options: SimulationOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new SeededRNG(this.seed);
  }

  /** Register a system. Update order follows registration order. */
  addSystem(system: System): this {
    if (this.systemsById.has(system.id)) {
      throw new Error(`Simulation.addSystem: duplicate system id "${system.id}"`);
    }
    this.systems.push(system);
    this.systemsById.set(system.id, system);
    return this;
  }

  getSystem<T extends System = System>(id: string): T | undefined {
    return this.systemsById.get(id) as T | undefined;
  }

  get seedValue(): number {
    return this.seed;
  }

  /** Simulate exactly one tick: advance time, update every system, emit events. */
  step(): void {
    const before = this.time.time();
    this.time.tick(1);

    const ctx: SystemContext = {
      totalTicks: this.time.ticks,
      time: this.time,
      rng: this.rng,
      bus: this.bus,
    };
    for (const system of this.systems) {
      system.update(ctx);
    }

    const after = this.time.time();
    this.bus.emit("tick", { totalTicks: after.totalTicks });
    if (after.hour !== before.hour) this.bus.emit("hourElapsed", after);
    if (after.day !== before.day) this.bus.emit("dayRolled", { day: after.day });
  }

  /** Simulate `ticks` ticks in sequence (headless). */
  run(ticks: number): void {
    if (ticks < 0) throw new Error("Simulation.run: ticks must be >= 0");
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * Live loop entry point: simulate the number of ticks owed for the given
   * real elapsed time at the current speed. Returns how many ticks were run.
   */
  advanceRealTime(deltaMs: number): number {
    const owed = this.time.ticksForRealTime(deltaMs);
    this.run(owed);
    return owed;
  }

  serialize(): SimulationSnapshot {
    const systems: Record<string, unknown> = {};
    for (const system of this.systems) {
      if (system.serialize) systems[system.id] = system.serialize();
    }
    return {
      version: SNAPSHOT_VERSION,
      seed: this.seed,
      rngState: this.rng.getState(),
      time: this.time.serialize(),
      systems,
    };
  }

  restore(snapshot: SimulationSnapshot): void {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Simulation.restore: version mismatch ${snapshot.version} != ${SNAPSHOT_VERSION}`,
      );
    }
    this.seed = snapshot.seed;
    this.rng.setState(snapshot.rngState);
    this.time.restore(snapshot.time);
    for (const system of this.systems) {
      const state = snapshot.systems[system.id];
      if (system.restore && state !== undefined) system.restore(state);
    }
  }
}
