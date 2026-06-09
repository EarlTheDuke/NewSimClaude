/**
 * Phase 1 tuning. One day = 1440 ticks (1 tick = 1 sim-minute). Rates are
 * chosen so a resident sleeps ~at night, works the day, eats once or twice,
 * and money stays in healthy circulation across the closed economy.
 */
import type { Needs, WorkSchedule } from "../world/types";
import { BASE_RESOURCE_PRICE, RETAIL_REFERENCE_PRICE } from "../world/industries";

// Daily schedule (hour of day, 0..23)
export const SLEEP_START_HOUR = 22;
export const WAKE_HOUR = 7;
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;
/**
 * Ticks a full-time worker is on shift in a day — the nominal 9–17 (8h × 60).
 * Used as the cost basis for a producer's per-unit wage cost (Phase 15 B). Real
 * resident schedules vary slightly (different start/end, days off), so this is a
 * typical-day approximation — all a pricing *floor* needs.
 */
export const WORK_TICKS_PER_DAY = (WORK_END_HOUR - WORK_START_HOUR) * 60;

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

// Housing (HP1) — homes are dwellings with a finite occupancy. Capacity reflects
// size: premium (pricier) homes are bigger, cheap homes are small flats. The town
// is seeded with more capacity than people (slack) so population can grow into it
// (HP3), and the cheapest home can't swallow the whole town. Re-homing only moves
// to a home with a free slot, and only for a *meaningful* saving (so people stay
// settled instead of churning toward the cheapest).
export const HOME_CAPACITY_MAX = 5; // capacity of the priciest/biggest home
export const HOME_CAPACITY_MIN = 2; // capacity of the cheapest/smallest home
export const HOME_MOVE_MIN_SAVING = 6; // min daily rent saving to bother moving home

// Population growth (HP3) — the town can grow over time so firms gain real
// customers and the labour pool can staff every firm (today's 12 residents are
// BOTH the whole workforce AND the whole customer base). HP1 seeded housing with
// slack; growth fills the vacancies. Everything here is default-OFF / inert until
// engaged, so the seam ships byte-identical.
//
// Real-world: a small town that's doing well attracts newcomers (and, later,
// families have children) — but only as fast as there are homes to live in and
// work to do, so growth is gated on spare housing + open jobs + prosperity.
export const POPULATION_GROWTH = false; // master flag: in-migration of $0 newcomers
export const IN_MIGRATION_COOLDOWN_DAYS = 5; // min days between arrivals (hysteresis, like ENTRY_COOLDOWN_DAYS)
export const MIGRATION_RATE_PER_DAY = 0.1; // growth pressure accrued per eligible day; ~1 arrival per 10 good days
export const MIGRATION_PROSPERITY_FLOOR = 600; // median resident cash the town must clear to attract a newcomer
/**
 * The fixed needs a newcomer arrives with (HP3). A constant — NOT an RNG draw —
 * so admitting a person consumes no random numbers and the seeded population's
 * RNG stream stays byte-identical (determinism is sacred). A content, rested
 * arrival who'll settle into the daily needs loop like everyone else.
 */
export const NEWCOMER_NEEDS: Needs = { hunger: 80, energy: 85, social: 70 };
/** Age (years) an in-migrant arrives at — a working adult; newborns start at 0 (HP3). */
export const NEWCOMER_AGE_YEARS = 25;

// Population mortality (HP3) — residents age and eventually die, with their estate
// passing to an heir so the closed economy is untouched. The exit path that lets
// births (HP3-7) sustain a living demographic cycle instead of just filling housing
// once. Default-OFF ⇒ no aging, no death ⇒ byte-identical.
//
// Real-world: people grow old and pass on; what they leave is inherited, not
// destroyed. A town stays alive through the turnover of generations.
export const POPULATION_MORTALITY = false; // master flag: residents age and die (with inheritance)
export const MAX_AGE_YEARS = 80; // a resident dies once they reach this age; estate -> heir (conserved)
export const DAYS_PER_YEAR = 365; // sim-days per year, for aging

