import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

/**
 * Initiative C / C4 path (b), slice b1 — the audited `mint`/`burn` primitives and the
 * relaxed-but-audited conservation harness. THE INVARIANT CHANGES HERE, by the user's explicit
 * 2026-06-09 decision: from "totalMoney() is constant" to "totalMoney() === genesis +
 * mintedTotal() − burnedTotal(), to the cent" — with the default city (and the CEO bench) never
 * minting, so they remain strictly conserved and byte-identical. Money creation gets exactly one
 * sanctioned, logged doorway; any other change to the total is still a bug.
 */
describe("World.mint/burn — the audited monetary primitives (C4 slice b1)", () => {
  it("the default city never mints: counters 0, no ledger in the snapshot, strictly conserved", () => {
    const { sim, world } = createCity({ seed: 1 });
    const genesis = world.totalMoney();
    sim.run(TICKS_PER_DAY * 30);
    expect(world.mintedTotal()).toBe(0);
    expect(world.burnedTotal()).toBe(0);
    expect("monetary" in world.serialize()).toBe(false); // the ledger key only exists once used
    expect(world.totalMoney()).toBeCloseTo(genesis, 6);
  });

  it("mint creates money at a holder and logs it: the audit identity holds to the cent", () => {
    const { sim, world } = createCity({ seed: 1 });
    const genesis = world.totalMoney();
    const landlordBefore = world.getBusiness("biz_landlord")!.cash;

    expect(world.mint("biz_landlord", 750)).toBe(750);
    expect(world.getBusiness("biz_landlord")!.cash).toBe(landlordBefore + 750);
    expect(world.mintedTotal()).toBe(750);
    expect(world.totalMoney()).toBeCloseTo(genesis + 750, 6);

    // The audit identity survives a month of ordinary (conserving) economic activity.
    sim.run(TICKS_PER_DAY * 30);
    expect(world.totalMoney()).toBeCloseTo(genesis + world.mintedTotal() - world.burnedTotal(), 2);
  });

  it("burn destroys money, capped at the holder's balance — no balance ever goes negative", () => {
    const { world } = createCity({ seed: 1 });
    const genesis = world.totalMoney();
    const resident = world.getResident("res_0")!; // seeded with $500

    expect(world.burn("res_0", 200)).toBe(200);
    expect(resident.money).toBe(300);
    // Asking for more than the balance burns only what exists.
    expect(world.burn("res_0", 10_000)).toBe(300);
    expect(resident.money).toBe(0);
    expect(world.burnedTotal()).toBe(500);
    expect(world.totalMoney()).toBeCloseTo(genesis - 500, 6);
    expect(world.totalMoney()).toBeCloseTo(genesis + world.mintedTotal() - world.burnedTotal(), 6);
  });

  it("rejects nonsense: zero/negative amounts are no-ops, an unknown holder throws", () => {
    const { world } = createCity({ seed: 1 });
    const genesis = world.totalMoney();
    expect(world.mint("biz_diner", 0)).toBe(0);
    expect(world.mint("biz_diner", -50)).toBe(0);
    expect(world.burn("biz_diner", -50)).toBe(0);
    expect(() => world.mint("biz_nowhere", 100)).toThrow(); // no minting into the void
    expect(world.totalMoney()).toBeCloseTo(genesis, 6);
    expect(world.mintedTotal()).toBe(0);
  });

  it("the audit ledger rides the snapshot: serialize → restore preserves minted/burned exactly", () => {
    const original = createCity({ seed: 1 });
    original.world.mint("biz_landlord", 1234.56);
    original.world.burn("biz_landlord", 34.56);
    original.sim.run(TICKS_PER_DAY * 10);
    const json = snapshotToJSON(original.sim.serialize());
    const worldJson = original.world.serialize();
    expect(worldJson.monetary).toEqual({ minted: 1234.56, burned: 34.56 });

    const loaded = createCity({ seed: 99 });
    loaded.sim.restore(snapshotFromJSON(json));
    loaded.world.restore(worldJson);
    expect(loaded.world.mintedTotal()).toBe(1234.56);
    expect(loaded.world.burnedTotal()).toBe(34.56);
    // The restored run keeps satisfying the audit identity as it continues.
    const genesisEquivalent =
      loaded.world.totalMoney() - loaded.world.mintedTotal() + loaded.world.burnedTotal();
    loaded.sim.run(TICKS_PER_DAY * 10);
    expect(loaded.world.totalMoney()).toBeCloseTo(
      genesisEquivalent + loaded.world.mintedTotal() - loaded.world.burnedTotal(),
      2,
    );
  });

  it("a pre-C4b snapshot (no ledger key) restores as strictly conserved zeros", () => {
    const old = createCity({ seed: 1 });
    old.sim.run(TICKS_PER_DAY * 5);
    const snap = old.world.serialize();
    expect(snap.monetary).toBeUndefined();

    const loaded = createCity({ seed: 2 });
    loaded.world.mint("biz_landlord", 10); // dirty the counters first, to prove restore resets them
    loaded.world.restore(snap);
    expect(loaded.world.mintedTotal()).toBe(0);
    expect(loaded.world.burnedTotal()).toBe(0);
  });

  it("mint/burn are deterministic bookkeeping: the same scripted operations replay identically", () => {
    const run = () => {
      const c = createCity({ seed: 7 });
      c.sim.run(TICKS_PER_DAY * 5);
      c.world.mint("biz_diner", 500);
      c.sim.run(TICKS_PER_DAY * 5);
      c.world.burn("biz_diner", 120);
      c.sim.run(TICKS_PER_DAY * 5);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());
  });
});
