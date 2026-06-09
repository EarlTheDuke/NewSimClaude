import { describe, it, expect, afterEach } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { ARCHETYPES } from "./archetypes";
import { resetIndustries, type Archetype, type IndustryDef } from "./industries";
import type { BusinessKind } from "./types";

/**
 * Initiative #2 slice 4d — a genuinely NEW industry, registered at city-build time. The "orchard"
 * is a new *kind* (outside the seeded union — reached via one contained cast) producing an existing
 * resource (grain); the bakery buys its grain alongside the farm via slice 2's multi-producer pool,
 * so it trades end-to-end. Resident-facing new kinds need need→kind routing in EconomySystem (a
 * follow-on), so the construction-time demo uses the B2B side, which is fully general already.
 */
const ORCHARD: IndustryDef = {
  kind: "orchard" as BusinessKind,
  produces: "grain",
  sellsToResidents: false,
  target: 50,
  maxPerDay: 36,
};

/** Read an archetype by a possibly-unregistered kind without fighting the seeded union type. */
const archetypeOf = (kind: string): Archetype | undefined =>
  (ARCHETYPES as Record<string, Archetype | undefined>)[kind];

describe("extra industries — register a new kind at build time (slice 4d)", () => {
  afterEach(() => resetIndustries()); // restore the seeded registry for any later test/file

  it("registers the new kind into ARCHETYPES and seeds it as a real, staffed, owned firm", () => {
    const { world } = createCity({ seed: 1, extraIndustries: [ORCHARD], residentCount: 16 });

    expect(archetypeOf("orchard")).toEqual({
      consumes: undefined,
      produces: "grain",
      sellsToResidents: false,
      target: 50,
      maxPerDay: 36,
      collectsRent: undefined,
      capitalGoodsVendor: undefined,
    });
    const orchard = world.getBusiness("biz_orchard")!;
    expect(orchard).toBeDefined();
    expect(orchard.kind).toBe("orchard");
    expect(world.residents.some((r) => r.id === orchard.ownerId)).toBe(true); // owned by a resident
    expect(orchard.employeeIds.length).toBeGreaterThan(0); // crewed by the normal staffing round-robin
  });

  it("trades end-to-end — the bakery buys its grain via the pool; the closed economy holds", () => {
    const { sim, world } = createCity({ seed: 1, extraIndustries: [ORCHARD], residentCount: 16 });
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * 20);

    const orchard = world.getBusiness("biz_orchard")!;
    expect(orchard.pnl.revenue).toBeGreaterThan(0); // the new industry actually sold grain downstream
    expect(world.totalMoney()).toBeCloseTo(start, 4); // conserved with an 8th industry in the loop
  });

  it("is deterministic: same seed + same extras ⇒ identical world", () => {
    const build = () => {
      const c = createCity({ seed: 3, extraIndustries: [ORCHARD], residentCount: 16 });
      c.sim.run(TICKS_PER_DAY * 15);
      return c.world.serialize();
    };
    expect(build()).toEqual(build());
  });

  it("is byte-identical with no extras — the seeded city is untouched", () => {
    // After a seeded build the per-build reset leaves the registry with no orchard.
    const seeded = createCity({ seed: 1 });
    expect(seeded.world.getBusiness("biz_orchard")).toBeUndefined();
    expect(archetypeOf("orchard")).toBeUndefined();
    // And two seeded builds still match exactly (the reset is idempotent).
    const a = createCity({ seed: 1 });
    const b = createCity({ seed: 1 });
    a.sim.run(TICKS_PER_DAY * 10);
    b.sim.run(TICKS_PER_DAY * 10);
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});