// Births (HP3-7) — the growth trigger's other flavour: instead of a newcomer
// arriving from outside, a working parent has a child who is born into the family
// home. Default-OFF ⇒ growth uses in-migration ⇒ unchanged. Real-world: families
// grow from within, the newborn supported by their parents until they come of age.
export const POPULATION_BIRTHS = false; // master flag: growth happens via births, not in-migration
/** Cash a parent gives a newborn (a parent→child transfer, so birth mints no money). */
export const BIRTH_GIFT = 100;
/**
 * Age (years) a child becomes a working adult (HP3-9 coming-of-age). Once a born
 * resident reaches this, the yearly demographic step seats them into an open job —
 * so grown children replace the workers mortality removes, and a births+mortality
 * town sustains its labour force instead of decaying into idle dependents.
 */
export const COMING_OF_AGE_YEARS = 18;

// Housing construction (HP4) — when the town runs out of homes, the landlord invests
// rent income in building more, lifting the population ceiling so growth continues
// past the seeded cap instead of freezing. The town then grows in a staircase: build
// a home → people fill it → build again. Default-OFF ⇒ inert. Real-world: a landlord
// seeing full occupancy and standing demand builds more housing to rent out.
export const HOUSING_CONSTRUCTION = false; // master flag
export const HOME_BUILD_COST = 1500; // cash the landlord spends per home (a transfer -> the factory for materials)
export const HOME_BUILD_RESERVE = 2000; // cash the landlord keeps after a build (so it stays solvent)
export const HOME_BUILD_CAPACITY = 3; // occupancy of a newly built home
export const HOME_BUILD_RENT = 60; // daily rent of a newly built home (mid-tier, so it doesn't trigger churn)
export const HOME_BUILD_COOLDOWN_DAYS = 20; // min days between builds (paces the staircase)

// Dynamic rent (HP2) — rent responds to housing scarcity: as the town fills up rents
// climb; when there's slack (or the landlord builds more) they ease back. Makes
// housing a real market and gives the landlord meaning — scarcity lifts its rent
// income, which (with HP4) funds the construction that relieves the scarcity: a
// supply-demand loop. Default-OFF ⇒ rents stay at their seeded values ⇒ byte-identical.
// Real-world: a tight rental market pushes rents up; vacancies and new building pull
// them down.
export const DYNAMIC_RENT = false; // master flag
export const RENT_NEUTRAL_OCCUPANCY = 0.8; // town occupancy at which rent sits at its base
export const RENT_SCARCITY_SENSITIVITY = 1.0; // how strongly rent responds to occupancy deviation
export const RENT_MIN_MULT = 0.75; // rent floor as a fraction of base (deep slack)
export const RENT_MAX_MULT = 1.3; // rent ceiling as a fraction of base (full town)
export const RENT_ADJUST_FRACTION = 0.1; // daily drift toward the scarcity target (smoothing)

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
// Slice 4: the retail anchors + base resource prices are owned by the registry now (the single,
// mutable source) and re-exported here for back-compat. The seeded diner/goods anchors derive
// from it (a new storefront just declares its own `retailPrice`).
export { BASE_RESOURCE_PRICE, RETAIL_REFERENCE_PRICE };
export const DINER_MEAL_PRICE = RETAIL_REFERENCE_PRICE.diner!; // resident -> diner per meal (seeded anchor)
export const GOODS_PRICE = RETAIL_REFERENCE_PRICE.goods!; // resident -> goods store per leisure/wares purchase
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
/**
 * Free-market wage cap (Initiative #1, S1) — the multiple of a role's base wage a firm may
 * post via `setWage`. Defaults to {@link MAX_WAGE_MULT} (2), so a city built without an
 * override is **byte-identical** to today. Raise it (e.g. createCity({ wageCapMult: 8 })) to
 * "free the wage": short-staffed firms then bid above the old 2× ceiling to win scarce labour,
 * and the labour-vs-capital split floats instead of pinning. Real-world: lifting an
 * administrative pay ceiling so a tight labour market can actually move wages.
 */
