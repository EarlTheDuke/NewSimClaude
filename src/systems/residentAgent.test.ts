import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { MockResidentProvider } from "../ai/MockResidentProvider";
import { clampResidentAction, DEFAULT_RESIDENT_LIMITS } from "../ai/residentClamp";
import type { ResidentObservation } from "../ai/residentTypes";

const flush = () => new Promise((r) => setTimeout(r, 0));

function baseObs(over: Partial<ResidentObservation> = {}): ResidentObservation {
  return {
    residentId: "res_0",
    name: "Ada",
    day: 10,
    money: 1000,
    needs: { hunger: 80, energy: 80, social: 80 },
    employed: true,
    jobId: "biz_diner",
    jobName: "The Corner Diner",
    wagePerTick: 0.5,
    jobBaseWage: 0.5,
    homeId: "loc_home_0",
    homeName: "Home 1",
    rent: 70,
    hasVehicle: false,
    daysSinceJobChange: 10,
    jobOptions: [
      { businessId: "biz_goods", name: "Maker Goods Co.", wagePerTick: 0.55, hiring: true },
      { businessId: "biz_landlord", name: "Keystone Housing", wagePerTick: 0.5, hiring: false },
    ],
    homeOptions: [
      { homeId: "loc_home_5", name: "Home 6", rent: 50 },
      { homeId: "loc_home_3", name: "Home 4", rent: 58 },
    ],
    ...over,
  };
}

describe("clampResidentAction", () => {
  it("keeps a valid job switch to a listed, hiring option off cooldown", () => {
    const out = clampResidentAction({ switchJobTo: "biz_goods" }, baseObs(), DEFAULT_RESIDENT_LIMITS);
    expect(out.switchJobTo).toBe("biz_goods");
  });

  it("drops a switch to a non-hiring or unlisted job", () => {
    expect(clampResidentAction({ switchJobTo: "biz_landlord" }, baseObs(), DEFAULT_RESIDENT_LIMITS).switchJobTo).toBeUndefined();
    expect(clampResidentAction({ switchJobTo: "biz_nope" }, baseObs(), DEFAULT_RESIDENT_LIMITS).switchJobTo).toBeUndefined();
  });

  it("drops a switch while on cooldown", () => {
    const o = baseObs({ daysSinceJobChange: 2 }); // cooldown is 5
    expect(clampResidentAction({ switchJobTo: "biz_goods" }, o, DEFAULT_RESIDENT_LIMITS).switchJobTo).toBeUndefined();
  });

  it("keeps only one structural move (priority: job over home)", () => {
    const out = clampResidentAction(
      { switchJobTo: "biz_goods", reHomeTo: "loc_home_5" },
      baseObs(),
      DEFAULT_RESIDENT_LIMITS,
    );
    expect(out.switchJobTo).toBe("biz_goods");
    expect(out.reHomeTo).toBeUndefined();
  });

  it("lets a raise ride alongside a structural move, capped by headroom", () => {
    const out = clampResidentAction(
      { reHomeTo: "loc_home_5", negotiateRaise: true },
      baseObs(),
      DEFAULT_RESIDENT_LIMITS,
    );
    expect(out.reHomeTo).toBe("loc_home_5");
    expect(out.negotiateRaise).toBe(true);
  });

  it("drops a raise at the wage cap", () => {
    const o = baseObs({ wagePerTick: 1.0, jobBaseWage: 0.5 }); // already 2x base = cap
    expect(clampResidentAction({ negotiateRaise: true }, o, DEFAULT_RESIDENT_LIMITS).negotiateRaise).toBeUndefined();
  });

  it("drops a vehicle purchase the resident can't afford", () => {
    const poor = baseObs({ money: 100 });
    expect(clampResidentAction({ buyVehicle: true }, poor, DEFAULT_RESIDENT_LIMITS).buyVehicle).toBeUndefined();
    const rich = baseObs({ money: 1000 });
    expect(clampResidentAction({ buyVehicle: true }, rich, DEFAULT_RESIDENT_LIMITS).buyVehicle).toBe(true);
  });

  it("drops selling a vehicle the resident doesn't own", () => {
    expect(clampResidentAction({ sellVehicle: true }, baseObs({ hasVehicle: false }), DEFAULT_RESIDENT_LIMITS).sellVehicle).toBeUndefined();
    expect(clampResidentAction({ sellVehicle: true }, baseObs({ hasVehicle: true }), DEFAULT_RESIDENT_LIMITS).sellVehicle).toBe(true);
  });
});

