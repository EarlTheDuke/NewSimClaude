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
 * An enterprise with cash, a simple P&L, and (for diner/goods) something to
 * sell. Producers/processors hold resource stock and trade it B2B; the landlord
 * collects rent and has no storefront visits.
 */
export interface Business {
  id: string;
  name: string;
  kind: BusinessKind;
  /** Building the business operates from (employees commute here). */
  locationId: string;
  cash: number;
  /** Units of resident-sellable good on hand (diner meals / goods wares). */
  inventory: number;
  /** Price charged per unit sold. */
  price: number;
  /** Resident ids on payroll. */
  employeeIds: string[];
  /** Per-tick wage paid to each employee while they are working here. */
  wagePerTick: number;
  /** Running P&L since the start of the run. */
  pnl: ProfitAndLoss;
  /** B2B resource stock on hand, keyed by resource (Phase 4). */
  resources: Partial<Record<ResourceKind, number>>;
  /** False once the business has gone bankrupt; it stops trading. */
  active: boolean;
  /** Consecutive day-boundaries observed below the cash floor (Phase 4c). 0/absent = solvent. */
  insolventDays?: number;
}

export interface ProfitAndLoss {
  revenue: number;
  wagesPaid: number;
  rentCollected: number;
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
  needs: Needs;
  activity: Activity;
  /** Location the resident is currently heading to / occupying. */
  destinationId: string;
  move: Movement;
  /** Consecutive day-boundaries the full rent went unpaid (Phase 4c eviction). 0/absent = current. */
  rentMissedDays?: number;
}

/** Serializable slice owned by the World. */
export interface WorldSnapshot {
  nodes: MapNode[];
  roads: Road[];
  locations: Location[];
  businesses: Business[];
  residents: Resident[];
}
