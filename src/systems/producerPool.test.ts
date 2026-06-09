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

/**
 * Initiative B slice 1 — producer competition. The multi-producer split now weights each
 * producer's share by its competitiveness (cheaper unit cost ⇒ more share), so the supply side
 * truly competes. At strength 0 it is the proportional-to-stock slice-2 split (byte-identical,
 * covered above + by the soaks); here we exercise the competitive case.
 */
describe("MarketSystem — producer competition (Initiative B slice 1)", () => {
  /**
   * Two farms with EQUAL stock + capacity (2 crew, baseline capital each) but different wages,
   * so the only difference is unit cost. biz_farm is the seeded "dear" supplier; biz_farm_2 is a
   * cheap rival. `producerCompetition` controls how hard the chain favours the cheaper one.
   */
  function competingFarms(producerCompetition: number) {
    const c = createCity({ seed: 1, businessEntry: false, unemployed: 6, producerCompetition });
    const dear = c.world.getBusiness("biz_farm")!;
    dear.wagePerTick = 0.16; // pricey labour ⇒ high unit cost
    dear.baseWagePerTick = 0.16;
    dear.cash = 6000; // both well-capitalised so neither dies inside the window
    dear.resources.grain = 50;
    const crew = c.world.residents.filter((r) => r.jobId === "").slice(0, 2);
    const cheap: Business = {
      id: "biz_farm_2",
      name: "Thrift Farm",
      kind: "farm",
      ownerId: dear.ownerId,
      locationId: dear.locationId, // B2B is by resource, not place
      cash: 6000,
      inventory: 0,
      price: 0,
      employeeIds: crew.map((r) => r.id),
      wagePerTick: 0.04, // cheap labour ⇒ low unit cost
      baseWagePerTick: 0.04,
      pnl: { revenue: 0, wagesPaid: 0, rentCollected: 0, distributed: 0 },
      resources: { grain: 50 }, // equal stock, so any share skew is from cost, not inventory
      active: true,
      capital: CAPITAL_BASELINE,
    };
    for (const r of crew) {
      r.jobId = "biz_farm_2";
      r.wagePerTick = cheap.wagePerTick;
    }
    c.world.businesses.push(cheap);
    return c;
  }

  /** The cheaper farm's share of the two farms' total grain revenue after a run. */
  function cheapShare(producerCompetition: number) {
    const c = competingFarms(producerCompetition);
    const start = c.world.totalMoney();
    c.sim.run(TICKS_PER_DAY * 12);
    const cheap = c.world.getBusiness("biz_farm_2")!;
    const dear = c.world.getBusiness("biz_farm")!;
    const total = cheap.pnl.revenue + dear.pnl.revenue;
    return { share: total > 0 ? cheap.pnl.revenue / total : 0, cheap, dear, start, end: c.world.totalMoney() };
  }

  it("off (strength 0): equal stock ⇒ the two farms split B2B grain roughly evenly", () => {
    const { share, end, start } = cheapShare(0);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6); // proportional-to-stock, equal stock ⇒ ~50/50
    expect(end).toBeCloseTo(start, 4);
  });

  it("on (strength 2): the cheaper, more efficient farm wins MORE of the order", () => {
    const off = cheapShare(0);
    const on = cheapShare(2);
    expect(on.share).toBeGreaterThan(off.share + 0.1); // competition skews share to the efficient supplier
    expect(on.cheap.pnl.revenue).toBeGreaterThan(on.dear.pnl.revenue);
    expect(on.end).toBeCloseTo(on.start, 4); // closed economy held
  });

  it("is deterministic: the same competitive town serializes identically", () => {
    const build = () => {
      const c = competingFarms(2);
      c.sim.run(TICKS_PER_DAY * 12);
      return c.world.serialize();
    };
    expect(build()).toEqual(build());
  });
});
