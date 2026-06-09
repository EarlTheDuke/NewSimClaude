import { describe, it, expect } from "vitest";
import { INDUSTRY_REGISTRY, RESOURCE_REGISTRY } from "./industries";
import { ARCHETYPES, PRODUCER_OF } from "./archetypes";
import { BASE_RESOURCE_PRICE } from "../systems/constants";

/**
 * Initiative #2 slice 4a — the industry registry is the single source, and ARCHETYPES /
 * PRODUCER_OF / BASE_RESOURCE_PRICE are derived from it. These guard that the derivation
 * stays faithful (a typo in the registry is caught here, not by a drifting soak) and pin
 * the seeded seven so slice 4d's edits can't silently change the default city.
 */
describe("industry registry (slice 4a)", () => {
  it("lists the seeded seven in chain order — a stable array, not keyed-object order", () => {
    expect(INDUSTRY_REGISTRY.map((d) => d.kind)).toEqual([
      "farm",
      "mine",
      "bakery",
      "factory",
      "diner",
      "goods",
      "landlord",
    ]);
    expect(RESOURCE_REGISTRY.map((r) => r.kind)).toEqual(["grain", "materials", "food", "wares"]);
  });

  it("derives ARCHETYPES faithfully — one entry per industry, fields verbatim", () => {
    expect(Object.keys(ARCHETYPES).sort()).toEqual(INDUSTRY_REGISTRY.map((d) => d.kind).sort());
    for (const d of INDUSTRY_REGISTRY) {
      expect(ARCHETYPES[d.kind]).toEqual({
        consumes: d.consumes,
        produces: d.produces,
        sellsToResidents: d.sellsToResidents,
        target: d.target,
        maxPerDay: d.maxPerDay,
      });
    }
  });

  it("pins the seeded archetype values (the byte-identity anchor)", () => {
    expect(ARCHETYPES.bakery).toEqual({
      consumes: "grain",
      produces: "food",
      sellsToResidents: false,
      target: 40,
      maxPerDay: 35,
    });
    expect(ARCHETYPES.diner).toEqual({
      consumes: "food",
      produces: undefined,
      sellsToResidents: true,
      target: 40,
      maxPerDay: 34,
    });
    expect(ARCHETYPES.landlord).toEqual({
      consumes: undefined,
      produces: undefined,
      sellsToResidents: false,
      target: 0,
      maxPerDay: 0,
    });
  });

  it("derives PRODUCER_OF as each resource's producing kind at its canonical seed id", () => {
    expect(PRODUCER_OF).toEqual({
      grain: "biz_farm",
      materials: "biz_mine",
      food: "biz_bakery",
      wares: "biz_factory",
    });
  });

  it("derives BASE_RESOURCE_PRICE from the registry's base prices", () => {
    expect(BASE_RESOURCE_PRICE).toEqual({ grain: 4, materials: 5, food: 8, wares: 11 });
  });
});
