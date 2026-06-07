import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { occupantsByHome } from "../world/housing";
import { ENTREPRENEUR_MIN_SAVINGS } from "./constants";

const THIRTY_DAYS = TICKS_PER_DAY * 30;

describe("PopulationSystem (HP3-1, inert seam)", () => {
  it("createCity exposes the population handle", () => {
    const { population } = createCity({ seed: 1 });
    expect(population).toBeDefined();
    expect(population.id).toBe("population");
  });

  it("with growth off (default), population stays fixed and money is conserved", () => {
    const { sim, world } = createCity({ seed: 1 });
    const startMoney = world.totalMoney();
    const startCount = world.residents.length;
    sim.run(THIRTY_DAYS);
    expect(world.residents).toHaveLength(startCount);
    expect(world.totalMoney()).toBeCloseTo(startMoney, 6);
  });

  it("is byte-identical (off): two same-seed 30-day runs serialize-equal", () => {
    const a = createCity({ seed: 7 });
    const b = createCity({ seed: 7 });
    a.sim.run(THIRTY_DAYS);
    b.sim.run(THIRTY_DAYS);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.sim.serialize()).toEqual(b.sim.serialize());
  });

  it("the disabled system rides the snapshot and round-trips through save/reload", () => {
    const original = createCity({ seed: 42 });
    original.sim.run(TICKS_PER_DAY * 3 + 50);

    const snap = original.sim.serialize();
    expect(snap.systems).toHaveProperty("population");

    const json = snapshotToJSON(snap);
    const loaded = createCity({ seed: 1 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());

    // Continuing both stays in lockstep.
    original.sim.run(TICKS_PER_DAY);
    loaded.sim.run(TICKS_PER_DAY);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });
});

describe("PopulationSystem spawn primitive (HP3-4)", () => {
  it("admits a $0 jobless migrant with a finite numeric id, conserving money", () => {
    const { world, population } = createCity({ seed: 1, populationGrowth: true });
    const before = world.totalMoney();
    const beforeCount = world.residents.length;

    const r = population.spawnMigrant();
    expect(r).toBeDefined();
    // Continues the numeric namespace (12 seeded -> res_12), so the id parses to a
    // finite index everywhere (the NaN-id break the design panel flagged is gone).
    expect(r!.id).toBe("res_12");
    expect(Number.isFinite(Number(r!.id.split("_")[1]))).toBe(true);
    expect(r!.origin).toBe("migrant");
    expect(r!.money).toBe(0);
    expect(r!.jobId).toBe("");
    expect(world.getLocation(r!.homeId).type).toBe("home");
    expect(r!.needs).toEqual({ hunger: 80, energy: 85, social: 70 });

    expect(world.residents).toHaveLength(beforeCount + 1);
    expect(world.getResident("res_12")).toBe(r); // visible after reindex
    expect(world.totalMoney()).toBeCloseTo(before, 6); // $0 entry mints nothing
  });

  it("a migrant is a fully-functional resident: finite demand, eats, conserves money (no NaN)", () => {
    const { sim, world, population } = createCity({ seed: 1, populationGrowth: true });
    const r = population.spawnMigrant()!;
    // Fund it from a business (a transfer, so money stays conserved) and let it live.
    world.transfer("biz_landlord", r.id, 500);
    const startMoney = world.totalMoney();
    sim.run(TICKS_PER_DAY * 5);

    // The decisive NaN-id guard: a `res_mig1`-style id makes consumptionUnits NaN,
    // and the meal transfer then poisons the balance to NaN. res_12 parses to a
    // finite index, so money (and every need) stays finite and in-bounds.
    expect(Number.isFinite(r.money)).toBe(true);
    expect(r.money).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(r.needs)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // It actually eats — hunger doesn't crash to starvation over 5 days (it visits
    // the diner like any resident), which it couldn't if demand computed to NaN/zero.
    expect(r.needs.hunger).toBeGreaterThan(20);
    // And it participated in the economy (spent on meals/goods and/or drew the
    // recirculated dividend) rather than sitting frozen at the funded amount.
    expect(r.money).not.toBe(500);
    expect(world.totalMoney()).toBeCloseTo(startMoney, 6);
  });

  it("returns undefined when every home is full (housing is the hard gate)", () => {
    const { world, population } = createCity({ seed: 1, populationGrowth: true });
    let spawned = 0;
    while (population.spawnMigrant()) spawned++;
    expect(spawned).toBeGreaterThan(0); // HP1 seeded slack to grow into

    // Town is now full: every home at capacity, the next admission refused.
    expect(population.spawnMigrant()).toBeUndefined();
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBe(l.capacity ?? 99);
    }
  });

  it("is deterministic: two same-seed spawns yield identical worlds", () => {
    const a = createCity({ seed: 5, populationGrowth: true });
    const b = createCity({ seed: 5, populationGrowth: true });
    a.population.spawnMigrant();
    b.population.spawnMigrant();
    expect(a.world.serialize()).toEqual(b.world.serialize());
  });
});

