import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { TRADE_ENABLED } from "./constants";

/**
 * External trade (Initiative C / C4 path a). Once a day, right after the B2B market settles, the
 * Port — the city's conserving window to the rest of the world — will **buy a bounded quantity of
 * the city's surplus output at frozen world prices** (`port → firm`, slice a2: outside demand, the
 * exports term in GDP) and **sell imports** to firms the local chain couldn't supply
 * (`firm → port`, slice a3: the current account's other leg). Every flow is a
 * {@link World.transfer} between holders counted in `totalMoney()`, so the sacred conservation
 * invariant holds to the cent across any number of ticks — the genesis total is simply higher by
 * the port's seeded reserve, which acts as a finite foreign **demand battery**.
 *
 * Slice a1 (this stub): a **no-op**. With {@link TRADE_ENABLED} off (the default) it does nothing,
 * so the seeded city is byte-identical — and even enabled, no trade happens until a2 lands. It
 * holds no own state — the port is an ordinary {@link Business} in the world snapshot — so it
 * needs no serialize/restore and a save/reload resumes the current account exactly.
 *
 * Runs after {@link MarketSystem} (stock freshly produced; export revenue books before the CEO
 * reviews the day, before profit distribution, and before Macro samples it).
 *
 * Real-world: the dock where foreign buyers' standing orders lift the town's sales beyond what its
 * own residents can absorb — and where the town buys what it can't make enough of.
 */
export class TradeSystem implements System {
  readonly id = "trade";

  constructor(
    private readonly world: World,
    /** Whether trade is live; defaults to {@link TRADE_ENABLED} (off ⇒ this system is inert). */
    private readonly enabled: boolean = TRADE_ENABLED,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const port = this.world.getBusiness("biz_port");
    if (!port || !port.active) return; // trade needs a seeded port (strictly opt-in, like the bank)
    // Slice a2 buys exports here; slice a3 sells imports.
  }
}
