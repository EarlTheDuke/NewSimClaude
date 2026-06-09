import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, ResourceKind } from "../world/types";
import { ARCHETYPES } from "../world/archetypes";
import { RESOURCE_KINDS, BASE_RESOURCE_PRICE } from "../world/industries";
import type { MarketSystem } from "./MarketSystem";
import {
  TRADE_ENABLED,
  TRADE_WORLD_PRICE_MULT,
  TRADE_EXPORT_MAX_PER_DAY,
  TRADE_EXPORT_STOCK_FLOOR,
  TRADE_IMPORT_PRICE_MULT,
  TRADE_IMPORT_MAX_PER_DAY,
} from "./constants";

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
 * With {@link TRADE_ENABLED} off (the default) it does nothing, so the seeded city is
 * byte-identical. It holds no own state — the port is an ordinary {@link Business} in the world
 * snapshot and export tallies ride on each firm's P&L — so it needs no serialize/restore and a
 * save/reload resumes the current account exactly.
 *
 * Runs after {@link MarketSystem} (stock freshly produced; export revenue books before the CEO
 * reviews the day, before profit distribution, and before Macro samples it). World prices are a
 * **frozen table** (base × {@link TRADE_WORLD_PRICE_MULT}) — the city is a price-taker abroad, so
 * export demand never feeds back into the local price book except the honest way: tomorrow's
 * production refilling what the dock shipped out.
 *
 * Real-world: the dock where foreign buyers' standing orders lift the town's sales beyond what its
 * own residents can absorb — and where the town buys what it can't make enough of.
 */
export class TradeSystem implements System {
  readonly id = "trade";

  constructor(
    private readonly world: World,
    /** Read-only access to the market's capacity/target arithmetic for the import-gap math (a3). */
    private readonly market: MarketSystem,
    /** Whether trade is live; defaults to {@link TRADE_ENABLED} (off ⇒ this system is inert). */
    private readonly enabled: boolean = TRADE_ENABLED,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const port = this.world.getBusiness("biz_port");
    if (!port || !port.active) return; // trade needs a seeded port (strictly opt-in, like the bank)
    this.buyExports(port);
    this.sellImports(port);
  }

  /**
   * Slice a2 — the rest of the world buys the city's surplus output, `port → firm`, at frozen
   * world prices. For each resource (chain order) the port places a bounded daily order
   * ({@link TRADE_EXPORT_MAX_PER_DAY}) and fills it from each active producer's stock **above its
   * keep-floor** ({@link TRADE_EXPORT_STOCK_FLOOR} × archetype target — the local chain's buffer is
   * never shipped), id-sorted. Every payment is a {@link World.transfer} capped by the port's
   * remaining reserve — when the demand battery runs dry, exports simply pause (foreign demand is
   * finite; refilling the port would be money creation, path b). Exported units leave the world —
   * goods are non-cash, so destroying them touches no invariant (exactly like residents eating
   * meals). Revenue books into the firm's `pnl.revenue` (its mind sees the income) AND
   * `pnl.exportRevenue` (Macro's exports term — kept out of consumption because no producer here
   * `sellsToResidents`). Deterministic: fixed resource order, id-sorted firms, integer units,
   * frozen prices, no RNG.
   */
  private buyExports(port: Business): void {
    for (const res of RESOURCE_KINDS) {
      const worldPrice = BASE_RESOURCE_PRICE[res] * TRADE_WORLD_PRICE_MULT;
      let remaining = TRADE_EXPORT_MAX_PER_DAY; // the world's standing daily order for this good
      for (const firm of this.producersOf(res)) {
        if (remaining <= 0) break;
        const stock = firm.resources[res] ?? 0;
        const keep = Math.ceil(ARCHETYPES[firm.kind].target * TRADE_EXPORT_STOCK_FLOOR);
        const surplus = Math.max(0, stock - keep);
        // Integer units, affordable within the port's remaining reserve — so the transfer below
        // always settles in full and cash moved matches units shipped exactly.
        const units = Math.min(surplus, remaining, Math.floor(port.cash / worldPrice));
        if (units <= 0) continue;
        const paid = this.world.transfer(port.id, firm.id, units * worldPrice); // port → firm; conserved
        if (paid <= 0) continue;
        firm.resources[res] = stock - units; // shipped abroad — leaves the world (non-cash)
        firm.pnl.revenue += paid;
        firm.pnl.exportRevenue = (firm.pnl.exportRevenue ?? 0) + paid;
        remaining -= units;
      }
    }
  }

