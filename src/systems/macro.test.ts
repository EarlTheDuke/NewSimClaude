import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { MACRO_HISTORY_DAYS, BANKRUPT_GRACE_DAYS } from "./constants";

describe("MacroSystem (Phase 4d vitals)", () => {
  it("records exactly one sample per day, numbered from 1", () => {
    const { sim, macro } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 5);
    const days = macro.history().map((s) => s.day);
    expect(days).toEqual([1, 2, 3, 4, 5]);
  });

  it("captures sensible vitals for the steady-state city", () => {
    const { sim, macro } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * 30);
    const s = macro.latest()!;
    expect(s.gdp).toBeGreaterThan(0); // residents are buying meals and goods
    expect(s.payroll).toBeGreaterThan(0); // money is reaching residents
    expect(s.rent).toBeGreaterThan(0); // the landlord is collecting
    expect(s.activeBusinesses).toBe(7); // nobody has failed
    expect(s.unemployed).toBe(0); // the default city is fully employed
    expect(s.totalMoney).toBeCloseTo(30000, 4); // conservation holds
    expect(s.avgResourcePrice).toBeGreaterThan(0);
  });

  it("reflects lifecycle shocks: a bankruptcy thins the active count and swells unemployment", () => {
    const { sim, world, macro } = createCity({ seed: 1 });
    // Strand the farm (sever its only customer, zero its cash) so it fails.
    world.getBusiness("biz_bakery")!.active = false;
    world.getBusiness("biz_farm")!.cash = 0;

    sim.run(TICKS_PER_DAY * (BANKRUPT_GRACE_DAYS + 1));

    const s = macro.latest()!;
    expect(world.getBusiness("biz_farm")!.active).toBe(false);
    expect(s.activeBusinesses).toBeLessThan(7);
    expect(s.unemployed).toBeGreaterThanOrEqual(2); // the farm's staff were laid off
  });

  it("ring-buffers to MACRO_HISTORY_DAYS, dropping the oldest", () => {
    const { sim, macro } = createCity({ seed: 1 });
    sim.run(TICKS_PER_DAY * (MACRO_HISTORY_DAYS + 2));
    const h = macro.history();
    expect(h).toHaveLength(MACRO_HISTORY_DAYS);
    expect(h[0]!.day).toBe(3); // days 1 and 2 fell off the front
    expect(macro.latest()!.day).toBe(MACRO_HISTORY_DAYS + 2);
  });

  it("is deterministic: same seed, same series", () => {
    const a = createCity({ seed: 7 });
    const b = createCity({ seed: 7 });
    a.sim.run(TICKS_PER_DAY * 20);
    b.sim.run(TICKS_PER_DAY * 20);
    expect(a.macro.history()).toEqual(b.macro.history());
  });

  it("save -> reload restores the series and the delta baseline", () => {
    const original = createCity({ seed: 5 });
    original.sim.run(TICKS_PER_DAY * 10);
    const before = original.macro.history().map((s) => ({ ...s }));
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.macro.history()).toEqual(before);

    // Run both on one more day: the next day's flows match only if the delta
    // baseline was restored (else the reloaded GDP double-counts all of history).
    original.sim.run(TICKS_PER_DAY);
    loaded.sim.run(TICKS_PER_DAY);
    expect(loaded.macro.latest()).toEqual(original.macro.latest());
  });
});