export const WAGE_CAP_MULT = MAX_WAGE_MULT;
/**
 * Phase 18-pre (sustain the engine) — minimum base wage a B2B *producer* (farm, mine,
 * bakery, factory) is seeded paying. Producers seed cheap (mine 0.05) and, against the
 * storefronts' 0.17-0.20, can't hold a crew once demand growth (Phase 17 brand) makes the
 * storefronts richer employers — the lowest-wage producer goes crewless, starves the chain,
 * the factory dies, and the invest/brand engine can't compound (it loses its supply).
 * Flooring producer wages keeps the chain staffed so the engine sustains. Default 0 ⇒
 * today's seeds ⇒ byte-identical; engaged at 0.12 ⇒ producers compete for labour.
 * Why 0.12: a floor sweep (seeds 1 & 7) showed the engine sustains for any floor ≥ 0.08
 * (at 0, the factory dies and goods capital never leaves baseline), while the two-diner
 * truce survives only up to 0.14 — 0.16 pushed producers to near-parity with the diner's
 * 0.17 base and starved the second diner. 0.12 maximises sustained goods capital/brand
 * (~2600) AND keeps every producer fully crewed AND preserves the truce.
 */
export const PRODUCER_WAGE_FLOOR = 0.12;
export const JOB_CHANGE_COOLDOWN_DAYS = 5; // min days between a resident's job switches
export const RAISE_COOLDOWN_DAYS = 7; // min days between a resident's raise requests

// Economy depth & markets (Phase 4) — BASE_RESOURCE_PRICE is re-exported from the registry above.
/** A resource price stays within [base*MIN, base*MAX] — bounds runaway moves. */
export const PRICE_MIN_MULT = 0.4;
// Caps input-cost swings below the fixed retail prices (diner 18, goods 34): a
// resource can rise to at most base*1.6 (food 12.8, wares 17.6), so a storefront
// always keeps a margin over what it pays its supplier.
export const PRICE_MAX_MULT = 1.6;
/**
 * Phase 15 (B) — whether a producer's resource price is floored at its *cost of
 * production* (input + wages) plus a margin, instead of the flat band floor
 * base*{@link PRICE_MIN_MULT}. ON (B2): the floor is the cost-plus reservation
 * price computed in {@link MarketSystem}'s priceFloor; B1 shipped the seam as a
 * pure no-op with this off.
 *
 * Real-world: a supplier won't keep selling below its own cost — it goes broke.
 * Today's price-discovery loop has no such reservation, so on a long agentic run
 * a B2B producer's resource price can sag below what the firm pays for inputs and
 * wages, draining its cash until it goes bankrupt and starves the storefronts of
 * supply (P10-7). A cost-plus floor is the upstream fix that keeps the whole
 * supply chain solvent — the first, highest-leverage slice of Phase 15. It is the
 * money-in that lets a producer afford the competitive wage the labour market
 * (A) needs it to pay.
 */
export const PRODUCER_COST_FLOOR = true;
/**
 * Phase 15 (B) — the gross markup a producer adds over its unit cost (input +
 * labour) when {@link PRODUCER_COST_FLOOR} is on. A *fractional* markup, so the
 * floor is `unitCost * (1 + this)`. 0.15 = a 15% margin: enough to cover wages
 * and leave a thin operating surplus (so the firm can fund a competitive wage and
 * the odd capital purchase) without squeezing the storefront that buys from it —
 * the floor is additionally capped below base*{@link PRICE_MAX_MULT} so a
 * storefront always keeps a margin over what it pays.
 */
export const PRODUCER_COST_PLUS_MARGIN = 0.15;
/**
 * Producer competition strength (Initiative B, slice 1) — the exponent `k` that skews the
 * multi-producer order split (slice 2) toward the **more efficient** supplier. A buyer's order
 * is allocated by `weight = stock × (marketPrice / unitCost)^k`, so a producer with a lower unit
 * cost (cheaper input + wages spread over more capacity) wins **more** share — it earns more,
 * reinvests, and out-grows a laggard, who shrinks and may exit (→ entry refills). At **0** the
 * factor is `(…)^0 = 1`, so weight = stock ⇒ the proportional-to-stock slice-2 split, **byte-
 * identical**. Engage at ~1–2 for visible supply-side competition. Real-world: buyers route
 * contracts to the cheaper, more reliable supplier, so efficient producers grow and inefficient
 * ones lose the business. Keeps the single market price (per-producer pricing is a later step).
 */
