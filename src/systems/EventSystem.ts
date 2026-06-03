import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { SeededRNG } from "../utils/rng";
import type { MarketSystem } from "./MarketSystem";
import { DISASTERS, type DisasterDef, type DisasterKind, type DisasterRecord } from "./disasters";
import { DISASTER_DAILY_CHANCE, DISASTER_LOG_SIZE } from "./constants";

export interface EventSystemOptions {
  /** Per-day probability that a disaster strikes. Defaults to DISASTER_DAILY_CHANCE. */
  dailyChance?: number;
  /** Restrict the roster to these kinds (e.g. ["fire"]). Defaults to all. */
  kinds?: DisasterKind[];
}

/**
 * Phase 6 — the drama director. Opt-in (off by default in createCity, so every
 * pre-Phase-6 test sees the same world). Once per sim-day it rolls a single
 * disaster from {@link DISASTERS} and applies it to the city.
 *
 * Determinism, two ways:
 *  - It runs on its **own** seeded RNG, derived from the run seed but never the
 *    simulation's `ctx.rng`. So enabling disasters changes only their direct
 *    effects — the underlying run is otherwise bit-for-bit identical.
 *  - That RNG's state and the events log are part of the snapshot, so a saved
 *    run resumes with the exact same future disasters it would have had.
 */
export class EventSystem implements System {
  readonly id = "events";
  private readonly rng: SeededRNG;
  private readonly dailyChance: number;
  private readonly roster: readonly DisasterDef[];
  private readonly log: DisasterRecord[] = [];

  constructor(
    private readonly world: World,
    private readonly market: MarketSystem,
    seed: number,
    options?: EventSystemOptions,
  ) {
    // Decorrelate from the sim's stream so the base trajectory is untouched.
    this.rng = new SeededRNG((seed ^ 0x9e3779b9) >>> 0);
    this.dailyChance = options?.dailyChance ?? DISASTER_DAILY_CHANCE;
    this.roster = options?.kinds
      ? DISASTERS.filter((d) => options.kinds!.includes(d.kind))
      : DISASTERS;
  }

  update(ctx: SystemContext): void {
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    if (this.roster.length === 0) return;
    if (!this.rng.bool(this.dailyChance)) return;

    const def = this.weightedPick();
    const outcome = def.apply({ world: this.world, market: this.market, rng: this.rng });
    if (!outcome) return; // conditions weren't right (e.g. nothing to burn) — no record

    this.log.push({
      day: ctx.time.time().day,
      kind: def.kind,
      headline: outcome.headline,
      targetId: outcome.targetId,
    });
    if (this.log.length > DISASTER_LOG_SIZE) this.log.shift();
  }

  /** All retained disaster records, oldest first. */
  events(): readonly DisasterRecord[] {
    return this.log;
  }

  /** The most recent disaster, if any. */
  latest(): DisasterRecord | undefined {
    return this.log[this.log.length - 1];
  }

  private weightedPick(): DisasterDef {
    const total = this.roster.reduce((s, d) => s + d.weight, 0);
    let r = this.rng.range(0, total);
    for (const def of this.roster) {
      r -= def.weight;
      if (r < 0) return def;
    }
    return this.roster[this.roster.length - 1]!; // float-rounding fallback
  }

  serialize(): unknown {
    return { log: this.log.map((r) => ({ ...r })), rngState: this.rng.getState() };
  }

  restore(state: unknown): void {
    const s = state as { log?: DisasterRecord[]; rngState?: number } | undefined;
    this.log.length = 0;
    if (s?.log) for (const r of s.log) this.log.push({ ...r });
    if (typeof s?.rngState === "number") this.rng.setState(s.rngState);
  }
}
