import type { BusinessKind, ResourceKind } from "./types";

/**
 * The **industry registry** (Initiative #2 slice 4a) — the single source of the seeded
 * supply chain's shape. Until now the per-kind archetype table and the per-resource
 * price/producer maps were hand-maintained `Record`s the compiler forced exhaustive
 * over the {@link BusinessKind}/{@link ResourceKind} unions; this consolidates that data
 * into two stable arrays, and {@link ARCHETYPES} / {@link PRODUCER_OF} (archetypes.ts)
 * and {@link BASE_RESOURCE_PRICE} (constants.ts) are now **derived** from them.
 *
 * Pure data move — the seeded city is byte-identical (the 399-test suite is the guard).
 * Deliberately a **stable array**, iterated in order (never keyed-object / Map order — the
 * sacred no-iteration-surprise rule). Slice 4d lets new industries append/register here,
 * so genuinely new kinds, resources, and chains can exist without touching core logic.
 *
 * Real-world: the roster of trades a town supports — each row a line of business: what it
 * buys, what it makes, whether it sells to the public, and how much it can turn out a day.
 */
export interface IndustryDef {
  kind: BusinessKind;
  /** Resource bought B2B and turned 1:1 into output (processors + storefronts). */
  consumes?: ResourceKind;
  /** Resource produced — from nothing (primary producer) or from `consumes` (processor). */
  produces?: ResourceKind;
  /** Storefront: production tops up resident-sellable `inventory` rather than a resource stock. */
  sellsToResidents: boolean;
  /** Output stock level the business refills toward each day. */
  target: number;
  /** Hard per-day production / restock ceiling. */
  maxPerDay: number;
  /**
   * Rentier role (Initiative #2 slice 4b) — collects rent, runs no production, holds a larger
   * cash reserve, and is spared physical disasters (it has no premises stock to burn). Replaces
   * the scattered `kind === "landlord"` identity checks: logic keys off the role, not the name.
   */
  collectsRent?: boolean;
  /**
   * Capital-goods / construction-materials vendor (slice 4b) — the firm that sells equipment to
   * investing firms and materials for home-building. Replaces the `kind === "factory"` lookups.
   */
  capitalGoodsVendor?: boolean;
  /**
   * Storefront retail anchor price (slice 4c) — the reference the price-elastic discretionary
   * demand model reckons against. Source for `RETAIL_REFERENCE_PRICE` (and the seeded
   * `DINER_MEAL_PRICE`/`GOODS_PRICE`). Set only on storefronts; absent ⇒ not resident-facing.
   */
  retailPrice?: number;
}

/**
 * The seeded seven, in supply-chain order:
 *   farm → grain → bakery → food → diner → meals (to residents)
 *   mine → materials → factory → wares → goods (to residents)
 *   landlord collects rent and runs no production.
 */
export const INDUSTRY_REGISTRY: readonly IndustryDef[] = [
  { kind: "farm", produces: "grain", sellsToResidents: false, target: 50, maxPerDay: 36 },
  { kind: "mine", produces: "materials", sellsToResidents: false, target: 24, maxPerDay: 22 },
  { kind: "bakery", consumes: "grain", produces: "food", sellsToResidents: false, target: 40, maxPerDay: 35 },
  { kind: "factory", consumes: "materials", produces: "wares", sellsToResidents: false, target: 24, maxPerDay: 22, capitalGoodsVendor: true },
  { kind: "diner", consumes: "food", sellsToResidents: true, target: 40, maxPerDay: 34, retailPrice: 18 },
  { kind: "goods", consumes: "wares", sellsToResidents: true, target: 24, maxPerDay: 21, retailPrice: 34 },
  { kind: "landlord", sellsToResidents: false, target: 0, maxPerDay: 0, collectsRent: true },
];

/** A tradeable intermediate good and its starting B2B price ($/unit) — source for {@link BASE_RESOURCE_PRICE}. */
export interface ResourceDef {
  kind: ResourceKind;
  basePrice: number;
}

/** The seeded four, in chain order (grain/materials are primary; food/wares are processed). */
export const RESOURCE_REGISTRY: readonly ResourceDef[] = [
  { kind: "grain", basePrice: 4 },
  { kind: "materials", basePrice: 5 },
  { kind: "food", basePrice: 8 },
  { kind: "wares", basePrice: 11 },
];
