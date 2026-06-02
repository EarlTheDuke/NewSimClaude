import { Simulation } from "./core/Simulation";
import { World } from "./world/World";
import { buildCity, type CityOptions } from "./world/cityGen";
import { WorldSystem } from "./systems/WorldSystem";
import { BrainSystem } from "./systems/BrainSystem";
import { MovementSystem } from "./systems/MovementSystem";
import { EconomySystem } from "./systems/EconomySystem";
import { NeedsSystem } from "./systems/NeedsSystem";

export interface CitySimOptions extends CityOptions {
  seed?: number;
}

/**
 * Assembles the full Phase 1 city: a Simulation with the world and the four
 * behavioural systems wired in the correct update order.
 *
 * Order matters — brain decides, movement walks, economy settles money on the
 * settled activity, needs decay last so they read the final activity.
 */
export function createCity(options: CitySimOptions = {}): { sim: Simulation; world: World } {
  const sim = new Simulation({ seed: options.seed ?? 1 });
  const world = buildCity(sim.rng, options);

  sim.addSystem(new WorldSystem(world));
  sim.addSystem(new BrainSystem(world));
  sim.addSystem(new MovementSystem(world));
  sim.addSystem(new EconomySystem(world));
  sim.addSystem(new NeedsSystem(world));

  return { sim, world };
}