export const PRODUCER_COMPETITION = 0;
/**
 * Labour competition (Initiative B, slice 2) — OFF by default. When on, a firm's review sees the
 * strongest same-kind rival's wage (`rivalWage`) and can **poach** (bid up to at least the rival's
 * wage to pull staff) or **match-to-retain** (a rival pays more → match it, *don't exceed* — the
 * truce, so wages converge at a shared competitive level instead of spiralling to the cap). Only
 * sharpens the freed-wage market (Initiative #1 S1); the capped default city already ignores rivals.
 * Off ⇒ `rivalWage` is omitted from the observation ⇒ the wage logic is byte-identical.
 */
export const LABOUR_COMPETITION = false;

// --- Credit & finance (Initiative C / Phase 18) — all INERT here (slice 18a). Engaged later via
//     a tuning sweep; the whole subsystem is frozen OFF in the CEO bench. See PHASE18-CREDIT.md. ---
/**
 * Master switch for credit/banking (Initiative C, C1). OFF here ⇒ no lending, no interest, the
 * {@link CreditSystem} is a no-op, and `createCity` seeds no Bank ⇒ the default city is byte-identical.
 * Real-world: whether the town has a working bank that firms can borrow from to fund growth.
 */
export const CREDIT_ENABLED = false;
/** Flat daily interest a borrower pays the Bank, as a fraction of principal (`firm→bank` transfer). 0 ⇒ free credit / no-op. */
export const CREDIT_DAILY_INTEREST_RATE = 0;
/** Hard ceiling on a single firm's outstanding principal — its borrowing limit. 0 ⇒ no firm may borrow. */
export const CREDIT_MAX_PRINCIPAL_PER_FIRM = 0;
/** Daily yield the Bank pays on a firm's idle cash (`bank→saver` transfer), so hoarding isn't free. 0 ⇒ no savings interest. */
export const CREDIT_SAVINGS_DAILY_RATE = 0;
/** Working-capital reserve the Bank keeps (its lending float) — kept above {@link BUSINESS_RESERVE} so the nightly distribution sweep doesn't drain its capacity. */
export const BANK_RESERVE = 4500;
/** Seed cash the Bank is capitalised with when `includeBank` — carved from the landlord's seeded cash so the genesis total is unchanged. */
export const BANK_SEED_CASH = 1500;
/** The CEO benchmark freezes credit OFF (mirrors the other BENCH_* freezes) so historical scorecards never move. */
export const BENCH_CREDIT_ENABLED = false;

/** Max single-day price move, as a fraction of the current price. */
export const PRICE_ADJUST_FRACTION = 0.05;
/**
 * The utilization neutral band the pricer treats as "balanced" (Phase 14). Above
 * {@link PRICE_UTIL_HIGH} a producer is over-worked → price nudges up; below
 * {@link PRICE_UTIL_LOW} it's slack → price nudges down; in between, price drifts
 * back to base. The band was [0.3, 0.6] when the chain ran at ~0.4 utilization;
 * the Phase 14 capacity cut moves the operating point to ~0.75–0.85, so the band
 * is recentred there — otherwise the now-hotter (but healthy) utilization would
 * read as "over-worked" and firm every input price above base, squeezing
 * storefront margins. The band is widened/raised (not just shifted): the LOW edge
 * stays at 0.3 so a quiet, leisure-light chain (~0.55 util at neutral demand)
 * doesn't deflate to the floor, while the HIGH edge rises to 0.92 so the new
 * ~0.6–0.85 operating range reads as balanced and prices only firm on genuine
 * near-stockout scarcity (util > 0.92).
 */
export const PRICE_UTIL_HIGH = 0.92;
export const PRICE_UTIL_LOW = 0.3;
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
 * Phase 15 D — on bankruptcy, hand the firm's residual cash to its owner (recouped
 * equity) and write off its non-cash stock, instead of freezing a dead husk that
 * holds money out of circulation forever. The residual is small by construction (a
 * firm only bankrupts once its cash is under {@link BANKRUPT_CASH_FLOOR}), but over
 * a long run of creative destruction those scraps would otherwise pile up in
 * corpses. Money moves only via {@link World.transfer}, so the closed economy is
 * untouched. ON — the husk is settled, not frozen.
 */
