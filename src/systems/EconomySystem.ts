import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, BusinessKind, Resident } from "../world/types";
import {
  RENT_PER_DAY,
  BUSINESS_RENT_PER_DAY,
  SOCIAL_SPEND,
  RETAIL_REFERENCE_PRICE,
  LEISURE_PRICE_SPREAD,
  LEISURE_TOLERANCE_TIERS,
  STORE_TRAVEL_WEIGHT,
  WEALTH_BASELINE,
  WEALTH_ELASTICITY,
  WEALTH_DEMAND_CAP,
  WEALTH_ROUND_TIERS,
} from "./constants";

/**
 * The closed money loop. Money only ever moves via World.transfer, so the
 * total across residents and businesses is conserved every tick:
 *
 *   wages: employer -> worker (while working)
 *   meals: diner customer -> diner
 *   leisure: customer -> social venue
 *   rent: every resident -> landlord (daily); diner/goods -> landlord (daily)
 */
export class EconomySystem implements System {
  readonly id = "economy";
  constructor(private readonly world: World) {}

  update(ctx: SystemContext): void {
    for (const resident of this.world.residents) {
      this.payWageIfWorking(resident);
      this.buyMealIfEating(resident);
      this.spendIfSocializing(resident);
    }
    // Paychecks and rent both settle once a day, at the stroke of midnight.
    if (ctx.totalTicks > 0 && ctx.totalTicks % TICKS_PER_DAY === 0) {
      this.settlePaychecks();
      this.collectRent();
    }
  }

  private payWageIfWorking(resident: Resident): void {
    if (resident.activity !== "working") return;
    const employer = this.world.getBusiness(resident.jobId);
    if (!employer) return;
    const paid = this.world.transfer(employer.id, resident.id, resident.wagePerTick);
    employer.pnl.wagesPaid += paid;
    // Accrue the dossier's running tally; the money already moved above.
    resident.earnedThisPeriod = (resident.earnedThisPeriod ?? 0) + paid;
  }

  /**
   * Close out the day's wages into each resident's "last paycheck" and reset the
   * accumulator (Phase 10a). Reporting only: every wage dollar already moved
   * tick-by-tick in {@link payWageIfWorking}, so this touches no balances and
   * leaves money conservation untouched.
   */
  private settlePaychecks(): void {
    for (const r of this.world.residents) {
      r.lastPaycheck = r.earnedThisPeriod ?? 0;
      r.earnedThisPeriod = 0;
    }
  }

  private buyMealIfEating(resident: Resident): void {
    if (resident.activity !== "eating" || resident.needs.hunger >= 100) return;
    const diner = this.storeForResident(resident, "diner");
    if (!diner) return;
    // A richer resident orders more in one sitting (Phase 13); at baseline wealth
    // — or with the keystone off (WEALTH_ELASTICITY 0) — this is exactly one meal,
    // as before. Each unit is its own transfer, so the loop simply stops when the
    // resident runs out of cash or the diner runs out of stock; over-ordering is
    // structurally impossible.
    const units = consumptionUnits(resident);
    for (let k = 0; k < units; k++) {
      const paid = this.world.transfer(resident.id, diner.id, diner.price);
      if (paid <= 0) break; // can't afford the next one; stays hungry, brain will retry
      if (k === 0) resident.needs.hunger = 100; // one meal sates hunger; the rest are splurge
      diner.pnl.revenue += paid;
      diner.inventory = Math.max(0, diner.inventory - 1);
      if (diner.inventory === 0) break; // shelves empty — later visitors get fewer
    }
  }

  private spendIfSocializing(resident: Resident): void {
    if (resident.activity !== "socializing" || resident.needs.social >= 100) return;
    const venue = this.storeForResident(resident, "goods");
    if (!venue) return;
    resident.needs.social = 100; // company lifts the spirits even when broke

    // Leisure is discretionary (Phase 11a): the resident buys only when the
    // venue's asking price sits at or below their willingness-to-pay. At or below
    // the anchor everyone still buys (back-compat); as a venue prices above it,
    // buyers drop out a tier at a time, so a storefront faces a real
    // raise-price-lose-volume tradeoff instead of captive demand. A richer
    // resident buys more units in the visit (Phase 13) — each its own transfer,
    // gated identically; at baseline wealth (or keystone off) it is one unit, so
    // the body below runs exactly once, byte-identical to before.
    const units = consumptionUnits(resident);
    for (let k = 0; k < units; k++) {
      const cost = venue.price > 0 ? venue.price : SOCIAL_SPEND;
      const anchor = RETAIL_REFERENCE_PRICE[venue.kind];
      if (anchor !== undefined && cost > this.leisureReservation(resident, anchor) + 1e-9) {
        break; // priced past this resident's reservation — they window-shop, buy nothing
      }
      const paid = this.world.transfer(resident.id, venue.id, cost);
      if (paid <= 0) break; // out of cash for the next unit
      venue.pnl.revenue += paid;
      if (venue.inventory > 0) venue.inventory -= 1;
      if (venue.inventory === 0) break; // shelves empty
    }
  }

