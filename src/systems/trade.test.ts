import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { PORT_SEED_CASH } from "./constants";

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
    const { sim, world } = createCity({
      seed: 1,
      includePort: true,
      tradeEnabled: true,
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