describe("PopulationSystem growth trigger (HP3-5)", () => {
  const homeCapacity = (world: ReturnType<typeof createCity>["world"]) =>
    world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0);

  it("a prosperous town grows to fill its housing, then plateaus at the cap", () => {
    // prosperityFloor 0 => the wealth gate is always open, isolating the growth loop.
    const { sim, world } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { prosperityFloor: 0 },
    });
    const start = world.totalMoney();
    const cap = homeCapacity(world); // 18 for the default town

    sim.run(TICKS_PER_DAY * 200);
    expect(world.residents.length).toBe(cap); // grew to the housing ceiling
    expect(cap).toBeGreaterThan(12);

    // No home was ever pushed past its capacity.
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }

    // Plateau: another full year admits no one (housing is the hard ceiling -> HP4),
    // and the closed economy still balances despite a 50% bigger population.
    sim.run(TICKS_PER_DAY * 365);
    expect(world.residents.length).toBe(cap);
    expect(world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("seats a newcomer into a short-staffed producer (the headline win)", () => {
    // residentCount 11 leaves the factory one seat short, with nobody jobless.
    const { sim, world } = createCity({
      seed: 1,
      residentCount: 11,
      populationGrowth: true,
      populationOptions: { prosperityFloor: 0 },
    });
    expect(world.getBusiness("biz_factory")!.employeeIds.length).toBe(1); // short at seed

    sim.run(TICKS_PER_DAY * 200);

    // The newcomer took the open seat, so the producer is fully crewed (=> full
    // output): growth is productive, not just more mouths. Every producer crewed.
    for (const id of ["biz_farm", "biz_mine", "biz_bakery", "biz_factory"]) {
      expect(world.getBusiness(id)!.employeeIds.length).toBe(2);
    }
  });

  it("growth is deterministic and money-conserving", () => {
    const opts = { seed: 4, populationGrowth: true, populationOptions: { prosperityFloor: 0 } };
    const a = createCity(opts);
    const b = createCity(opts);
    const start = a.world.totalMoney();
    a.sim.run(TICKS_PER_DAY * 150);
    b.sim.run(TICKS_PER_DAY * 150);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.world.residents.length).toBeGreaterThan(12); // it actually grew
    expect(a.world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("the real (agentic) economy grows to capacity on the live default floor and stays healthy", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      populationGrowth: true,
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
    });
    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 365 * 2);

    expect(world.residents.length).toBe(homeCapacity(world)); // reaches the cap on the real economy
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
    // Healthy: the supply chain survives the bigger population, money is conserved,
    // and nobody is in the red.
    expect(new Set(world.businesses.filter((b) => b.active).map((b) => b.kind)).size).toBeGreaterThanOrEqual(4);
    expect(world.totalMoney()).toBeCloseTo(start, 2);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});

