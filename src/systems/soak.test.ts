import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { ResourceKind } from "../world/types";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];
const YEAR = TICKS_PER_DAY * 365;

/**
 * Phase 8 final QC — a year-long soak with *everything* running: organic
 * disasters, the business brain, and the resident brain. The economy must stay
 * sane for the whole run — money conserved, needs bounded, no NaN, nobody under
 * water. This is the "anyone can pick it up and it just works" guarantee.
 */
function assertHealthy(seed: number): void {
  const { sim, world, market, events } = createCity({
    seed,
    brain: "rules",
    residentBrain: "rules",
    agenticResidentIds: ["res_0", "res_1", "res_2", "res_3"],
    disasters: true,
  });

  const start = world.totalMoney();
  sim.run(YEAR);

  // Ran to completion and actually exercised the disaster path.
  expect(sim.time.time().day).toBe(365);
  expect(events!.events().length).toBeGreaterThan(0);

  // Closed economy: not a dollar minted or burned across a full year.
  expect(world.totalMoney()).toBeCloseTo(start, 4);

  for (const r of world.residents) {
    expect(Number.isFinite(r.money)).toBe(true);
    expect(r.money).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.move.x)).toBe(true);
    expect(Number.isFinite(r.move.y)).toBe(true);
    for (const [need, v] of Object.entries(r.needs)) {
      expect(Number.isFinite(v), `${r.id} ${need} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }

  for (const b of world.businesses) {
    expect(Number.isFinite(b.cash), `${b.id} cash finite`).toBe(true);
    expect(b.cash).toBeGreaterThanOrEqual(0); // the economy never drives a holder negative
    expect(Number.isFinite(b.inventory)).toBe(true);
    expect(b.inventory).toBeGreaterThanOrEqual(0);
  }

  const pb = market.priceBook();
  for (const res of RESOURCES) {
    expect(Number.isFinite(pb[res]), `${res} price finite`).toBe(true);
    expect(pb[res]).toBeGreaterThan(0);
  }
}

describe("Phase 8 — year-long soak (final QC)", () => {
  it(
    "holds every invariant across 365 days with disasters + both brains, on multiple seeds",
    () => {
      for (const seed of [1, 7]) assertHealthy(seed);
    },
    60_000,
  );
});
