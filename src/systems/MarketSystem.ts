import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, ResourceKind } from "../world/types";
import { ARCHETYPES, PRODUCER_OF } from "../world/archetypes";
import {
  BASE_RESOURCE_PRICE,
  PRICE_MIN_MULT,
  PRICE_MAX_MULT,
  PRICE_ADJUST_FRACTION,
  PRICE_REVERT_FRACTION,
  PRICE_REVERT_SNAP,
  LANDLORD_RESERVE,
  BUSINESS_RESERVE,
  PROFIT_DISTRIBUTION_CAP,
  CAPITAL_BASELINE,
  CAPITAL_OUTPUT_ELASTICITY,
  CAPITAL_DEPRECIATION_RATE,
  LABOR_FULL_STAFF,
} from "./constants";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];

/**
 * The B2B layer (Phase 4). Once per sim-day it runs the supply chain:
 *
 *   1. Procurement — each storefront/processor buys the input it's short on
 *      from that resource's sole producer, at the live market price. Money
 *      moves only via {@link World.transfer}, so the economy stays closed.
 *   2. Production — primary producers make their resource from nothing;
 *      processors turn inputs 1:1 into outputs; storefronts turn inputs into
 *      resident-sellable inventory. All demand-driven (refill toward target) and
 *      capped at each business's labour-/capital-limited capacity (Phase 12b),
 *      so the chain self-sizes to resident demand.
 *   3. Pricing — each resource's price nudges toward its supply/demand balance,
 *      bounded so it can never run away.
 *
 * Deterministic: fixed iteration order, integer quantities, no RNG. The price
 * book is the only persistent state and is part of the snapshot.
 */
export class MarketSystem implements System {
  readonly id = "market";
  private readonly prices: Record<ResourceKind, number> = { ...BASE_RESOURCE_PRICE };
  /**
   * Phase 12c — how hard each business worked yesterday, as `make / capacity`
   * in 0..1. Only populated for kinds that go through a production path (any
   * archetype with `produces` set, i.e. everyone except the landlord) and only
   * when capacity was positive that day. A business at ~1.0 produced every unit
   * it could; investing in capital would lift its ceiling. Below ~1.0 it was
   * limited by demand or input, and more equipment is dead weight. Ephemeral —
   * recomputed each {@link produce} run, not part of the snapshot.
   */
  private readonly lastUtilization = new Map<string, number>();

  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;

