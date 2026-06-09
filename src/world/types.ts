/**
 * Phase 1 world model — the small, watchable city.
 *
 * Everything here is plain serializable data. Behaviour lives in systems
 * (Needs, Brain, Movement, Economy); the World is the shared state they read
 * and mutate. Keeping data and logic apart keeps snapshots trivial and the
 * simulation deterministic.
 */

/** A point on the road network. Buildings attach to a node. */
export interface MapNode {
  id: string;
  x: number;
  y: number;
}

/** An undirected road segment between two nodes. */
export interface Road {
  a: string;
  b: string;
}

export type LocationType = "home" | "workplace";

/** A building. Sits at a map node; residents travel to its node. */
export interface Location {
  id: string;
  name: string;
  type: LocationType;
  nodeId: string;
  /** Daily rent for a home (resident -> landlord). Absent/0 for workplaces. */
  rent?: number;
  /**
   * The home's reference rent (HP2 dynamic rent) — what it was seeded/built at. The
   * mutable `rent` drifts around this with housing scarcity; this is the stable base
   * the multiplier reckons against (like a business's baseWagePerTick). Captured
   * lazily the first time dynamic rent runs; absent ⇒ read as `rent` ⇒ byte-identical
   * when dynamic rent is off.
   */
  baseRent?: number;
  /** Max occupants for a home (HP1) — its dwelling size. Absent for workplaces. */
  capacity?: number;
}

/**
 * The seven business archetypes form a supply chain (Phase 4):
 *   farm → grain → bakery → food → diner → meals (sold to residents)
 *   mine → materials → factory → wares → goods (sold to residents)
 *   landlord collects rent and runs no production.
 */
export type BusinessKind =
  | "diner"
  | "goods"
  | "landlord"
  | "farm"
  | "mine"
  | "bakery"
  | "factory";

/** Tradeable intermediate goods that flow between businesses (Phase 4). */
export type ResourceKind = "grain" | "materials" | "food" | "wares";

/**
 * Initiative #2 slice 4d note: the seeded kinds/resources above stay the closed unions so all
 * typed code (and `noUncheckedIndexedAccess`) keeps its safety. A city's **extra** industries
 * (registered at build time via `resetIndustries`) carry kinds outside these unions — they reach
 * the registry through a single contained cast at the registration boundary, and the sim core
 * handles them by **capability flag** (slice 4b), never by kind identity. So new industries work
 * at runtime without widening every `Record<BusinessKind, …>` lookup to a possibly-undefined one.
 */

/**
 * An enterprise with cash, a simple P&L, and (for diner/goods) something to
 * sell. Producers/processors hold resource stock and trade it B2B; the landlord
 * collects rent and has no storefront visits.
 */
