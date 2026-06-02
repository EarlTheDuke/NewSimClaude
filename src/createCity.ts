import { Simulation } from "./core/Simulation";
import { World } from "./world/World";
import { buildCity, type CityOptions } from "./world/cityGen";
import { WorldSystem } from "./systems/WorldSystem";
import { BrainSystem } from "./systems/BrainSystem";
import { MovementSystem } from "./systems/MovementSystem";
import { EconomySystem } from "./systems/EconomySystem";
import { NeedsSystem } from "./systems/NeedsSystem";
import { BusinessAgentSystem } from "./systems/BusinessAgentSystem";
import { RuleBasedProvider } from "./ai/RuleBasedProvider";
import type { DecisionLimits, DecisionProvider } from "./ai/types";

/**
 * Which mind, if any, runs the businesses:
 *  - "off"     — no agentic layer; behaviour is exactly Phase 1 (the A/B control).
 *  - "rules"   — the deterministic RuleBasedProvider.
 *  - a provider — any DecisionProvider (e.g. ClaudeDecisionProvider, MockProvider).
 */
export type BrainOption = "off" | "rules" | DecisionProvider;

export interface CitySimOptions extends CityOptions {
  seed?: number;
  brain?: BrainOption;
  /** Businesses the brain manages. Defaults to the diner and the goods store. */
  agenticBusinessIds?: string[];
  /** Override the action safety limits (defaults to DEFAULT_LIMITS). */
  limits?: DecisionLimits;
}

const DEFAULT_AGENTIC = ["biz_diner", "biz_goods"];

/**
 * Assembles the city. With `brain: "off"` (the default) it is the Phase 1
 * simulation, untouched. Any other brain adds a {@link BusinessAgentSystem}
 * after the economy settles, so businesses can react to the day just ended.
 *
 * Update order: brain decides residents, movement walks, economy settles money,
 * the business agent reviews the day, needs decay last.
 */
export function createCity(options: CitySimOptions = {}): {
  sim: Simulation;
  world: World;
  agent?: BusinessAgentSystem;
} {
  const sim = new Simulation({ seed: options.seed ?? 1 });
  const world = buildCity(sim.rng, options);

  sim.addSystem(new WorldSystem(world));
  sim.addSystem(new BrainSystem(world));
  sim.addSystem(new MovementSystem(world));
  sim.addSystem(new EconomySystem(world));

  let agent: BusinessAgentSystem | undefined;
  const brain = options.brain ?? "off";
  if (brain !== "off") {
    const provider: DecisionProvider = brain === "rules" ? new RuleBasedProvider() : brain;
    agent = new BusinessAgentSystem(
      world,
      provider,
      options.agenticBusinessIds ?? DEFAULT_AGENTIC,
      options.limits,
    );
    sim.addSystem(agent);
  }

  sim.addSystem(new NeedsSystem(world));

  return { sim, world, agent };
}
