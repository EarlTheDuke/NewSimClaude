import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { BANKRUPT_GRACE_DAYS, EVICTION_GRACE_DAYS } from "./constants";

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
  it("re-homes a resident who can't make rent, to the cheapest home, never homeless", () => {
    const { sim, world } = createCity({ seed: 1 });
    const res = world.getResident("res_0")!;
    const startHome = res.homeId;
    // Make this home unpayable so rent always falls short.
    world.getLocation(startHome).rent = 1_000_000;

    sim.run(TICKS_PER_DAY * (EVICTION_GRACE_DAYS + 1));

    // Moved off the unpayable home onto the cheapest one — and still housed.
    expect(res.homeId).not.toBe(startHome);
    const home = world.getLocation(res.homeId);
    expect(home.type).toBe("home");
    const cheapest = Math.min(
      ...world.locations.filter((l) => l.type === "home").map((l) => l.rent ?? Infinity),
    );
    expect(home.rent).toBe(cheapest);
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

    // Bankruptcy freezes cash and eviction moves no money — totals are untouched.
    expect(world.getBusiness("biz_farm")!.active).toBe(false);
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
