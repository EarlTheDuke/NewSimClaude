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

/**
 * Slice b2 — the Monetary Authority and its bounded, deterministic supply rule: once a day,
 * mint `min(rate × current supply, hard cap)` at the authority through the audited doorway, then
 * helicopter it evenly to residents. Three inert switches (enabled, rate, cap) plus an opt-in
 * institution — all must be deliberately set before a cent is created.
 */
describe("MonetarySystem — the authority + the k-percent rule (C4 slice b2)", () => {
  const RATE = 0.001; // 0.1%/day for crisp test arithmetic
  const engaged = (seed: number, cap = 1_000_000) =>
    createCity({
      seed,
      includeAuthority: true,
      monetaryEnabled: true,
      monetaryGrowthRate: RATE,
      monetaryDailyCap: cap,
    });

  it("includeAuthority alone is inert: $0 resting cash, never bankrupted, city byte-identical around it", () => {
    const plain = createCity({ seed: 1 });
    plain.sim.run(TICKS_PER_DAY * 20);
    const seeded = createCity({ seed: 1, includeAuthority: true });
    seeded.sim.run(TICKS_PER_DAY * 20);

    const authority = seeded.world.getBusiness("biz_authority")!;
    expect(authority.kind).toBe("authority");
    expect(authority.cash).toBe(0); // its resting state — and the lifecycle shield held at $0
    expect(authority.active).toBe(true);
    expect(seeded.world.mintedTotal()).toBe(0); // present ≠ printing

    const snap = seeded.world.serialize();
    snap.businesses = snap.businesses.filter((b) => b.id !== "biz_authority");
    snap.locations = snap.locations.filter((l) => l.id !== "loc_authority");
    expect(snap).toEqual(plain.world.serialize());
  });

  it("day one mints exactly min(rate × genesis, cap) and helicopters it evenly to residents", () => {
    const { sim, world } = engaged(1);
    const genesis = world.totalMoney();
    sim.run(TICKS_PER_DAY); // one midnight — one policy action
    const expected = genesis * RATE; // far below the cap here
    expect(world.mintedTotal()).toBeCloseTo(expected, 9);
    expect(world.totalMoney()).toBeCloseTo(genesis + expected, 6);
    // Passed straight through: the authority keeps nothing.
    expect(world.getBusiness("biz_authority")!.cash).toBeCloseTo(0, 9);
  });

  it("the hard cap binds: a misconfigured rate can never print more than the cap per day", () => {
    const city = createCity({
      seed: 1,
      includeAuthority: true,
      monetaryEnabled: true,
      monetaryGrowthRate: 5, // absurd: 500%/day — the cap must hold the line
      monetaryDailyCap: 100,
    });
    city.sim.run(TICKS_PER_DAY * 10);
    expect(city.world.mintedTotal()).toBeCloseTo(1000, 6); // exactly 100/day × 10 days
  });

  it("the supply compounds (each day's issue grows the base of the next) and stays audited to the cent", () => {
    const { sim, world } = engaged(1);
    const genesis = world.totalMoney();
    sim.run(TICKS_PER_DAY * 60);
    // Compounding: cumulative issue strictly exceeds 60 flat days of the genesis-sized mint.
    expect(world.mintedTotal()).toBeGreaterThan(genesis * RATE * 60);
    // The relaxed-but-audited invariant, through 60 days of live economy + daily minting.
    expect(world.totalMoney()).toBeCloseTo(genesis + world.mintedTotal() - world.burnedTotal(), 2);
    for (const r of world.residents) expect(r.money).toBeGreaterThanOrEqual(0);
  });

  it("every switch is independently inert: no authority / not enabled / rate 0 / cap 0 ⇒ byte-identical", () => {
    const baseline = createCity({ seed: 1 });
    baseline.sim.run(TICKS_PER_DAY * 15);
    const base = baseline.world.serialize();

    const enabledNoAuthority = createCity({ seed: 1, monetaryEnabled: true, monetaryGrowthRate: RATE, monetaryDailyCap: 1000 });
    enabledNoAuthority.sim.run(TICKS_PER_DAY * 15);
    expect(enabledNoAuthority.world.serialize()).toEqual(base);

    for (const opts of [
      { monetaryGrowthRate: RATE, monetaryDailyCap: 1000 }, // not enabled
      { monetaryEnabled: true, monetaryDailyCap: 1000 }, // rate 0
      { monetaryEnabled: true, monetaryGrowthRate: RATE }, // cap 0 — the bound must be set
    ]) {
      const c = createCity({ seed: 1, includeAuthority: true, ...opts });
      c.sim.run(TICKS_PER_DAY * 15);
      expect(c.world.mintedTotal()).toBe(0);
      expect(c.world.totalMoney()).toBeCloseTo(baseline.world.totalMoney(), 6);
    }
  });

  it("Macro charts the day's issue: sample.minted equals the policy mint, 0 in conserved cities", () => {
    const { sim, macro, world } = engaged(1);
    sim.run(TICKS_PER_DAY * 3);
    const sample = macro.latest()!;
    expect(sample.minted).toBeGreaterThan(0);
    // The latest day's issue = rate × (supply at that midnight), within float dust.
    expect(sample.minted).toBeCloseTo((world.totalMoney() - sample.minted) * RATE, 6);

    const plain = createCity({ seed: 1 });
    plain.sim.run(TICKS_PER_DAY * 3);
    expect(plain.macro.latest()!.minted).toBe(0);
  });

  it("setPolicy flips the press mid-run (God's live lever): inert at 0/0, minting after, inert again", () => {
    const { sim, world } = createCity({ seed: 1, includeAuthority: true, monetaryEnabled: true });
    const monetary = sim.getSystem<import("./MonetarySystem").MonetarySystem>("monetary")!;
    const genesis = world.totalMoney();

    sim.run(TICKS_PER_DAY * 5); // armed but rate 0 / cap 0 ⇒ strictly conserved
    expect(world.mintedTotal()).toBe(0);

    monetary.setPolicy(RATE, 1_000_000); // God announces a money-growth target
    sim.run(TICKS_PER_DAY * 5);
    const mintedWhileOn = world.mintedTotal();
    expect(mintedWhileOn).toBeGreaterThan(0);
    expect(monetary.policy()).toEqual({ rate: RATE, cap: 1_000_000 });

    monetary.setPolicy(0, 0); // ...and turns the press back off
    sim.run(TICKS_PER_DAY * 5);
    expect(world.mintedTotal()).toBe(mintedWhileOn); // not a cent more
    expect(world.totalMoney()).toBeCloseTo(genesis + mintedWhileOn, 6); // audit holds throughout
  });

  it("is deterministic and round-trips mid-policy: ledger, wallets, and macro all survive save/load", () => {
    const run = () => {
      const c = engaged(7);
      c.sim.run(TICKS_PER_DAY * 20);
      return c.world.serialize();
    };
    expect(run()).toEqual(run());

    const original = engaged(1);
    original.sim.run(TICKS_PER_DAY * 10);
    const simJson = snapshotToJSON(original.sim.serialize());
    const worldSnap = original.world.serialize();

    const loaded = engaged(99);
    loaded.sim.restore(snapshotFromJSON(simJson));
    loaded.world.restore(worldSnap);
    original.sim.run(TICKS_PER_DAY * 10);
    loaded.sim.run(TICKS_PER_DAY * 10);
    expect(loaded.world.serialize()).toEqual(original.world.serialize());
    expect(loaded.world.mintedTotal()).toBeCloseTo(original.world.mintedTotal(), 9);
    expect(loaded.macro.latest()).toEqual(original.macro.latest());
  });
});
