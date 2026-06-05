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
 * Phase 13c — the invest lever fires only when a capacity-bound business has at
 * least this much profit sitting above its reserve at review time. After the 13c
 * reorder the agent reviews *before* the daily dividend, so cash-above-reserve is
 * the day's undistributed operating profit: this keeps the lever off on a thin
 * day and lets it engage on a fat one. Tuned alongside the elasticity in the soak.
 */
export const INVEST_MIN_SURPLUS = 200;
/**
 * Phase 13c — the daily-capacity utilization a business must clear to count as
 * "busy enough that more equipment pays off." Utilization here is the day's
 * production as a fraction of the labour-/capital-limited ceiling; because each
 * business refills to a fixed stock target it can always reach, utilization in
 * this model tops out near ~0.5 rather than 1.0, so the trigger sits below that
 * practical ceiling. (Raising the ceiling toward a true 1.0 — so demand presses
 * hard against capacity and capital-deepening compounds — is a later
 * capacity-calibration phase; see the Phase 13c notes.)
 */
export const INVEST_UTILIZATION_THRESHOLD = 0.45;
/**
 * Phase 14 — whether a business's stock target scales with its capital (see
 * {@link MarketSystem}'s effectiveTarget). OFF here: the 14a seam ships as a pure
 * no-op (effectiveTarget = the archetype target). Turned ON in 14c, paired with
 * the maxPerDay cut, so a re-capitalised firm holds a deeper buffer and the
 * invest loop stays live (target and capacity scale by the same factor, keeping
 * utilization invariant to capital) instead of self-extinguishing.
 */
export const TARGET_CAPITAL_SCALING = false;
/**
 * Starting productive capital for every business (Phase 12). A dimensionless
 * index, not money: capital is quoted relative to this baseline, and the Phase
 * 12b capacity formula is calibrated so that a business at baseline capital
 * produces exactly today's output — making 12a a pure no-op. Above baseline,
 * output rises with diminishing returns; capital is bought from the factory and
 * depreciates daily.
 */
export const CAPITAL_BASELINE = 100;
/**
 * Phase 12b — how steeply a business's daily output ceiling bends with its
 * equipment. Capacity scales as (capital / CAPITAL_BASELINE) ^ this exponent —
 * the textbook "capital share" of a Cobb-Douglas production function. Below 1 it
 * encodes diminishing returns: at 0.3, doubling a business's capital lifts its
 * ceiling by only 2^0.3 ≈ 23%, and the next doubling adds less again. At exactly
 * baseline capital the factor is 1 (today's output), so a freshly-seeded city is
 * unchanged — which is what keeps 12b a no-op for the default town.
 */
export const CAPITAL_OUTPUT_ELASTICITY = 0.3;
/**
 * Phase 12b — the fraction of a business's *above-baseline* capital that wears
 * out each day (maintenance/obsolescence). Only the stock bought on top of the
 * baseline depreciates; the baseline plant is treated as maintained out of
 * ordinary operating costs, so a city where nobody invests never erodes below
 * baseline (and the seeded no-op city, sitting exactly at baseline, never moves).
 * This is the Solow "run to stand still": holding a high capital level takes
 * recurring re-investment to replace what wears out, so investment is an ongoing
 * decision, not a one-off. Reduces the capital quantity only, never cash, so the
 * conservation invariant is untouched. Tuned for real in Phase 12e.
 */
export const CAPITAL_DEPRECIATION_RATE = 0.01;
/**
 * Phase 12b — the head-count at which a business counts as "fully staffed" for
 * production. Output scales with min(1, employees / this): with no workers a
 * business makes nothing (the fix for empty producers shipping full output,
 * P10-3), and it reaches its full ceiling once staffed to this level. Set to 1
 * because the seeded city gives every producer at least one worker, so the labour
 * factor sits at 1 there and 12b stays a pure no-op for the default town. Raising
 * it — so head-count, not mere presence, drives output — is a Phase 12e lever.
 */
export const LABOR_FULL_STAFF = 1;
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

// Wealth-elastic consumption — "wants grow with wealth" (Phase 13)
/**
 * The wealth pivot: the cash level at which a resident's basket is exactly one
 * of each, like today. It equals the seeded starting balance every resident
 * begins with (cityGen gives each resident $500), so at the start of a run — and
 * for anyone who hasn't yet banked a surplus — nothing changes. Real-world terms:
 * subsistence. At or below it you order one plate; above it your order grows.
 * A test pins this to the actual starting money so the two can never silently drift.
 */
export const WEALTH_BASELINE = 500;
/**
 * How steeply a richer resident's order grows — the keystone's master knob, and
 * the real-world income-elasticity of demand. 0 = OFF: every resident buys
 * exactly one unit per visit, exactly like today, so Phase 13a ships as a pure
 * no-op. Raised toward ~1.0 in 13b, where a resident sitting on twice the
 * baseline (~$1000) then orders ~twice as much per visit.
 *
 * Phase 13b: engaged at 1.0 (linear) — the keystone is ON. A resident's order
 * scales with how far their cash sits above subsistence, capped at
 * {@link WEALTH_DEMAND_CAP}. 13c will likely temper this toward ~0.5
 * (diminishing returns) once the soak shows how hard the rich tail pushes GDP.
 */
export const WEALTH_ELASTICITY = 1;
/**
 * Hard ceiling on units bought in a single visit, so one runaway-rich resident
 * can't drain a storefront's shelves in a single tick. Bounds the blast radius.
 */
export const WEALTH_DEMAND_CAP = 4;
/**
 * Deterministic rounding "phases" (mirrors {@link LEISURE_TOLERANCE_TIERS}). The
 * unit count is a real number (e.g. 1.5 units); rather than round it with
 * randomness — which would perturb the seeded stream and desync the city — we
 * spread the fractional unit across the population by resident index, so ~half a
 * tier buys one and half buys two. The AGGREGATE tracks the real elasticity
 * smoothly while every individual resident stays perfectly reproducible. NO RNG.
 */
export const WEALTH_ROUND_TIERS = 6;

// CEO benchmark (Phase 10d)
/** Capital the benchmarked CEO's storefront is seeded with at scenario start ($). */
export const BENCH_START_CAPITAL = 50_000;
/** Fixed-length scenario horizon: how many turns (sim-days) a CEO run lasts. */
export const BENCH_TURNS = 42;
/**
 * The wealth-elasticity the CEO benchmark runs at — frozen *separately* from the
 * live-game {@link WEALTH_ELASTICITY} so re-tuning the city-wide knob (13c) never
 * silently moves historical CEO scores. The benchmark wants this ON: a CEO who
 * keeps residents employed and recirculates dividends lifts their wealth above
 * the baseline, which raises their orders and makes the storefront capacity-
 * bound — so good stewardship shows up as a cleaner net-worth gap.
 */
export const BENCH_WEALTH_ELASTICITY = 1;
