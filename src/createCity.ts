import { Simulation } from "./core/Simulation";
import { World } from "./world/World";
import { buildCity, type CityOptions } from "./world/cityGen";
import { WorldSystem } from "./systems/WorldSystem";
import { BrainSystem } from "./systems/BrainSystem";
import { MovementSystem } from "./systems/MovementSystem";
import { EconomySystem } from "./systems/EconomySystem";
import { MarketSystem } from "./systems/MarketSystem";
import { DistributionSystem } from "./systems/DistributionSystem";
import { WelfareSystem } from "./systems/WelfareSystem";
import { EventSystem, type EventSystemOptions } from "./systems/EventSystem";
import { GodMode } from "./systems/GodMode";
import { NeedsSystem } from "./systems/NeedsSystem";
import { LifecycleSystem } from "./systems/LifecycleSystem";
import { BusinessEntrySystem } from "./systems/BusinessEntrySystem";
import { MacroSystem } from "./systems/MacroSystem";
import { PopulationSystem, type PopulationOptions } from "./systems/PopulationSystem";
import { BusinessAgentSystem } from "./systems/BusinessAgentSystem";
import { ResidentAgentSystem } from "./systems/ResidentAgentSystem";
import { RuleBasedProvider } from "./ai/RuleBasedProvider";
import { RuleBasedResidentProvider } from "./ai/RuleBasedResidentProvider";
import type { DecisionLimits, DecisionProvider } from "./ai/types";
import { DEFAULT_LIMITS } from "./ai/clamp";
import { WAGE_CAP_MULT, MAX_WAGE_MULT } from "./systems/constants";
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
  /**
   * Residents the resident brain manages. An explicit id list, or "all" — every
   * working-age resident (so HP3 migrants and grown children are full agents too).
   * Defaults to none until set.
   */
  agenticResidentIds?: string[] | "all";
  /** Override the resident action safety limits. */
  residentLimits?: ResidentDecisionLimits;
  /**
   * Opt in to Phase 6 disasters. `true` uses the default roster/odds; pass an
   * object to tune them. Off by default, so pre-Phase-6 runs are unchanged.
   */
  disasters?: boolean | EventSystemOptions;
  /**
   * Override how strongly consumption grows with wealth (Phase 13). Defaults to
   * the live-game `WEALTH_ELASTICITY`; the CEO benchmark passes its own frozen
   * `BENCH_WEALTH_ELASTICITY` so its scores stay reproducible when the live knob
   * is re-tuned.
   */
  wealthElasticity?: number;
  /**
   * Override how strongly brand equity lifts willingness-to-pay (Phase 17 Hook A).
   * Defaults to the live `BRAND_DEMAND_ELASTICITY` (0 until 17d); the CEO benchmark
   * passes its frozen `BENCH_BRAND_DEMAND_ELASTICITY` so scores stay reproducible.
   */
  brandElasticity?: number;
  /**
   * Override the owner-dividend share (Phase 15 C). Defaults to the live-game
   * `OWNER_DIVIDEND_SHARE`; the CEO benchmark passes 0 to keep its firm-net-worth
   * score a clean skill signal, free of the dividend's wealth-concentration noise.
   */
  ownerDividendShare?: number;
  /**
   * Dividend weaning (Initiative #1 S3) — multiplier on the even recirculation. Defaults to the
   * live {@link DIVIDEND_WEAN} (1.0 ⇒ byte-identical). Taper toward 0 to wean the artificial demand
   * pump and test whether the freed wage market + welfare keep the closed economy circulating.
   */
  dividendWean?: number;
  /**
   * Free-market wage cap (Initiative #1 S1) — the multiple of base wage a firm may post via
   * `setWage`. Defaults to the live {@link WAGE_CAP_MULT} (= 2 = the old fixed cap), so an
   * unset city is **byte-identical** to today. Raise it (e.g. 8) to free the wage: firms then
   * bid above the old 2× ceiling for scarce labour and the labour-vs-capital split floats. When
   * raised, the coarse absolute wage clamp ({@link DecisionLimits.maxWagePerTick}) is lifted in
   * step so the per-firm cap, not the safety rail, governs.
   */
  wageCapMult?: number;
  /**
   * Welfare floor (Initiative #1 S2) — fraction of the average worker's daily income paid to each
   * non-earning resident, funded by a levy on business surplus. Defaults to the live
   * {@link WELFARE_RATIO} (0 ⇒ no welfare ⇒ byte-identical). Engage at ~0.5 for "the unemployed
   * earn about half an average worker." The single deliberate control in the free-market run.
   */
  welfareRatio?: number;
  /** Absolute daily subsistence floor per non-worker (Initiative #1 S2). Defaults to {@link WELFARE_SUBSISTENCE_MIN} (0). */
  welfareSubsistence?: number;
  /**
   * Toggle business birth (Phase 15 D). Defaults to the live `BUSINESS_ENTRY`;
   * lifecycle/bankruptcy tests pass `false` to isolate a death from the entry
   * system that would otherwise refill the niche it opens.
   */
  businessEntry?: boolean;
  /**
   * Toggle population growth (HP3). Defaults to the live {@link POPULATION_GROWTH}
   * (false); pass true to admit new $0 residents into spare housing over time so
   * firms gain real customers and the labour pool can staff every firm.
   */
  populationGrowth?: boolean;
  /** Override population growth knobs (HP3 rate/cooldown/prosperity). Defaults to the live constants. */
  populationOptions?: PopulationOptions;
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
  entry: BusinessEntrySystem;
  population: PopulationSystem;
  welfare: WelfareSystem;
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
  sim.addSystem(new EconomySystem(world, options.wealthElasticity, options.brandElasticity));
  sim.addSystem(market);

  let agent: BusinessAgentSystem | undefined;
  const brain = options.brain ?? "off";
  if (brain !== "off") {
    const provider: DecisionProvider = brain === "rules" ? new RuleBasedProvider() : brain;
    // Free-market wage cap (S1). Default keeps the old fixed 2× and the coarse safety rail
    // untouched ⇒ byte-identical. When the wage is freed (a higher mult), lift the absolute
    // clamp in step so the per-firm cap, not the rail, is what binds.
    const wageCapMult = options.wageCapMult ?? WAGE_CAP_MULT;
    const limits =
      options.limits ??
      (wageCapMult > MAX_WAGE_MULT
        ? { ...DEFAULT_LIMITS, maxWagePerTick: Math.max(DEFAULT_LIMITS.maxWagePerTick, wageCapMult) }
        : undefined);
    agent = new BusinessAgentSystem(
      world,
      provider,
      options.agenticBusinessIds ?? DEFAULT_AGENTIC,
      limits,
      market,
      options.brandElasticity,
      wageCapMult,
    );
    sim.addSystem(agent);
  }

  // Profit distribution runs AFTER the business agent (Phase 13c): a business
  // reviews its day with its full operating profit still in hand, so it can
  // reinvest part in equipment before the rest flows out as the daily dividend —
  // the change that finally fires the dormant invest lever. With no agent this
  // sits right where distribution always ran (just after the market), so the
  // brain-off baseline is byte-identical.
  sim.addSystem(new DistributionSystem(world, options.ownerDividendShare, options.dividendWean));
  // Welfare floor (Initiative #1 S2) runs right after distribution, on the day's settled cash —
  // the one deliberate control. Inert at the default ratio 0 ⇒ byte-identical.
  const welfare = new WelfareSystem(world, options.welfareRatio, options.welfareSubsistence);
  sim.addSystem(welfare);

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
  // Business entry runs right after lifecycle (Phase 15 D): it sees the day's
  // bankruptcies settled, then refills any niche they emptied — before Macro reads
  // the day's vitals. Inert until a kind goes extinct, so the seeded city is
  // unchanged.
  const entry = new BusinessEntrySystem(world, options.businessEntry);
  sim.addSystem(entry);
  sim.addSystem(new NeedsSystem(world));

  // Macro vitals last of all: it reads the fully-settled day (post-economy,
  // -market, -lifecycle) and only observes, never mutates.
  const macro = new MacroSystem(world, market);
  sim.addSystem(macro);

  // Population growth runs LAST — after macro has sampled the fully-settled day —
  // so a newcomer admitted today is counted from tomorrow and never perturbs the
  // vitals just measured. Inert unless populationGrowth is on (HP3): with it off
  // (the default) the seeded city is byte-identical.
  const population = new PopulationSystem(world, options.populationGrowth, options.populationOptions);
  sim.addSystem(population);

  // God Mode is a controller, not a system: it never runs in the tick loop, so
  // its mere presence is inert and a hands-off run is unchanged. It reads the
  // sim clock to stamp interventions and mirrors forced disasters into `events`.
  const god = new GodMode(world, market, sim.time, seed, events);

  return { sim, world, market, macro, agent, residentAgent, events, entry, population, welfare, god };
}
