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
    vehicleSellerOpen: true,
    savingsGoal: 0,
    luxuriesOwned: 0,
    luxurySellerOpen: true,
    daysSinceJobChange: 10,
    daysSinceRaise: 10,
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

  it("drops a raise while on raise cooldown", () => {
    const o = baseObs({ daysSinceRaise: 2 }); // cooldown is 7
    expect(clampResidentAction({ negotiateRaise: true }, o, DEFAULT_RESIDENT_LIMITS).negotiateRaise).toBeUndefined();
  });

  it("drops a vehicle purchase the resident can't afford", () => {
    const poor = baseObs({ money: 100 });
    expect(clampResidentAction({ buyVehicle: true }, poor, DEFAULT_RESIDENT_LIMITS).buyVehicle).toBeUndefined();
    const rich = baseObs({ money: 1000 });
    expect(clampResidentAction({ buyVehicle: true }, rich, DEFAULT_RESIDENT_LIMITS).buyVehicle).toBe(true);
  });

  it("drops a vehicle purchase when the seller is closed", () => {
    const closed = baseObs({ money: 1000, vehicleSellerOpen: false });
    expect(clampResidentAction({ buyVehicle: true }, closed, DEFAULT_RESIDENT_LIMITS).buyVehicle).toBeUndefined();
  });

  it("drops selling a vehicle the resident doesn't own", () => {
    expect(clampResidentAction({ sellVehicle: true }, baseObs({ hasVehicle: false }), DEFAULT_RESIDENT_LIMITS).sellVehicle).toBeUndefined();
    expect(clampResidentAction({ sellVehicle: true }, baseObs({ hasVehicle: true }), DEFAULT_RESIDENT_LIMITS).sellVehicle).toBe(true);
  });

  it("clamps a savings goal into [0, max]", () => {
    expect(clampResidentAction({ setSavingsGoal: -50 }, baseObs(), DEFAULT_RESIDENT_LIMITS).setSavingsGoal).toBe(0);
    expect(clampResidentAction({ setSavingsGoal: 1e9 }, baseObs(), DEFAULT_RESIDENT_LIMITS).setSavingsGoal).toBe(DEFAULT_RESIDENT_LIMITS.maxSavingsGoal);
    expect(clampResidentAction({ setSavingsGoal: 500 }, baseObs(), DEFAULT_RESIDENT_LIMITS).setSavingsGoal).toBe(500);
    // A non-finite goal is ignored rather than poisoning the number.
    expect(clampResidentAction({ setSavingsGoal: NaN }, baseObs(), DEFAULT_RESIDENT_LIMITS).setSavingsGoal).toBeUndefined();
  });

  it("buys a luxury only with surplus above the savings goal, from an open seller", () => {
    // money 1000, goal 0, luxury 150 → surplus, fires.
    expect(clampResidentAction({ buyLuxury: true }, baseObs(), DEFAULT_RESIDENT_LIMITS).buyLuxury).toBe(true);
    // goal eats the surplus (1000 < 900 + 150) → dropped.
    expect(clampResidentAction({ buyLuxury: true }, baseObs({ savingsGoal: 900 }), DEFAULT_RESIDENT_LIMITS).buyLuxury).toBeUndefined();
    // seller closed → dropped.
    expect(clampResidentAction({ buyLuxury: true }, baseObs({ luxurySellerOpen: false }), DEFAULT_RESIDENT_LIMITS).buyLuxury).toBeUndefined();
  });

  it("lets a luxury and a goal ride alongside a structural move (all non-structural)", () => {
    const out = clampResidentAction(
      { reHomeTo: "loc_home_5", buyLuxury: true, setSavingsGoal: 400 },
      baseObs(),
      DEFAULT_RESIDENT_LIMITS,
    );
    expect(out.reHomeTo).toBe("loc_home_5");
    expect(out.buyLuxury).toBe(true);
    expect(out.setSavingsGoal).toBe(400);
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

  it("won't buy a vehicle from a closed seller, conserving money", () => {
    const provider = new MockResidentProvider({ fixed: { action: { buyVehicle: true }, reason: "try anyway" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    world.getResident("res_0")!.money = 3000;
    world.getBusiness("biz_goods")!.active = false; // store shut down
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.hasVehicle).toBe(false);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("buys a luxury, conserving money and counting it", () => {
    const provider = new MockResidentProvider({ fixed: { action: { buyLuxury: true }, reason: "treat myself" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    world.getResident("res_0")!.money = 3000; // surplus above the (zero) savings goal
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.luxuriesOwned).toBe(1);
    expect(world.totalMoney()).toBeCloseTo(start, 6); // a transfer, nothing minted
  });

  it("sets a savings goal, clamped to the allowed range", () => {
    const provider = new MockResidentProvider({ fixed: { action: { setSavingsGoal: 800 }, reason: "build a buffer" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.savingsGoal).toBe(800);
  });

  it("grants a capped raise", () => {
    const provider = new MockResidentProvider({ fixed: { action: { negotiateRaise: true }, reason: "raise" } });
    const { sim, world } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    const base = world.getResident("res_0")!.wagePerTick;

    sim.run(TICKS_PER_DAY);

    expect(world.getResident("res_0")!.wagePerTick).toBeCloseTo(base * 1.08, 6);
  });

  it("honours the raise cooldown: a daily ask lands only once in the window", () => {
    const provider = new MockResidentProvider({ fixed: { action: { negotiateRaise: true }, reason: "again" } });
    const { sim, world, residentAgent } = createCity({ seed: 1, residentBrain: provider, agenticResidentIds: ["res_0"] });
    const base = world.getResident("res_0")!.wagePerTick;

    // Six straight days of asking — only the day-1 raise is off cooldown (7d).
    sim.run(TICKS_PER_DAY * 6);

    expect(world.getResident("res_0")!.wagePerTick).toBeCloseTo(base * 1.08, 6);
    const log = residentAgent!.decisions().filter((e) => e.residentId === "res_0");
    expect(log).toHaveLength(6);
    expect(log[0]!.action.negotiateRaise).toBe(true);
    for (let i = 1; i < 6; i++) expect(log[i]!.action.negotiateRaise).toBeUndefined();
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