  /**
   * A resident's top price for one leisure purchase. Fans deterministically from
   * the venue's anchor (tier 0 buys only at or below it) up to anchor*(1+spread)
   * (the top tier pays well over), spread across {@link LEISURE_TOLERANCE_TIERS}
   * tiers by resident index. No RNG, so it is stable across saves and identical
   * for the same resident every visit.
   */
  private leisureReservation(resident: Resident, anchor: number): number {
    const idx = Number(resident.id.split("_")[1] ?? 0);
    const tier = (idx % LEISURE_TOLERANCE_TIERS) / (LEISURE_TOLERANCE_TIERS - 1);
    return anchor * (1 + LEISURE_PRICE_SPREAD * tier);
  }

  private collectRent(): void {
    const landlord = this.world.getBusiness("biz_landlord");
    if (!landlord) return;
    for (const resident of this.world.residents) {
      const rent = this.world.getLocation(resident.homeId).rent ?? RENT_PER_DAY;
      const paid = this.world.transfer(resident.id, landlord.id, rent);
      landlord.pnl.rentCollected += paid;
      // A running shortfall streak the LifecycleSystem reads to re-home anyone
      // who keeps falling short. transfer caps at the resident's balance, so
      // paid < rent means they couldn't cover the full bill this day.
      resident.rentMissedDays = paid + 1e-9 < rent ? (resident.rentMissedDays ?? 0) + 1 : 0;
    }
    for (const biz of this.world.businesses) {
      if (biz.kind === "diner" || biz.kind === "goods") {
        const paid = this.world.transfer(biz.id, landlord.id, BUSINESS_RENT_PER_DAY);
        landlord.pnl.rentCollected += paid;
      }
    }
  }

  /**
   * Which store of `kind` this resident shops at (Phase 11b). Among the active
   * storefronts of that kind, the resident picks the lowest all-in cost of a
   * visit: the asking price plus the effort of getting there (straight-line
   * distance from home, weighted by {@link STORE_TRAVEL_WEIGHT}). So a nearer
   * store can hold a small premium and a rival must undercut to pull its
   * neighbours across town. With a single store of the kind (the pre-11b norm)
   * it returns that store unchanged — the back-compat path. Deterministic (no
   * RNG); the lowest id breaks exact ties.
   */
  private storeForResident(resident: Resident, kind: BusinessKind): Business | undefined {
    const open = this.world.businesses.filter((b) => b.kind === kind && b.active);
    if (open.length <= 1) return open[0];
    const home = this.world.getNode(this.world.getLocation(resident.homeId).nodeId);
    const visitCost = (b: Business): number => {
      const node = this.world.getNode(this.world.getLocation(b.locationId).nodeId);
      return b.price + STORE_TRAVEL_WEIGHT * Math.hypot(node.x - home.x, node.y - home.y);
    };
    return open.reduce((best, b) => {
      const delta = visitCost(b) - visitCost(best);
      if (delta < -1e-9) return b;
      if (delta <= 1e-9 && b.id < best.id) return b; // stable tie-break by id
      return best;
    });
  }
}

/**
 * How many units a resident buys in a single eating/socializing visit —
 * "wants grow with wealth" (Phase 13). At or below {@link WEALTH_BASELINE} (the
 * seeded starting balance) everyone buys exactly one, exactly like today; the
 * richer a resident is, the bigger their order, up to {@link WEALTH_DEMAND_CAP}.
 *
 * Pure and RNG-free: the real-valued multiplier `ratio ^ elasticity` is turned
 * into an integer by a per-resident phase offset — the same deterministic
 * id-index {@link EconomySystem.leisureReservation} relies on — so the fractional
 * unit is spread across the population (aggregate demand tracks the elasticity
 * smoothly) without ever touching the seeded RNG stream. With `elasticity` at 0
 * it short-circuits to 1: a hard global off switch, and the byte-identity
 * guarantee for Phase 13a. `elasticity` defaults to the shipped
 * {@link WEALTH_ELASTICITY}; callers in tests pass an explicit value to exercise
 * the curve before the city-wide knob is turned up in 13b.
 */
export function consumptionUnits(
  resident: Pick<Resident, "id" | "money">,
  elasticity: number = WEALTH_ELASTICITY,
): number {
  if (elasticity === 0) return 1;
  const ratio = Math.max(0, resident.money) / WEALTH_BASELINE;
  const mult = Math.min(WEALTH_DEMAND_CAP, Math.max(1, Math.pow(ratio, elasticity)));
  const idx = Number(resident.id.split("_")[1] ?? 0);
  const phase = (idx % WEALTH_ROUND_TIERS) / WEALTH_ROUND_TIERS;
  return Math.floor(mult + phase);
}