describe("HP3-8 — population growth stability soak", () => {
  const livingCity = (seed: number) =>
    createCity({
      seed,
      brain: "rules",
      residentBrain: "rules",
      disasters: true,
      populationGrowth: true,
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
      // births + mortality with a compressed clock so a few sim-years exercise real
      // demographic turnover (births, deaths, inheritance, ownership reassignment).
      populationOptions: { births: true, mortality: true, maxAgeYears: 50, daysPerYear: 90 },
    });

  for (const seed of [1, 7]) {
    it(`holds every invariant over 3 years of the full living + growing economy (seed ${seed})`, () => {
      const { sim, world, population } = livingCity(seed);
      const start = world.totalMoney();
      const cap = world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0);

      sim.run(TICKS_PER_DAY * 365 * 3);

      // Population grew yet stayed bounded by housing; the town is alive.
      expect(world.residents.length).toBeGreaterThan(12); // it grew
      expect(world.residents.length).toBeLessThanOrEqual(cap); // never outran its homes
      const occ = occupantsByHome(world.residents);
      for (const l of world.locations) {
        if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
      }
      // Real turnover happened (the demographic cycle ran).
      const demo = population.demography();
      expect(demo.born + demo.migrated).toBeGreaterThan(0);
      expect(demo.died).toBeGreaterThan(0);

      // SACRED: money conserved to the cent, no negatives, no NaN, needs bounded.
      expect(world.totalMoney()).toBeCloseTo(start, 2);
      for (const r of world.residents) {
        expect(r.money).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.money)).toBe(true);
        for (const v of Object.values(r.needs)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
      for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);

      // The supply chain survived the bigger, churning population.
      expect(new Set(world.businesses.filter((b) => b.active).map((b) => b.kind)).size).toBeGreaterThanOrEqual(4);
      // Every active firm has a LIVING owner — mortality reassigns on death.
      for (const b of world.businesses) {
        if (b.active) expect(world.getResident(b.ownerId)).toBeDefined();
      }
      // Wealth isn't flattened to subsistence: someone can still bankroll a firm,
      // so business entry can keep refounding dead niches under growth.
      expect(world.residents.some((r) => r.money >= ENTREPRENEUR_MIN_SAVINGS)).toBe(true);
    });
  }

  it("the full living economy is deterministic and round-trips mid-run", () => {
    const a = livingCity(1);
    a.sim.run(TICKS_PER_DAY * 200);
    const json = snapshotToJSON(a.sim.serialize());

    const b = livingCity(1);
    b.sim.restore(snapshotFromJSON(json));

    a.sim.run(TICKS_PER_DAY * 120);
    b.sim.run(TICKS_PER_DAY * 120);
    expect(b.world.serialize()).toEqual(a.world.serialize());
  });

  it("exposes housing-constrained as the HP4 build trigger", () => {
    const { sim, world, population } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { prosperityFloor: 0 },
    });
    expect(population.isHousingConstrained()).toBe(false); // slack at seed
    sim.run(TICKS_PER_DAY * 200); // fill the town
    expect(world.residents.length).toBe(
      world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0),
    );
    expect(population.isHousingConstrained()).toBe(true); // full -> HP4 would build
  });
});

describe("PopulationSystem mortality (HP3-6)", () => {
  // daysPerYear 2 compresses the demographic clock so a death fires on day 2;
  // maxAge 100 keeps the rest of the (age-spread) cohort alive so only the victim dies.
  const fast = { mortality: true, maxAgeYears: 100, daysPerYear: 2 };

  it("a resident at max age dies; estate -> heir, firm -> heir, job freed, money conserved", () => {
    const { sim, world } = createCity({ seed: 1, populationOptions: fast });
    // res_3 owns the farm (ownerOf(3)) and works at the mine (staffable[3]).
    expect(world.getBusiness("biz_farm")!.ownerId).toBe("res_3");
    expect(world.getBusiness("biz_mine")!.employeeIds).toContain("res_3");
    world.getResident("res_3")!.age = 100; // at the death age

    const start = world.totalMoney();
    sim.run(TICKS_PER_DAY * 2); // cross the (compressed) year boundary

    expect(world.getResident("res_3")).toBeUndefined(); // died
    expect(world.residents).toHaveLength(11);
    expect(world.totalMoney()).toBeCloseTo(start, 6); // estate inherited, none destroyed
    // The heir (lowest-id living resident) took over the farm; no dead owner remains.
    expect(world.getBusiness("biz_farm")!.ownerId).toBe("res_0");
    expect(world.getResident("res_0")).toBeDefined();
    // The decedent's job seat was freed.
    expect(world.getBusiness("biz_mine")!.employeeIds).not.toContain("res_3");
    // Every business owner is a living resident.
    for (const b of world.businesses) expect(world.getResident(b.ownerId)).toBeDefined();
  });

  it("aging + death survive save/reload (the same death reproduces)", () => {
    const opts = { seed: 1, populationOptions: fast };
    const a = createCity(opts);
    a.world.getResident("res_3")!.age = 99; // ages to 100 at the day-2 boundary
    a.sim.run(TICKS_PER_DAY); // day 1: no death yet

    const json = snapshotToJSON(a.sim.serialize());
    const b = createCity(opts);
    b.sim.restore(snapshotFromJSON(json));

    a.sim.run(TICKS_PER_DAY); // day 2: res_3 dies
    b.sim.run(TICKS_PER_DAY);
    expect(a.world.getResident("res_3")).toBeUndefined(); // it really died
    expect(b.world.serialize()).toEqual(a.world.serialize());
  });

  it("mortality + growth together stay deterministic and money-conserving", () => {
    const opts = {
      seed: 7,
      populationGrowth: true,
      populationOptions: { mortality: true, maxAgeYears: 8, daysPerYear: 30, prosperityFloor: 0 },
    };
    const a = createCity(opts);
    const b = createCity(opts);
    const start = a.world.totalMoney();
    a.sim.run(TICKS_PER_DAY * 150); // many year-boundaries -> births, deaths, migration
    b.sim.run(TICKS_PER_DAY * 150);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.world.totalMoney()).toBeCloseTo(start, 2);
    for (const r of a.world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });

  it("with mortality off, the seeded cohort is never aged (byte-identical)", () => {
    const { sim, world } = createCity({ seed: 1, populationGrowth: true, populationOptions: { prosperityFloor: 0 } });
    sim.run(TICKS_PER_DAY * 400);
    expect(world.getResident("res_0")!.age).toBeUndefined(); // no lazy-init without mortality
    expect(world.residents.length).toBeGreaterThanOrEqual(12); // only grew, nobody died
  });
});

