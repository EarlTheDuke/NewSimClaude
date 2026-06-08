import { describe, it, expect } from "vitest";
import { createCity, type CitySimOptions } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";

const BIZ = ["biz_diner", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"];

const city = (over: Partial<CitySimOptions> = {}) =>
  createCity({
    seed: 1,
    brain: "rules",
    residentBrain: "rules",
    agenticResidentIds: "all",
    agenticBusinessIds: BIZ,
    disasters: true,
    ...over,
  });

// A labour-scarce city: a second diner means more seats than workers, so firms must
// compete for staff — the condition under which a freed wage cap actually bites.
const scarce = (over: Partial<CitySimOptions> = {}) =>
  city({ secondDiner: true, agenticBusinessIds: [...BIZ, "biz_diner_2"], ...over });

describe("free wage market (S1)", () => {
  it("the default cap (2×) is byte-identical to leaving wageCapMult unset", () => {
    const a = city();
    const b = city({ wageCapMult: 2 });
    a.sim.run(TICKS_PER_DAY * 120);
    b.sim.run(TICKS_PER_DAY * 120);
    expect(b.world.serialize()).toEqual(a.world.serialize());
  });

  it("a freed wage market is conserved, deterministic, and bounded — no firm pinned at the high cap", () => {
    const free = scarce({ wageCapMult: 8 });
    const start = free.world.totalMoney();
    free.sim.run(TICKS_PER_DAY * 365);
    const firms = free.world.businesses.filter((b) => b.active && !!b.baseWagePerTick);

    // Anti-spiral (S3 fix): affordability keeps every firm's posted wage off the 8× ceiling.
    expect(firms.every((b) => b.wagePerTick < b.baseWagePerTick! * 8 - 1e-9)).toBe(true);

    // Conservation holds to the cent.
    expect(free.world.totalMoney()).toBeCloseTo(start, 2);

    // Determinism: a same-config run reproduces the world exactly.
    const free2 = scarce({ wageCapMult: 8 });
    free2.sim.run(TICKS_PER_DAY * 365);
    expect(free2.world.serialize()).toEqual(free.world.serialize());
  });

  it("the freed market lifts wages above base (competes) but the affordability gate prevents a spiral", () => {
    // Before the S3 fix, a freed cap let understaffed-but-broke firms ratchet wages toward the 8×
    // ceiling, driving the average toward ~1.0 and collapsing circulation once the dividend was
    // weaned. With the affordability gate + understaffed-cash-thin ease-back, the average lands in a
    // sane band: above the seeded bases (≤ 0.20 — wages did compete up) yet far below the spiral.
    const free = scarce({ wageCapMult: 8 });
    free.sim.run(TICKS_PER_DAY * 365);
    const w = free.macro.latest()!.avgWage;
    expect(w).toBeGreaterThan(0.2); // competition lifted pay above the highest seeded base
    expect(w).toBeLessThan(0.5); // but no runaway toward the cap (the bug drove this to ~1.0)
  });
});