export const RECYCLE_BANKRUPT_ASSETS = true;
/**
 * Phase 15 D — whether new firms are *born* to fill an empty niche. ON. A
 * BusinessKind that has gone fully extinct (every firm of it bankrupt) is a
 * standing unmet demand; this lets a resident-entrepreneur found a fresh firm to
 * serve it, so the city self-heals from the deaths the productivity engine's
 * long-run churn produces — and it is the disruption that finally makes the labour
 * levers (hire/setWage) bite. Inert until a kind actually goes extinct, so the
 * seeded city (every kind staffed and solvent) is unaffected.
 */
export const BUSINESS_ENTRY = true;
/**
 * The savings a resident needs before they'll sink {@link NEW_FIRM_CAPITAL} into
 * founding a firm — they keep a cushion for themselves. Kept low because residents
 * run cash-light (they spend down into luxuries), so an entrepreneur is someone who
 * has banked a little above the seeded $500 starting balance.
 */
export const ENTREPRENEUR_MIN_SAVINGS = 600;
/**
 * Starting cash a founder capitalises a new firm with (a resident → firm transfer,
 * so birth mints no money). Modest by necessity — it's what a cash-light resident
 * can spare — but a firm born into an *empty* niche is the sole supplier of a
 * needed good, so it earns its way up from a thin start.
 */
export const NEW_FIRM_CAPITAL = 500;
/** Min days between business births — hysteresis so a wave of deaths heals gradually, not in a thrash. */
export const ENTRY_COOLDOWN_DAYS = 10;
/**
 * Opportunity-driven entry (Initiative #2, slice 1) — OFF by default, so the seeded
 * city is byte-identical. Where {@link BUSINESS_ENTRY} only *heals* (refills a kind
 * once it has gone fully extinct), this lets a kind that is alive but *overstretched*
 * attract a **second** firm. Real-world: when the corner diner is slammed every lunch
 * and still turning a profit, an entrepreneur opens a rival across town. Scoped to
 * **storefronts** (diner, goods) — the only kinds the demand side already splits across
 * multiple firms (by price + distance); a second *producer* would sit unreached behind
 * {@link MarketSystem}'s first-match `producerOf`, so new producers/industries are a
 * later slice. Conserving + deterministic, exactly like the heal path.
 */
export const OPPORTUNITY_ENTRY = false;
/**
 * The yesterday-utilization (`make / capacity`, Phase 12c) at or above which a storefront
 * counts as **capacity-bound** — running flat-out, a signal of unmet demand worth a rival.
 * High by design: only a firm that made nearly every unit it could is a true opportunity.
 */
export const OPPORTUNITY_UTIL = 0.97;
/**
 * The most active firms one storefront kind may hold via opportunity entry — a hard cap so
 * a hot niche attracts *a* rival, not an unbounded swarm (the demand-split + lifecycle then
 * decide whether the newcomer survives). 2 = the incumbent plus one challenger.
 */
export const MAX_FIRMS_PER_KIND = 2;
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
 * Phase 15 C — the fraction of a business's daily distributable profit that goes
 * to its OWNER as personal income, before the rest recirculates evenly to all
 * residents. 0 here (C1): owning a business pays nothing special and distribution
 * is the old even split — byte-identical. Engaged at ~0.35 in C2, so an owner
 * earns more as their firm prospers (the payoff that makes entrepreneurship — and
 * the whole CEO premise — mean something economically), while the remaining ~0.65
 * still recirculates broadly. It is deliberately a *split*, not a re-route: the
 * even payout is the closed economy's primary demand pump, so routing 100% to the
 * ~7 owners would pool money in them and collapse everyone else's spending.
 * Real-world: an owner draws profits, but wages and supplier payments still spread
 * income across the whole town.
 */
export const OWNER_DIVIDEND_SHARE = 0.1;
/**
 * Welfare floor (Initiative #1 S2) — the single deliberate control in the free-market
 * experiment. Each day every non-earning resident (`jobId === ""` — the unemployed plus
 * dependents who can't work) receives a transfer targeting this fraction of the *average
 * worker's daily income*, funded by a levy on businesses' above-reserve cash. Default 0 ⇒
 * the {@link WelfareSystem} is inert ⇒ byte-identical. Engaged at ~0.5 (the user's target:
 * the unemployed earn about half an average worker).
 *
 * Why a levy on **capital** (not on wages): welfare is funded from the economy's surplus, so a
 * worker's take-home wage — and thus the labour-share metric — stays clean, and the safety net
 * survives the later weaning of the even dividend (S3). It is also a *market-respecting* wage
 * floor: no one takes a job paying less than welfare, so firms must beat welfare to hire — a
 * floor set by the safety net competing for labour, not a price control imposed on firms.
 * Real-world: a profits-funded unemployment benefit pegged to prevailing wages.
 */
