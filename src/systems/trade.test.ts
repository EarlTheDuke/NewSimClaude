import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import {
  PORT_SEED_CASH,
  TRADE_WORLD_PRICE_MULT,
  TRADE_EXPORT_MAX_PER_DAY,
  TRADE_EXPORT_STOCK_FLOOR,
} from "./constants";
import { ARCHETYPES } from "../world/archetypes";
import { RESOURCE_KINDS, BASE_RESOURCE_PRICE } from "../world/industries";

/**
 * Initiative C / C4 slice a1 — the inert external-trade seam. The TradeSystem is registered (right
 * after the market) but does nothing: no port is seeded by default, no trade fires, no money moves.
 * The default city must be byte-identical, and even with `tradeEnabled` on the a1 stub is a true
 * no-op. The Port arrives as a registry entry with a `port` role flag (the bank's 18b pattern) —
 * seeded as NEW genesis money (the rest of the world's reserve), not carved from a city holder.
 */
describe("TradeSystem — inert seam (C4 slice a1)", () => {
  it("the default city has no port and conserves money over 30 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    expect(world.getBusiness("biz_port")).toBeUndefined();
    expect(world.businesses).toHaveLength(7);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("tradeEnabled:true with no port is byte-identical to off (the stub is a true no-op)", () => {
    const off = createCity({ seed: 1 });
    off.sim.run(TICKS_PER_DAY * 20);
    const on = createCity({ seed: 1, tradeEnabled: true });
    on.sim.run(TICKS_PER_DAY * 20);
    expect(on.world.serialize()).toEqual(off.world.serialize());
  });

  it("includePort alone (trade off) leaves the run byte-identical except the port itself", () => {
    const plain = createCity({ seed: 1 });
    plain.sim.run(TICKS_PER_DAY * 20);
    const ported = createCity({ seed: 1, includePort: true });
    ported.sim.run(TICKS_PER_DAY * 20);
    // Strip the port + its location: everything the city itself did must match exactly.
    const snap = ported.world.serialize();
    snap.businesses = snap.businesses.filter((b) => b.id !== "biz_port");
    snap.locations = snap.locations.filter((l) => l.id !== "loc_port");
    expect(snap).toEqual(plain.world.serialize());
  });

  it("seeds the port as NEW genesis money — every city holder untouched", () => {
    const plain = createCity({ seed: 1 });
    const ported = createCity({ seed: 1, includePort: true });

    const port = ported.world.getBusiness("biz_port")!;
    expect(port).toBeDefined();
    expect(port.kind).toBe("port");
    expect(port.cash).toBe(PORT_SEED_CASH);
    expect(port.active).toBe(true);
    expect(port.employeeIds).toHaveLength(0);
    // Unlike the bank (carved from the landlord), the port's reserve is the rest of the world's
    // money: the genesis total is simply higher by exactly the seed, and no city holder moved.
    expect(ported.world.getBusiness("biz_landlord")!.cash).toBe(
      plain.world.getBusiness("biz_landlord")!.cash,
    );
    expect(ported.world.totalMoney()).toBeCloseTo(plain.world.totalMoney() + PORT_SEED_CASH, 6);
  });

  it("conserves the higher genesis to the cent across 60 days with the port present", () => {
    const { sim, world } = createCity({ seed: 1, includePort: true, tradeEnabled: true });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 60);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("nothing touches the port's reserve: distribution, welfare levy, bank savings, lifecycle all shielded", () => {
    // The harshest cash-sweep stack available: dividends, an engaged welfare levy, bank savings
    // yield, agentic firms — the port must come out holding EXACTLY its seed, still active.
    // (Trade itself stays OFF here: this test isolates the SWEEP shields; only the TradeSystem
    // may ever move the port's money, and that is a2/a3's own assertion.)
    const { sim, world } = createCity({
      seed: 1,
      includePort: true,
      tradeEnabled: false,
      includeBank: true,
      creditEnabled: true,
      creditDailyRate: 0.003,
      creditSavingsRate: 0.001,
      welfareRatio: 0.5,
      welfareSubsistence: 2,
      brain: "rules",
      residentBrain: "rules",
      agenticResidentIds: "all",
    });
    sim.run(TICKS_PER_DAY * 60);
    const port = world.getBusiness("biz_port")!;
    expect(port.cash).toBe(PORT_SEED_CASH); // exact — not one cent in or out in a1
    expect(port.active).toBe(true);
    expect(port.pnl.distributed).toBe(0);
    expect(port.employeeIds).toHaveLength(0); // never staffed (maxPerDay 0)
  });

  it("is deterministic with port + trade set: seed 7 twice → identical world", () => {
    const run = () => {
      const c = createCity({ seed: 7, includePort: true, tradeEnabled: true });
      c.sim.run(TICKS_PER_DAY * 20);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });

  it("round-trips through save/load with the port (TradeSystem is stateless)", () => {
    const original = createCity({ seed: 1, includePort: true, tradeEnabled: true });
    original.sim.run(TICKS_PER_DAY * 20);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 99, includePort: true, tradeEnabled: true });
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });
});

/**
 * Slice a2 — export demand. The port buys each resource's surplus (stock above the keep-floor) at
 * frozen world prices, `port → firm`, bounded by its daily order and its remaining reserve. The
 * exports term enters GDP; the conservation invariant holds with money merely shifting port→city.
 */
describe("TradeSystem — export demand (C4 slice a2)", () => {
  const engaged = (seed: number) => createCity({ seed, includePort: true, tradeEnabled: true });

  it("exports fire from day one: producers sell surplus, the port pays, money is conserved", () => {
    const { sim, world } = engaged(1);
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY); // one full day — market produces, then the port buys
    const port = world.getBusiness("biz_port")!;
    const totalExports = world.businesses.reduce((s, b) => s + (b.pnl.exportRevenue ?? 0), 0);
    expect(totalExports).toBeGreaterThan(0); // the seeded stocks sit above their floors
    // The port paid out exactly what the firms booked — a pure shift inside the conserved total.
    expect(port.cash).toBeCloseTo(PORT_SEED_CASH - totalExports, 6);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("respects the keep-floor and the daily order cap on day one", () => {
    const { sim, world } = engaged(1);
    sim.run(TICKS_PER_DAY);
    for (const res of RESOURCE_KINDS) {
      const worldPrice = BASE_RESOURCE_PRICE[res] * TRADE_WORLD_PRICE_MULT;
      let unitsExported = 0;
      for (const b of world.businesses) {
        if (ARCHETYPES[b.kind].produces !== res) continue;
        // Post-trade stock never sits below the keep-floor (the morning's procurement may take it
        // lower tomorrow — that's the local market's claim, not the dock's).
        const keep = Math.ceil(ARCHETYPES[b.kind].target * TRADE_EXPORT_STOCK_FLOOR);
        if ((b.pnl.exportRevenue ?? 0) > 0) {
          expect(b.resources[res] ?? 0).toBeGreaterThanOrEqual(keep);
          unitsExported += (b.pnl.exportRevenue ?? 0) / worldPrice;
        }
      }
      expect(unitsExported).toBeLessThanOrEqual(TRADE_EXPORT_MAX_PER_DAY + 1e-9);
    }
  });

  it("MacroSystem reports the exports term and adds it to GDP", () => {
    const { sim, macro } = engaged(1);
    sim.run(TICKS_PER_DAY * 5);
    const sample = macro.latest()!;
    expect(sample.exports).toBeGreaterThan(0);
    expect(sample.gdp).toBeCloseTo(sample.consumption + sample.investment + sample.exports, 6);
  });

  it("a portless city reads exports 0 and gdp = consumption + investment, exactly as before", () => {
    const { sim, macro } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 5);
    const sample = macro.latest()!;
    expect(sample.exports).toBe(0);
    expect(sample.gdp).toBeCloseTo(sample.consumption + sample.investment, 6);
  });

  it("export income recirculates: the city's own money grows by exactly the port's drain", () => {
    const { sim, world } = engaged(1);
    const cityStart = world.totalMoney() - PORT_SEED_CASH;
    sim.run(TICKS_PER_DAY * 30);
    const port = world.getBusiness("biz_port")!;
    const cityNow = world.totalMoney() - port.cash;
    // Net exports drain the battery into the city — the demand injection, conserved to the cent.
    expect(port.cash).toBeLessThan(PORT_SEED_CASH);
    expect(cityNow).toBeCloseTo(cityStart + (PORT_SEED_CASH - port.cash), 6);
  });

  it("when the battery runs dry, exports pause — no negative port cash, no crash", () => {
    const { sim, world } = engaged(1);
    // Drain the port to (nearly) nothing, conservingly, then run on: trades must degrade to zero.
    world.transfer("biz_port", "biz_landlord", world.getBusiness("biz_port")!.cash - 1);
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 10);
    const port = world.getBusiness("biz_port")!;
    expect(port.cash).toBeGreaterThanOrEqual(0);
    expect(port.active).toBe(true); // never bankrupted — foreign demand is exhausted, not failed
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("is deterministic while trading: seed 7 twice → identical world + identical macro", () => {
    const run = () => {
      const c = engaged(7);
      c.sim.run(TICKS_PER_DAY * 30);
      return { world: c.world.serialize(), macro: c.macro.history().map((s) => ({ ...s })) };
    };
    expect(run()).toEqual(run());
  });

  it("round-trips mid-trade: export tallies and the macro baseline survive save/load", () => {
    const original = engaged(1);
    original.sim.run(TICKS_PER_DAY * 15);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = engaged(99);
    loaded.sim.restore(snapshotFromJSON(json));
    // Lockstep: run both 10 more days; flows (which difference the restored baseline) must match.
    original.sim.run(TICKS_PER_DAY * 10);
    loaded.sim.run(TICKS_PER_DAY * 10);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
    expect(loaded.macro.latest()).toEqual(original.macro.latest());
  });
});
