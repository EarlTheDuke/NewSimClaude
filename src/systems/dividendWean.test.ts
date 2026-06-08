import { describe, it, expect } from "vitest";
import { createCity, type CitySimOptions } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

const BIZ = ["biz_diner", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"];

const city = (over: Partial<CitySimOptions> = {}) =>
  createCity({
    seed: 1,
    brain: "rules",
    residentBrain: "rules",
    agenticResidentIds: "all",
    agenticBusinessIds: BIZ,
    disasters: true,
    populationGrowth: true,
    ...over,
  });

describe("dividend weaning (S3)", () => {
  it("default (wean 1.0) is byte-identical to leaving dividendWean unset", () => {
    const a = city();
    const b = city({ dividendWean: 1 });
    a.sim.run(TICKS_PER_DAY * 200);
    b.sim.run(TICKS_PER_DAY * 200);
    expect(b.world.serialize()).toEqual(a.world.serialize());
  });

  it("a lower wean factor shrinks the even dividend; wean 0 zeroes it — conserved & deterministic", () => {
    // ownerDividendShare 0 so macro.dividend isolates the *even* recirculation (it otherwise also
    // counts the owner's draw, which weaning deliberately leaves alone).
    const full = city({ dividendWean: 1, ownerDividendShare: 0 });
    const half = city({ dividendWean: 0.5, ownerDividendShare: 0 });
    const none = city({ dividendWean: 0, ownerDividendShare: 0 });
    const start = full.world.totalMoney();
    for (const c of [full, half, none]) c.sim.run(TICKS_PER_DAY * 200);

    // Even-dividend flow scales down with the wean factor.
    expect(half.macro.latest()!.dividend).toBeLessThan(full.macro.latest()!.dividend);
    expect(none.macro.latest()!.dividend).toBe(0); // no even dividend at all

    // Conservation holds regardless of the wean factor (un-distributed cash just stays in firms).
    expect(none.world.totalMoney()).toBeCloseTo(start, 2);

    // Deterministic: a same-config weaned run reproduces the world exactly.
    const none2 = city({ dividendWean: 0, ownerDividendShare: 0 });
    none2.sim.run(TICKS_PER_DAY * 200);
    expect(none2.world.serialize()).toEqual(none.world.serialize());
  });

  it("weaning the even dividend does NOT stop the owner's draw (capital income survives)", () => {
    // Owners still draw their share even with the even pump fully off — that's genuine profit,
    // not the artificial recirculation. With an owner share engaged and wean 0, owners' wealth
    // must still climb relative to a no-owner-share baseline.
    const ownersDraw = city({ dividendWean: 0, ownerDividendShare: 0.35 });
    const noDraw = city({ dividendWean: 0, ownerDividendShare: 0 });
    ownersDraw.sim.run(TICKS_PER_DAY * 200);
    noDraw.sim.run(TICKS_PER_DAY * 200);
    const ownerIds = new Set(ownersDraw.world.businesses.map((b) => b.ownerId));
    const ownerWealth = (c: ReturnType<typeof city>) =>
      c.world.residents.filter((r) => ownerIds.has(r.id)).reduce((s, r) => s + r.money, 0);
    expect(ownerWealth(ownersDraw)).toBeGreaterThan(ownerWealth(noDraw));
    expect(ownersDraw.world.residents.every((r) => r.money >= 0)).toBe(true);
  });
});
