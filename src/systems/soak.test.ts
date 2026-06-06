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

const AGENTIC_BIZ = ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"];
const ALL_RESIDENTS = Array.from({ length: 12 }, (_, i) => `res_${i}`);

/**
 * Phase 15 final QC — the whole living firm economy, every lever and feedback
 * engaged at once: all six firms agentic, all twelve residents agentic, disasters,
 * the owner dividend, and business birth/death — held to its invariants across
 * three full years. This is the "anyone can run it for years and it stays alive
 * and honest" guarantee for the living-firm-economy build.
 */
function assertLivingCity(seed: number): void {
  const { sim, world, macro } = createCity({
    seed,
    brain: "rules",
    residentBrain: "rules",
    agenticBusinessIds: AGENTIC_BIZ,
    agenticResidentIds: ALL_RESIDENTS,
    disasters: true,
  });
  const start = world.totalMoney();
  sim.run(TICKS_PER_DAY * 365 * 3); // three years

  expect(sim.time.time().day).toBe(365 * 3);
  // Closed economy: conserved to the cent across three years of churn, dividends,
  // births, deaths and disasters.
  expect(world.totalMoney()).toBeCloseTo(start, 2);

  // Needs bounded, nobody underwater, no NaN — anywhere.
  for (const r of world.residents) {
    expect(Number.isFinite(r.money)).toBe(true);
    expect(r.money).toBeGreaterThanOrEqual(0);
    for (const [need, v] of Object.entries(r.needs)) {
      expect(Number.isFinite(v), `${r.id} ${need} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }
  for (const b of world.businesses) {
    expect(Number.isFinite(b.cash), `${b.id} cash finite`).toBe(true);
    expect(b.cash).toBeGreaterThanOrEqual(0);
  }

  // Still a *living* city, not a frozen husk: a core of distinct kinds is still
  // served (entry refills what the long-run churn kills), and the economy is still
  // producing — a positive GDP on the final day.
  const activeKinds = new Set(world.businesses.filter((b) => b.active).map((b) => b.kind));
  expect(activeKinds.size).toBeGreaterThanOrEqual(4);
  expect(macro.latest()?.gdp ?? 0).toBeGreaterThan(0);
}

describe("Phase 15 — whole-arc soak (final QC)", () => {
  it(
    "holds every invariant across 3 years of the full living economy on seeds 1 & 7",
    () => {
      for (const seed of [1, 7]) assertLivingCity(seed);
    },
    120_000,
  );

  it(
    "is deterministic across a full year of the living economy (seed 1)",
    () => {
      const run = (): unknown => {
        const c = createCity({
          seed: 1,
          brain: "rules",
          residentBrain: "rules",
          agenticBusinessIds: AGENTIC_BIZ,
          agenticResidentIds: ALL_RESIDENTS,
          disasters: true,
        });
        c.sim.run(TICKS_PER_DAY * 365);
        return c.world.serialize();
      };
      expect(run()).toEqual(run());
    },
    60_000,
  );
});
