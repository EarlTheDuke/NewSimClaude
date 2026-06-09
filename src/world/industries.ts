import type { BusinessKind, ResourceKind } from "./types";

/**
 * The **industry registry** (Initiative #2 slice 4) — the single source of the supply
 * chain's shape, and the home of every table derived from it. Slices 4a–4c moved the
 * seeded data here and derived `ARCHETYPES` / `PRODUCER_OF` / prices / resources from it;
 * slice 4d makes those derived tables **mutable singletons** that {@link resetIndustries}
 * rebuilds in place, so a city can be built with **extra industries** registered at
 * construction time and have them flow through the whole economic core.
 *
 * Determinism + isolation: the live registries are reset to the **seeded** set plus the
 * current city's extras at the start of every `createCity` build (reset-then-apply is
 * idempotent, so a seeded city is byte-identical and two identical builds match exactly).
 * Constraint: all live cities in one process share this registry, so they must share the
 * same industry set — `createCity` enforces that by resetting per build. Deliberately
 * **stable arrays**, iterated in order (never keyed-object / Map order — the sacred rule).
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
   * Rentier role (slice 4b) — collects rent, runs no production, holds a larger cash reserve,
   * and is spared physical disasters (no premises stock to burn).
   */
  collectsRent?: boolean;
  /**
   * Capital-goods / construction-materials vendor (slice 4b) — sells equipment to investing firms
   * and materials for home-building.
   */
  capitalGoodsVendor?: boolean;
  /**
   * Storefront retail anchor price (slice 4c) — the reference the discretionary demand model
   * reckons against. Set only on storefronts; absent ⇒ not resident-facing.
   */
  retailPrice?: number;
  /**
   * The Bank role (Initiative C / Phase 18) — a conserving financial holder: it lends, accrues
   * interest, holds a larger reserve, and is never bankrupted. Set only on the bank archetype,
   * which is registered solely when a city is built with `includeBank`.
   */
  bank?: boolean;
  /**
   * The Port role (Initiative C / C4 path a — external trade) — the city's conserving window to
   * the rest of the world. Its cash is the *foreign buyers'* money (counted in `totalMoney()`, so
   * conservation holds to the cent), never city profit: it pays no dividend, is exempt from the
   * welfare levy and bank savings yield, and is never bankrupted (an empty port = foreign demand
   * exhausted, not a business failure). Set only on the port archetype, registered solely when a
   * city is built with `includePort`.
   */
  port?: boolean;
}

/** The economic identity a system reads by kind — the IndustryDef minus its `kind` tag. */
export interface Archetype {
  consumes?: ResourceKind;
  produces?: ResourceKind;
  sellsToResidents: boolean;
  target: number;
  maxPerDay: number;
  collectsRent?: boolean;
  capitalGoodsVendor?: boolean;
  bank?: boolean;
  port?: boolean;
}

/** A tradeable intermediate good and its starting B2B price ($/unit). */
export interface ResourceDef {
  kind: ResourceKind;
  basePrice: number;
}

/**
 * The seeded seven, in supply-chain order:
 *   farm → grain → bakery → food → diner → meals (to residents)
 *   mine → materials → factory → wares → goods (to residents)
 *   landlord collects rent and runs no production.
 */
export const SEEDED_INDUSTRIES: readonly IndustryDef[] = [
  { kind: "farm", produces: "grain", sellsToResidents: false, target: 50, maxPerDay: 36 },
  { kind: "mine", produces: "materials", sellsToResidents: false, target: 24, maxPerDay: 22 },
  { kind: "bakery", consumes: "grain", produces: "food", sellsToResidents: false, target: 40, maxPerDay: 35 },
  { kind: "factory", consumes: "materials", produces: "wares", sellsToResidents: false, target: 24, maxPerDay: 22, capitalGoodsVendor: true },
  { kind: "diner", consumes: "food", sellsToResidents: true, target: 40, maxPerDay: 34, retailPrice: 18 },
  { kind: "goods", consumes: "wares", sellsToResidents: true, target: 24, maxPerDay: 21, retailPrice: 34 },
  { kind: "landlord", sellsToResidents: false, target: 0, maxPerDay: 0, collectsRent: true },
];

/**
 * The Bank archetype (Initiative C / Phase 18) — a non-producing financial holder, registered into
 * the live registry ONLY when a city is built with `includeBank` (never seeded by default, so the
 * default seven-business city is untouched). Its `kind` is outside the seeded union, so it reaches
 * the registry through one contained cast — exactly like a data-driven extra industry (slice 4d).
 */
