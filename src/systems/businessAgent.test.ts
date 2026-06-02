import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { MockProvider } from "../ai/MockProvider";
import { runAB } from "../ai/abHarness";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BusinessAgentSystem", () => {
  it("applies a clamped decision once per day per business", () => {
    const provider = new MockProvider({ fixed: { action: { setPrice: 99, produce: 50 }, reason: "test" } });
    const { sim, world, agent } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_diner"] });
    const diner = world.getBusiness("biz_diner")!;
    const startInv = diner.inventory;

    sim.run(TICKS_PER_DAY); // exactly one day-boundary review

    // price clamped: 14 -> at most 14 * 1.25 = 17.5
    expect(diner.price).toBeLessThanOrEqual(17.5);
    expect(diner.price).toBeGreaterThan(14);
    // produce added to inventory (minus any meals sold during the day)
    expect(diner.inventory).toBeGreaterThan(startInv - 200 + 50 - 1);
    expect(agent!.decisions()).toHaveLength(1);
    expect(agent!.decisions()[0]!.fallback).toBe(false);
  });

  it("hires from the jobless pool, deterministically", () => {
    const provider = new MockProvider({ fixed: { action: { hire: 2 }, reason: "grow" } });
    const { sim, world } = createCity({
      seed: 1,
      brain: provider,
      agenticBusinessIds: ["biz_diner"],
      residentCount: 12,
      unemployed: 4,
    });
    const diner = world.getBusiness("biz_diner")!;
    const before = diner.employeeIds.length;
    const joblessBefore = world.residents.filter((r) => r.jobId === "").length;
    expect(joblessBefore).toBe(4);

    sim.run(TICKS_PER_DAY);

    expect(diner.employeeIds.length).toBe(before + 2);
    expect(world.residents.filter((r) => r.jobId === "").length).toBe(2);
  });

  it("falls back to rules when the provider throws (sync)", () => {
    const provider = new MockProvider({ fail: true });
    const { sim, agent } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_diner"] });

    sim.run(TICKS_PER_DAY);

    const log = agent!.decisions();
    expect(log).toHaveLength(1);
    expect(log[0]!.fallback).toBe(true);
    expect(log[0]!.providerId).toBe("rules");
  });

  it("applies async decisions after they resolve, off the tick path", async () => {
    const provider = new MockProvider({ async: true, fixed: { action: { setPrice: 30 }, reason: "async" } });
    const { sim, world, agent } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_goods"] });
    const goods = world.getBusiness("biz_goods")!;
    const startPrice = goods.price;

    sim.run(TICKS_PER_DAY);
    // synchronous run can't have applied the still-pending async decision yet
    expect(agent!.decisions()).toHaveLength(0);

    await flush();

    expect(agent!.decisions()).toHaveLength(1);
    expect(goods.price).not.toBe(startPrice);
  });

  it("falls back invisibly when an async provider rejects", async () => {
    const provider = new MockProvider({ async: true, fail: true });
    const { sim, agent } = createCity({ seed: 1, brain: provider, agenticBusinessIds: ["biz_diner"] });

    sim.run(TICKS_PER_DAY);
    await flush();

    const log = agent!.decisions();
    expect(log).toHaveLength(1);
    expect(log[0]!.fallback).toBe(true);
    expect(log[0]!.providerId).toBe("rules");
  });
});

describe("agentic economy stays sound", () => {
  it("conserves money with the rules brain over 30 days", () => {
    const { sim, world } = createCity({ seed: 1, brain: "rules" });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("never lets a holder go negative under the rules brain", () => {
    const { sim, world } = createCity({ seed: 3, brain: "rules" });
    sim.run(TICKS_PER_DAY * 30);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
    for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
  });

  it("rules brain is deterministic: same seed, same world", () => {
    const a = createCity({ seed: 99, brain: "rules" });
    const b = createCity({ seed: 99, brain: "rules" });
    a.sim.run(TICKS_PER_DAY * 10);
    b.sim.run(TICKS_PER_DAY * 10);
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});

describe("A/B harness", () => {
  it("control arm is Phase 1 untouched; treatment is the brain's doing", () => {
    const res = runAB("rules", { seed: 1, days: 20 });

    // No agent in the control arm: zero decisions logged.
    expect(res.control.decisions).toHaveLength(0);
    // The brain acted in the treatment arm.
    expect(res.treatment.decisions.length).toBeGreaterThan(0);

    // Money is conserved in both arms, so both end at the same total.
    expect(res.treatment.totalMoney).toBeCloseTo(res.control.totalMoney, 6);

    // The brain changed something the control left alone.
    const diff = res.treatment.businesses.some((t) => {
      const c = res.control.businesses.find((b) => b.id === t.id)!;
      return t.price !== c.price || t.inventory !== c.inventory || t.employees !== c.employees;
    });
    expect(diff).toBe(true);
  });

  it("a deterministic-brain A/B run is reproducible", () => {
    const a = runAB("rules", { seed: 7, days: 15 });
    const b = runAB("rules", { seed: 7, days: 15 });
    expect(a.treatment.businesses).toEqual(b.treatment.businesses);
    expect(a.treatment.decisions).toEqual(b.treatment.decisions);
  });
});