describe("ResidentAgentSystem", () => {
  it("applies a job switch, moving the resident between payrolls", () => {
    const provider = new MockResidentProvider({ fixed: { action: { switchJobTo: "biz_goods" }, reason: "better pay" } });
    const { sim, world, residentAgent } = createCity({
      seed: 1,
      residentBrain: provider,
      agenticResidentIds: ["res_0"],
    });
    const diner = world.getBusiness("biz_diner")!;
    const goods = world.getBusiness("biz_goods")!;
    expect(diner.employeeIds).toContain("res_0");

    sim.run(TICKS_PER_DAY);

    const r = world.getResident("res_0")!;
    expect(r.jobId).toBe("biz_goods");
    expect(r.wagePerTick).toBe(goods.wagePerTick);
    expect(diner.employeeIds).not.toContain("res_0");
    expect(goods.employeeIds).toContain("res_0");
    expect(residentAgent!.decisions()).toHaveLength(1);
    expect(residentAgent!.decisions()[0]!.fallback).toBe(false);
  });

  it("re-homes a resident to a listed home", () => {
    const provider = new MockResidentProvider({ fixed: { action: { reHomeTo: "loc_home_5" }, reason: "cheaper" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.homeId).toBe("loc_home_5");
  });

  it("buys a vehicle, conserving money through the goods store", () => {
    const provider = new MockResidentProvider({ fixed: { action: { buyVehicle: true }, reason: "faster commute" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    world.getResident("res_0")!.money = 3000; // give them savings to spend
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.hasVehicle).toBe(true);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("grants a capped raise", () => {
    const provider = new MockResidentProvider({ fixed: { action: { negotiateRaise: true }, reason: "raise" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    const base = world.getResident("res_0")!.wagePerTick;

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.wagePerTick).toBeCloseTo(base * 1.08, 6);
  });

  it("falls back to rules when the provider throws (sync)", () => {
    const provider = new MockResidentProvider({ fail: true });
    const { sim, residentAgent } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });

    sim.run(TICKS_PER_DAY);

    const log = residentAgent!.decisions();
    expect(log).toHaveLength(1);
    expect(log[0]!.fallback).toBe(true);
    expect(log[0]!.providerId).toBe("rules");
  });

  it("applies async decisions after they resolve, off the tick path", async () => {
    const provider = new MockResidentProvider({ async: true, fixed: { action: { switchJobTo: "biz_goods" }, reason: "async" } });
    const { sim, world, residentAgent } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });

    sim.run(TICKS_PER_DAY);
    expect(residentAgent!.decisions()).toHaveLength(0);

    await flush();

    expect(residentAgent!.decisions()).toHaveLength(1);
    expect(world.getResident("res_0")!.jobId).toBe("biz_goods");
  });

  it("falls back invisibly when an async provider rejects", async () => {
    const provider = new MockResidentProvider({ async: true, fail: true });
    const { sim, residentAgent } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });

    sim.run(TICKS_PER_DAY);
    await flush();

    const log = residentAgent!.decisions();
    expect(log).toHaveLength(1);
    expect(log[0]!.fallback).toBe(true);
  });
});

describe("resident agency stays sound", () => {
  it("is inert when no resident is opted in (Phase 1/2 untouched)", () => {
    const off = createCity({ seed: 1 });
    const empty = createCity({ seed: 1, residentBrain: "rules", agenticResidentIds: [] });
    off.sim.run(TICKS_PER_DAY * 10);
    empty.sim.run(TICKS_PER_DAY * 10);
    expect(empty.world.serialize()).toEqual(off.world.serialize());
  });

  it("conserves money with rule-driven residents over 30 days", () => {
    const { sim, world } = createCity({
      seed: 1,
      residentBrain: "rules",
      agenticResidentIds: ["res_0", "res_1", "res_2", "res_3"],
    });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("never lets a holder go negative with rule-driven residents", () => {
    const { sim, world } = createCity({
      seed: 3,
      residentBrain: "rules",
      agenticResidentIds: ["res_0", "res_1", "res_2", "res_3"],
    });
    sim.run(TICKS_PER_DAY * 30);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
    for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
  });

  it("rule-driven residents are deterministic: same seed, same world", () => {
    const a = createCity({ seed: 99, residentBrain: "rules", agenticResidentIds: ["res_0", "res_2"] });
    const b = createCity({ seed: 99, residentBrain: "rules", agenticResidentIds: ["res_0", "res_2"] });
    a.sim.run(TICKS_PER_DAY * 10);
    b.sim.run(TICKS_PER_DAY * 10);
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});