export const BANK_INDUSTRY: IndustryDef = {
  kind: "bank" as BusinessKind,
  sellsToResidents: false,
  target: 0,
  maxPerDay: 0, // produces nothing ⇒ never staffed (desiredHeadcount 0), no capacity
  bank: true,
};

/**
 * The Port archetype (Initiative C / C4 path a — external trade) — a non-producing trade
 * counterparty, registered into the live registry ONLY when a city is built with `includePort`
 * (never seeded by default, so the default city is untouched). Same contained-cast pattern as the
 * Bank. Real-world: the dock and customs house where the rest of the world buys the town's surplus
 * output — and sells it what it can't make enough of.
 */
export const PORT_INDUSTRY: IndustryDef = {
  kind: "port" as BusinessKind,
  sellsToResidents: false,
  target: 0,
  maxPerDay: 0, // produces nothing ⇒ never staffed (desiredHeadcount 0), no capacity
  port: true,
};

/** The seeded four, in chain order (grain/materials are primary; food/wares are processed). */
export const SEEDED_RESOURCES: readonly ResourceDef[] = [
  { kind: "grain", basePrice: 4 },
  { kind: "materials", basePrice: 5 },
  { kind: "food", basePrice: 8 },
  { kind: "wares", basePrice: 11 },
];

// --- Live registries + derived tables (mutated in place by rebuild, so every importer's
//     reference stays valid). Populated by the module-load resetIndustries() below. ---

/** The live industries for the current build — seeded plus this city's extras. */
export const INDUSTRY_REGISTRY: IndustryDef[] = [];
/** The live resources for the current build. */
export const RESOURCE_REGISTRY: ResourceDef[] = [];
/** The live resource-kind list (chain order) — what MarketSystem/disasters iterate. */
export const RESOURCE_KINDS: ResourceKind[] = [];
/** Per-kind economic identity, by lookup. */
export const ARCHETYPES: Record<BusinessKind, Archetype> = {} as Record<BusinessKind, Archetype>;
/** Each resource's seeded producer business id (the `biz_<kind>` convention; seed/observability only). */
export const PRODUCER_OF: Record<ResourceKind, string> = {} as Record<ResourceKind, string>;
/** Each resource's starting B2B price ($/unit). */
export const BASE_RESOURCE_PRICE: Record<ResourceKind, number> = {} as Record<ResourceKind, number>;
/** Each storefront kind's retail anchor price. */
export const RETAIL_REFERENCE_PRICE: Partial<Record<BusinessKind, number>> = {};

/** Recompute the derived tables in place from the live registries — deterministic (array order). */
function rebuild(): void {
  clear(ARCHETYPES);
  for (const d of INDUSTRY_REGISTRY) {
    ARCHETYPES[d.kind] = {
      consumes: d.consumes,
      produces: d.produces,
      sellsToResidents: d.sellsToResidents,
      target: d.target,
      maxPerDay: d.maxPerDay,
      collectsRent: d.collectsRent,
      capitalGoodsVendor: d.capitalGoodsVendor,
      bank: d.bank,
      port: d.port,
    };
  }

  RESOURCE_KINDS.length = 0;
  clear(PRODUCER_OF);
  clear(BASE_RESOURCE_PRICE);
  for (const r of RESOURCE_REGISTRY) {
    RESOURCE_KINDS.push(r.kind);
    BASE_RESOURCE_PRICE[r.kind] = r.basePrice;
    const producer = INDUSTRY_REGISTRY.find((d) => d.produces === r.kind);
    if (producer) PRODUCER_OF[r.kind] = `biz_${producer.kind}`; // a resource with no producer is simply unlisted
  }

  clear(RETAIL_REFERENCE_PRICE);
  for (const d of INDUSTRY_REGISTRY) {
    if (d.retailPrice !== undefined) RETAIL_REFERENCE_PRICE[d.kind] = d.retailPrice;
  }
}

function clear(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) delete obj[k];
}

/**
 * Reset the live registries to the seeded set plus a city's extras, then rebuild the derived
 * tables. Called by {@link createCity} before it builds, so a run reflects exactly its configured
 * industries. With no extras it restores the seeded economy verbatim (byte-identical). Slice 4d.
 */
export function resetIndustries(
  extraIndustries: readonly IndustryDef[] = [],
  extraResources: readonly ResourceDef[] = [],
): void {
  INDUSTRY_REGISTRY.length = 0;
  INDUSTRY_REGISTRY.push(...SEEDED_INDUSTRIES, ...extraIndustries);
  RESOURCE_REGISTRY.length = 0;
  RESOURCE_REGISTRY.push(...SEEDED_RESOURCES, ...extraResources);
  rebuild();
}

resetIndustries(); // populate the seeded tables at module load
