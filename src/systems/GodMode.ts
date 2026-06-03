import type { World } from "../world/World";
import type { Needs, ResourceKind } from "../world/types";
import { SeededRNG } from "../utils/rng";
import type { MarketSystem } from "./MarketSystem";
import type { EventSystem } from "./EventSystem";
import { DISASTERS, type DisasterKind } from "./disasters";
import { GODMODE_LOG_SIZE, PRICE_MAX_MULT } from "./constants";

/**
 * Phase 7 — God Mode. Direct interventions an observer can apply to the *live*
 * city. Unlike a {@link System} it never runs in the tick loop; it only acts
 * when a method is called, so simply having it around perturbs nothing and a
 * hands-off run stays bit-for-bit identical.
 *
 * Every intervention is **money-conserving** — needs, prices, and the active
 * flag aren't money, and the one cash operation ({@link GodMode.subsidize}) is a
 * transfer between two existing holders. So `world.totalMoney()` is invariant
 * under God Mode too: the god may redistribute and stir up drama, but never
 * mints or burns a dollar.
 *
 * Each act is appended to an intervention log; forced disasters are *also*
 * mirrored into the {@link EventSystem} log (when present) so they surface in
 * the same city-events panel and on-canvas glyph as organic ones.
 */

export type InterventionKind =
  | "strike"
  | "subsidize"
  | "setNeed"
  | "healAll"
  | "exhaustAll"
  | "setActive"
  | "shockPrice";

/** A single divine act, for the God Mode log / UI. */
export interface InterventionRecord {
  /** Sim-day the act was applied. */
  day: number;
  kind: InterventionKind;
  /** Human-readable one-liner. */
  headline: string;
  /** Business id, resident id, or resource the act targeted. */
  targetId?: string;
}

/** Minimal clock the controller reads to stamp records — satisfied by TimeSystem. */
export interface Clock {
  time(): { day: number };
}

function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export class GodMode {
  private readonly rng: SeededRNG;
  private readonly log: InterventionRecord[] = [];

  constructor(
    private readonly world: World,
    private readonly market: MarketSystem,
    private readonly clock: Clock,
    seed: number,
    private readonly events?: EventSystem,
  ) {
    // Its own stream, decorrelated from both the sim and the EventSystem, so a
    // manual strike never shifts the organic disaster schedule.
    this.rng = new SeededRNG((seed ^ 0x6d2b79f5) >>> 0);
  }

  /**
   * Force a specific disaster to strike immediately. Money-conserving by
   * construction (it reuses the same disaster definitions). Returns the record,
   * or null if the disaster fizzled (e.g. fire with nothing left to burn).
   */
  strike(kind: DisasterKind): InterventionRecord | null {
    const def = DISASTERS.find((d) => d.kind === kind);
    if (!def) return null;
    const outcome = def.apply({ world: this.world, market: this.market, rng: this.rng });
    if (!outcome) return null;

    const day = this.day();
    // Mirror into the organic events log so the existing UI shows it for free.
    this.events?.record({ day, kind: def.kind, headline: outcome.headline, targetId: outcome.targetId });
    return this.push({ day, kind: "strike", headline: outcome.headline, targetId: outcome.targetId });
  }

  /** Move existing cash between two holders (conserving). Returns the record, or null if nothing moved. */
  subsidize(fromId: string, toId: string, amount: number): InterventionRecord | null {
    const moved = this.world.transfer(fromId, toId, amount);
    if (moved <= 0) return null;
    return this.push({
      day: this.day(),
      kind: "subsidize",
      headline: `Subsidy — $${moved.toFixed(0)} moved to ${this.holderName(toId)}`,
      targetId: toId,
    });
  }

  /**
   * Bail out the poorest active non-landlord business from the landlord's cash —
   * a one-click convenience over {@link subsidize}. Caps at what the landlord has.
   */
  bailOutPoorest(amount: number): InterventionRecord | null {
    const landlord = this.world.getBusiness("biz_landlord");
    if (!landlord || !landlord.active) return null;

    let needy: typeof landlord | undefined;
    for (const b of this.world.businesses) {
      if (!b.active || b.kind === "landlord") continue;
      if (!needy || b.cash < needy.cash) needy = b;
    }
    if (!needy) return null;

    const moved = this.world.transfer(landlord.id, needy.id, amount);
    if (moved <= 0) return null;
    return this.push({
      day: this.day(),
      kind: "subsidize",
      headline: `Bailout — ${needy.name} receives $${moved.toFixed(0)}`,
      targetId: needy.id,
    });
  }

  /** Set one of a resident's needs (clamped to 0..100). Doesn't touch money. */
  setNeed(residentId: string, need: keyof Needs, value: number): InterventionRecord | null {
    const r = this.world.getResident(residentId);
    if (!r) return null;
    r.needs[need] = clampNeed(value);
    return this.push({
      day: this.day(),
      kind: "setNeed",
      headline: `${r.name}: ${need} set to ${r.needs[need].toFixed(0)}`,
      targetId: r.id,
    });
  }

  /** Bless the city: every resident's needs fully restored. */
  healAll(): InterventionRecord {
    for (const r of this.world.residents) {
      r.needs.hunger = 100;
      r.needs.energy = 100;
      r.needs.social = 100;
    }
    return this.push({ day: this.day(), kind: "healAll", headline: "Blessing — the whole city is restored" });
  }

  /** Afflict the city: every resident's needs drained to zero. */
  exhaustAll(): InterventionRecord {
    for (const r of this.world.residents) {
      r.needs.hunger = 0;
      r.needs.energy = 0;
      r.needs.social = 0;
    }
    return this.push({ day: this.day(), kind: "exhaustAll", headline: "Malaise — the whole city is drained" });
  }

  /** Shutter (false) or revive (true) a business. Doesn't touch money. */
  setActive(bizId: string, active: boolean): InterventionRecord | null {
    const b = this.world.getBusiness(bizId);
    if (!b) return null;
    b.active = active;
    return this.push({
      day: this.day(),
      kind: "setActive",
      headline: `${b.name} ${active ? "revived" : "shuttered"} by decree`,
      targetId: b.id,
    });
  }

  /** Force a resource's price (default: to its ceiling). Doesn't touch money. */
  shockPrice(resource: ResourceKind, multiplier: number = PRICE_MAX_MULT): InterventionRecord {
    const price = this.market.shockPrice(resource, multiplier);
    return this.push({
      day: this.day(),
      kind: "shockPrice",
      headline: `Decree — ${resource} fixed at $${price.toFixed(2)}/unit`,
      targetId: resource,
    });
  }

  /** All retained intervention records, oldest first. */
  interventions(): readonly InterventionRecord[] {
    return this.log;
  }

  /** The most recent intervention, if any. */
  latest(): InterventionRecord | undefined {
    return this.log[this.log.length - 1];
  }

  private day(): number {
    return this.clock.time().day;
  }

  private holderName(id: string): string {
    return this.world.getBusiness(id)?.name ?? this.world.getResident(id)?.name ?? id;
  }

  private push(rec: InterventionRecord): InterventionRecord {
    this.log.push(rec);
    if (this.log.length > GODMODE_LOG_SIZE) this.log.shift();
    return rec;
  }
}
