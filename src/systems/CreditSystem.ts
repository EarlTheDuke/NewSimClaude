import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { CREDIT_ENABLED } from "./constants";

/**
 * Credit & finance (Initiative C / Phase 18). Once a day it will service outstanding loans —
 * **interest accrual** (`firm→bank` transfer, slice 18d) and optional **savings yield** on idle cash
 * (`bank→firm`, slice 18i) — between the {@link DistributionSystem} and the {@link LifecycleSystem},
 * so a firm's debt service is taken before its dividend and a defaulter settles to the lender first.
 *
 * Slice 18a (this stub): a **no-op**. With {@link CREDIT_ENABLED} off (the default) it does nothing,
 * so the seeded city is byte-identical. It holds **no own state** — debt rides on each
 * {@link Business} in the world snapshot — so it needs no serialize/restore and a save/reload resumes
 * any loan exactly. Money will only ever move via {@link World.transfer}, so `totalMoney()` stays
 * conserved to the cent (a borrow is `bank→firm`, interest/repay `firm→bank`; debt is non-cash).
 */
export class CreditSystem implements System {
  readonly id = "credit";

  constructor(
    private readonly world: World,
    /** Whether credit is live; defaults to {@link CREDIT_ENABLED} (off ⇒ this system is inert). */
    private readonly enabled: boolean = CREDIT_ENABLED,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    // Slice 18a — no lending/interest yet. Accrual (18d) and savings (18i) land here later.
    void this.world;
  }
}