    const sold: Record<ResourceKind, number> = { grain: 0, materials: 0, food: 0, wares: 0 };
    this.procure(sold);
    this.produce();
    this.depreciate();
    this.distributeProfits();
    this.adjustPrices(sold);
  }

  /** Live resource price book — newest values. */
  priceBook(): Readonly<Record<ResourceKind, number>> {
    return this.prices;
  }

  /**
   * Phase 12c — yesterday's capacity utilization for a business in 0..1, or
   * undefined for kinds that don't produce (landlord) or businesses that had
   * zero effective capacity (e.g. fully unstaffed). Read by
   * {@link BusinessAgentSystem} to drive the invest decision: high utilization
   * means more equipment would pay off, low means it wouldn't.
   */
  capacityUtilizationFor(bizId: string): number | undefined {
    return this.lastUtilization.get(bizId);
  }

  /**
   * Phase 6 hook — slam a resource's price to `base * multiplier`, clamped to
   * the usual [MIN, MAX] band so a supply-shock can't break the price model.
   * Touches no cash (the spike is felt later, as dearer B2B procurement, which
   * still flows through {@link World.transfer}). Returns the new price.
   */
  shockPrice(resource: ResourceKind, multiplier: number): number {
    const base = BASE_RESOURCE_PRICE[resource];
    const p = clamp(base * multiplier, base * PRICE_MIN_MULT, base * PRICE_MAX_MULT);
    this.prices[resource] = p;
    return p;
  }

  private procure(sold: Record<ResourceKind, number>): void {
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const a = ARCHETYPES[biz.kind];
      if (!a.consumes) continue;
      const input = a.consumes;

      // How much output is the business short of its target? That, minus input
      // already on hand, is what it needs to buy to refill — but never more than
      // it can actually process today (its labour-/capital-limited capacity), so
      // an understaffed buyer doesn't stockpile input it can't turn into output.
      const outStock = a.sellsToResidents ? biz.inventory : biz.resources[a.produces!] ?? 0;
      const deficit = Math.min(this.effectiveCapacity(biz), Math.max(0, a.target - outStock));
      const want = Math.max(0, deficit - (biz.resources[input] ?? 0));
      if (want <= 0) continue;

      const producer = this.world.getBusiness(PRODUCER_OF[input]);
      if (!producer || !producer.active) continue;
      const price = this.prices[input];
      const avail = producer.resources[input] ?? 0;
      const units = Math.floor(Math.min(want, avail, biz.cash / price));
      if (units <= 0) continue;

      const cost = units * price;
      const paid = this.world.transfer(biz.id, producer.id, cost);
      if (paid <= 0) continue;
      const bought = Math.floor(paid / price);
      producer.resources[input] = avail - bought;
      biz.resources[input] = (biz.resources[input] ?? 0) + bought;
      producer.pnl.revenue += paid;
      sold[input] += bought;
    }
  }

  /**
   * Profit distribution — the feedback that keeps the closed loop alive. Each
   * day every business pays cash above its working-capital reserve back to
   * residents (evenly, as wages/dividends), capped per business. In a closed
   * supply chain B2B transfers net to zero, so any per-business surplus would
   * otherwise pool forever in one holder (the rent-collecting landlord, a busy
   * diner). Returning it to people who re-spend it at the shops recirculates the
   * money instead of letting it stagnate. The transfer cap already prevents a
   * business from paying out cash it doesn't have.
   */
  private distributeProfits(): void {
    const residents = this.world.residents;
    if (residents.length === 0) return;
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const reserve = biz.kind === "landlord" ? LANDLORD_RESERVE : BUSINESS_RESERVE;
      const budget = Math.min(biz.cash - reserve, PROFIT_DISTRIBUTION_CAP);
      if (budget <= 0) continue;
      const share = budget / residents.length;
      for (const r of residents) {
        biz.pnl.wagesPaid += this.world.transfer(biz.id, r.id, share);
      }
    }
  }

  private produce(): void {
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const a = ARCHETYPES[biz.kind];
      // The day's real ceiling — maxPerDay bent by how well-staffed and
      // well-equipped this business is (Phase 12b). At baseline capital with at
      // least one worker this is exactly maxPerDay, so the seeded city is
      // unchanged; an empty producer makes nothing.
      const capacity = this.effectiveCapacity(biz);

      let make = 0;
      if (a.produces && !a.consumes) {
        // Primary producer: make its resource from nothing, refilling to target.
        const stock = biz.resources[a.produces] ?? 0;
        make = Math.min(capacity, Math.max(0, a.target - stock));
        if (make > 0) biz.resources[a.produces] = stock + make;
      } else if (a.consumes) {
        const outStock = a.sellsToResidents ? biz.inventory : biz.resources[a.produces!] ?? 0;
        const have = biz.resources[a.consumes] ?? 0;
        make = Math.min(capacity, Math.max(0, a.target - outStock), have);
        if (make > 0) {
          biz.resources[a.consumes] = have - make;
          if (a.sellsToResidents) biz.inventory += make;
          else biz.resources[a.produces!] = outStock + make;
        }
      } else {
        // Not a producer (landlord) — no utilization to record.
        continue;
      }

      // Record how hard this business ran versus its effective capacity (Phase
      // 12c). At ~1.0 the firm is capacity-bound and would benefit from more
      // equipment; below ~1.0 it was limited by demand or input. Skip when
      // capacity is zero (e.g. fully unstaffed): the ratio is undefined and
      // "no workers" is a staffing problem, not a capital one.
      if (capacity > 0) {
        this.lastUtilization.set(biz.id, make / capacity);
      } else {
        this.lastUtilization.delete(biz.id);
      }
    }
  }

  /**
   * A business's real daily production ceiling (Phase 12b) — what the flat
   * `maxPerDay` becomes once labour and capital are taken into account:
   *
   *   capacity = maxPerDay × laborFactor(staff) × capitalFactor(capital)
   *
   * laborFactor gates on staffing — no workers means no output (the fix for
   * empty producers shipping full output, P10-3) — and saturates at
   * {@link LABOR_FULL_STAFF}, so the seeded city, where every producer has at
   * least one worker, sits at factor 1. capitalFactor scales with equipment with
   * diminishing returns (Cobb-Douglas), and is exactly 1 at {@link CAPITAL_BASELINE}
   * (read for pre-12 saves where the field is absent). So a fully-staffed,
   * baseline-capital business returns its old `maxPerDay` unchanged — 12b is a
   * pure no-op for the default town, and only an *under*staffed or *re*capitalised
   * business produces differently. Floored to keep production integer and the
   * chain deterministic.
   */
  private effectiveCapacity(biz: Business): number {
    const max = ARCHETYPES[biz.kind].maxPerDay;
    if (max <= 0) return 0;
    const laborFactor = Math.min(1, biz.employeeIds.length / LABOR_FULL_STAFF);
    const capital = biz.capital ?? CAPITAL_BASELINE;
    const capitalFactor = Math.pow(capital / CAPITAL_BASELINE, CAPITAL_OUTPUT_ELASTICITY);
    return Math.floor(max * laborFactor * capitalFactor);
  }

  /**
   * Capital wears out (Phase 12b). Only the stock *above* {@link CAPITAL_BASELINE}
   * depreciates: the baseline plant is treated as maintained out of ordinary
   * operating costs, so a city where nobody invests never erodes below baseline,
   * and the seeded no-op city — sitting exactly at baseline — never moves at all.
   * The excess a business buys with the invest lever (Phase 12c) decays a fixed
   * fraction per day, so holding a high capital level takes recurring re-investment
   * (the Solow "run to stand still"). Touches the capital quantity only, never
   * cash, so money stays conserved.
   */
  private depreciate(): void {
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const capital = biz.capital ?? CAPITAL_BASELINE;
      if (capital <= CAPITAL_BASELINE) continue;
      const excess = capital - CAPITAL_BASELINE;
      biz.capital = CAPITAL_BASELINE + excess * (1 - CAPITAL_DEPRECIATION_RATE);
    }
  }

  /**
   * Price tracks how hard each producer is being worked: brisk sales (high
   * utilization of its daily capacity) nudge the price up, a slow day nudges it
   * down. In the neutral band between those — neither over- nor under-worked —
   * the price drifts gently back toward base (snapping once within a hair),
   * giving base a restoring pull instead of leaving it frozen wherever an early
   * transient landed (P9-9). Bounded so it can never run away in either
   * direction.
   */
  private adjustPrices(sold: Record<ResourceKind, number>): void {
    for (const res of RESOURCES) {
      const producer = this.world.getBusiness(PRODUCER_OF[res]);
      // Measure how hard the producer worked against its *effective* capacity,
      // not the flat maxPerDay (Phase 12b) — otherwise an understaffed producer's
      // brisk-but-small output would read as a slow day and the price would sag
      // when it should firm up. At baseline this equals maxPerDay, so prices are
      // unchanged for the seeded city.
      const cap = producer ? this.effectiveCapacity(producer) : 0;
      const utilization = cap > 0 ? sold[res] / cap : 0;
      const base = BASE_RESOURCE_PRICE[res];
      let p = this.prices[res];
      if (utilization > 0.6) {
        p *= 1 + PRICE_ADJUST_FRACTION;
      } else if (utilization < 0.3) {
        p *= 1 - PRICE_ADJUST_FRACTION;
      } else {
        p += (base - p) * PRICE_REVERT_FRACTION;
        if (Math.abs(base - p) <= base * PRICE_REVERT_SNAP) p = base;
      }
      this.prices[res] = clamp(p, base * PRICE_MIN_MULT, base * PRICE_MAX_MULT);
    }
  }

  serialize(): unknown {
    return { prices: { ...this.prices } };
  }

  restore(state: unknown): void {
    const s = state as { prices?: Partial<Record<ResourceKind, number>> } | undefined;
    for (const res of RESOURCES) {
      const v = s?.prices?.[res];
      this.prices[res] = typeof v === "number" ? v : BASE_RESOURCE_PRICE[res];
    }
    // Utilization is derived, not persisted; wipe any stale readings from a
    // prior run so the first review after restore reports undefined until
    // produce() refills it.
    this.lastUtilization.clear();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
