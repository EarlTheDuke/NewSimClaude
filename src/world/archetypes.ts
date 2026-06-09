import type { BusinessKind, ResourceKind } from "./types";
import { DESIRED_HEADCOUNT } from "../systems/constants";
import { INDUSTRY_REGISTRY, RESOURCE_REGISTRY } from "./industries";

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
 *
 * Phase 14: maxPerDay is sized TIGHT — just above each chain's real daily
 * drawdown — so steady-state utilization runs ~0.85 and demand presses against
 * capacity. That's what makes investment productive (the Solow engine). These
 * numbers are calibrated empirically (14a probe) and validated in the soak.
 *
 * Initiative #2 slice 4a: the values are no longer a hand-keyed Record but are
 * **derived from {@link INDUSTRY_REGISTRY}** (the single source) — a pure data move,
 * byte-identical. As a lookup table (`ARCHETYPES[kind]`) its key order is irrelevant.
 */
export interface Archetype {
  consumes?: ResourceKind;
  produces?: ResourceKind;
  sellsToResidents: boolean;
  target: number;
  maxPerDay: number;
  /** Rentier role (slice 4b) — collects rent, no production, larger reserve, disaster-spared. */
  collectsRent?: boolean;
  /** Capital-goods / construction-materials vendor (slice 4b) — sells equipment + build materials. */
  capitalGoodsVendor?: boolean;
}

export const ARCHETYPES = Object.fromEntries(
  INDUSTRY_REGISTRY.map((d) => [
    d.kind,
    {
      consumes: d.consumes,
      produces: d.produces,
      sellsToResidents: d.sellsToResidents,
      target: d.target,
      maxPerDay: d.maxPerDay,
      collectsRent: d.collectsRent,
      capitalGoodsVendor: d.capitalGoodsVendor,
    } satisfies Archetype,
  ]),
) as Record<BusinessKind, Archetype>;

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

/**
 * The single seeded producer business id for each tradeable resource — derived from
 * the registry (the kind that produces it, at its canonical `biz_<kind>` seed id).
 * The live supply chain finds producers by *kind* ({@link MarketSystem}'s pool), so
 * this is the seed/observability convention, not the runtime lookup.
 */
export const PRODUCER_OF = Object.fromEntries(
  RESOURCE_REGISTRY.map((r) => {
    const producer = INDUSTRY_REGISTRY.find((d) => d.produces === r.kind);
    if (!producer) throw new Error(`PRODUCER_OF: no industry produces "${r.kind}"`);
    return [r.kind, `biz_${producer.kind}`];
  }),
) as Record<ResourceKind, string>;