export interface Business {
  id: string;
  name: string;
  kind: BusinessKind;
  /**
   * Resident who owns the business (Phase 10g). Each day the business's
   * profit above its working-capital reserve is paid to this resident as
   * personal income, so profit becomes spendable money instead of pooling.
   */
  ownerId: string;
  /** Building the business operates from (employees commute here). */
  locationId: string;
  cash: number;
  /** Units of resident-sellable good on hand (diner meals / goods wares). */
  inventory: number;
  /** Price charged per unit sold. */
  price: number;
  /** Resident ids on payroll. */
  employeeIds: string[];
  /** Per-tick wage paid to each employee while they are working here — the firm's *posted* wage. */
  wagePerTick: number;
  /**
   * The role's immutable *base* wage (Phase 15 A) — what this firm was seeded
   * paying. `wagePerTick` is the mutable *posted* wage that the setWage lever
   * moves within `[base, base*MAX_WAGE_MULT]`; this base is the stable reference
   * the wage cap and resident raise-caps read, so a bidding war can't compound
   * wages upward without bound. Seeded equal to `wagePerTick`; absent on
   * pre-Phase-15 saves, read as `wagePerTick` (an old town resumes with base =
   * its posted wage). Never money.
   */
  baseWagePerTick?: number;
  /** Running P&L since the start of the run. */
  pnl: ProfitAndLoss;
  /**
   * Fraction of its daily distributable surplus this firm pays out (dividends +
   * recirculation); the rest is retained as cash to reinvest (Phase 16). Set by
   * the `setPayout` lever; read by DistributionSystem. Undefined ⇒ 1.0 (full
   * distribution) — byte-identical to pre-Phase-16.
   */
  payoutRate?: number;
  /** B2B resource stock on hand, keyed by resource (Phase 4). */
  resources: Partial<Record<ResourceKind, number>>;
  /** False once the business has gone bankrupt; it stops trading. */
  active: boolean;
  /** Consecutive day-boundaries observed below the cash floor (Phase 4c). 0/absent = solvent. */
  insolventDays?: number;
  /**
   * Productive capital — the equipment/plant a business owns (Phase 12). Higher
   * capital lifts output per worker; it is bought with cash from the factory and
   * depreciates daily. Quoted relative to `CAPITAL_BASELINE` (baseline = today's
   * output). Inert until Phase 12b wires it into production; absent on pre-12
   * saves, read as the baseline. Never money — like `inventory` it is a non-cash
   * quantity, so the conservation invariant is untouched.
   */
  capital?: number;
  /**
   * Cumulative cash this business has spent on capital goods via the invest
   * lever (Phase 12d) — its running investment expenditure. {@link MacroSystem}
   * differences it day-over-day into the investment component of GDP
   * (GDP = Consumption + Investment). Absent until the firm first invests, read
   * as 0. Never money itself — it only *records* spend that already moved via
   * {@link World.transfer}, so the conservation invariant is untouched.
   */
  capitalInvested?: number;
  /**
   * Brand equity — the demand-side twin of {@link capital} (Phase 17). Built by
   * spending cash on marketing/quality (the `brand` lever); it lifts residents'
   * willingness-to-pay at this firm and depreciates daily like capital. Quoted
   * relative to `BRAND_BASELINE`; absent ⇒ read as baseline ⇒ no demand lift,
   * byte-identical to pre-17. Never money — a non-cash quantity like capital, so
   * the conservation invariant is untouched. NEVER seeded/defaulted: a brain-off
   * snapshot must omit it entirely.
   */
  brand?: number;
  /**
   * Cumulative cash spent on brand via the `brand` lever (Phase 17) — the
   * demand-side mirror of {@link capitalInvested}, for observation/ROI. Absent ⇒ 0.
   * Never money (it only records spend that already moved via World.transfer).
   * NEVER seeded.
   */
  brandSpent?: number;
  /**
   * Outstanding debt to the Bank (Initiative C / Phase 18 credit) — **non-cash bookkeeping**, never
   * money. `principal` is what was borrowed and not yet repaid; `accruedInterest` is interest the
   * firm owed but couldn't pay in cash (a claim, not minted money); `originDay` is informational
   * (interest is flat `principal × rate`, time-independent); `borrowed` is the cumulative draw, for
   * observation. Money only ever moves via `World.transfer` (borrow `bank→firm`, interest/repay
   * `firm→bank`), so `totalMoney()` is untouched. Absent ⇒ debt-free; an emptied loan is deleted to
   * restore the byte-identical shape. NEVER seeded — the default city carries no debt.
   */
  debt?: { principal: number; accruedInterest: number; originDay: number; borrowed?: number };
}

export interface ProfitAndLoss {
  revenue: number;
  /** Wages paid to staff (labour cost only). Profit payouts live in {@link distributed}. */
  wagesPaid: number;
  rentCollected: number;
  /**
   * Profit paid out to residents/owner as dividends + even recirculation by the
   * DistributionSystem (Phase 16). Tracked separately from {@link wagesPaid} so a
   * firm's labour cost isn't conflated with its profit payout — which keeps the CEO
   * observation's wage signal a clean labour cost. Never money itself; it only
   * records cash that already moved via World.transfer (conservation untouched).
   */
  distributed: number;
  /**
   * Interest + principal paid to the Bank during the day (Initiative C / Phase 18 credit) — a true
   * cash outflow (a `firm→bank` transfer), tracked separately so the observation can net financing
   * out of `dayProfit`/`dayRent`. Records cash that already moved via World.transfer (conservation
   * untouched). Absent ⇒ 0 (debt-free / pre-credit), byte-identical.
   */
  debtService?: number;
  /**
   * Cumulative revenue from EXPORT sales to the port (Initiative C / C4a) — cash the rest of the
   * world paid this firm for goods shipped abroad. A subset of {@link revenue} (export sales book
   * into both), broken out so {@link MacroSystem} can count the exports term of GDP without
   * polluting consumption, and so a mind can see its export income (slice a4). Records cash that
   * already moved via World.transfer (`port→firm` — conservation untouched). Absent ⇒ 0 (no port /
   * never exported), byte-identical. NEVER seeded.
   */
  exportRevenue?: number;
}

