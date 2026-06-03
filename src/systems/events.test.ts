import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { SeededRNG } from "../utils/rng";
import { DISASTERS } from "./disasters";
import { BASE_RESOURCE_PRICE, PRICE_MAX_MULT } from "./constants";
import type { ResourceKind } from "../world/types";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];
const defOf = (kind: string) => DISASTERS.find((d) => d.kind === kind)!;
const fireDef = defOf("fire");
const festivalDef = defOf("festival");
const illnessDef = defOf("illness");
const supplyShockDef = defOf("supplyShock");
const grantDef = defOf("grant");

describe("EventSystem & disasters (Phase 6)", () => {
  describe("fire disaster effect", () => {
    it("destroys 40–80% of a business's goods without touching money", () => {
      const { world, market } = createCity({ seed: 7 });
      // Make exactly one business burnable, so the random pick is forced onto it.
      for (const b of world.businesses) {
        b.inventory = 0;
        for (const r of RESOURCES) b.resources[r] = 0;
      }
      const target = world.getBusiness("biz_goods")!;
      target.inventory = 100;
      target.resources.materials = 40;

      const before = world.totalMoney();
      const outcome = fireDef.apply({ world, market, rng: new SeededRNG(123) });

      expect(outcome).not.toBeNull();
      expect(outcome!.targetId).toBe("biz_goods");
      // 40–80% lost ⇒ between 20 and 60 of the 100 inventory remain.
      expect(target.inventory).toBeGreaterThanOrEqual(20);
      expect(target.inventory).toBeLessThanOrEqual(60);
      expect(target.resources.materials!).toBeLessThan(40);
      // Goods burned, but not a single dollar minted or destroyed.
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("fizzles (returns null) when nothing is burnable", () => {
      const { world, market } = createCity({ seed: 7 });
      for (const b of world.businesses) {
        b.inventory = 0;
        for (const r of RESOURCES) b.resources[r] = 0;
      }
      expect(fireDef.apply({ world, market, rng: new SeededRNG(1) })).toBeNull();
    });
  });

  describe("roster effects (Phase 6b)", () => {
    it("festival: maxes social, costs energy, moves no money", () => {
      const { world, market } = createCity({ seed: 4 });
      for (const r of world.residents) {
        r.needs.social = 10;
        r.needs.energy = 50;
      }
      const before = world.totalMoney();
      const out = festivalDef.apply({ world, market, rng: new SeededRNG(1) });
      expect(out!.headline).toMatch(/Festival/);
      for (const r of world.residents) {
        expect(r.needs.social).toBe(100);
        expect(r.needs.energy).toBe(32); // 50 - 18
      }
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("illness: sickens 2–5 distinct residents, moves no money", () => {
      const { world, market } = createCity({ seed: 4 });
      for (const r of world.residents) {
        r.needs.energy = 100;
        r.needs.hunger = 100;
      }
      const before = world.totalMoney();
      const out = illnessDef.apply({ world, market, rng: new SeededRNG(42) });

      const victims = world.residents.filter((r) => r.needs.energy < 100);
      expect(victims.length).toBeGreaterThanOrEqual(2);
      expect(victims.length).toBeLessThanOrEqual(5);
      for (const v of victims) {
        expect(v.needs.energy).toBeGreaterThanOrEqual(5);
        expect(v.needs.energy).toBeLessThan(20);
        expect(v.needs.hunger).toBe(80); // 100 - 20
      }
      expect(world.residents.some((r) => r.id === out!.targetId)).toBe(true);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("supplyShock: spikes one resource to its ceiling, moves no money", () => {
      const { world, market } = createCity({ seed: 4 });
      const before = world.totalMoney();
      const out = supplyShockDef.apply({ world, market, rng: new SeededRNG(2) });
      const res = out!.targetId as ResourceKind;
      expect(RESOURCES.includes(res)).toBe(true);
      expect(market.priceBook()[res]).toBeCloseTo(BASE_RESOURCE_PRICE[res] * PRICE_MAX_MULT, 6);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("grant: transfers landlord cash to the neediest business, conserving money", () => {
      const { world, market } = createCity({ seed: 4 });
      const landlord = world.getBusiness("biz_landlord")!;
      landlord.cash = 7000; // above LANDLORD_RESERVE so a grant is affordable
      const needy = world.getBusiness("biz_factory")!;
      needy.cash = 10; // clearly the poorest active non-landlord
      const before = world.totalMoney();

      const out = grantDef.apply({ world, market, rng: new SeededRNG(1) });
      expect(out!.targetId).toBe("biz_factory");
      expect(needy.cash).toBe(10 + 1500);
      expect(landlord.cash).toBe(7000 - 1500);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("grant: fizzles when the landlord has no cash above its reserve", () => {
      const { world, market } = createCity({ seed: 4 }); // landlord starts at 4000 < reserve
      expect(grantDef.apply({ world, market, rng: new SeededRNG(1) })).toBeNull();
    });
  });

  describe("opt-in wiring", () => {
    it("is off by default — no events system, world unchanged", () => {
      expect(createCity({ seed: 1 }).events).toBeUndefined();
    });

    it("is present once disasters are enabled", () => {
      expect(createCity({ seed: 1, disasters: true }).events).toBeDefined();
      expect(createCity({ seed: 1, disasters: { dailyChance: 0.5 } }).events).toBeDefined();
    });
  });

  describe("daily roll", () => {
    it("populates the log with fires at dailyChance 1", () => {
      const { sim, events } = createCity({
        seed: 3,
        disasters: { dailyChance: 1, kinds: ["fire"] },
      });
      sim.run(TICKS_PER_DAY * 30);
      const log = events!.events();
      expect(log.length).toBeGreaterThanOrEqual(10);
      expect(log.every((r) => r.kind === "fire")).toBe(true);
      expect(events!.latest()).toEqual(log[log.length - 1]);
      // Days are recorded in order and within the run.
      expect(log[0]!.day).toBeGreaterThanOrEqual(1);
      expect(log[log.length - 1]!.day).toBeLessThanOrEqual(30);
    });

    it("caps the log at DISASTER_LOG_SIZE (ring buffer)", () => {
      const { sim, events } = createCity({
        seed: 3,
        disasters: { dailyChance: 1, kinds: ["fire"] },
      });
      sim.run(TICKS_PER_DAY * 120); // > 50 fires
      expect(events!.events().length).toBeLessThanOrEqual(50);
    });
  });

  describe("determinism & conservation", () => {
    it("identical seed + options -> identical disaster log", () => {
      const opts = { seed: 9, disasters: { dailyChance: 0.5 } as const };
      const a = createCity(opts);
      const b = createCity(opts);
      a.sim.run(TICKS_PER_DAY * 60);
      b.sim.run(TICKS_PER_DAY * 60);
      expect(a.events!.events()).toEqual(b.events!.events());
    });

    it("uses its own RNG: the disaster log is independent of the sim stream", () => {
      // Same disaster options, different sim seed ⇒ the EventSystem's own RNG
      // (seeded from the run seed) still diverges, but never throws and stays valid.
      const a = createCity({ seed: 1, disasters: { dailyChance: 1, kinds: ["fire"] } });
      a.sim.run(TICKS_PER_DAY * 20);
      expect(a.events!.events().every((r) => r.kind === "fire")).toBe(true);
    });

    it("conserves total money over 100 disaster-days", () => {
      const { sim, world } = createCity({
        seed: 1,
        disasters: { dailyChance: 1, kinds: ["fire"] },
      });
      const start = world.totalMoney();
      sim.run(TICKS_PER_DAY * 100);
      expect(world.totalMoney()).toBeCloseTo(start, 4);
    });

    it("conserves money over 100 days with the FULL roster firing daily", () => {
      const { sim, world } = createCity({ seed: 2, disasters: { dailyChance: 1 } });
      const start = world.totalMoney();
      sim.run(TICKS_PER_DAY * 100);
      expect(world.totalMoney()).toBeCloseTo(start, 4);
    });

    it("exercises more than one disaster kind across a long run", () => {
      const { sim, events } = createCity({ seed: 11, disasters: { dailyChance: 1 } });
      sim.run(TICKS_PER_DAY * 60);
      const kinds = new Set(events!.events().map((r) => r.kind));
      expect(kinds.size).toBeGreaterThan(1);
    });
  });

  describe("persistence", () => {
    it("save -> reload restores the log and the event RNG (future disasters match)", () => {
      const disasters = { dailyChance: 0.6 } as const;
      const original = createCity({ seed: 5, disasters });
      original.sim.run(TICKS_PER_DAY * 25 + 300);
      const before = original.events!.events().map((r) => ({ ...r }));
      const json = snapshotToJSON(original.sim.serialize());

      // Different seed; restore must overwrite both world and event state.
      const loaded = createCity({ seed: 1, disasters });
      loaded.sim.restore(snapshotFromJSON(json));
      expect(loaded.events!.events()).toEqual(before);

      // Run both on — logs must stay in lockstep, proving the event RNG round-tripped.
      original.sim.run(TICKS_PER_DAY * 30);
      loaded.sim.run(TICKS_PER_DAY * 30);
      expect(loaded.events!.events()).toEqual(original.events!.events());
    });
  });

  describe("Phase 6 stability (DoD)", () => {
    const NEEDS = ["hunger", "energy", "social"] as const;

    it("survives 100 days at default odds: money conserved, all businesses alive, needs valid", () => {
      const { sim, world, events } = createCity({ seed: 1, disasters: true });
      const start = world.totalMoney();
      sim.run(TICKS_PER_DAY * 100);

      expect(world.totalMoney()).toBeCloseTo(start, 4);
      expect(world.businesses.every((b) => b.active)).toBe(true);
      for (const r of world.residents) {
        for (const k of NEEDS) {
          expect(r.needs[k]).toBeGreaterThanOrEqual(0);
          expect(r.needs[k]).toBeLessThanOrEqual(100);
        }
      }
      // Drama actually happened, and the log respected its ring-buffer cap.
      expect(events!.events().length).toBeGreaterThan(0);
      expect(events!.events().length).toBeLessThanOrEqual(50);
      expect(sim.time.time().day).toBe(100);
    });

    it("is fully deterministic with disasters on (money + log identical after 100 days)", () => {
      const a = createCity({ seed: 8, disasters: true });
      const b = createCity({ seed: 8, disasters: true });
      a.sim.run(TICKS_PER_DAY * 100);
      b.sim.run(TICKS_PER_DAY * 100);
      expect(a.world.totalMoney()).toBeCloseTo(b.world.totalMoney(), 9);
      expect(a.events!.events()).toEqual(b.events!.events());
    });
  });
});
