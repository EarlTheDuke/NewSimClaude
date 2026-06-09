import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, BusinessKind, Location, Resident } from "../world/types";
import type { MarketSystem } from "./MarketSystem";
import { ARCHETYPES } from "../world/archetypes";
import {
  BUSINESS_ENTRY,
  OPPORTUNITY_ENTRY,
  OPPORTUNITY_UTIL,
  MAX_FIRMS_PER_KIND,
  ENTREPRENEUR_MIN_SAVINGS,
  NEW_FIRM_CAPITAL,
  ENTRY_COOLDOWN_DAYS,
  DESIRED_HEADCOUNT,
  CAPITAL_BASELINE,
  RETAIL_REFERENCE_PRICE,
} from "./constants";

/** Kinds an entrepreneur can found — everyone who produces or sells; not the landlord. */
const ENTRANT_KINDS: BusinessKind[] = ["diner", "goods", "farm", "mine", "bakery", "factory"];

/**
 * Storefront kinds an opportunity entrant can found a second firm of (Initiative #2
 * slice 1). {@link EconomySystem.storeForResident} splits resident demand across them
 * by price + distance, so a rival opens **across town** to win the far-side customers.
 */
const STOREFRONT_KINDS: BusinessKind[] = ["diner", "goods"];

/**
 * Producer kinds an opportunity entrant can found a second firm of (Initiative #2 slice
 * 3 — unlocked by slice 2's multi-producer B2B). A capacity-bound producer is a *supply*
 * bottleneck; a second one **co-locates** (B2B is by resource, not place) and {@link
 * MarketSystem} splits the chain's orders across the pool, so its output actually sells.
 */
const PRODUCER_KINDS: BusinessKind[] = ["farm", "mine", "bakery", "factory"];

/** All kinds opportunity entry considers — storefronts first (visible consumer demand), then producers. */
const OPPORTUNITY_KINDS: BusinessKind[] = [...STOREFRONT_KINDS, ...PRODUCER_KINDS];

function residentIndex(id: string): number {
  return Number(id.split("_")[1] ?? 0);
}

/**
 * Business entry — the *birth* half of creative destruction (Phase 15 D). Once per
 * day, after {@link LifecycleSystem} has settled the day's bankruptcies, it looks
 * for an **empty niche**: a BusinessKind with no active firm left. If it finds one
 * and a resident has savings to spare, that resident *founds* a fresh firm to serve
 * the standing demand — funding it from their own pocket (a transfer, so no money
 * is minted), staffing it from the jobless pool (where the dead firm's laid-off
 * crew now sit), and **owning** it (so the owner dividend rewards the risk). The new
 * firm reuses the dead firm's location and template, and {@link MarketSystem} finds
 * producers by kind, so it slots straight into the supply chain.
 *
 * This is what makes the city *self-heal*: the productivity engine's long-run churn
 * kills marginal firms, and entry refills the niches they leave. It is also the
 * disruption that finally makes the labour levers (`hire`/`setWage`) bite — a newborn
 * firm bids for the very workers a dead one freed.
 *
 * **Two birth modes, both off the same machinery (fund → staff → own):**
 *  - *Heal* ({@link BUSINESS_ENTRY}, on): refill a kind that has gone fully **extinct**,
 *    reopening at the dead firm's spot — the original creative-destruction birth half.
 *  - *Opportunity* ({@link OPPORTUNITY_ENTRY}, off by default — Initiative #2 slices 1+3):
 *    found a **second** firm of a kind that is alive but **overstretched** (every
 *    incumbent ran capacity-bound and solvent). A *storefront* rival opens **across town**
 *    so the price+distance demand split hands it customers (slice 1); a *producer* rival
 *    **co-locates** (B2B is by resource, not place) and slice 2's multi-producer chain
 *    splits orders to it (slice 3). Generalizes entry from "refill the dead" to
 *    "challenge the busy" — across both the consumer and supply sides of the chain.
 *
 * Heal outranks opportunity, and at most one birth fires per cooldown.
 *
 * Deterministic: fixed kind order, the lowest-index eligible founder, a serialized
 * spawn counter for unique ids, no RNG. Conservation-safe: the only money move is
 * the founder's transfer into the firm. A cooldown spaces births so a wave of deaths
 * heals gradually rather than thrashing. With both modes' triggers unmet — the seeded
 * city, every kind staffed and none flat-out — it is byte-identical.
 */
