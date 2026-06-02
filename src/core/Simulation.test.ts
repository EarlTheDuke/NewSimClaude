import { describe, it, expect, vi } from "vitest";
import { Simulation } from "./Simulation";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "./TimeSystem";
import type { System, SystemContext } from "./types";
import {
  snapshotToJSON,
  snapshotFromJSON,
} from "../utils/serialization";

/**
 * A stateful test system: each tick it draws from the seeded RNG and folds the
 * value into an accumulator. Because it consumes shared RNG, its trajectory is
 * a good probe for determinism and snapshot fidelity.
 */
class AccumulatorSystem implements System {
  readonly id = "accumulator";
  total = 0;
  draws = 0;

  update(ctx: SystemContext): void {
    this.total += ctx.rng.next();
    this.draws += 1;
  }

  serialize() {
    return { total: this.total, draws: this.draws };
  }

  restore(state: unknown) {
    const s = state as { total: number; draws: number };
    this.total = s.total;
    this.draws = s.draws;
  }
}

describe("Simulation", () => {
  it("runs many ticks without error and keeps time consistent", () => {
    const sim = new Simulation({ seed: 1 });
    sim.run(10_000);
    expect(sim.time.ticks).toBe(10_000);
    const t = sim.time.time();
    expect(t.day).toBe(Math.floor(10_000 / TICKS_PER_DAY));
  });

  it("updates registered systems every tick", () => {
    const sim = new Simulation({ seed: 1 });
    const acc = new AccumulatorSystem();
    sim.addSystem(acc);
    sim.run(500);
    expect(acc.draws).toBe(500);
  });

  it("rejects duplicate system ids", () => {
    const sim = new Simulation();
    sim.addSystem(new AccumulatorSystem());
    expect(() => sim.addSystem(new AccumulatorSystem())).toThrow();
  });

  describe("determinism", () => {
    it("identical seed -> identical state after 10k ticks", () => {
      const a = new Simulation({ seed: 4242 });
      const b = new Simulation({ seed: 4242 });
      a.addSystem(new AccumulatorSystem());
      b.addSystem(new AccumulatorSystem());
      a.run(10_000);
      b.run(10_000);
      expect(a.serialize()).toEqual(b.serialize());
    });

    it("different seeds -> different state", () => {
      const a = new Simulation({ seed: 1 });
      const b = new Simulation({ seed: 2 });
      a.addSystem(new AccumulatorSystem());
      b.addSystem(new AccumulatorSystem());
      a.run(1000);
      b.run(1000);
      expect(a.serialize()).not.toEqual(b.serialize());
    });
  });

  describe("save / load", () => {
    it("round-trips through a snapshot and resumes identically", () => {
      const original = new Simulation({ seed: 777 });
      original.addSystem(new AccumulatorSystem());
      original.run(1234);

      const snapshot = original.serialize();

      // A fresh sim with a different seed should converge once restored.
      const loaded = new Simulation({ seed: 1 });
      loaded.addSystem(new AccumulatorSystem());
      loaded.restore(snapshot);

      expect(loaded.serialize()).toEqual(snapshot);

      // Continuing both must stay in lockstep.
      original.run(500);
      loaded.run(500);
      expect(loaded.serialize()).toEqual(original.serialize());
    });

    it("survives a JSON string round-trip", () => {
      const sim = new Simulation({ seed: 55 });
      sim.addSystem(new AccumulatorSystem());
      sim.run(300);

      const json = snapshotToJSON(sim.serialize());
      const restored = snapshotFromJSON(json);

      const loaded = new Simulation();
      loaded.addSystem(new AccumulatorSystem());
      loaded.restore(restored);

      expect(loaded.serialize()).toEqual(sim.serialize());
    });

    it("rejects a version mismatch", () => {
      const sim = new Simulation();
      const snap = sim.serialize();
      expect(() => sim.restore({ ...snap, version: 999 })).toThrow();
    });
  });

  describe("events", () => {
    it("emits a tick event every step", () => {
      const sim = new Simulation();
      const fn = vi.fn();
      sim.bus.on("tick", fn);
      sim.run(3);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenLastCalledWith({ totalTicks: 3 });
    });

    it("emits hourElapsed on the hour boundary", () => {
      const sim = new Simulation();
      const fn = vi.fn();
      sim.bus.on("hourElapsed", fn);
      sim.run(TICKS_PER_HOUR); // ticks 1..60; hour rolls 0->1 at tick 60
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0]![0]).toMatchObject({ hour: 1, minute: 0 });
    });

    it("emits dayRolled on the day boundary", () => {
      const sim = new Simulation();
      const fn = vi.fn();
      sim.bus.on("dayRolled", fn);
      sim.run(TICKS_PER_DAY);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith({ day: 1 });
    });
  });
});
