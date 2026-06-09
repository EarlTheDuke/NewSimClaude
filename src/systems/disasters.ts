import type { World } from "../world/World";
import type { ResourceKind } from "../world/types";
import type { SeededRNG } from "../utils/rng";
import type { MarketSystem } from "./MarketSystem";
import { ARCHETYPES } from "../world/archetypes";
import { RESOURCE_KINDS } from "../world/industries";
import { PRICE_MAX_MULT, LANDLORD_RESERVE, GRANT_AMOUNT } from "./constants";

/**
 * Phase 6 — disasters & drama. Each disaster is a small, self-contained shock
 * to the city. The non-negotiable invariant: **every effect conserves money.**
 * A disaster may destroy goods (inventory/resources), shift residents' needs,
 * nudge a market price, or move *existing* cash via {@link World.transfer} — but
 * it never mints or burns a dollar. So `world.totalMoney()` is unchanged by any
 * disaster, and the closed economy stays closed even when the city is on fire.
 *
 * Disasters draw from the EventSystem's *own* RNG, never the simulation's, so
 * turning drama on perturbs only the direct effects below — the rest of the run
 * plays out bit-for-bit as it would have without them.
 */

export type DisasterKind = "fire" | "festival" | "illness" | "supplyShock" | "grant";

/** A single thing that happened, for the events log / UI. */
export interface DisasterRecord {
  /** Sim-day the disaster struck. */
  day: number;
  kind: DisasterKind;
  /** Human-readable one-liner for the log. */
  headline: string;
  /** Business id, resource, or first victim — whatever the glyph should mark. */
  targetId?: string;
}

/** Everything a disaster may touch. RNG here is the EventSystem's isolated stream. */
export interface DisasterContext {
  world: World;
  market: MarketSystem;
  rng: SeededRNG;
}

/** What a disaster reports back, or null when conditions meant it fizzled. */
export type DisasterOutcome = { headline: string; targetId?: string } | null;

/** A registered disaster: how likely it is, and what it does. */
export interface DisasterDef {
  kind: DisasterKind;
  /** Relative likelihood within the roster (weighted pick). */
  weight: number;
  apply(ctx: DisasterContext): DisasterOutcome;
}

// Slice 4: the shockable resources are the registry's LIVE array, in stable order — a city's
// extra resource becomes shockable automatically. Byte-identical for the seeded four.
const RESOURCES: ResourceKind[] = RESOURCE_KINDS;

/** Keep a need value within its valid 0..100 band. */
function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Does this business have anything a fire could consume? */
function hasBurnableGoods(b: { inventory: number; resources: Partial<Record<ResourceKind, number>> }): boolean {
  return b.inventory > 0 || RESOURCES.some((r) => (b.resources[r] ?? 0) > 0);
}

/**
 * Fire — strikes one active business holding goods and destroys 40–80% of its
 * sellable inventory and each resource stock. Money is untouched (goods are not
 * money), so it is conservation-safe by construction.
 */
const fire: DisasterDef = {
  kind: "fire",
  weight: 3,
  apply({ world, rng }) {
    const burnable = world.businesses.filter((b) => b.active && hasBurnableGoods(b));
    if (burnable.length === 0) return null;

    const biz = rng.pick(burnable);
    const invLost = Math.ceil(biz.inventory * rng.range(0.4, 0.8));
    biz.inventory = Math.max(0, biz.inventory - invLost);

    let stockLost = 0;
    for (const res of RESOURCES) {
      const have = biz.resources[res] ?? 0;
      if (have <= 0) continue;
      const lost = Math.ceil(have * rng.range(0.4, 0.8));
      biz.resources[res] = have - lost;
      stockLost += lost;
    }

    return {
      headline: `Fire at ${biz.name} — ${invLost} goods, ${stockLost} stock destroyed`,
      targetId: biz.id,
    };
  },
};

/**
 * Festival — a city-wide good day. Everyone's social need is fully met, at the
 * cost of some energy (a late night out). Needs only; money untouched.
 */
const festival: DisasterDef = {
  kind: "festival",
  weight: 2,
  apply({ world }) {
    if (world.residents.length === 0) return null;
    for (const r of world.residents) {
      r.needs.social = 100;
      r.needs.energy = clampNeed(r.needs.energy - 18);
    }
    return { headline: `Festival in the square — the whole city turns out` };
  },
};

/**
 * Illness — a handful of residents take ill: drained energy and a hit to
 * hunger (too unwell to eat well). Needs only; money untouched.
 */
const illness: DisasterDef = {
  kind: "illness",
  weight: 2,
  apply({ world, rng }) {
    const pool = [...world.residents];
    if (pool.length === 0) return null;
    const k = Math.min(pool.length, rng.int(2, 6)); // 2–5 victims

    const victims = [];
    for (let i = 0; i < k; i++) {
      // Partial Fisher–Yates: pick a distinct resident each iteration.
      const j = rng.int(i, pool.length);
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
      const v = pool[i]!;
      v.needs.energy = rng.range(5, 20);
      v.needs.hunger = clampNeed(v.needs.hunger - 20);
      victims.push(v);
    }
    return { headline: `A bug goes around — ${k} residents fall ill`, targetId: victims[0]!.id };
  },
};

/**
 * Supply shock — one resource's price spikes to its ceiling for the day. The
 * pinch is felt later as dearer procurement (still a conserving transfer), so
 * no money moves here.
 */
const supplyShock: DisasterDef = {
  kind: "supplyShock",
  weight: 2,
  apply({ market, rng }) {
    const resource = rng.pick(RESOURCES);
    const price = market.shockPrice(resource, PRICE_MAX_MULT);
    return {
      headline: `Supply shock — ${resource} jumps to $${price.toFixed(2)}/unit`,
      targetId: resource,
    };
  },
};

/**
 * Grant — the landlord bankrolls the neediest business with a one-off relief
 * payment (capped, and only from cash above its reserve). Pure transfer of
 * existing cash, so totally money-conserving.
 */
const grant: DisasterDef = {
  kind: "grant",
  weight: 1,
  apply({ world }) {
    const landlord = world.getBusiness("biz_landlord");
    if (!landlord || !landlord.active) return null;

    let needy: typeof landlord | undefined;
    for (const b of world.businesses) {
      if (!b.active || ARCHETYPES[b.kind].collectsRent) continue;
      if (!needy || b.cash < needy.cash) needy = b;
    }
    if (!needy) return null;

    const amount = Math.min(GRANT_AMOUNT, landlord.cash - LANDLORD_RESERVE);
    if (amount <= 0) return null;

    const moved = world.transfer(landlord.id, needy.id, amount);
    if (moved <= 0) return null;
    return {
      headline: `Relief grant — ${needy.name} receives $${moved.toFixed(0)}`,
      targetId: needy.id,
    };
  },
};

/** The active roster. Effects are all money-conserving by construction. */
export const DISASTERS: readonly DisasterDef[] = [fire, festival, illness, supplyShock, grant];
