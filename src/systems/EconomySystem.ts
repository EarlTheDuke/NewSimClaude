import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Resident } from "../world/types";
import {
  RENT_PER_DAY,
  BUSINESS_RENT_PER_DAY,
  SOCIAL_SPEND,
  RETAIL_REFERENCE_PRICE,
  LEISURE_PRICE_SPREAD,
  LEISURE_TOLERANCE_TIERS,
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
    const diner = this.world.getBusiness("biz_diner");
    if (!diner) return;
    const paid = this.world.transfer(resident.id, diner.id, diner.price);
    if (paid <= 0) return; // can't afford it; stays hungry, brain will retry
    resident.needs.hunger = 100;
    diner.pnl.revenue += paid;
    diner.inventory = Math.max(0, diner.inventory - 1);
  }

  private spendIfSocializing(resident: Resident): void {
    if (resident.activity !== "socializing" || resident.needs.social >= 100) return;
    const venueId = this.venueForResident(resident);
    const venue = this.world.getBusiness(venueId);
    if (!venue) return;
    resident.needs.social = 100; // company lifts the spirits even when broke

    // Leisure is discretionary (Phase 11a): the resident buys only when the
    // venue's asking price sits at or below their willingness-to-pay. At or below
    // the anchor everyone still buys (back-compat); as a venue prices above it,
    // buyers drop out a tier at a time, so a storefront faces a real
    // raise-price-lose-volume tradeoff instead of captive demand.
    const cost = venue.price > 0 ? venue.price : SOCIAL_SPEND;
    const anchor = RETAIL_REFERENCE_PRICE[venue.kind];
    if (anchor !== undefined && cost > this.leisureReservation(resident, anchor) + 1e-9) {
      return; // priced past this resident's reservation — they window-shop, buy nothing
    }
    const paid = this.world.transfer(resident.id, venue.id, cost);
    if (paid > 0) {
      venue.pnl.revenue += paid;
      if (venue.inventory > 0) venue.inventory -= 1;
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

  private venueForResident(_resident: Resident): string {
    // Leisure/shopping happens at the general goods store, so the diner anchors
    // the food chain and the goods store anchors the wares chain — two retail
    // venues, each driving one production chain at comparable volume.
    return "biz_goods";
  }
}
