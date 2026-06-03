import type { BusinessKind, ResourceKind } from "./types";

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

// maxPerDay is right-sized so each chain's real daily throughput (food chain
// ~26 units/day, wares chain ~12 units/day) lands inside the pricing model's
// neutral band — prices settle near base instead of pinning to a bound. target
// is the small output buffer each business refills toward; kept lean so the
// chain procures steadily every day (smooth utilization = stable prices) rather
// than in lumpy bursts off a large stockpile.
export const ARCHETYPES: Record<BusinessKind, Archetype> = {
  farm: { produces: "grain", sellsToResidents: false, target: 50, maxPerDay: 50 },
  mine: { produces: "materials", sellsToResidents: false, target: 24, maxPerDay: 24 },
  bakery: { consumes: "grain", produces: "food", sellsToResidents: false, target: 40, maxPerDay: 45 },
  factory: { consumes: "materials", produces: "wares", sellsToResidents: false, target: 20, maxPerDay: 24 },
  diner: { consumes: "food", sellsToResidents: true, target: 40, maxPerDay: 45 },
  goods: { consumes: "wares", sellsToResidents: true, target: 20, maxPerDay: 24 },
  landlord: { sellsToResidents: false, target: 0, maxPerDay: 0 },
};

/** The single producer business id for each tradeable resource. */
export const PRODUCER_OF: Record<ResourceKind, string> = {
  grain: "biz_farm",
  materials: "biz_mine",
  food: "biz_bakery",
  wares: "biz_factory",
};
