import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

/** Kill a business outright (as a forced exit), laying its crew off to the pool. */
function kill(world: ReturnType<typeof createCity>["world"], id: string): void {
  const biz = world.getBusiness(id)!;
  for (const eid of biz.employeeIds) {
    const r = world.getResident(eid);
    if (r) { r.jobId = ""; r.wagePerTick = 0; }
  }
  biz.active = false;
  biz.employeeIds = [];
}

/**
 * Phase 15 D — business *entry* (the birth half of creative destruction). When a
 * BusinessKind goes fully extinct, a resident with savings to spare founds a fresh
 * firm to serve the standing demand: funded from their own pocket (no money minted),
 * staffed from the jobless pool, and owned by the founder. The seeded city, where
 * every kind is alive, never triggers it.
 */
describe("BusinessEntrySystem — business birth", () => {
  it("births a new firm when a kind goes extinct, funded by a resident-founder", () => {
    const { sim, world } = createCity({ seed: 1 });
    world.getResident("res_5")!.money = 1000; // an eligible founder (seeded residents hold $500)
    kill(world, "biz_diner"); // the sole diner — the food-retail niche is now empty
    const startMoney = world.totalMoney();

    sim.run(TICKS_PER_DAY); // one day-boundary → entry fires

    const diners = world.businesses.filter((b) => b.kind === "diner" && b.active);
    expect(diners).toHaveLength(1); // the niche was refilled
    const born = diners[0]!;
    expect(born.id).not.toBe("biz_diner"); // a genuinely new firm, not the husk re-activated
    expect(born.cash).toBeGreaterThan(0); // capitalised from the founder's savings
    expect(born.employeeIds.length).toBeGreaterThan(0); // staffed from the jobless pool
    expect(world.residents.some((r) => r.id === born.ownerId)).toBe(true); // a resident owns it
    // The founder paid for it out of pocket — a transfer, so the closed economy holds.
    expect(world.totalMoney()).toBeCloseTo(startMoney, 6);
  });

  it("does not spawn while any firm of the kind still trades (niche not yet empty)", () => {
    const { sim, world } = createCity({ seed: 1, secondDiner: true });
    world.getResident("res_5")!.money = 1000;
    kill(world, "biz_diner"); // one of the two diners dies; biz_diner_2 still trades
    const before = world.businesses.length;

    sim.run(TICKS_PER_DAY * 12); // well past the entry cooldown

    // The diner niche is still served, so no new diner is founded.
    expect(world.businesses.filter((b) => b.kind === "diner" && b.active)).toHaveLength(1);
    expect(world.businesses.length).toBe(before);
  });

  it("leaves the healthy seeded city untouched — no spurious births over 100 days", () => {
    const { sim, world } = createCity({ seed: 1 });
    const before = world.businesses.length;
    sim.run(TICKS_PER_DAY * 100);
    expect(world.businesses.length).toBe(before); // nothing went extinct, so nothing was born
  });

  it("is deterministic: the same extinction births the identical firm", () => {
    const build = () => {
      const c = createCity({ seed: 4 });
      c.world.getResident("res_5")!.money = 1000;
      kill(c.world, "biz_diner");
      c.sim.run(TICKS_PER_DAY * 3);
      return c.world.serialize();
    };
    expect(build()).toEqual(build());
  });

  it("round-trips a born firm and the entry cooldown across save → reload", () => {
    const original = createCity({ seed: 1 });
    original.world.getResident("res_5")!.money = 1000;
    kill(original.world, "biz_diner");
    original.sim.run(TICKS_PER_DAY); // births the replacement diner
    expect(
      original.world.businesses.some((b) => b.kind === "diner" && b.active && b.id !== "biz_diner"),
    ).toBe(true);
    const json = snapshotToJSON(original.sim.serialize());

    const loaded = createCity({ seed: 99 }); // different seed; restore overwrites
    loaded.sim.restore(snapshotFromJSON(json));
    expect(loaded.world.serialize()).toEqual(original.world.serialize());

    // They stay in lockstep when run on — the serialized spawn counter survived, so
    // no future birth collides with an id minted before the save.
    original.sim.run(TICKS_PER_DAY * 5);
    loaded.sim.run(TICKS_PER_DAY * 5);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
  });

  /**
   * Initiative #2, slice 1 — *opportunity* entry. Where heal refills an extinct kind,
   * opportunity founds a SECOND storefront when the incumbent runs flat-out (capacity-
   * bound) and solvent: a busy, profitable niche attracts a rival, who opens across
   * town so the price+distance demand split actually hands it customers. Off by default
   * (byte-identical); a slammed diner is the standing test fixture.
   */
  describe("opportunity entry — a slammed storefront draws a rival", () => {
    /** A rich town eats voraciously (steep wealth elasticity), pinning the lone diner flat-out. */
    function slammedTown(over: Parameters<typeof createCity>[0] = {}) {
      const c = createCity({
        seed: 1,
        businessEntry: false, // isolate: only opportunity entry may add a firm
        wealthElasticity: 2, // wants grow steeply with wealth → demand >> diner capacity
        unemployed: 3, // slack labour the rival can hire (poaching is a later initiative)
        ...over,
      });
      for (const r of c.world.residents) r.money = 20_000; // slam demand + guarantee funded founders
      return c;
    }

    it("founds a rival diner across town when the incumbent is capacity-bound and solvent", () => {
      const { sim, world } = slammedTown({ opportunityEntry: true });
      const startMoney = world.totalMoney();

      sim.run(TICKS_PER_DAY * 20); // past the entry cooldown; the diner runs hot for days

      const diners = world.businesses.filter((b) => b.kind === "diner" && b.active);
      expect(diners.length).toBe(2); // a second diner was born into the unmet demand
      const rival = diners.find((b) => b.id !== "biz_diner")!;
      // It opened at its OWN location, not on top of the incumbent — a real geographic split.
      expect(rival.locationId).not.toBe(world.getBusiness("biz_diner")!.locationId);
      expect(rival.employeeIds.length).toBeGreaterThan(0); // staffed from the labour pool
      expect(world.residents.some((r) => r.id === rival.ownerId)).toBe(true); // a resident founded + owns it
      // Birth mints no money — the founder bought the firm out of pocket; the loop holds.
      expect(world.totalMoney()).toBeCloseTo(startMoney, 4);
    });

    it("is inert when the flag is off — the same slammed town spawns no rival", () => {
      const { sim, world } = slammedTown(); // opportunityEntry defaults OFF
      sim.run(TICKS_PER_DAY * 20);
      expect(world.businesses.filter((b) => b.kind === "diner" && b.active)).toHaveLength(1);
      expect(world.businesses.some((b) => b.id.startsWith("biz_diner_gen"))).toBe(false);
    });

    it("respects the per-kind cap — never founds a third diner", () => {
      // Start with two diners already; the kind is at the cap, so no rival may be added.
      const { sim, world } = slammedTown({ opportunityEntry: true, secondDiner: true });
      sim.run(TICKS_PER_DAY * 30);
      expect(
        world.businesses.filter((b) => b.kind === "diner" && b.active).length,
      ).toBeLessThanOrEqual(2);
      expect(world.businesses.some((b) => b.id.startsWith("biz_diner_gen"))).toBe(false);
    });

    it("is deterministic: the same slammed town births the identical rival", () => {
      const build = () => {
        const c = slammedTown({ opportunityEntry: true });
        c.sim.run(TICKS_PER_DAY * 20);
        return c.world.serialize();
      };
      expect(build()).toEqual(build());
    });

    // --- Slice 3: the bottleneck moves upstream — a slammed PRODUCER draws a rival ---
    const PRODUCER_KINDS = ["farm", "mine", "bakery", "factory"];
    /** A bigger town (population > jobs) slams the whole chain AND leaves a jobless pool to staff entrants. */
    function slammedChain() {
      return slammedTown({
        opportunityEntry: true,
        secondDiner: true,
        residentCount: 30, // population > jobs ⇒ a real labour pool...
        unemployed: 12, // ...without gutting the base (18 stay employed and staff it)
      });
    }

    it("founds a second producer, co-located, when a supply bottleneck runs capacity-bound", () => {
      const { sim, world } = slammedChain();
      const startMoney = world.totalMoney();

      sim.run(TICKS_PER_DAY * 20);

      // The producer that runs flat-out first draws a rival founded *beside* it.
      const seconds = world.businesses.filter(
        (b) => b.active && b.id.includes("_gen") && PRODUCER_KINDS.includes(b.kind),
      );
      expect(seconds.length).toBeGreaterThan(0); // a supply bottleneck drew a rival producer
      const rival = seconds[0]!;
      const incumbent = world.businesses.find((b) => b.kind === rival.kind && !b.id.includes("_gen"))!;
      // Co-located with the incumbent — producers compete on supply, not on map position.
      expect(rival.locationId).toBe(incumbent.locationId);
      // It actually trades: slice 2's pooled procurement routes orders to the newcomer.
      expect(rival.pnl.revenue).toBeGreaterThan(0);
      // The closed economy held through the upstream birth.
      expect(world.totalMoney()).toBeCloseTo(startMoney, 4);
    });

    it("producer entry is deterministic and money-conserving", () => {
      const build = () => {
        const c = slammedChain();
        c.sim.run(TICKS_PER_DAY * 20);
        return c.world.serialize();
      };
      expect(build()).toEqual(build());
    });
  });

  it("self-heals: forced exits across the chain are refilled over a churning run (D4)", () => {
    const { sim, world } = createCity({
      seed: 1,
      brain: "rules",
      residentBrain: "rules",
      agenticBusinessIds: ["biz_diner", "biz_goods", "biz_farm", "biz_factory", "biz_mine", "biz_bakery"],
      agenticResidentIds: Array.from({ length: 12 }, (_, i) => `res_${i}`),
    });
    const startMoney = world.totalMoney();
    sim.run(TICKS_PER_DAY * 60); // warm up so residents bank the savings to found firms

    // Force two exits on different chains — a retail food seller and a raw producer.
    kill(world, "biz_diner");
    kill(world, "biz_mine");
    expect(world.businesses.filter((b) => b.kind === "diner" && b.active)).toHaveLength(0);
    expect(world.businesses.filter((b) => b.kind === "mine" && b.active)).toHaveLength(0);

    sim.run(TICKS_PER_DAY * 120); // give entry time (births are cooldown-spaced)

    // Both niches are served again — entrepreneurs refilled them, so the city healed.
    expect(world.businesses.filter((b) => b.kind === "diner" && b.active).length).toBeGreaterThan(0);
    expect(world.businesses.filter((b) => b.kind === "mine" && b.active).length).toBeGreaterThan(0);
    // The closed economy held through all the death, liquidation and birth; nobody underwater.
    expect(world.totalMoney()).toBeCloseTo(startMoney, 2);
    for (const b of world.businesses) expect(b.cash).toBeGreaterThanOrEqual(0);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });
});