export const WELFARE_RATIO = 0;
/** Absolute daily subsistence floor per non-worker (Initiative #1 S2), used when welfare is engaged
 *  and average worker income is low. Default 0 ⇒ inert. */
export const WELFARE_SUBSISTENCE_MIN = 0;
/**
 * Dividend weaning (Initiative #1 S3) — a multiplier on the *even recirculation* (the artificial
 * "UBI" demand pump in {@link DistributionSystem}). 1.0 = today's full even dividend ⇒
 * byte-identical; taper toward 0 to wean it in notches (1.0 → 0.5 → 0.25 → 0) and watch whether
 * competitive wages + welfare + owner spending keep the closed economy circulating, or whether it
 * pools and stalls — the empirical trigger for the VISION money-creation fork. **Only the even
 * split is weaned; the owner's draw ({@link OWNER_DIVIDEND_SHARE}) is untouched** (that's genuine
 * capitalist income, not the artificial pump). The un-distributed remainder stays as firm cash.
 * Real-world: removing a universal stimulus transfer to see if the market self-circulates.
 */
export const DIVIDEND_WEAN = 1;
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
 * Whether a business's stock target scales with its capital (see
 * {@link MarketSystem}'s effectiveTarget). OFF: the 14a seam is a pure no-op
 * (effectiveTarget = the archetype target).
 *
 * The 14a/14c theory was that scaling the target up with capital keeps
 * utilization invariant (target and capacity rise together) so the invest loop
 * doesn't self-extinguish. Phase 15 E3 measured it empirically on a 2-year
 * full-agentic run, now that producers actually survive (B) and head-count drives
 * output (E2): turning it ON was *worse* — it pulled a firm into insolvency
 * earlier and left capital lower, not higher. So it stays OFF. The invest loop
 * fires and deepens capital materially anyway (≈3× baseline over the first year,
 * now that removing the produce exploit unmasked utilization), then decays slowly
 * over multiple years as depreciation outpaces a maturing city's reinvestment —
 * a real (not self-sustaining) productivity engine, with multi-year firm churn
 * handled by business entry/exit (slice D) rather than by inflating buffers.
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
 * Phase 17 — BRAND equity: the demand-side twin of productive capital. A firm spends
 * cash (the `brand` lever) to build a brand stock that lifts residents'
 * willingness-to-pay at that firm, with diminishing returns + daily decay — exactly
 * the {@link CAPITAL_BASELINE} / {@link CAPITAL_OUTPUT_ELASTICITY} /
 * {@link CAPITAL_DEPRECIATION_RATE} shape, mirrored on the demand side. All default
 * OFF/no-op: `BRAND_DEMAND_ELASTICITY = 0` ⇒ brandFactor ≡ 1 ⇒ no lift, and brand is
 * never seeded ⇒ a no-spend city sits at baseline forever (byte-identical to pre-17).
 */
