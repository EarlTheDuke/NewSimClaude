import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import type { Activity } from "../world/types";

const THIRTY_DAYS = TICKS_PER_DAY * 30;

describe("Phase 1 city", () => {
  it("builds the expected world", () => {
    const { world } = createCity({ seed: 1 });
    expect(world.residents).toHaveLength(12);
    expect(world.businesses.map((b) => b.kind).sort()).toEqual([
      "diner",
      "goods",
      "landlord",
    ]);
    // Every resident has a real home and a real employer.
    for (const r of world.residents) {
      expect(world.getLocation(r.homeId).type).toBe("home");
      expect(world.getBusiness(r.jobId)).toBeDefined();
    }
  });

  describe("closed economy", () => {
    it("conserves total money across 30 sim-days", () => {
      const { sim, world } = createCity({ seed: 1 });
      const start = world.totalMoney();
      sim.run(THIRTY_DAYS);
      expect(world.totalMoney()).toBeCloseTo(start, 6);
    });

    it("money actually circulates (wages, rent, sales all flow)", () => {
      const { sim, world } = createCity({ seed: 1 });
      sim.run(TICKS_PER_DAY * 2);
      const landlord = world.getBusiness("biz_landlord")!;
      const diner = world.getBusiness("biz_diner")!;
      expect(landlord.pnl.rentCollected).toBeGreaterThan(0);
      expect(diner.pnl.revenue).toBeGreaterThan(0);
      const totalWages = world.businesses.reduce((s, b) => s + b.pnl.wagesPaid, 0);
      expect(totalWages).toBeGreaterThan(0);
    });

    it("never lets a holder go negative", () => {
      const { sim, world } = createCity({ seed: 3 });
      sim.run(THIRTY_DAYS);
      for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
      for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
    });
  });

  describe("residents are alive, not stuck", () => {
    it("commute between distinct places over a day", () => {
      const { sim, world } = createCity({ seed: 1 });
      const visited = new Map<string, Set<string>>(
        world.residents.map((r) => [r.id, new Set<string>()]),
      );
      const seenActivities = new Set<Activity>();
      for (let i = 0; i < TICKS_PER_DAY; i++) {
        sim.step();
        for (const r of world.residents) {
          visited.get(r.id)!.add(r.move.atNodeId);
          seenActivities.add(r.activity);
        }
      }
      // Everyone reached at least two different nodes — no one is frozen.
      for (const nodes of visited.values()) {
        expect(nodes.size).toBeGreaterThanOrEqual(2);
      }
      // A full life shows up over a day.
      expect(seenActivities.has("working")).toBe(true);
      expect(seenActivities.has("sleeping")).toBe(true);
      expect(seenActivities.has("commuting")).toBe(true);
    });

    it("keeps positions finite and needs within [0,100]", () => {
      const { sim, world } = createCity({ seed: 7 });
      sim.run(TICKS_PER_DAY * 5);
      for (const r of world.residents) {
        expect(Number.isFinite(r.move.x)).toBe(true);
        expect(Number.isFinite(r.move.y)).toBe(true);
        for (const v of Object.values(r.needs)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe("determinism & persistence", () => {
    it("identical seed -> identical world after 10 days", () => {
      const a = createCity({ seed: 99 });
      const b = createCity({ seed: 99 });
      a.sim.run(TICKS_PER_DAY * 10);
      b.sim.run(TICKS_PER_DAY * 10);
      expect(a.world.serialize()).toEqual(b.world.serialize());
    });

    it("save -> reload resumes identically", () => {
      const original = createCity({ seed: 42 });
      original.sim.run(TICKS_PER_DAY * 3 + 137);
      const json = snapshotToJSON(original.sim.serialize());

      const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
      loaded.sim.restore(snapshotFromJSON(json));
      expect(loaded.world.serialize()).toEqual(original.world.serialize());

      // Continuing both must stay in lockstep.
      original.sim.run(TICKS_PER_DAY);
      loaded.sim.run(TICKS_PER_DAY);
      expect(loaded.world.serialize()).toEqual(original.world.serialize());
    });
  });
});
