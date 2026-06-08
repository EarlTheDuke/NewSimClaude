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

  it("a lifted cap lets competition push wages above the old 2× ceiling — conserved & deterministic", () => {
    const free = scarce({ wageCapMult: 8 });
    const start = free.world.totalMoney();
    free.sim.run(TICKS_PER_DAY * 365);

    // Some firm now pays above 2× its base — impossible under the old fixed cap.
    const overOldCap = free.world.businesses.filter(
      (b) => b.active && !!b.baseWagePerTick && b.wagePerTick > b.baseWagePerTick * 2 + 1e-9,
    );
    expect(overOldCap.length).toBeGreaterThan(0);

    // Conservation holds to the cent.
    expect(free.world.totalMoney()).toBeCloseTo(start, 2);

    // Determinism: a same-config run reproduces the world exactly.
    const free2 = scarce({ wageCapMult: 8 });
    free2.sim.run(TICKS_PER_DAY * 365);
    expect(free2.world.serialize()).toEqual(free.world.serialize());
  });

  it("freeing the wage lifts the average wage vs the same city with the cap on", () => {
    const capped = scarce(); // wageCapMult defaults to 2
    const free = scarce({ wageCapMult: 8 });
    capped.sim.run(TICKS_PER_DAY * 365);
    free.sim.run(TICKS_PER_DAY * 365);
    expect(free.macro.latest()!.avgWage).toBeGreaterThan(capped.macro.latest()!.avgWage);
  });
});