describe("PopulationSystem births (HP3-7)", () => {
  it("a working parent has a child in the family home, funded by a conserved gift", () => {
    const { world, population } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { births: true, prosperityFloor: 0 },
    });
    const before = world.totalMoney();
    const beforeCount = world.residents.length;

    const child = population.spawnBirth();
    expect(child).toBeDefined();
    expect(child!.id).toBe("res_12"); // numeric id continues the namespace (finite index)
    expect(child!.origin).toBe("born");
    expect(child!.age).toBe(0);
    expect(child!.money).toBe(100); // received the gift (BIRTH_GIFT)
    expect(child!.jobId).toBe(""); // a dependent, not a worker

    const parent = world.getResident(child!.parentId!)!;
    expect(parent.jobId).not.toBe(""); // a working parent
    expect(child!.homeId).toBe(parent.homeId); // born into the family home

    expect(world.residents).toHaveLength(beforeCount + 1);
    expect(world.totalMoney()).toBeCloseTo(before, 6); // gift relocated, nothing minted
  });

  it("births grow the town to its housing cap, then plateau", () => {
    const { sim, world } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { births: true, prosperityFloor: 0 },
    });
    const cap = world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0);
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * 365);
    expect(world.residents.length).toBe(cap);
    expect(world.residents.filter((r) => r.origin === "born").length).toBeGreaterThan(0); // grew via families
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
    expect(world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("births are deterministic and money-conserving", () => {
    const opts = { seed: 3, populationGrowth: true, populationOptions: { births: true, prosperityFloor: 0 } };
    const a = createCity(opts);
    const b = createCity(opts);
    const start = a.world.totalMoney();
    a.sim.run(TICKS_PER_DAY * 200);
    b.sim.run(TICKS_PER_DAY * 200);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.world.residents.filter((r) => r.origin === "born").length).toBeGreaterThan(0);
    expect(a.world.totalMoney()).toBeCloseTo(start, 2);
  });

  it("births + mortality sustain a living town over many years (conserved, never collapses)", () => {
    // Births grow families; as the working generation ages out, in-migration backfills
    // the labour (the fallback) — so the town neither dies out nor overfills.
    const { sim, world } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { births: true, mortality: true, maxAgeYears: 8, daysPerYear: 30, prosperityFloor: 0 },
    });
    const start = world.totalMoney();
    const cap = world.locations.filter((l) => l.type === "home").reduce((s, l) => s + (l.capacity ?? 0), 0);

    sim.run(TICKS_PER_DAY * 365 * 2); // ~24 year-boundaries of births + deaths

    expect(world.residents.length).toBeGreaterThan(0); // didn't die out
    expect(world.residents.length).toBeLessThanOrEqual(cap); // never overran housing
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
    expect(world.totalMoney()).toBeCloseTo(start, 2);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});

