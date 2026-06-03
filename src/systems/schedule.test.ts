import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { Activity, Resident, WorkSchedule } from "../world/types";

/**
 * Phase 10a — work schedules & paychecks. Each resident gets a deterministic,
 * varied shift plus one day off a week; the day's wages settle into a
 * "last paycheck" the dossier can show. None of it may mint or burn money.
 */
describe("Phase 10a — work schedules", () => {
  it("assigns deterministic, varied 8-hour shifts with one staggered day off", () => {
    const { world } = createCity({ seed: 1 });
    for (const r of world.residents) {
      expect(r.schedule.endHour - r.schedule.startHour).toBe(8);
      expect(r.schedule.daysOff).toHaveLength(1);
      expect(r.schedule.daysOff[0]).toBeGreaterThanOrEqual(0);
      expect(r.schedule.daysOff[0]!).toBeLessThan(7);
    }
    // Variety: the city doesn't all clock in at the same hour or rest the same day.
    expect(new Set(world.residents.map((r) => r.schedule.startHour)).size).toBeGreaterThan(1);
    expect(new Set(world.residents.map((r) => r.schedule.daysOff[0])).size).toBeGreaterThan(1);

    // Determinism: same seed → identical schedules.
    const again = createCity({ seed: 1 }).world;
    const sched = (w: typeof world): WorkSchedule[] => w.residents.map((r) => r.schedule);
    expect(sched(again)).toEqual(sched(world));
  });

  it("rests on a day off and works on a work day", () => {
    const { sim, world } = createCity({ seed: 1 });
    const res0 = world.getResident("res_0")!;
    expect(res0.schedule.daysOff).toEqual([0]); // off on dayOfWeek 0

    // Day 0 is dayOfWeek 0 → res_0's day off: never clocks in.
    const day0 = new Set<Activity>();
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      sim.step();
      day0.add(res0.activity);
    }
    expect(day0.has("working")).toBe(false);

    // Day 1 is dayOfWeek 1 → a work day: clocks in during the shift.
    const day1 = new Set<Activity>();
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      sim.step();
      day1.add(res0.activity);
    }
    expect(day1.has("working")).toBe(true);
  });
});

describe("Phase 10a — paychecks", () => {
  it("settles a worker's daily wages into lastPaycheck and resets the accumulator", () => {
    const { sim, world } = createCity({ seed: 1 });
    const r = world.getResident("res_1")!; // off on dayOfWeek 1, so it works day 0
    expect(r.lastPaycheck).toBe(0); // nothing settled yet
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY); // run through the first midnight settlement

    expect(r.lastPaycheck).toBeGreaterThan(0); // day 0's earnings, snapshotted
    expect(r.earnedThisPeriod).toBe(0); // accumulator cleared for day 1
    // Reporting only — the wage money moved tick-by-tick, nothing minted/burned.
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });

  it("falls back to the default schedule for a legacy resident missing the new fields", () => {
    const { sim, world } = createCity({ seed: 1 });
    const res0 = world.getResident("res_0")!;
    // Simulate restoring a pre-10a save: strip the fields the model now expects.
    const legacy = res0 as unknown as Partial<Resident>;
    delete legacy.schedule;
    delete legacy.earnedThisPeriod;
    delete legacy.lastPaycheck;

    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY);

    // The default 9–17 every-day pattern applies, so day 0 — which the new model
    // would treat as res_0's day off — is a normal work day and wages still flow.
    expect(Number.isFinite(res0.money)).toBe(true);
    expect(res0.money).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(res0.earnedThisPeriod)).toBe(true);
    expect(res0.lastPaycheck).toBeGreaterThan(0);
    expect(world.totalMoney()).toBeCloseTo(start, 6);
  });
});
