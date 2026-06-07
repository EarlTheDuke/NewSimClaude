import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import type { Resident, ResidentOrigin } from "../world/types";
import { cheapestVacantHome, occupantsByHome } from "../world/housing";
import { scheduleFor, FIRST_NAMES } from "../world/cityGen";
import { desiredHeadcount } from "../world/archetypes";
import {
  POPULATION_GROWTH,
  IN_MIGRATION_COOLDOWN_DAYS,
  MIGRATION_RATE_PER_DAY,
  MIGRATION_PROSPERITY_FLOOR,
  NEWCOMER_NEEDS,
} from "./constants";

/** Tunable growth knobs; each defaults to the live constant. Tests/tuning override. */
export interface PopulationOptions {
  /** Growth pressure accrued per eligible day (a whole unit admits one person). */
  ratePerDay?: number;
  /** Minimum days between arrivals. */
  cooldownDays?: number;
  /** Median resident cash the town must clear to attract a newcomer. */
  prosperityFloor?: number;
}

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
  private lastSpawnDay: number;
  /**
   * The seeded resident count, captured at construction — the floor of the numeric
   * id namespace. New ids are `res_${baseCount + spawnCount}`, so they continue the
   * seeded `res_0..res_(n-1)` sequence without ever colliding or producing a NaN
   * index when parsed (the bug the design panel flagged: an `res_mig1`-style id
   * makes `Number(id.split("_")[1])` NaN and breaks consumption + founder sorts).
   */
  private readonly baseCount: number;
  private readonly ratePerDay: number;
  private readonly cooldownDays: number;
  private readonly prosperityFloor: number;

  constructor(
    private readonly world: World,
    /** Whether growth is enabled; defaults to the live {@link POPULATION_GROWTH}. */
    private readonly enabled: boolean = POPULATION_GROWTH,
    opts: PopulationOptions = {},
  ) {
    this.baseCount = world.residents.length;
    this.ratePerDay = opts.ratePerDay ?? MIGRATION_RATE_PER_DAY;
    this.cooldownDays = opts.cooldownDays ?? IN_MIGRATION_COOLDOWN_DAYS;
    this.prosperityFloor = opts.prosperityFloor ?? MIGRATION_PROSPERITY_FLOOR;
    this.lastSpawnDay = -this.cooldownDays;
  }

  update(ctx: SystemContext): void {
    if (!this.enabled) return;
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();

    // The town only attracts newcomers when it's healthy (all pure reads of the
    // fully-settled day): spare homes to live in AND a prosperous-enough populace.
    //  - Housing slack is the HARD ceiling — growth halts at the HP1 cap (18 slots)
    //    until HP4 builds more, so N can never outrun its homes.
    //  - The prosperity floor is ALSO the dilution brake: new people enter at $0
    //    against a fixed money supply, so each arrival nudges the median down; once
    //    it falls below the floor, growth self-limits before it can deflate the town.
    //    (This is why HP3 does NOT need to gate on open jobs — unemployment can't
    //    spiral, because the median-money gate stops admitting before it does.)
    const slack = this.housingSlack();
    const eligible = slack >= 1 && this.medianMoney() >= this.prosperityFloor;
    if (!eligible) return;

    // Pressure builds slowly on healthy days; one whole unit admits one person.
    this.pressureAccumulator += this.ratePerDay;
    if (day - this.lastSpawnDay < this.cooldownDays) return; // space arrivals out
    const want = Math.floor(this.pressureAccumulator);
    if (want < 1) return;

    const toSpawn = Math.min(want, slack);
    let spawned = 0;
    for (let i = 0; i < toSpawn; i++) {
      const r = this.spawnMigrant();
      if (!r) break; // housing filled mid-loop
      this.seat(r); // take an open producer seat if one exists (productive growth)
      spawned += 1;
    }
    this.pressureAccumulator -= spawned;
    if (spawned > 0) this.lastSpawnDay = day;
  }

  /** Total free home slots across the town — the headroom growth can fill. */
  private housingSlack(): number {
    const occ = occupantsByHome(this.world.residents);
    let slack = 0;
    for (const l of this.world.locations) {
      if (l.type !== "home") continue;
      slack += Math.max(0, (l.capacity ?? 99) - (occ.get(l.id) ?? 0));
    }
    return slack;
  }

  /** Median resident cash (sorted) — the prosperity signal + dilution brake. */
  private medianMoney(): number {
    const sorted = this.world.residents.map((r) => r.money).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  /**
   * Seat a newcomer in the lowest-index active producer that still has an open seat
   * (mirrors {@link BusinessEntrySystem}'s jobless-staffing loop) — so a new mouth
   * becomes a wage-earner, raising real output rather than just adding demand. If
   * every firm is fully crewed the newcomer stays a job-seeking customer for now;
   * the labour market / a future birth-of-firms will employ them. No money moves at
   * hire (only jobId/wage/roster change), so conservation is untouched.
   */
  private seat(r: Resident): void {
    const target = this.world.businesses.find(
      (b) => b.active && desiredHeadcount(b.kind) > 0 && b.employeeIds.length < desiredHeadcount(b.kind),
    );
    if (!target) return;
    target.employeeIds.push(r.id);
    r.jobId = target.id;
    r.wagePerTick = target.wagePerTick;
  }

  /**
   * Current town headcount — the number growth lifts over time. A read-only view
   * for HP3-8's macro demography line and live inspection; never mutates.
   */
  headcount(): number {
    return this.world.residents.length;
  }

  /**
   * Admit one in-migrant: a brand-new resident who arrives from outside with **$0**
   * and no job, placed in the cheapest home that still has a free slot. Returns the
   * new resident, or `undefined` when every home is full (housing is the hard gate —
   * HP4 will build more). The spawn primitive HP3-5's growth trigger drives; exposed
   * publicly for tests and live tooling.
   *
   * Conservation: the newcomer is constructed with `money: 0` and there is **no**
   * transfer — `world.totalMoney()` is unchanged at the instant of the `push`, so no
   * money is minted. Determinism: numeric id, index-derived name/schedule, fixed
   * needs (no RNG draw), and a deterministic home, so two same-seed runs match.
   */
  spawnMigrant(): Resident | undefined {
    const homeId = cheapestVacantHome(this.world.residents, this.world.locations);
    if (homeId === undefined) return undefined;
    return this.create(homeId, "migrant");
  }

  /**
   * Build and register a new $0, jobless resident in `homeId` (shared by migration
   * and, later, births — only the origin and any funding differ; a birth funds the
   * child with a separate parent→child transfer, never here). Continues the numeric
   * id namespace, draws no RNG, and reindexes so the newcomer is immediately visible
   * to every system and lookup.
   */
  private create(homeId: string, origin: ResidentOrigin): Resident {
    const index = this.baseCount + this.spawnCount;
    this.spawnCount += 1;
    const home = this.world.getLocation(homeId);
    const node = this.world.getNode(home.nodeId);
    const r: Resident = {
      id: `res_${index}`,
      name: FIRST_NAMES[index % FIRST_NAMES.length]!,
      money: 0,
      homeId,
      jobId: "",
      wagePerTick: 0,
      hasVehicle: false,
      schedule: scheduleFor(index),
      earnedThisPeriod: 0,
      lastPaycheck: 0,
      savingsGoal: 0,
      luxuriesOwned: 0,
      needs: { ...NEWCOMER_NEEDS },
      activity: "sleeping",
      destinationId: homeId,
      origin,
      move: { x: node.x, y: node.y, atNodeId: home.nodeId, path: [], segmentProgress: 0 },
    };
    this.world.residents.push(r);
    this.world.reindex();
    return r;
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
    this.lastSpawnDay = s?.lastSpawnDay ?? -this.cooldownDays;
  }
}
