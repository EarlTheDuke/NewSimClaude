import { Simulation } from "./core/Simulation";
import { World } from "./world/World";
import { buildCity, type CityOptions } from "./world/cityGen";
import { resetIndustries, BANK_INDUSTRY, PORT_INDUSTRY, AUTHORITY_INDUSTRY, type ResourceDef } from "./world/industries";
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
import { CreditSystem } from "./systems/CreditSystem";
import { TradeSystem } from "./systems/TradeSystem";
import { MonetarySystem } from "./systems/MonetarySystem";
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
   * Toggle opportunity-driven entry (Initiative #2, slice 1). Defaults to the live
   * {@link OPPORTUNITY_ENTRY} (off ⇒ byte-identical). On, a storefront kind that runs
   * capacity-bound and solvent attracts a **second** firm across town — creative
   * destruction's birth half generalized from "refill the dead" to "challenge the
   * overstretched." Reads utilization from the market, so it needs no new state.
   */
  opportunityEntry?: boolean;
  /**
   * Toggle population growth (HP3). Defaults to the live {@link POPULATION_GROWTH}
   * (false); pass true to admit new $0 residents into spare housing over time so
   * firms gain real customers and the labour pool can staff every firm.
   */
  populationGrowth?: boolean;
  /** Override population growth knobs (HP3 rate/cooldown/prosperity). Defaults to the live constants. */
  populationOptions?: PopulationOptions;
  /**
   * Extra **resources** a city's extra industries trade (Initiative #2 slice 4d) — registered into
   * the live registry alongside {@link CityOptions.extraIndustries} before the city is built. Off by
   * default (empty) ⇒ the seeded economy is byte-identical. A new resource needs a producing
   * industry in `extraIndustries`, or it simply won't be supplied.
   */
  extraResources?: readonly ResourceDef[];
  /**
   * Producer competition strength (Initiative B, slice 1) — the exponent that skews the
   * multi-producer B2B split toward cheaper, more efficient suppliers. Defaults to the live
   * {@link PRODUCER_COMPETITION} (0 ⇒ proportional-to-stock ⇒ byte-identical). Engage at ~1–2 so
   * an efficient producer wins more share, out-grows a laggard, and the supply side truly competes.
   */
  producerCompetition?: number;
  /**
   * Labour competition (Initiative B, slice 2) — when true, a firm's review sees the strongest
   * same-kind rival's wage and can poach / match-to-retain (a wage war with a truce). Defaults to
   * the live {@link LABOUR_COMPETITION} (off ⇒ `rivalWage` omitted ⇒ wage logic byte-identical).
   * Only bites in a freed-wage city (`wageCapMult` raised); the capped default already ignores rivals.
   */
  labourCompetition?: boolean;
  /**
   * Credit & finance (Initiative C / Phase 18). When true, the {@link CreditSystem} services loans
   * and (later slices) firms may borrow from a seeded Bank. Defaults to the live {@link CREDIT_ENABLED}
   * (off ⇒ the system is a no-op ⇒ byte-identical). Strictly opt-in — never implied by other knobs.
   */
  creditEnabled?: boolean;
  /**
   * A firm's total outstanding-principal ceiling (Initiative C / Phase 18c). Defaults to the live
   * {@link CREDIT_MAX_PRINCIPAL_PER_FIRM} (0 ⇒ no borrowing). Engaged later via a tuning sweep; tests
   * pass an explicit ceiling to exercise the borrow lever.
   */
  creditMaxPrincipal?: number;
  /**
   * Flat daily interest rate on outstanding loan principal (Initiative C / Phase 18d) — the
   * `firm→bank` charge. Defaults to the live {@link CREDIT_DAILY_INTEREST_RATE} (0 ⇒ no interest).
   * Engaged later via a tuning sweep; tests pass a rate to exercise accrual.
   */
  creditDailyRate?: number;
  /**
   * Daily yield the Bank pays on a firm's idle cash (Initiative C / Phase 18i) — the `bank→saver`
   * rate, so hoarded retained earnings aren't free net worth. Defaults to the live
   * {@link CREDIT_SAVINGS_DAILY_RATE} (0 ⇒ no savings ⇒ byte-identical). The borrow−savings spread is
   * the bank's margin.
   */
  creditSavingsRate?: number;
  /**
   * External trade (Initiative C / C4a). When true, the {@link TradeSystem} runs the port's daily
   * current account — export purchases (`port→firm`, outside demand) and import sales
   * (`firm→port`) — all conserving transfers. Defaults to the live {@link TRADE_ENABLED} (off ⇒
   * the system is a no-op ⇒ byte-identical). Strictly opt-in, and needs `includePort` to actually
   * trade — exactly like `creditEnabled` vs `includeBank`.
   */
  tradeEnabled?: boolean;
  /**
   * Imported content of luxuries (C4a-C — the conserving trade CYCLE). The fraction of each
   * day's luxury sales the goods store pays the port for restocking its fineries off the boat,
   * which keeps foreign commerce alive past the battery: city money flows out through luxuries,
   * refilling the reserve that funds continuing exports. Defaults to the live
   * {@link TRADE_LUXURY_IMPORT_SHARE}; pass 0 for the pre-C one-shot battery model (the a5 soak
   * pins 0 to preserve its recorded battery-death finding as the control).
   */
  luxuryImportShare?: number;
  /**
   * Benchmark F3 — equalize the two diners' GENESIS staffing (1/1 instead of the round-robin's
   * 2/1) so both duel seats carry skill signal instead of one being a structural drain.
   * Requires {@link secondDiner}; geometry stays asymmetric (the home-and-away swap cancels
   * it). Default off ⇒ byte-identical.
   */
  balancedDiners?: boolean;
  /**
   * Monetary policy (Initiative C / C4b) — THE DELIBERATE RELAXATION of strict conservation
   * (user-greenlit 2026-06-09). When true (with `includeAuthority`, a rate, and a cap), the
   * {@link MonetarySystem} mints `min(rate × supply, cap)` daily through the audited
   * `World.mint` and helicopters it to residents. Defaults to the live {@link MONETARY_ENABLED}
   * (off ⇒ no-op ⇒ strictly conserved, byte-identical).
   */
  monetaryEnabled?: boolean;
  /** Daily money-supply growth as a fraction of the current total (C4b). Defaults to {@link MONETARY_DAILY_GROWTH_RATE} (0 ⇒ inert). */
  monetaryGrowthRate?: number;
  /** Hard $/day mint ceiling (C4b) — the bound in bounded money creation. Defaults to {@link MONETARY_DAILY_MINT_CAP} (0 ⇒ inert). */
  monetaryDailyCap?: number;
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
  // Initiative #2 slice 4d — register this city's industries (seeded + any extras) before building,
  // so ARCHETYPES/resources/prices reflect them. With no extras this restores the seeded economy
  // verbatim ⇒ byte-identical. Per-build reset keeps determinism + test isolation (see industries.ts).
  // Initiative C / Phase 18b — when includeBank, register the Bank archetype too (so ARCHETYPES.bank
  // exists for the lookups), STRICTLY opt-in (never implied by creditEnabled). cityGen seeds the bank
  // firm itself (carved from the landlord), so it is NOT added to the cityGen extra-industry list.
  // Initiative C / C4a — likewise the Port under includePort (never implied by tradeEnabled);
  // cityGen seeds the port firm itself, as new genesis money (the foreign buyers' reserve).
  const includeBank = options.includeBank ?? false;
  const includePort = options.includePort ?? false;
  const includeAuthority = options.includeAuthority ?? false;
  const registryIndustries = [
    ...(options.extraIndustries ?? []),
    ...(includeBank ? [BANK_INDUSTRY] : []),
    ...(includePort ? [PORT_INDUSTRY] : []),
    ...(includeAuthority ? [AUTHORITY_INDUSTRY] : []),
  ];
  resetIndustries(registryIndustries, options.extraResources);
  const world = buildCity(sim.rng, options);

  // Benchmark F3 — balancedDiners: with the rival diner present, the seeded staffing
  // round-robin hands The Corner Diner 2 staff and Riverside 1, which makes one duel seat a
  // structural drain (every pilot bleeds there) — half of every match measured the map, not
  // the mind. This genesis-only rebalance releases Corner's surplus staff into UNEMPLOYMENT
  // until both diners hold the same crew (1/1) — and the freed worker becomes a FREE AGENT
  // the two CEOs must compete for on day one (with F1's resident agency, the rules mind takes
  // the best hiring offer — the fairest possible opening for a wage-war scenario). Geometry
  // remains the residual difference, cancelled by the home-and-away swap. Deterministic (no
  // RNG, last-listed picks), occupancy-only (no cash moves), default OFF ⇒ byte-identical.
  if (options.secondDiner && options.balancedDiners) {
    const corner = world.getBusiness("biz_diner");
    const riverside = world.getBusiness("biz_diner_2");
    while (corner && riverside && corner.employeeIds.length > riverside.employeeIds.length) {
      const freedId = corner.employeeIds[corner.employeeIds.length - 1]!;
      corner.employeeIds = corner.employeeIds.filter((id) => id !== freedId);
      const freed = world.getResident(freedId);
      if (freed) freed.jobId = "";
    }
  }

  // Constructed up front so the EventSystem can hold a market reference; it is
  // still *registered* (run) at its normal position below. Initiative B slice 1:
  // producerCompetition skews the multi-producer split toward cheaper suppliers
  // (default 0 ⇒ proportional-to-stock ⇒ byte-identical).
  const market = new MarketSystem(world, options.producerCompetition);

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

  // External trade (Initiative C / C4a) runs right after the B2B market: stock is freshly
  // produced, and export revenue books before the CEO reviews the day, before profit distribution,
  // and before Macro samples it. The market reference feeds the import-gap arithmetic (a3); the
  // luxury-import share (C4a-C) keeps the current account cycling past the battery.
  // Inert at the default (TRADE_ENABLED off ⇒ no-op) ⇒ byte-identical.
  sim.addSystem(new TradeSystem(world, market, options.tradeEnabled, options.luxuryImportShare));

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
      options.labourCompetition,
      options.creditEnabled,
      options.creditMaxPrincipal,
      options.creditDailyRate,
      options.tradeEnabled,
    );
    sim.addSystem(agent);
  }

  // Profit distribution runs AFTER the business agent (Phase 13c): a business
  // reviews its day with its full operating profit still in hand, so it can
  // reinvest part in equipment before the rest flows out as the daily dividend —
  // the change that finally fires the dormant invest lever. With no agent this
  // sits right where distribution always ran (just after the market), so the
  // brain-off baseline is byte-identical.
  sim.addSystem(
    new DistributionSystem(
      world,
      options.ownerDividendShare,
      options.dividendWean,
      options.creditEnabled,
      options.creditDailyRate,
    ),
  );
  // Welfare floor (Initiative #1 S2) runs right after distribution, on the day's settled cash —
  // the one deliberate control. Inert at the default ratio 0 ⇒ byte-identical.
  const welfare = new WelfareSystem(world, options.welfareRatio, options.welfareSubsistence);
  sim.addSystem(welfare);

  // Monetary policy (Initiative C / C4b) runs right after the welfare floor — both are
  // transfers-to-residents on the settled day — and before lifecycle/macro, so the day's issue is
  // in wallets before solvency is judged and vitals are sampled. Inert at the default
  // (MONETARY_ENABLED off, rate 0, cap 0 ⇒ no-op) ⇒ strictly conserved, byte-identical.
  sim.addSystem(
    new MonetarySystem(world, options.monetaryEnabled, options.monetaryGrowthRate, options.monetaryDailyCap),
  );

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

  // Credit/finance (Initiative C / Phase 18) runs between distribution and lifecycle, so a firm's
  // debt service is taken after its dividend is set but before solvency is judged. Inert at the
  // default (CREDIT_ENABLED off ⇒ no-op) ⇒ byte-identical. Slice 18a: a no-op stub.
  sim.addSystem(
    new CreditSystem(world, options.creditEnabled, options.creditDailyRate, options.creditSavingsRate),
  );

  // Lifecycle runs after the economy, market, and any agents so it judges each
  // holder on the fully-settled day: bankruptcy off true end-of-day cash, and
  // eviction off the rent actually paid this day.
  sim.addSystem(new LifecycleSystem(world, options.creditEnabled));
  // Business entry runs right after lifecycle (Phase 15 D): it sees the day's
  // bankruptcies settled, then refills any niche they emptied — before Macro reads
  // the day's vitals. Inert until a kind goes extinct, so the seeded city is
  // unchanged.
  const entry = new BusinessEntrySystem(world, options.businessEntry, options.opportunityEntry, market);
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
