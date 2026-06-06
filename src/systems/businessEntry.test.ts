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
});
