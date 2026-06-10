import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { clampAction, DEFAULT_LIMITS } from "../ai/clamp";
import type {
  BusinessDecision,
  BusinessObservation,
  DecisionProvider,
  DecisionRequest,
} from "../ai/types";
import {
  PORT_SEED_CASH,
  TRADE_WORLD_PRICE_MULT,
  TRADE_EXPORT_MAX_PER_DAY,
  TRADE_EXPORT_STOCK_FLOOR,
  TRADE_IMPORT_PRICE_MULT,
  TRADE_IMPORT_MAX_PER_DAY,
  TRADE_LUXURY_IMPORT_SHARE,
  LUXURY_COST,
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

/**
 * Slice a3 — imports / the current account's other leg. A firm the LOCAL chain left short buys its
 * standing input gap from the port at the dearer landed price (`firm → port`), so money flows back
 * into the demand battery and only NET exports drain it. In a healthy chain the gap is zero —
 * imports are the relief valve, not a replacement supply chain.
 */
describe("TradeSystem — imports / current account (C4 slice a3)", () => {
  /** An engaged trade city whose bakery is dead (and never refilled), starving the diner of food. */
  const starved = (seed: number) => {
    const city = createCity({ seed, includePort: true, tradeEnabled: true, businessEntry: false });
    const bakery = city.world.getBusiness("biz_bakery")!;
    bakery.active = false; // the local food source is gone — only the dock can supply now
    bakery.resources = {};
    return city;
  };

  it("a healthy local chain imports nothing — the valve stays shut", () => {
    const { sim, world, macro } = createCity({ seed: 1, includePort: true, tradeEnabled: true });
    sim.run(TICKS_PER_DAY * 30);
    for (const b of world.businesses) expect(b.pnl.importSpend ?? 0).toBe(0);
    expect(macro.latest()!.imports).toBe(0);
  });

  it("a starved consumer imports its input gap at the landed price, bounded by the boat", () => {
    const { sim, world } = starved(1);
    sim.run(TICKS_PER_DAY); // one day: local procurement fails, the evening boat lands the gap
    const diner = world.getBusiness("biz_diner")!;
    const landedPrice = BASE_RESOURCE_PRICE.food * TRADE_IMPORT_PRICE_MULT;
    const spend = diner.pnl.importSpend ?? 0;
    expect(spend).toBeGreaterThan(0);
    // Units landed match cash paid exactly, and never exceed the boat's daily cargo.
    const unitsLanded = spend / landedPrice;
    expect(diner.resources.food).toBeCloseTo(unitsLanded, 9);
    expect(unitsLanded).toBeLessThanOrEqual(TRADE_IMPORT_MAX_PER_DAY + 1e-9);
  });

  it("imports keep a starved storefront trading — the relief valve works", () => {
    const { sim, world } = starved(1);
    sim.run(TICKS_PER_DAY * 30);
    const diner = world.getBusiness("biz_diner")!;
    expect(diner.active).toBe(true);
    expect(diner.pnl.importSpend ?? 0).toBeGreaterThan(0);
    // Imported food was processed into meals and sold on — the diner still has stock to sell.
    expect(diner.inventory).toBeGreaterThan(0);
  });

  it("the current account nets to the cent: port cash = seed − exports + imports", () => {
    const { sim, world } = starved(1);
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 45);
    const port = world.getBusiness("biz_port")!;
    const exportsTotal = world.businesses.reduce((s, b) => s + (b.pnl.exportRevenue ?? 0), 0);
    const importsTotal = world.businesses.reduce((s, b) => s + (b.pnl.importSpend ?? 0), 0);
    expect(importsTotal).toBeGreaterThan(0);
    expect(port.cash).toBeCloseTo(PORT_SEED_CASH - exportsTotal + importsTotal, 6);
    expect(world.totalMoney()).toBeCloseTo(start, 6); // conserved through the two-way account
  });

  it("MacroSystem reports the −M term: gdp = C + I + X − M", () => {
    const { sim, macro } = starved(1);
    sim.run(TICKS_PER_DAY * 10);
    const sample = macro.latest()!;
    expect(sample.imports).toBeGreaterThan(0);
    expect(sample.gdp).toBeCloseTo(
      sample.consumption + sample.investment + sample.exports - sample.imports,
      6,
    );
  });

  it("the starved import scenario is deterministic: same seed twice → identical world", () => {
    const run = () => {
      const c = starved(7);
      c.sim.run(TICKS_PER_DAY * 20);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});

/**
 * Slice C (C4a-C) — the conserving trade CYCLE. Luxuries carry imported content: each night the
 * goods store pays the port a share of the day's luxury sales to restock its fineries, so city
 * money flows back into the reserve that funds continuing exports — trade self-sustains instead
 * of dying with the battery. Strictly conserving throughout.
 */
describe("TradeSystem — the trade cycle: imported luxury content (C4 slice C)", () => {
  const engaged = (seed: number, share?: number) =>
    createCity({ seed, includePort: true, tradeEnabled: true, luxuryImportShare: share });

  it("charges the store the import share of the day's luxury sales, store → port, conserved", () => {
    const { sim, world } = engaged(1); // live default share (0.3)
    sim.run(TICKS_PER_DAY); // day 1 anchors the luxury baseline
    const port = world.getBusiness("biz_port")!;
    const store = world.getBusiness("biz_goods")!;
    const portBefore = port.cash;
    const start = world.totalMoney();
    // Two luxuries sell during day 2 (the non-cash tally is the sim's own sale signal).
    world.getResident("res_0")!.luxuriesOwned += 2;
    sim.run(TICKS_PER_DAY);
    const owed = 2 * LUXURY_COST * TRADE_LUXURY_IMPORT_SHARE;
    expect(store.pnl.importSpend ?? 0).toBeCloseTo(owed, 6);
    // The port's day-2 net: −exports +luxury restock. Isolate the restock via the X tally delta.
    const x = world.businesses.reduce((s, b) => s + (b.pnl.exportRevenue ?? 0), 0);
    expect(port.cash).toBeCloseTo(portBefore - (x - (PORT_SEED_CASH - portBefore)) + owed, 6);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("share 0 is the pre-C battery model: luxuries sell, nothing flows back", () => {
    const { sim, world } = engaged(1, 0);
    sim.run(TICKS_PER_DAY);
    world.getResident("res_0")!.luxuriesOwned += 3;
    sim.run(TICKS_PER_DAY * 2);
    expect(world.getBusiness("biz_goods")!.pnl.importSpend ?? 0).toBe(0);
  });

  it("a fresh build never back-charges history: the first boundary only anchors", () => {
    const { sim, world } = engaged(1);
    world.getResident("res_0")!.luxuriesOwned = 50; // pre-existing wealth of trinkets
    sim.run(TICKS_PER_DAY); // anchor day — must charge nothing for the 50
    expect(world.getBusiness("biz_goods")!.pnl.importSpend ?? 0).toBe(0);
  });

  it("the charge is capped at the store's cash — no negative balances, still conserved", () => {
    const { sim, world } = engaged(1);
    sim.run(TICKS_PER_DAY);
    const store = world.getBusiness("biz_goods")!;
    world.transfer(store.id, "biz_landlord", store.cash - 10); // drain the till to $10
    world.getResident("res_0")!.luxuriesOwned += 5; // owes 5 × $150 × 0.3 = $225 > $10
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY);
    expect(store.cash).toBeGreaterThanOrEqual(0);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("the luxury baseline survives save/load — no double-charge, no skipped day", () => {
    const original = engaged(1);
    original.sim.run(TICKS_PER_DAY * 5);
    const json = snapshotToJSON(original.sim.serialize());
    const loaded = engaged(99);
    loaded.sim.restore(snapshotFromJSON(json));
    // Lockstep with a luxury sale after the restore point in BOTH arms.
    original.world.getResident("res_1")!.luxuriesOwned += 1;
    loaded.world.getResident("res_1")!.luxuriesOwned += 1;
    original.sim.run(TICKS_PER_DAY * 3);
    loaded.sim.run(TICKS_PER_DAY * 3);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });
});

/** A test mind that sets a fixed export share once, then leaves everything alone. */
class ShareProvider implements DecisionProvider {
  readonly id = "share-test";
  constructor(private readonly share: number) {}
  decide(): BusinessDecision {
    return { action: { setExportShare: this.share }, reason: "share test" };
  }
}

/** Records the last observation it saw, so a test can assert what the mind was shown. */
class CaptureProvider implements DecisionProvider {
  readonly id = "capture";
  last: BusinessObservation | undefined;
  decide(req: DecisionRequest): BusinessDecision {
    this.last = req.observation;
    return { action: {}, reason: "capture" };
  }
}

/**
 * Slice a4 — the CEO export lever. A producing firm decides what fraction of its above-floor
 * surplus to offer the dock (`setExportShare`, clamped [0,1]); its observation gains the decision's
 * inputs (frozen world price vs floating local quote, current stance, yesterday's export cash) —
 * present ONLY when the dock is live for it, the creditRate gating pattern.
 */
describe("TradeSystem — the CEO export lever (C4 slice a4)", () => {
  it("setExportShare 0 stops a firm's exports; the rest of the chain keeps shipping", () => {
    const { sim, world } = createCity({
      seed: 1,
      includePort: true,
      tradeEnabled: true,
      brain: new ShareProvider(0),
      agenticBusinessIds: ["biz_farm"],
    });
    sim.run(TICKS_PER_DAY * 10);
    const farm = world.getBusiness("biz_farm")!;
    const mine = world.getBusiness("biz_mine")!;
    // Day 1's export lands before the first review applies (trade runs before the agent on the
    // boundary tick); from day 2 the farm withholds — its tally freezes at the one day.
    const worldGrainPrice = BASE_RESOURCE_PRICE.grain * TRADE_WORLD_PRICE_MULT;
    expect(farm.pnl.exportRevenue ?? 0).toBeLessThanOrEqual(
      TRADE_EXPORT_MAX_PER_DAY * worldGrainPrice + 1e-9,
    );
    expect(farm.exportShare).toBe(0);
    expect(mine.pnl.exportRevenue ?? 0).toBeGreaterThan(farm.pnl.exportRevenue ?? 0); // others unaffected
  });

  it("a partial share scales the offer: 0.2 of the farm's surplus = 5 units, not the 8-unit cap", () => {
    const run = (share?: number) => {
      const city = createCity({ seed: 1, includePort: true, tradeEnabled: true });
      if (share !== undefined) city.world.getBusiness("biz_farm")!.exportShare = share;
      city.sim.run(TICKS_PER_DAY);
      return city.world.getBusiness("biz_farm")!.pnl.exportRevenue ?? 0;
    };
    const worldGrainPrice = BASE_RESOURCE_PRICE.grain * TRADE_WORLD_PRICE_MULT;
    // Day 1 the farm sits at its target 50; keep-floor 25 ⇒ surplus 25. Full participation hits
    // the 8-unit daily cap; share 0.2 offers floor(25 × 0.2) = 5 — the share binds, not the cap.
    expect(run()).toBeCloseTo(TRADE_EXPORT_MAX_PER_DAY * worldGrainPrice, 6);
    expect(run(0.2)).toBeCloseTo(5 * worldGrainPrice, 6);
  });

  it("shows a producing mind the export signals when the dock is live — and omits them when not", () => {
    const live = new CaptureProvider();
    const ported = createCity({
      seed: 1,
      includePort: true,
      tradeEnabled: true,
      brain: live,
      agenticBusinessIds: ["biz_farm"],
    });
    ported.sim.run(TICKS_PER_DAY);
    expect(live.last!.exportPrice).toBeCloseTo(BASE_RESOURCE_PRICE.grain * TRADE_WORLD_PRICE_MULT, 9);
    expect(live.last!.localPrice).toBeGreaterThan(0); // the floating local quote, for comparison
    expect(live.last!.exportShare).toBe(1); // default stance — full participation
    // Day 1's exports landed before the review: the mind sees the cash in its feedback signal.
    expect(live.last!.dayExportRevenue).toBeGreaterThan(0);

    const dark = new CaptureProvider();
    const plain = createCity({ seed: 1, brain: dark, agenticBusinessIds: ["biz_farm"] });
    plain.sim.run(TICKS_PER_DAY);
    // Undefined-valued keys vanish at the JSON boundary every networked provider crosses — the
    // same "omitted when off" contract the credit fields keep.
    expect(dark.last!.exportPrice).toBeUndefined();
    expect(dark.last!.localPrice).toBeUndefined();
    expect(dark.last!.exportShare).toBeUndefined();
    expect(dark.last!.dayExportRevenue).toBeUndefined();
  });

  it("a storefront mind never sees the lever — meals don't ship abroad", () => {
    const capture = new CaptureProvider();
    const { sim } = createCity({
      seed: 1,
      includePort: true,
      tradeEnabled: true,
      brain: capture,
      agenticBusinessIds: ["biz_diner"],
    });
    sim.run(TICKS_PER_DAY);
    expect(capture.last!.exportPrice).toBeUndefined();
    expect(capture.last!.exportShare).toBeUndefined();
  });

  it("the dead lever writes nothing: with trade off, setExportShare never reaches the world", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: new ShareProvider(0.5),
      agenticBusinessIds: ["biz_farm"],
    });
    sim.run(TICKS_PER_DAY * 5);
    expect("exportShare" in world.getBusiness("biz_farm")!).toBe(false);
  });

  it("clamps setExportShare into [0,1] and drops non-finite proposals", () => {
    expect(clampAction({ setExportShare: 5 }, 10, DEFAULT_LIMITS).setExportShare).toBe(1);
    expect(clampAction({ setExportShare: -0.5 }, 10, DEFAULT_LIMITS).setExportShare).toBe(0);
    expect(clampAction({ setExportShare: 0.4 }, 10, DEFAULT_LIMITS).setExportShare).toBe(0.4);
    expect(clampAction({ setExportShare: NaN }, 10, DEFAULT_LIMITS).setExportShare).toBeUndefined();
  });

  it("the rules brain trades through the lever deterministically (same seed → identical world)", () => {
    const run = () => {
      const c = createCity({
        seed: 7,
        includePort: true,
        tradeEnabled: true,
        brain: "rules",
        agenticBusinessIds: ["biz_farm", "biz_bakery", "biz_diner", "biz_goods"],
      });
      c.sim.run(TICKS_PER_DAY * 30);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});
