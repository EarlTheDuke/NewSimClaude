import type { BusinessKind, ResourceKind } from "./types";
import { DESIRED_HEADCOUNT } from "../systems/constants";

/**
 * The economic identity of each business archetype (Phase 4). The MarketSystem
 * reads this table to run daily, demand-driven procurement and production:
 *
 *  - `consumes`: the resource this business buys B2B and turns 1:1 into output.
 *  - `produces`: the resource it makes — primary producers (farm, mine) make it
 *    from nothing; processors (bakery, factory) make it from `consumes`.
 *  - `sellsToResidents`: storefronts (diner, goods). Their production tops up
 *    the resident-sellable `inventory` rather than a resource stock.
 *  - `target`: the stock level the business refills its OUTPUT toward each day
 *    (resident `inventory` for storefronts, else `resources[produces]`). Refill
 *    is demand-driven: it only makes/buys what sell-through drew down, so the
 *    whole chain self-sizes to what residents actually consume.
 *  - `maxPerDay`: a hard per-day production/restock ceiling.
 */
export interface Archetype {
  consumes?: ResourceKind;
  produces?: ResourceKind;
  sellsToResidents: boolean;
  target: number;
  maxPerDay: number;
}

// Phase 14: maxPerDay is sized TIGHT — just above each chain's real daily
// drawdown — so steady-state utilization runs ~0.85 and demand presses against
// capacity. That's what makes investment productive: as wealth-elastic demand
// grows, capacity binds and a firm reinvests to chase it (the Solow engine). The
// pre-14 calibration left ~75% slack (util ~0.4), so investing was pointless and
// the invest lever self-extinguished. `target` is the inventory buffer (≥ peak
// demand and ≥ maxPerDay) so a busy day doesn't empty the shelves; storefronts
// are the tightest link so they bind — and fund investment — first, and the chain
// then deepens demand-end-backward. These numbers are calibrated empirically
// (14a probe) and validated in the soak; capacity is the only thing the invest
// lever raises, so prices read utilization against effectiveCapacity, not maxPerDay.
export const ARCHETYPES: Record<BusinessKind, Archetype> = {
  farm: { produces: "grain", sellsToResidents: false, target: 50, maxPerDay: 36 },
  mine: { produces: "materials", sellsToResidents: false, target: 24, maxPerDay: 22 },
  bakery: { consumes: "grain", produces: "food", sellsToResidents: false, target: 40, maxPerDay: 35 },
  factory: { consumes: "materials", produces: "wares", sellsToResidents: false, target: 24, maxPerDay: 22 },
  diner: { consumes: "food", sellsToResidents: true, target: 40, maxPerDay: 34 },
  goods: { consumes: "wares", sellsToResidents: true, target: 24, maxPerDay: 21 },
  landlord: { sellsToResidents: false, target: 0, maxPerDay: 0 },
};

/**
 * How many workers a business wants on staff (Phase 15 A). A *producing* business
 * (anything with a daily output ceiling) wants {@link DESIRED_HEADCOUNT}; the
 * landlord produces nothing — it runs on rent — so it wants no crew, which frees
 * the seeded workforce to fully staff the supply chain instead. Drives both the
 * `hiring` signal a job-hunting resident sees and the `understaffed` cue a firm's
 * mind reads to decide whether to bid wages up.
 */
export function desiredHeadcount(kind: BusinessKind): number {
  return ARCHETYPES[kind].maxPerDay > 0 ? DESIRED_HEADCOUNT : 0;
}

/** The single producer business id for each tradeable resource. */
export const PRODUCER_OF: Record<ResourceKind, string> = {
  grain: "biz_farm",
  materials: "biz_mine",
  food: "biz_bakery",
  wares: "biz_factory",
};
