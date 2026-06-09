import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { CAPITAL_BASELINE } from "./constants";
import type { Business } from "../world/types";

/**
 * Initiative #2, slice 2 — multi-producer B2B (the unlock). Until now the supply
 * chain reached only the *first* active producer of a resource: a second farm/factory
 * would sit there never receiving an order. This splits each buyer's procurement
 * across the WHOLE producer pool (proportional to stock), so a second producer can
 * actually trade — the prerequisite for producer entry (slice 3), data-driven
 * industries (slice 4), and producer competition (Initiative B). With one producer
 * per resource (the seeded city) every path collapses to the old math, so the 394-test
 * soak/determinism suite is the byte-identity guard; here we exercise the two-producer case.
 */
describe("MarketSystem — multi-producer B2B (Initiative #2 slice 2)", () => {
  /** Open a second farm co-located with the seeded one (producers have no geography), staffed from the jobless. */
  function withSecondFarm(seed = 1) {
    const c = createCity({ seed, businessEntry: false, unemployed: 4 }); // isolate; spare labour to staff it
    const farm1 = c.world.getBusiness("biz_farm")!;
    const crew = c.world.residents.filter((r) => r.jobId === "").slice(0, 2);
    const farm2: Business = {
      id: "biz_farm_2",
      name: "Second Farm",
      kind: "farm",
      ownerId: farm1.ownerId,
      locationId: farm1.locationId, // B2B is by resource, not place — co-location is fine
      cash: 5000,
      inventory: 0,
      price: 0,
      employeeIds: crew.map((r) => r.id),
      wagePerTick: farm1.wagePerTick,
      baseWagePerTick: farm1.baseWagePerTick ?? farm1.wagePerTick,
      pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0, distributed: 0 },
      resources: { grain: 0 },
      active: true,
      capital: CAPITAL_BASELINE,
    };
    for (const r of crew) {
      r.jobId = "biz_farm_2";
      r.wagePerTick = farm2.wagePerTick;
    }
    c.world.businesses.push(farm2);
    return c;
  }

  it("splits the bakery's grain orders across BOTH farms (the second producer trades)", () => {
    const { sim, world } = withSecondFarm();
    const startMoney = world.totalMoney();

    sim.run(TICKS_PER_DAY * 12);

    const farm1 = world.getBusiness("biz_farm")!;
    const farm2 = world.getBusiness("biz_farm_2")!;
    // The headline: the chain reached BOTH producers — each sold grain downstream.
    expect(farm1.pnl.revenue).toBeGreaterThan(0);
    expect(farm2.pnl.revenue).toBeGreaterThan(0);
    // Closed economy held through the split procurement.
    expect(world.totalMoney()).toBeCloseTo(startMoney, 4);
  });

  it("is deterministic: the same two-farm town serializes identically", () => {
    const build = () => {
      const c = withSecondFarm(7);
      c.sim.run(TICKS_PER_DAY * 12);
      return c.world.serialize();
    };
    expect(build()).toEqual(build());
  });

  it("leaves the single-producer city untouched — one farm still sells, money conserved", () => {
    // A guard that the pool path is a no-op with one producer (belt-and-braces over the soaks).
    const { sim, world } = createCity({ seed: 1, businessEntry: false });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 12);
    expect(world.getBusiness("biz_farm")!.pnl.revenue).toBeGreaterThan(0);
    expect(world.totalMoney()).toBeCloseTo(start, 4);
  });
});