export class BusinessEntrySystem implements System {
  readonly id = "business-entry";
  private lastEntryDay = -ENTRY_COOLDOWN_DAYS;
  private spawnCount = 0;

  constructor(
    private readonly world: World,
    /** Whether *heal* births are enabled; defaults to the live {@link BUSINESS_ENTRY}. Tests pass false to isolate lifecycle. */
    private readonly enabled: boolean = BUSINESS_ENTRY,
    /**
     * Whether *opportunity* births are enabled (Initiative #2 slice 1); defaults to the live
     * {@link OPPORTUNITY_ENTRY} (off ⇒ byte-identical). Needs {@link market} to read utilization.
     */
    private readonly opportunityEntry: boolean = OPPORTUNITY_ENTRY,
    /** The market — read-only — so opportunity entry can see how hard each storefront ran (Phase 12c util). */
    private readonly market?: MarketSystem,
  ) {}

  update(ctx: SystemContext): void {
    const healOn = this.enabled;
    const opportunityOn = this.opportunityEntry && this.market !== undefined;
    if (!healOn && !opportunityOn) return;
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();
    if (day - this.lastEntryDay < ENTRY_COOLDOWN_DAYS) return;

    // Heal first: refilling a fully extinct kind (a hard supply gap) outranks adding a
    // rival into a merely-busy one. At most one birth per cooldown keeps the spacing.
    if (healOn) {
      const kind = this.emptyNiche();
      const founder = kind !== undefined ? this.entrepreneur() : undefined;
      if (kind !== undefined && founder) {
        this.found(kind, founder);
        this.lastEntryDay = day;
        return;
      }
    }

    // Then opportunity: a kind running flat-out and solvent attracts a rival. A storefront
    // rival opens across town (geographic demand split); a producer co-locates (B2B by
    // resource), its output sold via slice 2's multi-producer chain.
    if (opportunityOn) {
      const kind = this.opportunityNiche();
      const founder = kind !== undefined ? this.entrepreneur() : undefined;
      if (kind !== undefined && founder) {
        this.found(kind, founder, STOREFRONT_KINDS.includes(kind));
        this.lastEntryDay = day;
      }
    }
  }

  /** The decision trace surfaces the latest birth via the founded firm's id. */
  lastFoundedId: string | undefined;

  /** The first kind (fixed order) with no active firm — a standing unmet demand. */
  private emptyNiche(): BusinessKind | undefined {
    return ENTRANT_KINDS.find(
      (kind) => !this.world.businesses.some((b) => b.kind === kind && b.active),
    );
  }

  /**
   * The first kind (fixed order — storefronts then producers) that is a standing
   * *opportunity* — alive but overstretched. It qualifies when the kind has at least
   * one but fewer than {@link MAX_FIRMS_PER_KIND} active firms, and *every* one of them
   * yesterday both ran **capacity-bound** ({@link OPPORTUNITY_UTIL}+ utilization —
   * flat-out, a sign of unmet demand: a slammed storefront, or a supply-bottleneck
   * producer) and held enough cash to be plainly **solvent** ({@link NEW_FIRM_CAPITAL}+
   * — a profitable niche, not a dying one). An unstaffed firm has no utilization reading
   * and never qualifies (a staffing gap, not an entry opportunity). Producer entry is
   * only reachable because slice 2 lets the chain buy from more than one producer.
   * Read-only + deterministic: fixed kind order, integer-free thresholds.
   */
  private opportunityNiche(): BusinessKind | undefined {
    const market = this.market;
    if (!market) return undefined;
    return OPPORTUNITY_KINDS.find((kind) => {
      const firms = this.world.businesses.filter((b) => b.kind === kind && b.active);
      if (firms.length === 0 || firms.length >= MAX_FIRMS_PER_KIND) return false;
      return firms.every((b) => {
        const util = market.capacityUtilizationFor(b.id);
        return util !== undefined && util >= OPPORTUNITY_UTIL && b.cash >= NEW_FIRM_CAPITAL;
      });
    });
  }

  /** The lowest-index resident with savings to spare to capitalise a firm. */
  private entrepreneur(): Resident | undefined {
    let best: Resident | undefined;
    for (const r of this.world.residents) {
      if (r.money < ENTREPRENEUR_MIN_SAVINGS) continue;
      if (!best || residentIndex(r.id) < residentIndex(best.id)) best = r;
    }
    return best;
  }