describe("PopulationSystem coming-of-age (HP3-9)", () => {
  it("a grown child takes an open job when it comes of age", () => {
    // residentCount 11 leaves the factory one seat short with nobody jobless; a
    // compressed clock (2 sim-days/year, adulthood at 2) lets the child mature fast.
    const { sim, world, population } = createCity({
      seed: 1,
      residentCount: 11,
      populationOptions: { mortality: true, maxAgeYears: 100, daysPerYear: 2, comingOfAgeYears: 2 },
    });
    expect(world.getBusiness("biz_factory")!.employeeIds.length).toBe(1); // short at seed

    const child = population.spawnBirth()!; // res_11: a dependent, age 0, jobless
    expect(child.age).toBe(0);
    expect(child.jobId).toBe("");
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * 6); // cross enough year-boundaries to reach adulthood

    const grown = world.getResident(child.id)!;
    expect(grown.age ?? 0).toBeGreaterThanOrEqual(2); // came of age
    expect(grown.jobId).not.toBe(""); // and took a job...
    expect(world.getBusiness("biz_factory")!.employeeIds).toContain(child.id); // ...the open seat
    expect(world.totalMoney()).toBeCloseTo(start, 6); // seating is non-cash
  });

  it("tallies a child coming of age (demography.grewUp), for the town-life feed", () => {
    const { sim, population } = createCity({
      seed: 1,
      populationOptions: { mortality: true, maxAgeYears: 100, daysPerYear: 2, comingOfAgeYears: 2 },
    });
    population.spawnBirth(); // a newborn, origin "born", age 0
    expect(population.demography().grewUp).toBe(0);
    sim.run(TICKS_PER_DAY * 6); // ages past the coming-of-age threshold
    expect(population.demography().grewUp).toBeGreaterThanOrEqual(1);
  });

  it("births + mortality + coming-of-age sustain the WORKFORCE over many years (no death spiral)", () => {
    // The full living cycle on a compressed clock (40y life, 9y adulthood, 30 sim-days
    // /year) so ~36 year-boundaries of births, maturation, and deaths run quickly.
    // Without coming-of-age this config death-spirals: the workforce collapses to ~5
    // and every producer goes unstaffed. With it, grown children (and displaced
    // adults) keep the seats filled.
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
      agenticBusinessIds: ["biz_diner", "biz_diner_2", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"],
      secondDiner: true,
      disasters: true,
      populationGrowth: true,
      populationOptions: { births: true, mortality: true, maxAgeYears: 40, daysPerYear: 30, comingOfAgeYears: 9 },
    });
    const start = world.totalMoney();

    sim.run(TICKS_PER_DAY * 365 * 3); // ~36 compressed year-boundaries

    // The labour force did NOT collapse — employment stays high (vs ~5 without it).
    const emp = world.residents.filter((r) => r.jobId !== "").length;
    expect(emp).toBeGreaterThanOrEqual(10);
    // Every producer KIND still has a staffed firm, so the supply chain is alive
    // (the assertion the old soak lacked — an *unstaffed* producer is still "active").
    for (const k of ["farm", "mine", "bakery", "factory", "diner", "goods"] as const) {
      expect(world.businesses.some((b) => b.kind === k && b.active && b.employeeIds.length > 0)).toBe(true);
    }
    // Sacred invariants hold across the whole living cycle.
    expect(world.totalMoney()).toBeCloseTo(start, 1);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});

describe("ResidentAgentSystem full agency (manageAll)", () => {
  it("manages every working-age resident (migrants, grown children) but not newborns", () => {
    const { sim, world, residentAgent, population } = createCity({
      seed: 1,
      residentBrain: "rules",
      agenticResidentIds: "all",
      populationGrowth: true,
      populationOptions: { prosperityFloor: 9_999_999 }, // suppress auto-growth; spawn manually
    });
    const migrant = population.spawnMigrant()!; // age 25 — a working adult
    const baby = population.spawnBirth()!; // age 0 — a dependent
    expect(migrant.age).toBeGreaterThanOrEqual(18);
    expect(baby.age).toBe(0);

    sim.run(TICKS_PER_DAY); // one daily review cycle

    const reviewed = new Set(residentAgent!.decisions().map((d) => d.residentId));
    expect(reviewed.has("res_0")).toBe(true); // the seeded cohort
    expect(reviewed.has(migrant.id)).toBe(true); // the in-migrant is a full agent
    expect(reviewed.has(baby.id)).toBe(false); // the newborn is a dependent, not an agent
    expect(world.totalMoney()).toBeGreaterThan(0); // sanity
  });
});

