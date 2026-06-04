/**
 * Phase 1 tuning. One day = 1440 ticks (1 tick = 1 sim-minute). Rates are
 * chosen so a resident sleeps ~at night, works the day, eats once or twice,
 * and money stays in healthy circulation across the closed economy.
 */
import type { BusinessKind, ResourceKind, WorkSchedule } from "../world/types";

// Daily schedule (hour of day, 0..23)
export const SLEEP_START_HOUR = 22;
export const WAKE_HOUR = 7;
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;

/**
 * Fallback work pattern for any resident missing one — e.g. a pre-10a save
 * restored into the new model. Mirrors the original behaviour exactly: a 9–17
 * shift, every day, no days off. Fresh cities assign varied schedules in
 * cityGen, so this only ever applies to legacy restored residents.
 */
export const DEFAULT_SCHEDULE: WorkSchedule = {
  startHour: WORK_START_HOUR,
  endHour: WORK_END_HOUR,
  daysOff: [],
};

// Need decay per tick (points/tick; needs are 0..100)
export const HUNGER_DECAY = 0.12;
export const HUNGER_DECAY_ASLEEP = 0.05;
export const ENERGY_DECAY = 0.08;
export const ENERGY_RESTORE = 0.3; // while sleeping
export const SOCIAL_DECAY = 0.05;

// Need thresholds that hijack the schedule
export const HUNGRY_THRESHOLD = 30;
export const TIRED_THRESHOLD = 20;
export const LONELY_THRESHOLD = 35;

// Movement
export const MOVE_SPEED = 20; // world units per tick
export const VEHICLE_SPEED_MULT = 1.6; // a vehicle owner covers more ground per tick

// Economy
export const RENT_PER_DAY = 70; // resident -> landlord (fallback when a home has no rent set)
export const BUSINESS_RENT_PER_DAY = 60; // diner/goods -> landlord
export const SOCIAL_SPEND = 8; // resident -> social venue per visit (flat fallback when a venue has no price)

// Retail prices & price-elastic demand (Phase 11a)
/**
 * The "natural" retail price each storefront is seeded with — also the anchor its
 * resident demand is measured against. A venue may move its own price off this
 * (the setPrice lever), but elasticity is always reckoned relative to the anchor,
 * so a price *at* the anchor reproduces the original behaviour exactly. That's the
 * back-compat guarantee: the no-agency baseline never moves off its anchor, so it
 * stays byte-identical.
 */
export const DINER_MEAL_PRICE = 18; // resident -> diner per meal
export const GOODS_PRICE = 34; // resident -> goods store per leisure/wares purchase
/** Per-kind anchor retail price the price-elastic *discretionary* demand model reckons against. */
export const RETAIL_REFERENCE_PRICE: Partial<Record<BusinessKind, number>> = {
  diner: DINER_MEAL_PRICE,
  goods: GOODS_PRICE,
};
/**
 * Spread of resident willingness-to-pay for discretionary spend (leisure), as a
 * fraction above the anchor. Reservations fan from the anchor (a resident who'll
 * only buy at or below it) up to anchor*(1+spread) (one who'll pay well over). So
 * leisure demand is full at or below the anchor and falls smoothly to ~zero by
 * anchor*(1+spread) — giving a storefront a real raise-price-lose-volume tradeoff
 * instead of captive demand. 0.6 lines the vanishing point up with the B2B band
 * ceiling ({@link PRICE_MAX_MULT}). Essential meal demand is left inelastic.
 */
export const LEISURE_PRICE_SPREAD = 0.6;
/** Distinct willingness-to-pay tiers spread deterministically across residents. */
export const LEISURE_TOLERANCE_TIERS = 6;

// Storefront competition (Phase 11b)
/**
 * How strongly travel distance weighs against price when a resident chooses which
 * store (of the same kind) to visit. Units: dollars of "felt cost" per world-unit
 * of straight-line distance from home. A resident shops where (price + WEIGHT *
 * distance) is lowest, so a nearer store can hold a small premium and a rival must
 * undercut by roughly WEIGHT * (distance gap) to poach its neighbours. At 0.03 the
 * ~100-unit gap between the two diners is worth ~$3 of price — enough that geography
 * splits the town at equal prices, yet a real undercut still wins customers across
 * it. Inert when only one store of a kind exists (no choice to make).
 */
export const STORE_TRAVEL_WEIGHT = 0.03;