  private found(kind: BusinessKind, founder: Resident, rival = false): void {
    // Template: a live incumbent if one exists (the opportunity case — copy its name and
    // going wage), else the dead husk (the heal case — same spot, name, base wage as before).
    const template =
      this.world.businesses.find((b) => b.kind === kind && b.active) ??
      this.world.businesses.find((b) => b.kind === kind);
    if (!template) return; // unreachable — every kind is seeded — but keeps us total

    const produces = ARCHETYPES[kind].produces;
    const wage = template.baseWagePerTick ?? template.wagePerTick;
    this.spawnCount += 1;
    // A heal reopens at the dead firm's spot; a rival opens across town (its own new
    // location) so the price+distance demand split actually hands it customers.
    const locationId = rival ? this.openRivalLocation(template) : template.locationId;
    const biz: Business = {
      id: `biz_${kind}_gen${this.spawnCount}`,
      name: template.name,
      kind,
      ownerId: founder.id, // the founder owns it — and earns its dividend
      locationId, // heal: the dead firm's location · rival: a fresh cross-town node
      cash: 0,
      inventory: 0,
      price: RETAIL_REFERENCE_PRICE[kind] ?? 0, // storefronts open at the going rate; producers carry no price
      employeeIds: [],
      wagePerTick: wage,
      baseWagePerTick: wage,
      pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0, distributed: 0 },
      resources: produces ? { [produces]: 0 } : {},
      active: true,
      capital: CAPITAL_BASELINE,
    };
    this.world.businesses.push(biz);

    // Capitalise it from the founder's own savings — a transfer, so no money minted.
    this.world.transfer(founder.id, biz.id, NEW_FIRM_CAPITAL);

    // Staff it from the jobless pool, lowest index first (the dead firm's laid-off
    // crew are in this pool), up to the desired headcount.
    const jobless = this.world.residents
      .filter((r) => r.jobId === "")
      .sort((a, b) => residentIndex(a.id) - residentIndex(b.id));
    for (let i = 0; i < Math.min(DESIRED_HEADCOUNT, jobless.length); i++) {
      const r = jobless[i]!;
      r.jobId = biz.id;
      r.wagePerTick = wage;
      biz.employeeIds.push(r.id);
    }

    this.lastFoundedId = biz.id;
  }

  /**
   * Mint a fresh workplace for a rival entrant, in the **residential cluster farthest
   * from the incumbent**. Distance is the whole point: {@link
   * EconomySystem.storeForResident} routes each customer to the lowest price+travel
   * store, so a co-located twin at the same opening price would lose every tie and
   * starve — opening across town instead hands the rival the customers on its side
   * of the map (a genuine two-firm split). We target the farthest *home* node, not the
   * farthest node outright, so the rival lands where under-served customers actually
   * live (real footfall) rather than in an empty industrial corner. Reuses an existing
   * grid node (mints no node/road, so pathfinding is unchanged) and reindexes so the
   * new location resolves. Deterministic: scans residents in array order, max distance,
   * lowest node id breaks ties; the id carries the same `gen` counter as its firm.
   */
  private openRivalLocation(template: Business): string {
    const home = this.world.getNode(this.world.getLocation(template.locationId).nodeId);
    let far = home;
    let best = -1;
    for (const r of this.world.residents) {
      const n = this.world.getNode(this.world.getLocation(r.homeId).nodeId);
      const d = Math.hypot(n.x - home.x, n.y - home.y);
      if (d > best + 1e-9 || (Math.abs(d - best) <= 1e-9 && n.id < far.id)) {
        best = d;
        far = n;
      }
    }
    const loc: Location = {
      id: `loc_${template.kind}_gen${this.spawnCount}`,
      name: `${template.name} (across town)`,
      type: "workplace",
      nodeId: far.id,
    };
    this.world.locations.push(loc);
    this.world.reindex(); // register the new location for getLocation lookups
    return loc.id;
  }

  serialize(): unknown {
    return { lastEntryDay: this.lastEntryDay, spawnCount: this.spawnCount };
  }

  restore(state: unknown): void {
    const s = state as { lastEntryDay?: number; spawnCount?: number } | undefined;
    this.lastEntryDay = s?.lastEntryDay ?? -ENTRY_COOLDOWN_DAYS;
    this.spawnCount = s?.spawnCount ?? 0;
  }
}