export const BRAND_BASELINE = 100; // demand-capital scale, twin of CAPITAL_BASELINE
export const BRAND_DEMAND_ELASTICITY = 0.3; // Hook A master knob. Live since 17d (bench frozen at 0).
export const BRAND_UNITS_ELASTICITY = 0; // Hook B (units/visit) — OFF for all of Phase 17.
export const BRAND_DEPRECIATION_RATE = 0.01; // daily decay of above-baseline brand (≈ capital)
export const BRAND_PER_DOLLAR = 1; // cash -> stock; keeps brand on the capital scale
export const BRAND_DEMAND_CAP = 4; // headroom for the (inert) Hook B, separate from WEALTH_DEMAND_CAP
export const BRAND_SURPLUS_FRACTION = 0.25; // share of surplus to brand, taken BEFORE invest (17d split)
/**
 * The head-count at which a business counts as "fully staffed" for production.
 * Output scales with min(1, employees / this): with no workers a business makes
 * nothing (the fix for empty producers shipping full output, P10-3), and it
 * reaches its full ceiling once staffed to this level.
 *
 * Phase 15 E2 — raised from 1 to 2 so head-count, not mere presence, drives
 * output: a fully-crewed producer (2 workers) makes its full `maxPerDay`, but a
 * producer poached down to 1 worker makes only half — which is what makes losing
 * staff a real cost (the retention incentive behind the labour market) and makes
 * `hire` a genuine recovery lever. Kept equal to {@link DESIRED_HEADCOUNT} so the
 * two crew a firm *wants* are exactly the two its output needs — no unproductive
 * overhead. The seeded city now staffs every producing business to this level
 * (cityGen), so brain-off output is unchanged: 2 workers → laborFactor 1 → today's
 * `maxPerDay`, exactly as the old 1-worker/LABOR_FULL_STAFF=1 city produced.
 */
export const LABOR_FULL_STAFF = 2;
/**
 * Phase 15 A — how many workers a business *wants* on staff, and so the hiring-
 * capacity cap a job-hunting resident sees: a firm advertises a vacancy only
 * while `employeeIds.length < this`. This is the fix for the labour drain
 * (P10-3): without a cap every agentic resident piles into the single top-paying
 * storefront, stripping the producers of staff until the supply chain collapses
 * (producers → 0 workers → 0 output). With the cap, the storefronts fill and the
 * rest of the labour stays in production, so the chain survives agentic play.
 *
 * Real-world: a diner has only so many shifts to offer; once they're filled it
 * stops taking applications, and the next worker looks elsewhere. Decoupled from
 * {@link LABOR_FULL_STAFF} (output) for now — output still saturates at one
 * worker — so this changes only *agentic job mobility*, never brain-off
 * production. (E2 will couple them so a poached worker is a real output loss.)
 */
export const DESIRED_HEADCOUNT = 2;
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
/**
 * The owner-dividend share the CEO benchmark runs at — frozen *off* (0), separate
 * from the live-game {@link OWNER_DIVIDEND_SHARE}. The benchmark measures one
 * thing: how well a mind runs a single firm, read off that firm's net worth.
 * The owner dividend is a wealth-*distribution* feature (it moves profit from firm
 * equity to the owner's pocket), orthogonal to running skill — and because it
 * concentrates wealth it perturbs city-wide demand chaotically, muddying the
 * clean rules-vs-off comparison. Freezing it off (all profit stays in the firm, so
 * net worth fully reflects stewardship) keeps the score a clean skill signal, just
 * as {@link BENCH_WEALTH_ELASTICITY} freezes the demand knob.
 */
export const BENCH_OWNER_DIVIDEND_SHARE = 0;
/**
 * Phase 17 — the CEO bench freezes the brand-demand COEFFICIENT (not the lever): a
 * CEO may spend on `brand`, but its demand payoff is frozen to 0 so re-tuning the
 * live {@link BRAND_DEMAND_ELASTICITY} never silently moves historical scores — the
 * same discipline as {@link BENCH_WEALTH_ELASTICITY} / {@link BENCH_OWNER_DIVIDEND_SHARE}.
 * Un-frozen deliberately as the versioned Phase-16 slice-4 bench re-baseline.
 */
export const BENCH_BRAND_DEMAND_ELASTICITY = 0;
/**
 * Phase 16 slice 4 — the GROWTH benchmark (opt-in `growth: true`). The classic
 * bench above is a *preservation* scenario ($50k start) whose flaw is that a CEO
 * can "win" by simply hoarding cash. The growth bench instead starts the firm with
 * modest working capital and scores **productive value built** (capital + brand +
 * inventory + cash capped at working capital), so parked cash can't win and the
 * only way to score is to grow a bigger, more productive firm. These two knobs are
 * frozen *separately* from the live game (like the BENCH_* knobs above) so the
 * growth score stays reproducible as the live economy is re-tuned.
 */
export const BENCH_GROWTH_START_CAPITAL = 5_000;
/** The brand-demand growth path the growth bench runs at (the live lever, frozen here). */
export const BENCH_GROWTH_BRAND_ELASTICITY = 0.3;