/**
 * What a resident is currently doing. Drives colour in the renderer and the
 * restorative effects in NeedsSystem.
 */
export type Activity =
  | "sleeping"
  | "working"
  | "eating"
  | "socializing"
  | "commuting"
  | "idle";

/**
 * Where a resident came from (HP3 population growth). The seeded population has
 * none; growth tags each new arrival — "migrant" for an in-migrant, "born" for a
 * newborn. Cosmetic/analytic only — it never affects money or the id namespace
 * (ids stay numeric `res_N`).
 */
export type ResidentOrigin = "migrant" | "born";

/** Needs are 0 (critical) .. 100 (fully satisfied). */
export interface Needs {
  hunger: number; // 100 = full, 0 = starving
  energy: number; // 100 = rested, 0 = exhausted
  social: number; // 100 = content, 0 = lonely
}

/**
 * A resident's working pattern (Phase 10a). Hours are 0..23 and `endHour` is
 * exclusive. `daysOff` lists weekdays (0..6, matching TimeSystem's dayOfWeek)
 * the resident does not work — their free days.
 */
export interface WorkSchedule {
  startHour: number;
  endHour: number;
  daysOff: number[];
}

/** Live movement state along the road graph. */
export interface Movement {
  x: number;
  y: number;
  /** Node the resident is standing at (when not between nodes). */
  atNodeId: string;
  /** Remaining nodes to walk through to reach the destination. */
  path: string[];
  /** Distance already covered toward path[0], in world units. */
  segmentProgress: number;
}

export interface Resident {
  id: string;
  name: string;
  money: number;
  homeId: string;
  jobId: string; // business id employing this resident
  /** Wage this resident earns per tick while working. 0 when jobless. */
  wagePerTick: number;
  /** Owns a vehicle: commutes faster and can reach farther jobs. */
  hasVehicle: boolean;
  /** When this resident works (Phase 10a): drives the daily work decision. */
  schedule: WorkSchedule;
  /** Wages accrued since the last paycheck settlement; resets daily at midnight. */
  earnedThisPeriod: number;
  /** The most recent settled day's earnings — the dossier's "last paycheck". */
  lastPaycheck: number;
  /** A self-set cash buffer the resident keeps before splurging (Phase 10b). */
  savingsGoal: number;
  /** Count of discretionary luxuries bought — a visible marker of a thriving life. */
  luxuriesOwned: number;
  needs: Needs;
  activity: Activity;
  /** Location the resident is currently heading to / occupying. */
  destinationId: string;
  move: Movement;
  /** Consecutive day-boundaries the full rent went unpaid (Phase 4c eviction). 0/absent = current. */
  rentMissedDays?: number;
  /**
   * How this resident entered the world (HP3). Absent for the seeded population
   * (⇒ byte-identical to pre-HP3); "migrant"/"born" on residents added by growth.
   * Cosmetic/analytic only — never money, never part of the id namespace.
   */
  origin?: ResidentOrigin;
  /**
   * Age in years (HP3 mortality). Absent until mortality engages — the seeded
   * cohort is lazily given a spread of realistic ages the first time, and new
   * arrivals get an explicit age at creation. A resident dies at MAX_AGE_YEARS,
   * their estate passing to an heir. Absent ⇒ byte-identical to pre-HP3 / mortality-off.
   */
  age?: number;
  /**
   * The id of this resident's parent (HP3-7 births) — lineage, for analytics/render.
   * Absent for the seeded cohort and in-migrants. Cosmetic only; never money.
   */
  parentId?: string;
}

/** Serializable slice owned by the World. */
export interface WorldSnapshot {
  nodes: MapNode[];
  roads: Road[];
  locations: Location[];
  businesses: Business[];
  residents: Resident[];
}
