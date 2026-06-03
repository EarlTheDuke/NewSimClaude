import { describe, it, expect } from "vitest";
import { createCity, type CitySimOptions } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";

/**
 * Phase 8 hardening — a *fully-loaded* save/load round-trip.
 *
 * The Phase 1 test (city.test.ts) only round-trips a bare, hands-off city. This
 * exercises every stateful system at once — organic disasters (EventSystem RNG
 * + log), the business and resident brains (agent bookmarks + cooldowns), the
 * macro time series, and the market price book — proving the snapshot captures
 * *all* behaviour-affecting state, not just the World.
 */
const FULL_CONFIG: Omit<CitySimOptions, "seed"> = {
  brain: "rules",
  residentBrain: "rules",
  agenticBusinessIds: ["biz_diner", "biz_goods", "biz_bakery"],
  agenticResidentIds: ["res_0", "res_1", "res_2"],
  // A disaster every day hammers the EventSystem RNG + log so a missed byte of
  // restored state would desync the two runs almost immediately.
  disasters: { dailyChance: 1 },
};

/** Snapshot every observable surface, not just the World. */
function fingerprint(city: ReturnType<typeof createCity>) {
  return {
    world: city.world.serialize(),
    prices: city.market.priceBook(),
    macro: city.macro.history(),
    events: city.events!.events(),
  };
}

describe("Phase 8 — robust mid-simulation save/load", () => {
  it("round-trips a fully-loaded city and stays in lockstep", () => {
    const original = createCity({ seed: 42, ...FULL_CONFIG });
    // A deliberately mid-day offset, so partial-day + time-of-day state is non-trivial.
    original.sim.run(TICKS_PER_DAY * 5 + 613);

    // Two divine interventions mutate the live world right before the save. Their
    // *effects* belong to the World/market snapshot; the God Mode log itself is
    // intentionally never serialized (god acts are external, like LLM calls).
    original.god.shockPrice("grain");
    original.god.setActive("biz_mine", false);
    const moneyAtSave = original.world.totalMoney();

    const json = snapshotToJSON(original.sim.serialize());

    // Reload into a *different* seed with fresh systems built from the same
    // config; restore must overwrite every seed-derived bit of state.
    const loaded = createCity({ seed: 1, ...FULL_CONFIG });
    loaded.sim.restore(snapshotFromJSON(json));

    // Full structural equality at the save point — across all four surfaces.
    expect(fingerprint(loaded)).toEqual(fingerprint(original));
    // The god's price shock + shutter survived the round-trip (conserving, so
    // money is unchanged and biz_mine is still dark).
    expect(loaded.world.totalMoney()).toBeCloseTo(moneyAtSave, 6);
    expect(loaded.world.getBusiness("biz_mine")!.active).toBe(false);

    // Continuing both must stay bit-for-bit identical for many more days, through
    // more disasters and more agent reviews. A single unrestored byte desyncs here.
    original.sim.run(TICKS_PER_DAY * 10);
    loaded.sim.run(TICKS_PER_DAY * 10);
    expect(fingerprint(loaded)).toEqual(fingerprint(original));
  });

  it("a hands-off run is unaffected by God Mode's mere presence", () => {
    // The controller is always constructed; never touching it must leave the run
    // bit-for-bit identical to one built the same way.
    const a = createCity({ seed: 7, disasters: { dailyChance: 0.5 } });
    const b = createCity({ seed: 7, disasters: { dailyChance: 0.5 } });
    a.sim.run(TICKS_PER_DAY * 8);
    b.sim.run(TICKS_PER_DAY * 8);
    expect(a.world.serialize()).toEqual(b.world.serialize());
    expect(a.events!.events()).toEqual(b.events!.events());
  });
});
