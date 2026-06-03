import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Resident } from "../world/types";
import { RENT_PER_DAY, BUSINESS_RENT_PER_DAY, SOCIAL_SPEND } from "./constants";

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
    // Rent settles once a day, at the stroke of midnight.
    if (ctx.totalTicks > 0 && ctx.totalTicks % TICKS_PER_DAY === 0) {
      this.collectRent();
    }
  }

  private payWageIfWorking(resident: Resident): void {
    if (resident.activity !== "working") return;
    const employer = this.world.getBusiness(resident.jobId);
    if (!employer) return;
    const paid = this.world.transfer(employer.id, resident.id, resident.wagePerTick);
    employer.pnl.wagesPaid += paid;
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
    // Spend the venue's own price (its goods/leisure cost), so a business's
    // price lever is economically live. Fall back to the flat default if a
    // venue has no price set.
    const cost = venue.price > 0 ? venue.price : SOCIAL_SPEND;
    const paid = this.world.transfer(resident.id, venue.id, cost);
    resident.needs.social = 100; // company lifts the spirits even when broke
    if (paid > 0) {
      venue.pnl.revenue += paid;
      if (venue.inventory > 0) venue.inventory -= 1;
    }
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
