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

export type BusinessKind = "diner" | "goods" | "landlord";

/**
 * An enterprise with cash, a simple P&L, and (for diner/goods) something to
 * sell. The landlord collects rent; it has no storefront visits.
 */
export interface Business {
  id: string;
  name: string;
  kind: BusinessKind;
  /** Building the business operates from (employees commute here). */
  locationId: string;
  cash: number;
  /** Units of sellable good on hand (diner/goods only). */
  inventory: number;
  /** Price charged per unit sold. */
  price: number;
  /** Resident ids on payroll. */
  employeeIds: string[];
  /** Per-tick wage paid to each employee while they are working here. */
  wagePerTick: number;
  /** Running P&L since the start of the run. */
  pnl: ProfitAndLoss;
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
  needs: Needs;
  activity: Activity;
  /** Location the resident is currently heading to / occupying. */
  destinationId: string;
  move: Movement;
}

/** Serializable slice owned by the World. */
export interface WorldSnapshot {
  nodes: MapNode[];
  roads: Road[];
  locations: Location[];
  businesses: Business[];
  residents: Resident[];
}
