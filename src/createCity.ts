import { Simulation } from "./core/Simulation";
import { World } from "./world/World";
import { buildCity, type CityOptions } from "./world/cityGen";
import { WorldSystem } from "./systems/WorldSystem";
import { BrainSystem } from "./systems/BrainSystem";
import { MovementSystem } from "./systems/MovementSystem";
import { EconomySystem } from "./systems/EconomySystem";
import { MarketSystem } from "./systems/MarketSystem";
import { EventSystem, type EventSystemOptions } from "./systems/EventSystem";
import { GodMode } from "./systems/GodMode";
import { NeedsSystem } from "./systems/NeedsSystem";
import { LifecycleSystem } from "./systems/LifecycleSystem";
import { MacroSystem } from "./systems/MacroSystem";
import { BusinessAgentSystem } from "./systems/BusinessAgentSystem";
import { ResidentAgentSystem } from "./systems/ResidentAgentSystem";
import { RuleBasedProvider } from "./ai/RuleBasedProvider";
import { RuleBasedResidentProvider } from "./ai/RuleBasedResidentProvider";
import type { DecisionLimits, DecisionProvider } from "./ai/types";
import type { ResidentDecisionLimits, ResidentDecisionProvider } from "./ai/residentTypes";

/**
 * Which mind, if any, runs the businesses:
 *  - "off"     — no agentic layer; behaviour is exactly Phase 1 (the A/B control).
 *  - "rules"   — the deterministic RuleBasedProvider.
 *  - a provider — any DecisionProvider (e.g. ClaudeDecisionProvider, MockProvider).
 */
export type BrainOption = "off" | "rules" | DecisionProvider;

/**
 * Which mind, if any, runs an opted-in resident's life decisions. Mirrors
 * {@link BrainOption}: "off" is exactly Phase 1/2 (no resident agency).
 */
export type ResidentBrainOption = "off" | "rules" | ResidentDecisionProvider;

export interface CitySimOptions extends CityOptions {
  seed?: number;
  brain?: BrainOption;
  /** Businesses the brain manages. Defaults to the diner and the goods store. */
  agenticBusinessIds?: string[];
  /** Override the business action safety limits (defaults to DEFAULT_LIMITS). */
  limits?: DecisionLimits;
  /** Which mind runs opted-in residents' life decisions. Default "off". */
  residentBrain?: ResidentBrainOption;
  /** Residents the resident brain manages. Defaults to none until set. */
  agenticResidentIds?: string[];
  /** Override the resident action safety limits. */
  residentLimits?: ResidentDecisionLimits;
  /**
   * Opt in to Phase 6 disasters. `true` uses the default roster/odds; pass an
   * object to tune them. Off by default, so pre-Phase-6 runs are unchanged.
   */
  disasters?: boolean | EventSystemOptions;
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
  market: MarketSystem;
  macro: MacroSystem;
  agent?: BusinessAgentSystem;
  residentAgent?: ResidentAgentSystem;
  events?: EventSystem;
  god: GodMode;
} {
  const seed = options.seed ?? 1;
  const sim = new Simulation({ seed });
  const world = buildCity(sim.rng, options);

  // Constructed up front so the EventSystem can hold a market reference; it is
  // still *registered* (run) at its normal position below.
  const market = new MarketSystem(world);

  let events: EventSystem | undefined;
  const disasters = options.disasters ?? false;
  if (disasters) {
    events = new EventSystem(
      world,
      market,
      seed,
      typeof disasters === "object" ? disasters : undefined,
    );
  }

  sim.addSystem(new WorldSystem(world));
  // Disasters strike at the start of the day, before the economy settles.
  if (events) sim.addSystem(events);
  sim.addSystem(new BrainSystem(world));
  sim.addSystem(new MovementSystem(world));
  sim.addSystem(new EconomySystem(world));
  sim.addSystem(market);

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

  let residentAgent: ResidentAgentSystem | undefined;
  const residentBrain = options.residentBrain ?? "off";
  if (residentBrain !== "off") {
    const provider: ResidentDecisionProvider =
      residentBrain === "rules" ? new RuleBasedResidentProvider() : residentBrain;
    residentAgent = new ResidentAgentSystem(
      world,
      provider,
      options.agenticResidentIds ?? [],
      options.residentLimits,
    );
    sim.addSystem(residentAgent);
  }

  // Lifecycle runs after the economy, market, and any agents so it judges each
  // holder on the fully-settled day: bankruptcy off true end-of-day cash, and
  // eviction off the rent actually paid this day.
  sim.addSystem(new LifecycleSystem(world));
  sim.addSystem(new NeedsSystem(world));

  // Macro vitals last of all: it reads the fully-settled day (post-economy,
  // -market, -lifecycle) and only observes, never mutates.
  const macro = new MacroSystem(world, market);
  sim.addSystem(macro);

  // God Mode is a controller, not a system: it never runs in the tick loop, so
  // its mere presence is inert and a hands-off run is unchanged. It reads the
  // sim clock to stamp interventions and mirrors forced disasters into `events`.
  const god = new GodMode(world, market, sim.time, seed, events);

  return { sim, world, market, macro, agent, residentAgent, events, god };
}