// Resident agency (Phase 3)
export const VEHICLE_COST = 800; // resident -> goods store to buy a vehicle
export const VEHICLE_RESALE = 500; // goods store -> resident when selling back
export const RAISE_FRACTION = 0.08; // a granted raise lifts wage by this fraction
export const MAX_WAGE_MULT = 2; // wage may not exceed this multiple of the job's base wage
export const JOB_CHANGE_COOLDOWN_DAYS = 5; // min days between a resident's job switches
export const RAISE_COOLDOWN_DAYS = 7; // min days between a resident's raise requests

// Economy depth & markets (Phase 4)
/** Starting B2B price for each tradeable resource ($/unit). */
export const BASE_RESOURCE_PRICE: Record<ResourceKind, number> = {
  grain: 4,
  materials: 5,
  food: 8,
  wares: 11,
};
/** A resource price stays within [base*MIN, base*MAX] — bounds runaway moves. */
export const PRICE_MIN_MULT = 0.4;
// Caps input-cost swings below the fixed retail prices (diner 18, goods 34): a
// resource can rise to at most base*1.6 (food 12.8, wares 17.6), so a storefront
// always keeps a margin over what it pays its supplier.
export const PRICE_MAX_MULT = 1.6;
/** Max single-day price move, as a fraction of the current price. */
export const PRICE_ADJUST_FRACTION = 0.05;
/**
 * Restoring force (Phase 10f, fixes P9-9). When a resource's utilization sits in
 * the neutral band — neither over- nor under-worked — its price drifts this
 * fraction of the way back toward base each day. Without it the price has no
 * memory of base and simply freezes wherever an early-ramp transient left it, so
 * the city ran a persistent low-grade deflation (avg price ratcheted down and
 * stuck below base). With it, base is the unique attractor.
 */
export const PRICE_REVERT_FRACTION = 0.2;
/**
 * Once a reverting price is within this fraction of base, snap it exactly to
 * base. Keeps the steady state bit-flat (so "prices flat at steady state" still
 * holds to full precision) instead of crawling toward base forever.
 */
export const PRICE_REVERT_SNAP = 0.005;
/** A business is declared bankrupt below this cash for BANKRUPT_GRACE_DAYS running. */
export const BANKRUPT_CASH_FLOOR = 1;
export const BANKRUPT_GRACE_DAYS = 5;
/**
 * Profit distribution keeps the closed economy alive. In a closed loop, resident
 * shop-spending must equal total business wages, so any per-business surplus
 * would otherwise pool forever in one holder (a rent-collecting landlord, a
 * busy diner). Instead, each day every business pays cash above a working-
 * capital reserve back to residents as wages/dividends — they re-spend it at the
 * shops, and the money recirculates instead of stagnating.
 */
export const LANDLORD_RESERVE = 4500;
export const BUSINESS_RESERVE = 3000;
/** Max profit a single business disburses to residents per day ($). */
export const PROFIT_DISTRIBUTION_CAP = 900;
/**
 * Starting productive capital for every business (Phase 12). A dimensionless
 * index, not money: capital is quoted relative to this baseline, and the Phase
 * 12b capacity formula is calibrated so that a business at baseline capital
 * produces exactly today's output — making 12a a pure no-op. Above baseline,
 * output rises with diminishing returns; capital is bought from the factory and
 * depreciates daily.
 */
export const CAPITAL_BASELINE = 100;
/** Consecutive days of unpaid rent before a resident is downgraded to a cheaper home. */
export const EVICTION_GRACE_DAYS = 3;
/** Days of macro vitals retained in the ring buffer (chartable history). */
export const MACRO_HISTORY_DAYS = 400;

// Disasters & drama (Phase 6)
/** Probability that *some* disaster strikes on any given day (opt-in EventSystem). */
export const DISASTER_DAILY_CHANCE = 0.18;
/** How many recent disaster records the events log retains (ring buffer). */
export const DISASTER_LOG_SIZE = 50;
/** A relief grant moves at most this much landlord cash to the neediest business ($). */
export const GRANT_AMOUNT = 1500;

// God Mode (Phase 7)
/** How many recent divine-intervention records the God Mode log retains (ring buffer). */
export const GODMODE_LOG_SIZE = 50;

// Aspirational depth (Phase 10b)
/** Price of one discretionary luxury (resident -> goods store). Repeatable, money-conserving. */
export const LUXURY_COST = 150;
/** Upper bound a resident may set as their savings-goal buffer. */
export const MAX_SAVINGS_GOAL = 2000;

// CEO benchmark (Phase 10d)
/** Capital the benchmarked CEO's storefront is seeded with at scenario start ($). */
export const BENCH_START_CAPITAL = 50_000;
/** Fixed-length scenario horizon: how many turns (sim-days) a CEO run lasts. */
export const BENCH_TURNS = 42;
