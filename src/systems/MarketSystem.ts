import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, ResourceKind } from "../world/types";
import { ARCHETYPES } from "../world/archetypes";
import { RESOURCE_KINDS } from "../world/industries";
import {
  BASE_RESOURCE_PRICE,
  PRICE_MIN_MULT,
  PRICE_MAX_MULT,
  PRICE_ADJUST_FRACTION,
  PRICE_UTIL_HIGH,
  PRICE_UTIL_LOW,
  PRICE_REVERT_FRACTION,
  PRICE_REVERT_SNAP,
  PRODUCER_COST_FLOOR,
  PRODUCER_COST_PLUS_MARGIN,
  PRODUCER_COMPETITION,
  WORK_TICKS_PER_DAY,
  CAPITAL_BASELINE,
  CAPITAL_OUTPUT_ELASTICITY,
  CAPITAL_DEPRECIATION_RATE,
  LABOR_FULL_STAFF,
  TARGET_CAPITAL_SCALING,
  BRAND_BASELINE,
  BRAND_DEPRECIATION_RATE,
} from "./constants";

// Slice 4: the resource list is the registry's LIVE array (slice 4d resets it per build), in
// stable chain order — so a city's extra resources flow through procurement, pricing, restore,
// and shocks. For the seeded four it is ["grain","materials","food","wares"] ⇒ byte-identical.
const RESOURCES: ResourceKind[] = RESOURCE_KINDS;

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

  /**
   * @param producerCompetition Initiative B slice 1 — the exponent that skews the multi-producer
   * order split toward cheaper suppliers. Defaults to the live {@link PRODUCER_COMPETITION} (0 ⇒
   * proportional-to-stock ⇒ byte-identical); the bench/tests pass an explicit value.
   */
  constructor(
    private readonly world: World,
    private readonly producerCompetition: number = PRODUCER_COMPETITION,
  ) {}

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;

    const sold = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<ResourceKind, number>;
    this.procure(sold);
    this.produce();
    this.depreciate();
    // Profit distribution moved out to DistributionSystem (Phase 13c) so it runs
    // *after* the business agent — letting a firm reinvest before paying dividends.
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
   * The current cost-of-production floor for a resource (Phase 15, B) — the
   * lowest price its producer's output may trade at. Read-only observability
   * (parallels {@link capacityUtilizationFor}); the UI can surface "this firm
   * can't profitably sell below X," and tests assert the floor binds. Equals the
   * flat band floor when {@link PRODUCER_COST_FLOOR} is off or the producer is
   * unstaffed (no wage cost to cover).
   */
  costFloorFor(res: ResourceKind): number {
    return this.priceFloor(res, this.producerOf(res));
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

  /**
   * Every active producer of a resource — found by *kind*, not a fixed id (Phase 15
   * D), so a respawned producer (new business id) seamlessly joins the supply chain.
   * Initiative #2 slice 2: there may now be **more than one** (opportunity/heal entry,
   * a future producer entrant), so this returns the whole pool, id-sorted for a stable
   * deterministic allocation order. For the default city — exactly one producer per
   * resource — it's a one-element list, so every caller collapses to its old behaviour.
   */
  private producersOf(resource: ResourceKind): Business[] {
    return this.world.businesses
      .filter((b) => b.active && ARCHETYPES[b.kind].produces === resource)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * The representative producer of a resource — the first of {@link producersOf} —
   * used for the single-valued cost floor and price-revert target. With one producer
   * (the seeded city) this is exactly that producer; with several it's the lowest-id
   * one, a stable stand-in until producer-level price discovery lands in Initiative B.
   */
  private producerOf(resource: ResourceKind): Business | undefined {
    return this.producersOf(resource)[0];
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
      const deficit = Math.min(this.effectiveCapacity(biz), Math.max(0, this.effectiveTarget(biz) - outStock));
      let want = Math.max(0, deficit - (biz.resources[input] ?? 0));
      if (want <= 0) continue;

      // Initiative #2 slice 2 — fill the order from the WHOLE producer pool, not just the
      // first. Each producer's pull is its stock × its competitiveness (Initiative B slice 1):
      // a cheaper, more efficient supplier wins MORE of the order. At PRODUCER_COMPETITION 0
      // the factor is 1, so the pull is just stock — the proportional-to-stock split, and with
      // one producer a single pass of the old math — byte-identical. Each take is capped by the
      // producer's stock, the remaining want, and the buyer's cash.
      const price = this.prices[input];
      const producers = this.producersOf(input);
      const pull = producers.map((p) => (p.resources[input] ?? 0) * this.competitiveness(p, input));
      // suffix[i] = pull of producer i and all after it. Dividing the still-wanted units by the
      // REMAINING pull (not the original total) makes the split truly proportional — equal pull ⇒
      // even split — instead of biasing toward the lowest-id producer. Single producer: suffix[0]
      // = its pull, so its share = the whole order — byte-identical. A zero-stock producer has pull
      // 0 and is skipped. (Strength 0 ⇒ pull = stock ⇒ a fair proportional-to-stock split.)
      const suffix = new Array<number>(producers.length + 1).fill(0);
      for (let i = producers.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + pull[i]!;
      if (suffix[0]! <= 0) continue;
      for (let i = 0; i < producers.length; i++) {
        if (want <= 0) break;
        const producer = producers[i]!;
        const avail = producer.resources[input] ?? 0;
        if (avail <= 0 || pull[i]! <= 0) continue;
        const share = Math.min(want, avail, Math.ceil((want * pull[i]!) / suffix[i]!));
        const units = Math.floor(Math.min(share, biz.cash / price));
        if (units <= 0) continue;

        const cost = units * price;
        const paid = this.world.transfer(biz.id, producer.id, cost);
        if (paid <= 0) continue;
        const bought = Math.floor(paid / price);
        producer.resources[input] = avail - bought;
        biz.resources[input] = (biz.resources[input] ?? 0) + bought;
        producer.pnl.revenue += paid;
        sold[input] += bought;
        want -= bought;
      }
    }
  }

  /**
   * A producer's competitiveness for a resource (Initiative B slice 1) — the multiplier on its
   * stock-share of an order. `(marketPrice / unitCost) ^ producerCompetition`: a producer whose
   * unit cost (input price + wage bill spread over its effective capacity, the same cost the
   * {@link priceFloor} reckons) sits **below** the market price is profitable and wins MORE share;
   * one **above** it loses share. At strength 0 it is exactly 1 — weight = stock, byte-identical.
   * Pure: reads prices/staffing/capital, moves no cash, no RNG.
   */
  private competitiveness(p: Business, resource: ResourceKind): number {
    if (this.producerCompetition <= 0) return 1; // off ⇒ weight is pure stock (slice-2 split)
    const a = ARCHETYPES[p.kind];
    const inputCost = a.consumes ? this.prices[a.consumes] : 0;
    const capacity = this.effectiveCapacity(p);
    const wageCost =
      capacity > 0 ? (p.wagePerTick * p.employeeIds.length * WORK_TICKS_PER_DAY) / capacity : 0;
    const unitCost = Math.max(inputCost + wageCost, 1e-6);
    return Math.pow(this.prices[resource] / unitCost, this.producerCompetition);
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
        make = Math.min(capacity, Math.max(0, this.effectiveTarget(biz) - stock));
        if (make > 0) biz.resources[a.produces] = stock + make;
      } else if (a.consumes) {
        const outStock = a.sellsToResidents ? biz.inventory : biz.resources[a.produces!] ?? 0;
        const have = biz.resources[a.consumes] ?? 0;
        make = Math.min(capacity, Math.max(0, this.effectiveTarget(biz) - outStock), have);
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
    return Math.floor(max * laborFactor * this.capitalFactor(biz));
  }

  /**
   * The Cobb-Douglas capital multiplier shared by capacity and the stock target
   * (Phase 14): `(capital / baseline) ^ elasticity`, exactly 1 at
   * {@link CAPITAL_BASELINE}. Below-baseline capital yields a factor < 1.
   */
  private capitalFactor(biz: Business): number {
    const capital = biz.capital ?? CAPITAL_BASELINE;
    return Math.pow(capital / CAPITAL_BASELINE, CAPITAL_OUTPUT_ELASTICITY);
  }

  /**
   * A business's desired output stock level. With {@link TARGET_CAPITAL_SCALING}
   * off (Phase 14a) this is exactly the archetype `target` — a pure no-op. On
   * (14c) it scales the buffer up with capital by the SAME {@link capitalFactor}
   * that capacity uses, so target and capacity move in lock-step: utilization
   * (`make / capacity`) stays invariant to capital, so the invest loop is
   * demand-driven, not self-driven. Floored at the baseline target — capital
   * scaling can only deepen the buffer, never shrink a storefront's survival
   * stock. Integer and deterministic.
   */
  private effectiveTarget(biz: Business): number {
    const target = ARCHETYPES[biz.kind].target;
    if (!TARGET_CAPITAL_SCALING) return target;
    return Math.floor(target * Math.max(1, this.capitalFactor(biz)));
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
      if (capital > CAPITAL_BASELINE) {
        const excess = capital - CAPITAL_BASELINE;
        biz.capital = CAPITAL_BASELINE + excess * (1 - CAPITAL_DEPRECIATION_RATE);
      }
      // Phase 17 — brand equity decays like capital (above-baseline only). A
      // no-spend city has brand unset ⇒ this skips ⇒ byte-identical no-op.
      const brand = biz.brand ?? BRAND_BASELINE;
      if (brand > BRAND_BASELINE) {
        const excess = brand - BRAND_BASELINE;
        biz.brand = BRAND_BASELINE + excess * (1 - BRAND_DEPRECIATION_RATE);
      }
    }
  }

  /**
   * The lower bound a resource's market price may not fall below (Phase 15, B).
   * With {@link PRODUCER_COST_FLOOR} off this is the flat band floor
   * base*{@link PRICE_MIN_MULT} — exactly today's behaviour, so the B1 seam was a
   * pure no-op. On (B2) it becomes the producer's *cost of production* plus a
   * margin, so price discovery can never drive a producer's revenue below its own
   * costs and bankrupt the upstream chain (P10-7):
   *
   *   floor = (unitInputCost + unitWageCost) × (1 + margin)
   *
   * - unitInputCost: a processor turns one input unit into one output unit, so
   *   its per-unit input cost is just that input's live market price; a primary
   *   producer (farm/mine) buys nothing, so zero.
   * - unitWageCost: the day's wage bill (posted wage/tick × head-count × an 8h
   *   shift) spread over the day's production ceiling (effectiveCapacity). When a
   *   producer is unstaffed there's no capacity to price against, so the band
   *   floor stands.
   *
   * The result is clamped into [band floor, base*MAX*0.99]: never below today's
   * floor, and held a hair under the band ceiling so the storefront that buys
   * this resource always keeps a sliver of margin over what it pays. Real-world:
   * the reservation price a supplier won't sell beneath — the discipline that
   * keeps the B2B chain solvent, and the money-in that lets a producer afford a
   * competitive wage (slice A). Pure: reads prices/staffing/capital, moves no
   * cash, uses no RNG.
   */
  private priceFloor(res: ResourceKind, producer: Business | undefined): number {
    const base = BASE_RESOURCE_PRICE[res];
    const bandFloor = base * PRICE_MIN_MULT;
    if (!PRODUCER_COST_FLOOR || !producer || !producer.active) return bandFloor;

    const a = ARCHETYPES[producer.kind];
    const inputCost = a.consumes ? this.prices[a.consumes] : 0;
    const capacity = this.effectiveCapacity(producer);
    const wageCost =
      capacity > 0
        ? (producer.wagePerTick * producer.employeeIds.length * WORK_TICKS_PER_DAY) / capacity
        : 0;

    const costPlus = (inputCost + wageCost) * (1 + PRODUCER_COST_PLUS_MARGIN);
    return clamp(costPlus, bandFloor, base * PRICE_MAX_MULT * 0.99);
  }

  /**
   * Price tracks how hard each producer is being worked: brisk sales (high
   * utilization of its daily capacity) nudge the price up, a slow day nudges it
   * down. In the neutral band between those — neither over- nor under-worked —
   * the price drifts gently back toward base (snapping once within a hair),
   * giving base a restoring pull instead of leaving it frozen wherever an early
   * transient landed (P9-9). Bounded so it can never run away in either
   * direction — and, once the Phase 15 floor engages, never below a producer's
   * own cost of production ({@link priceFloor}).
   */
  private adjustPrices(sold: Record<ResourceKind, number>): void {
    for (const res of RESOURCES) {
      const producers = this.producersOf(res);
      const producer = producers[0]; // representative for the cost floor / revert target
      // Measure how hard the producers worked against their *effective* capacity,
      // not the flat maxPerDay (Phase 12b) — otherwise an understaffed producer's
      // brisk-but-small output would read as a slow day and the price would sag
      // when it should firm up. Summed across the whole pool (Initiative #2 slice 2)
      // so a second producer's added capacity softens the price, not inflates it; with
      // one producer this is its lone capacity, so prices are unchanged for the seeded city.
      const cap = producers.reduce((s, p) => s + this.effectiveCapacity(p), 0);
      const utilization = cap > 0 ? sold[res] / cap : 0;
      const base = BASE_RESOURCE_PRICE[res];
      const floor = this.priceFloor(res, producer);
      let p = this.prices[res];
      if (utilization > PRICE_UTIL_HIGH) {
        p *= 1 + PRICE_ADJUST_FRACTION;
      } else if (utilization < PRICE_UTIL_LOW) {
        p *= 1 - PRICE_ADJUST_FRACTION;
      } else {
        // Neutral band: drift back toward base — or toward the cost floor when
        // that sits above base (a high-input or high-wage producer), so the
        // revert doesn't fight the floor and churn against the clamp.
        const revertTarget = Math.max(base, floor);
        p += (revertTarget - p) * PRICE_REVERT_FRACTION;
        if (Math.abs(revertTarget - p) <= base * PRICE_REVERT_SNAP) p = revertTarget;
      }
      this.prices[res] = clamp(p, floor, base * PRICE_MAX_MULT);
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
