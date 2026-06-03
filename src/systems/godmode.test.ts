import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { GodMode } from "./GodMode";
import { BASE_RESOURCE_PRICE, PRICE_MAX_MULT } from "./constants";
import type { ResourceKind } from "../world/types";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];

describe("GodMode (Phase 7)", () => {
  it("is always present on the city — inert until invoked", () => {
    const city = createCity({ seed: 1 });
    expect(city.god).toBeInstanceOf(GodMode);
    expect(city.god.interventions()).toHaveLength(0);
  });

  describe("strike — force a disaster now", () => {
    it("applies a fire, conserves money, and mirrors into the events log", () => {
      // dailyChance 0 ⇒ EventSystem present but no organic disasters to muddy the log.
      const { world, god, events, sim } = createCity({ seed: 7, disasters: { dailyChance: 0 } });
      sim.run(TICKS_PER_DAY * 3);
      const day = sim.time.time().day;

      // Force the random pick onto exactly one business — do this *after* the run,
      // since production would otherwise restock the others before the strike.
      for (const b of world.businesses) {
        b.inventory = 0;
        for (const r of RESOURCES) b.resources[r] = 0;
      }
      const target = world.getBusiness("biz_goods")!;
      target.inventory = 100;
      target.resources.materials = 40;
      const before = world.totalMoney();

      const rec = god.strike("fire");

      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe("strike");
      expect(rec!.targetId).toBe("biz_goods");
      expect(rec!.day).toBe(day);
      expect(target.inventory).toBeLessThan(100);
      expect(world.totalMoney()).toBeCloseTo(before, 6);

      // Mirrored: the organic events log + glyph see it as a real fire.
      expect(events!.events()).toHaveLength(1);
      expect(events!.events()[0]!.kind).toBe("fire");
      expect(events!.events()[0]!.headline).toBe(rec!.headline);
      // And it lives in God Mode's own log under the divine "strike" kind.
      expect(god.latest()).toEqual(rec);
    });

    it("returns null (no log entry) when the disaster fizzles", () => {
      const { world, god, events } = createCity({ seed: 7, disasters: { dailyChance: 0 } });
      for (const b of world.businesses) {
        b.inventory = 0;
        for (const r of RESOURCES) b.resources[r] = 0;
      }
      expect(god.strike("fire")).toBeNull();
      expect(god.interventions()).toHaveLength(0);
      expect(events!.events()).toHaveLength(0);
    });

    it("works without an EventSystem (still logs to God Mode's own log)", () => {
      const { world, god } = createCity({ seed: 4 }); // disasters off ⇒ no events system
      for (const r of world.residents) r.needs.social = 10;
      const rec = god.strike("festival");
      expect(rec!.kind).toBe("strike");
      expect(world.residents.every((r) => r.needs.social === 100)).toBe(true);
    });
  });

  describe("cash interventions are conserving transfers", () => {
    it("subsidize moves existing cash between holders", () => {
      const { world, god } = createCity({ seed: 4 });
      const from = world.getBusiness("biz_landlord")!;
      const to = world.getBusiness("biz_factory")!;
      const before = world.totalMoney();
      const fromCash = from.cash;
      const toCash = to.cash;

      const rec = god.subsidize(from.id, to.id, 250);

      expect(rec!.targetId).toBe(to.id);
      expect(from.cash).toBe(fromCash - 250);
      expect(to.cash).toBe(toCash + 250);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });

    it("subsidize returns null when nothing moves", () => {
      const { world, god } = createCity({ seed: 4 });
      expect(god.subsidize(world.businesses[0]!.id, world.businesses[1]!.id, 0)).toBeNull();
    });

    it("bailOutPoorest routes landlord cash to the neediest business", () => {
      const { world, god } = createCity({ seed: 4 });
      const landlord = world.getBusiness("biz_landlord")!;
      landlord.cash = 7000;
      const needy = world.getBusiness("biz_factory")!;
      needy.cash = 10;
      const before = world.totalMoney();

      const rec = god.bailOutPoorest(1500);

      expect(rec!.targetId).toBe("biz_factory");
      expect(needy.cash).toBe(1510);
      expect(landlord.cash).toBe(5500);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });
  });

  describe("need interventions", () => {
    it("setNeed clamps to 0..100", () => {
      const { world, god } = createCity({ seed: 4 });
      const id = world.residents[0]!.id;
      god.setNeed(id, "energy", 999);
      expect(world.getResident(id)!.needs.energy).toBe(100);
      god.setNeed(id, "hunger", -50);
      expect(world.getResident(id)!.needs.hunger).toBe(0);
    });

    it("healAll / exhaustAll move every resident's needs to the extremes", () => {
      const { world, god } = createCity({ seed: 4 });
      god.healAll();
      for (const r of world.residents) {
        expect(r.needs.hunger).toBe(100);
        expect(r.needs.energy).toBe(100);
        expect(r.needs.social).toBe(100);
      }
      god.exhaustAll();
      for (const r of world.residents) {
        expect(r.needs.hunger).toBe(0);
        expect(r.needs.energy).toBe(0);
        expect(r.needs.social).toBe(0);
      }
    });
  });

  describe("business + market interventions", () => {
    it("setActive shutters and revives a business", () => {
      const { world, god } = createCity({ seed: 4 });
      const b = world.getBusiness("biz_diner")!;
      god.setActive(b.id, false);
      expect(b.active).toBe(false);
      god.setActive(b.id, true);
      expect(b.active).toBe(true);
      expect(god.setActive("nope", true)).toBeNull();
    });

    it("shockPrice forces a resource to its ceiling without moving money", () => {
      const { world, market, god } = createCity({ seed: 4 });
      const before = world.totalMoney();
      const rec = god.shockPrice("grain");
      expect(rec.targetId).toBe("grain");
      expect(market.priceBook().grain).toBeCloseTo(BASE_RESOURCE_PRICE.grain * PRICE_MAX_MULT, 6);
      expect(world.totalMoney()).toBeCloseTo(before, 6);
    });
  });

  it("conserves total money across a whole battery of interventions", () => {
    const { world, god } = createCity({ seed: 2, disasters: { dailyChance: 0 } });
    const before = world.totalMoney();
    const r0 = world.residents[0]!.id;

    god.strike("fire");
    god.strike("festival");
    god.subsidize("biz_landlord", "biz_factory", 300);
    god.bailOutPoorest(500);
    god.setNeed(r0, "energy", 42);
    god.healAll();
    god.exhaustAll();
    god.setActive("biz_diner", false);
    god.shockPrice("wares");

    expect(world.totalMoney()).toBeCloseTo(before, 6);
    expect(god.interventions().length).toBeGreaterThanOrEqual(7);
  });
});
