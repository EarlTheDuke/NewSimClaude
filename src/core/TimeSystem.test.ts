import { describe, it, expect } from "vitest";
import {
  TimeSystem,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from "./TimeSystem";

describe("TimeSystem", () => {
  it("starts at day 0, 00:00", () => {
    const t = new TimeSystem();
    expect(t.ticks).toBe(0);
    expect(t.time()).toMatchObject({ day: 0, hour: 0, minute: 0, dayOfWeek: 0 });
    expect(t.clockString()).toBe("00:00");
  });

  it("derives hours and minutes from ticks", () => {
    const t = new TimeSystem();
    t.tick(TICKS_PER_HOUR * 9 + 30); // 09:30
    expect(t.time()).toMatchObject({ hour: 9, minute: 30, day: 0 });
    expect(t.clockString()).toBe("09:30");
  });

  it("rolls over to the next day after 1440 ticks", () => {
    const t = new TimeSystem();
    t.tick(TICKS_PER_DAY);
    expect(t.time()).toMatchObject({ day: 1, hour: 0, minute: 0 });
  });

  it("wraps day-of-week weekly", () => {
    const t = new TimeSystem();
    t.tick(TICKS_PER_DAY * 8); // day 8
    expect(t.time().day).toBe(8);
    expect(t.time().dayOfWeek).toBe(1);
  });

  it("rejects negative tick counts", () => {
    const t = new TimeSystem();
    expect(() => t.tick(-1)).toThrow();
  });

  describe("speed control", () => {
    it("defaults to 1x running", () => {
      const t = new TimeSystem();
      expect(t.getSpeed()).toBe(1);
      expect(t.isPaused()).toBe(false);
    });

    it("rejects invalid speeds", () => {
      const t = new TimeSystem();
      // @ts-expect-error invalid speed value
      expect(() => t.setSpeed(5)).toThrow();
    });

    it("budgets ~1 tick per real second at 1x", () => {
      const t = new TimeSystem();
      expect(t.ticksForRealTime(1000)).toBe(1);
      // pacing helper does not advance the clock itself
      expect(t.ticks).toBe(0);
    });

    it("budgets ~1000 ticks per real second at 1000x", () => {
      const t = new TimeSystem();
      t.setSpeed(1000);
      expect(t.ticksForRealTime(1000)).toBe(1000);
    });

    it("carries fractional ticks across frames", () => {
      const t = new TimeSystem();
      // 4 frames of 250ms at 1x = 1 tick total, not 0
      expect(t.ticksForRealTime(250)).toBe(0);
      expect(t.ticksForRealTime(250)).toBe(0);
      expect(t.ticksForRealTime(250)).toBe(0);
      expect(t.ticksForRealTime(250)).toBe(1);
    });
  });

  describe("pause", () => {
    it("budgets no ticks while paused", () => {
      const t = new TimeSystem();
      t.pause();
      expect(t.ticksForRealTime(5000)).toBe(0);
      expect(t.ticks).toBe(0);
    });

    it("does not accumulate catch-up after a long pause", () => {
      const t = new TimeSystem();
      t.pause();
      t.ticksForRealTime(60000);
      t.resume();
      expect(t.ticksForRealTime(1000)).toBe(1);
    });

    it("toggles cleanly", () => {
      const t = new TimeSystem();
      t.togglePause();
      expect(t.isPaused()).toBe(true);
      t.togglePause();
      expect(t.isPaused()).toBe(false);
    });

    it("discrete tick() ignores pause state", () => {
      const t = new TimeSystem();
      t.pause();
      t.tick(10);
      expect(t.ticks).toBe(10);
    });
  });

  describe("serialization", () => {
    it("round-trips time, speed, and pause state", () => {
      const t = new TimeSystem();
      t.tick(TICKS_PER_DAY + 123);
      t.setSpeed(100);
      t.pause();

      const restored = new TimeSystem();
      restored.restore(t.serialize());

      expect(restored.ticks).toBe(t.ticks);
      expect(restored.getSpeed()).toBe(100);
      expect(restored.isPaused()).toBe(true);
      expect(restored.time()).toEqual(t.time());
    });
  });
});
