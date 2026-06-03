import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { ResourceKind } from "../world/types";
import { ARCHETYPES, PRODUCER_OF } from "../world/archetypes";
import {
  BASE_RESOURCE_PRICE,
  PRICE_MIN_MULT,
  PRICE_MAX_MULT,
  PRICE_ADJUST_FRACTION,
  LANDLORD_RESERVE,
  BUSINESS_RESERVE,
  PROFIT_DISTRIBUTION_CAP,
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
 *      resident-sellable inventory. All demand-driven (refill toward target)
 *      and capped at maxPerDay, so the chain self-sizes to resident demand.
 *   3. Pricing — each resource's price nudges toward its supply/demand balance,
 *      bounded so it can never run away.
 *
 * Deterministic: fixed iteration order, integer quantities, no RNG. The price
 * book is the only persistent state and is part of the snapshot.
 */
export class MarketSystem implements System {
  readonly id = "market";
  private readonly prices: Record<ResourceKind, number> = { ...BASE_RESOURCE_PRICE };

  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;

    const sold: Record<ResourceKind, number> = { grain: 0, materials: 0, food: 0, wares: 0 };
    this.procure(sold);
    this.produce();
    this.distributeProfits();
    this.adjustPrices(sold);
  }

  /** Live resource price book — newest values. */
  priceBook(): Readonly<Record<ResourceKind, number>> {
    return this.prices;
  }

  private procure(sold: Record<ResourceKind, number>): void {
    for (const biz of this.world.businesses) {
      if (!biz.active) continue;
      const a = ARCHETYPES[biz.kind];
      if (!a.consumes) continue;
      const input = a.consumes;

      // How much output is the business short of its target? That, minus input
      // already on hand, is what it needs to buy to refill.
      const outStock = a.sellsToResidents ? biz.inventory : biz.resources[a.produces!] ?? 0;
      const deficit = Math.min(a.maxPerDay, Math.max(0, a.target - outStock));
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

      if (a.produces && !a.consumes) {
        // Primary producer: make its resource from nothing, refilling to target.
        const stock = biz.resources[a.produces] ?? 0;
        const make = Math.min(a.maxPerDay, Math.max(0, a.target - stock));
        if (make > 0) biz.resources[a.produces] = stock + make;
      } else if (a.consumes) {
        const outStock = a.sellsToResidents ? biz.inventory : biz.resources[a.produces!] ?? 0;
        const have = biz.resources[a.consumes] ?? 0;
        const make = Math.min(a.maxPerDay, Math.max(0, a.target - outStock), have);
        if (make <= 0) continue;
        biz.resources[a.consumes] = have - make;
        if (a.sellsToResidents) biz.inventory += make;
        else biz.resources[a.produces!] = outStock + make;
      }
    }
  }

  /**
   * Price tracks how hard each producer is being worked: brisk sales (high
   * utilization of its daily capacity) nudge the price up, a slow day nudges it
   * down. Bounded so it can never run away in either direction.
   */
  private adjustPrices(sold: Record<ResourceKind, number>): void {
    for (const res of RESOURCES) {
      const producer = this.world.getBusiness(PRODUCER_OF[res]);
      const cap = producer ? ARCHETYPES[producer.kind].maxPerDay : 0;
      const utilization = cap > 0 ? sold[res] / cap : 0;
      const base = BASE_RESOURCE_PRICE[res];
      let p = this.prices[res];
      if (utilization > 0.6) p *= 1 + PRICE_ADJUST_FRACTION;
      else if (utilization < 0.3) p *= 1 - PRICE_ADJUST_FRACTION;
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
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
