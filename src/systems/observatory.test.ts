import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

const agentic = () =>
  createCity({
    seed: 1,
    brain: "rules",
    residentBrain: "rules",
    agenticResidentIds: "all",
    agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"],
    disasters: true,
  });

describe("observatory metrics (S0)", () => {
  it("computes labour share / gini / velocity / dividend / avgWage — sane + deterministic", () => {
    const a = agentic();
    a.sim.run(TICKS_PER_DAY * 60);
    const m = a.macro.latest()!;

    // The emergent labour-vs-capital split (0..1). With today's even dividend still on,
    // wages and dividend both flow, so it sits strictly between the extremes.
    expect(m.labourShare).toBeGreaterThan(0);
    expect(m.labourShare).toBeLessThan(1);
    expect(m.payroll).toBeGreaterThan(0); // wages flowed
    expect(m.dividend).toBeGreaterThan(0); // dividend flowed

    expect(m.gini).toBeGreaterThanOrEqual(0);
    expect(m.gini).toBeLessThan(1);
    expect(m.velocity).toBeGreaterThan(0); // money is circulating
    expect(m.avgWage).toBeGreaterThan(0);

    // Deterministic: a same-seed run reproduces the macro sample exactly, new fields and all.
    const b = agentic();
    b.sim.run(TICKS_PER_DAY * 60);
    expect(b.macro.latest()).toEqual(m);
  });

  it("the new metrics round-trip through save/reload", () => {
    const a = agentic();
    a.sim.run(TICKS_PER_DAY * 40);
    const json = JSON.stringify(a.sim.serialize());
    const b = createCity({ seed: 999 }); // different seed; restore overwrites
    b.sim.restore(JSON.parse(json));
    expect(b.macro.latest()).toEqual(a.macro.latest());
  });
});
