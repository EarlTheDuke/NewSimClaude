import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { BANKRUPT_GRACE_DAYS, EVICTION_GRACE_DAYS } from "./constants";
import { occupantsByHome } from "../world/housing";

/**
 * Strands a business so it earns nothing: zero its cash and cut off its only
 * customer, so the market never refills it and it sinks toward bankruptcy. The
 * farm's sole revenue is selling grain to the bakery, so silencing the bakery
 * leaves the farm with no income at all.
 */
function strandFarm(world: ReturnType<typeof createCity>["world"]): void {
  world.getBusiness("biz_bakery")!.active = false; // stops buying the farm's grain
  world.getBusiness("biz_farm")!.cash = 0;
}

describe("LifecycleSystem — bankruptcy", () => {
  it("declares a starved business bankrupt only after the grace period, then lays off its staff", () => {
    const { sim, world } = createCity({ seed: 1 });
    const farm = world.getBusiness("biz_farm")!;
    const staff = [...farm.employeeIds];
    expect(staff.length).toBeGreaterThan(0);
    strandFarm(world);

    // One day short of the grace period: still trading.
    sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS - 1));
    expect(farm.active).toBe(true);

    // The grace-period day tips it over.
    sim.run(TICKS_PER_DAY);
    expect(farm.active).toBe(false);
    expect(farm.employeeIds).toHaveLength(0);
    for (const id of staff) {
      const worker = world.getResident(id)!;
      expect(worker.jobId).toBe("");
      expect(worker.wagePerTick).toBe(0);
    }
  });

  it("a recovering business never trips the bankruptcy counter", () => {
    // The default city is solvent: nobody should ever be declared bankrupt.
    const { sim, world } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 100);
    for (const b of world.businesses) {
      expect(b.active).toBe(true);
      expect(b.insolventDays ?? 0).toBe(0);
    }
  });
});

describe("LifecycleSystem — safe eviction", () => {
  it("re-homes a resident who can't make rent, to the cheapest VACANT home, never homeless or overfilled (HP3-3)", () => {
    const { sim, world } = createCity({ seed: 1 });
    const res = world.getResident("res_0")!;
    const startHome = res.homeId;
    // Make this home unpayable so rent always falls short.
    world.getLocation(startHome).rent = 1_000_000;

    sim.run(TICKS_PER_DAY * (EVICTION_GRACE_DAYS + 1));

    // Moved off the unpayable home and still housed.
    expect(res.homeId).not.toBe(startHome);
    const home = world.getLocation(res.homeId);
    expect(home.type).toBe("home");

    // HP3-3 re-baseline: the three cheapest seed-1 homes are full (caps [5,4,3,2,2,2],
    // 2 occupants each), so the old code would have STACKED the evictee into the
    // globally-cheapest home past its capacity. The fix lands them in the cheapest
    // home that still had a free slot instead — and, crucially, NO home is ever
    // pushed over its capacity by an eviction.
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type !== "home") continue;
      expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
    // It is the cheapest home that had room for them (every strictly-cheaper home
    // was already full at the moment of the move).
    const cheaperWithRoom = world.locations.filter(
      (l) =>
        l.type === "home" &&
        l.id !== res.homeId &&
        (l.rent ?? 0) < (home.rent ?? 0) &&
        (occ.get(l.id) ?? 0) < (l.capacity ?? 99),
    );
    expect(cheaperWithRoom).toHaveLength(0);
  });

  it("leaves the stable city's residents housed and solvent for 100 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 100);
    for (const r of world.residents) {
      // Whatever the economy did, every resident always resolves to a real home.
      expect(world.getLocation(r.homeId).type).toBe("home");
    }
  });
});

describe("LifecycleSystem — invariants", () => {
  it("conserves money across a bankruptcy and an eviction", () => {
    const { sim, world } = createCity({ seed: 1 });
    strandFarm(world);
    world.getLocation(world.getResident("res_0")!.homeId).rent = 1_000_000;
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS + 2));

    // Bankruptcy liquidates the husk to its owner (here ~$0) and eviction moves no
    // money — every dollar still moves only via transfer, so totals are untouched.
    expect(world.getBusiness("biz_farm")!.active).toBe(false);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("liquidates a bankrupt firm's residual cash to its owner — the husk isn't frozen (Phase 15 D)", () => {
    // businessEntry off so the bakery we strand the farm with isn't simply reborn.
    const { sim, world } = createCity({ seed: 1, businessEntry: false });
    world.getBusiness("biz_bakery")!.active = false; // strand the farm: cut its only buyer
    const farm = world.getBusiness("biz_farm")!;
    // Strip its crew (so no wage drain races the residual to zero) and park a small
    // residual below the bankruptcy floor, so the husk reaches bankruptcy still
    // holding cash to recoup.
    for (const id of farm.employeeIds) world.getResident(id)!.jobId = "";
    farm.employeeIds = [];
    farm.cash = 0.5;
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS + 1));

    expect(farm.active).toBe(false);
    // The husk is emptied (0.5 → 0), not frozen at its dying balance — proof the
    // residual was handed off, not stranded — and the closed economy still balances.
    expect(farm.cash).toBe(0);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("is deterministic: same seed and same shocks, same world", () => {
    const a = createCity({ seed: 4 });
    const b = createCity({ seed: 4 });
    strandFarm(a.world);
    strandFarm(b.world);
    a.sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS + 3));
    b.sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS + 3));
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });

  it("carries the bankruptcy streak across save -> reload", () => {
    const original = createCity({ seed: 1 });
    strandFarm(original.world);
    // Part-way to bankruptcy, then snapshot.
    original.sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS - 2));
    expect(original.world.getBusiness("biz_farm")!.active).toBe(true);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 99 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.getBusiness("biz_farm")!.insolventDays).toBe(BANKRUPT_GRACE_DAYS - 2);

    // The streak resumes from where it was saved and tips over on schedule.
    loaded.sim.run(TICKS_PER_DAY * 2);
    expect(loaded.world.getBusiness("biz_farm")!.active).toBe(false);
  });
});