describe("PopulationSystem dynamic rent (HP2)", () => {
  it("rent eases under slack and rises under scarcity (money conserved)", () => {
    const { sim, world, population } = createCity({
      seed: 1,
      populationOptions: { dynamicRent: true },
    });
    const h = () => world.getLocation("loc_home_0");
    const base = h().rent ?? 0; // seeded 70
    const start = world.totalMoney();

    // Seeded occupancy is 12/18 ≈ 0.67, below the neutral 0.8 → rent drifts DOWN.
    sim.run(TICKS_PER_DAY * 40);
    const slackRent = h().rent ?? 0;
    expect(slackRent).toBeLessThan(base);
    expect(h().baseRent).toBe(base); // the base was captured lazily

    // Fill every home → occupancy 1.0 → scarcity pushes rent back UP past the slack level.
    while (population.spawnMigrant()) {
      /* fill all vacancies */
    }
    sim.run(TICKS_PER_DAY * 40);
    expect(h().rent ?? 0).toBeGreaterThan(slackRent);

    expect(world.totalMoney()).toBeCloseTo(start, 2); // only the rent LEVEL changed; nothing minted
  });

  it("dynamic rent is deterministic in the full living economy", () => {
    const mk = () =>
      createCity({
        seed: 1,
        brain: "rules",
        residentBrain: "rules",
        agenticResidentIds: "all",
        agenticBusinessIds: ["biz_diner", "biz_diner_2", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"],
        secondDiner: true,
        disasters: true,
        populationGrowth: true,
        populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
      });
    const a = mk();
    const b = mk();
    const start = a.world.totalMoney();

    a.sim.run(TICKS_PER_DAY * 365 * 2);
    b.sim.run(TICKS_PER_DAY * 365 * 2);

    expect(a.world.serialize()).toEqual(b.world.serialize()); // deterministic with the rent market live
    expect(a.world.totalMoney()).toBeCloseTo(start, 1);
    // The rent market actually ran: every home captured a base rent.
    for (const l of a.world.locations) {
      if (l.type === "home") expect(l.baseRent).toBeDefined();
    }
  });
});

describe("PopulationSystem construction (HP4)", () => {
  it("builds a new home when the town is full, lifting the cap (money conserved)", () => {
    // prosperityFloor 0 + a short cooldown so migration fills the town and the
    // landlord builds quickly; in-migration (births off) keeps it simple.
    const { sim, world } = createCity({
      seed: 1,
      populationGrowth: true,
      populationOptions: { construction: true, prosperityFloor: 0, buildCooldownDays: 5 },
    });
    const start = world.totalMoney();
    const homes0 = world.locations.filter((l) => l.type === "home").length; // 6

    sim.run(TICKS_PER_DAY * 365);

    const homes1 = world.locations.filter((l) => l.type === "home").length;
    expect(homes1).toBeGreaterThan(homes0); // the landlord built housing
    expect(world.residents.length).toBeGreaterThan(18); // grew past the seeded 18 cap
    expect(world.totalMoney()).toBeCloseTo(start, 2); // build cost was a transfer, not minted
    // No home is ever over capacity, including the newly built ones.
    const occ = occupantsByHome(world.residents);
    for (const l of world.locations) {
      if (l.type === "home") expect(occ.get(l.id) ?? 0).toBeLessThanOrEqual(l.capacity ?? 99);
    }
  });

  it("the living economy grows past the cap, self-limits, stays healthy + deterministic", () => {
    const mk = () =>
      createCity({
        seed: 1,
        brain: "rules",
        residentBrain: "rules",
        agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
        agenticBusinessIds: ["biz_diner", "biz_diner_2", "biz_goods", "biz_farm", "biz_mine", "biz_bakery", "biz_factory"],
        secondDiner: true,
        disasters: true,
        populationGrowth: true,
        populationOptions: { births: true, mortality: true, construction: true, maxAgeYears: 40, daysPerYear: 30, comingOfAgeYears: 9 },
      });
    const a = mk();
    const b = mk();
    const start = a.world.totalMoney();

    a.sim.run(TICKS_PER_DAY * 365 * 3);
    b.sim.run(TICKS_PER_DAY * 365 * 3);

    expect(a.world.serialize()).toEqual(b.world.serialize()); // deterministic with construction
    expect(a.world.locations.filter((l) => l.type === "home").length).toBeGreaterThan(6); // built homes
    expect(a.world.residents.length).toBeGreaterThan(12); // grew past the seed
    expect(a.world.residents.length).toBeLessThanOrEqual(40); // but self-limited (no runaway)
    for (const k of ["farm", "mine", "bakery", "factory", "diner", "goods"] as const) {
      expect(a.world.businesses.some((bz) => bz.kind === k && bz.active && bz.employeeIds.length > 0)).toBe(true);
    }
    expect(a.world.totalMoney()).toBeCloseTo(start, 1);
    for (const r of a.world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});
