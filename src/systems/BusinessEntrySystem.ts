import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Business, BusinessKind, Resident } from "../world/types";
import { ARCHETYPES } from "../world/archetypes";
import {
  BUSINESS_ENTRY,
  ENTREPRENEUR_MIN_SAVINGS,
  NEW_FIRM_CAPITAL,
  ENTRY_COOLDOWN_DAYS,
  DESIRED_HEADCOUNT,
  CAPITAL_BASELINE,
  RETAIL_REFERENCE_PRICE,
} from "./constants";

/** Kinds an entrepreneur can found — everyone who produces or sells; not the landlord. */
const ENTRANT_KINDS: BusinessKind[] = ["diner", "goods", "farm", "mine", "bakery", "factory"];

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
 * Deterministic: fixed kind order, the lowest-index eligible founder, a serialized
 * spawn counter for unique ids, no RNG. Conservation-safe: the only money move is
 * the founder's transfer into the firm. A cooldown spaces births so a wave of deaths
 * heals gradually rather than thrashing. Inert until a kind goes extinct, so the
 * seeded city is byte-identical.
 */
export class BusinessEntrySystem implements System {
  readonly id = "business-entry";
  private lastEntryDay = -ENTRY_COOLDOWN_DAYS;
  private spawnCount = 0;

  constructor(
    private readonly world: World,
    /** Whether births are enabled; defaults to the live {@link BUSINESS_ENTRY}. Tests pass false to isolate lifecycle. */
    private readonly enabled: boolean = BUSINESS_ENTRY,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled) return;
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();
    if (day - this.lastEntryDay < ENTRY_COOLDOWN_DAYS) return;

    const kind = this.emptyNiche();
    if (kind === undefined) return;
    const founder = this.entrepreneur();
    if (!founder) return;

    this.found(kind, founder);
    this.lastEntryDay = day;
  }

  /** The decision trace surfaces the latest birth via the founded firm's id. */
  lastFoundedId: string | undefined;

  /** The first kind (fixed order) with no active firm — a standing unmet demand. */
  private emptyNiche(): BusinessKind | undefined {
    return ENTRANT_KINDS.find(
      (kind) => !this.world.businesses.some((b) => b.kind === kind && b.active),
    );
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

  private found(kind: BusinessKind, founder: Resident): void {
    // Reuse a (now dead) firm of this kind as the template: same spot, name, base wage.
    const template = this.world.businesses.find((b) => b.kind === kind);
    if (!template) return; // unreachable — every kind is seeded — but keeps us total

    const produces = ARCHETYPES[kind].produces;
    const wage = template.baseWagePerTick ?? template.wagePerTick;
    this.spawnCount += 1;
    const biz: Business = {
      id: `biz_${kind}_gen${this.spawnCount}`,
      name: template.name,
      kind,
      ownerId: founder.id, // the founder owns it — and earns its dividend
      locationId: template.locationId, // reopen at the dead firm's location
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

  serialize(): unknown {
    return { lastEntryDay: this.lastEntryDay, spawnCount: this.spawnCount };
  }

  restore(state: unknown): void {
    const s = state as { lastEntryDay?: number; spawnCount?: number } | undefined;
    this.lastEntryDay = s?.lastEntryDay ?? -ENTRY_COOLDOWN_DAYS;
    this.spawnCount = s?.spawnCount ?? 0;
  }
}