  /**
   * Slice a3 — the rest of the world sells the city what its own chain couldn't supply,
   * `firm → port`, at the frozen landed price (base × {@link TRADE_IMPORT_PRICE_MULT} — dearer
   * than the export price; the spread is the world's shipping margin). For each resource (chain
   * order), each active consumer's **standing input gap at end of market day** — the same
   * deficit arithmetic {@link MarketSystem.procure} uses, minus input already on hand — is filled
   * up to the boat's bounded daily cargo ({@link TRADE_IMPORT_MAX_PER_DAY}), capped by the firm's
   * own cash. **The local market keeps right of first refusal:** each consumer's gap is first
   * netted against the standing stock local producers still hold (claimed in the same id order
   * tomorrow's procurement will run), and the boat sells only the remainder — so a healthy chain
   * imports nothing, and the dock can never undercut a supplier who has the goods sitting ready.
   * The evening order lands tonight so TOMORROW's production can run: imports are the relief
   * valve when fire, bankruptcy, or export pull leaves the local market genuinely short. Money
   * flows city → port, refilling the demand battery: the current account nets, and only NET
   * exports drain the reserve. Imported units enter the world (non-cash, like production). Spend
   * books into `pnl.importSpend` — Macro's −M term, since imported content isn't city output.
   * Deterministic: fixed resource order, id-sorted firms, integer units, frozen prices, no RNG.
   */
  private sellImports(port: Business): void {
    for (const res of RESOURCE_KINDS) {
      const landedPrice = BASE_RESOURCE_PRICE[res] * TRADE_IMPORT_PRICE_MULT;
      let cargo = TRADE_IMPORT_MAX_PER_DAY; // the boat's daily hold for this good
      // What local producers still hold of this good (post-export) — tomorrow morning's local
      // supply, which outranks the boat. Consumers claim it in id order as they're considered.
      let localStock = this.producersOf(res).reduce((s, p) => s + (p.resources[res] ?? 0), 0);
      for (const firm of this.consumersOf(res)) {
        if (cargo <= 0) break;
        const a = ARCHETYPES[firm.kind];
        const outStock = a.sellsToResidents ? firm.inventory : firm.resources[a.produces!] ?? 0;
        const deficit = Math.min(
          this.market.effectiveCapacityOf(firm),
          Math.max(0, this.market.effectiveTargetOf(firm) - outStock),
        );
        const want = Math.max(0, deficit - (firm.resources[res] ?? 0));
        // Right of first refusal: the gap the local market can still fill is reserved for it.
        const localClaim = Math.min(want, localStock);
        localStock -= localClaim;
        const shortfall = want - localClaim;
        // Integer units the firm can actually pay for — the transfer settles in full, so cash
        // moved matches units landed exactly.
        const units = Math.min(shortfall, cargo, Math.floor(firm.cash / landedPrice));
        if (units <= 0) continue;
        const paid = this.world.transfer(firm.id, port.id, units * landedPrice); // firm → port; conserved
        if (paid <= 0) continue;
        firm.resources[res] = (firm.resources[res] ?? 0) + units; // landed from abroad (non-cash)
        firm.pnl.importSpend = (firm.pnl.importSpend ?? 0) + paid;
        cargo -= units;
      }
    }
  }

  /**
   * Every active producer of a resource, id-sorted — the same deterministic pool
   * {@link MarketSystem.producersOf} uses, so a respawned or second producer joins the export
   * channel exactly as it joins the local one.
   */
  private producersOf(resource: ResourceKind): Business[] {
    return this.world.businesses
      .filter((b) => b.active && ARCHETYPES[b.kind].produces === resource)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Every active consumer of a resource (storefronts + processors that buy it as input),
   * id-sorted — the import counterpart of {@link producersOf}.
   */
  private consumersOf(resource: ResourceKind): Business[] {
    return this.world.businesses
      .filter((b) => b.active && ARCHETYPES[b.kind].consumes === resource)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
