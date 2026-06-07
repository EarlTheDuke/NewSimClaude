import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { POPULATION_GROWTH, IN_MIGRATION_COOLDOWN_DAYS } from "./constants";

/**
 * Population growth (HP3) — the *birth* of new residents, the people-side twin of
 * {@link BusinessEntrySystem}'s firm birth. Once per sim-day, after the economy,
 * lifecycle, entry, and macro vitals have settled, it admits new people into the
 * town's spare housing so firms gain real customers and the labour pool can staff
 * every firm (today's 12 are both the entire workforce AND the entire customer
 * base, so the farm starves and demand can't grow).
 *
 * Conservation-safe by construction: a newcomer arrives with **$0** (in-migration)
 * — no money is minted — and later births fund a child via a parent→child
 * {@link World.transfer}. Deterministic: who/when is a pure function of the settled
 * day's vitals plus a serialized growth accumulator; no RNG, no wall-clock. Housing
 * is the hard gate (HP1 capacity), so the town can never grow past its homes.
 *
 * HP3-1 ships this as an INERT seam: with {@link POPULATION_GROWTH} off (the
 * default) update() is a no-op, so the seeded city is byte-identical. The capacity
 * helper, spawn primitive, and growth trigger arrive in HP3-2/4/5.
 */
export class PopulationSystem implements System {
  readonly id = "population";

  /** Monotonic count of people spawned this run — drives unique numeric ids. */
  private spawnCount = 0;
  /** Fractional growth pressure accrued across eligible days; a whole unit admits one person. */
  private pressureAccumulator = 0;
  /** Day the last person arrived, for the cooldown. */
  private lastSpawnDay = -IN_MIGRATION_COOLDOWN_DAYS;

  constructor(
    private readonly world: World,
    /** Whether growth is enabled; defaults to the live {@link POPULATION_GROWTH}. */
    private readonly enabled: boolean = POPULATION_GROWTH,
  ) {}

  update(ctx: SystemContext): void {
    if (!this.enabled) return;
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    // HP3-5 wires the growth trigger + spawn here, reading the fully-settled day's
    // vitals. Inert until then — the seam is byte-identical with growth off.
  }

  /**
   * Current town headcount — the number growth lifts over time. A read-only view
   * for HP3-8's macro demography line and live inspection; never mutates.
   */
  headcount(): number {
    return this.world.residents.length;
  }

  serialize(): unknown {
    return {
      spawnCount: this.spawnCount,
      pressureAccumulator: this.pressureAccumulator,
      lastSpawnDay: this.lastSpawnDay,
    };
  }

  restore(state: unknown): void {
    const s = state as
      | { spawnCount?: number; pressureAccumulator?: number; lastSpawnDay?: number }
      | undefined;
    this.spawnCount = s?.spawnCount ?? 0;
    this.pressureAccumulator = s?.pressureAccumulator ?? 0;
    this.lastSpawnDay = s?.lastSpawnDay ?? -IN_MIGRATION_COOLDOWN_DAYS;
  }
}
