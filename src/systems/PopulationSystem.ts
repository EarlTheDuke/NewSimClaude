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
  NEWCOMER_AGE_YEARS,
  POPULATION_MORTALITY,
  MAX_AGE_YEARS,
  DAYS_PER_YEAR,
  POPULATION_BIRTHS,
  BIRTH_GIFT,
  COMING_OF_AGE_YEARS,
  HOUSING_CONSTRUCTION,
  HOME_BUILD_COST,
  HOME_BUILD_RESERVE,
  HOME_BUILD_CAPACITY,
  HOME_BUILD_RENT,
  HOME_BUILD_COOLDOWN_DAYS,
  DYNAMIC_RENT,
  RENT_NEUTRAL_OCCUPANCY,
  RENT_SCARCITY_SENSITIVITY,
  RENT_MIN_MULT,
  RENT_MAX_MULT,
  RENT_ADJUST_FRACTION,
} from "./constants";

/** Tunable growth/mortality knobs; each defaults to the live constant. Tests/tuning override. */
export interface PopulationOptions {
  /** Growth pressure accrued per eligible day (a whole unit admits one person). */
  ratePerDay?: number;
  /** Minimum days between arrivals. */
  cooldownDays?: number;
  /** Median resident cash the town must clear to attract a newcomer. */
  prosperityFloor?: number;
  /** Whether residents age and die (with inheritance). */
  mortality?: boolean;
  /** Age (years) at which a resident dies. */
  maxAgeYears?: number;
  /** Sim-days per year, for aging (small values compress the demographic clock in tests). */
  daysPerYear?: number;
  /** Whether growth happens via births (newborn in a parent's home) instead of in-migration. */
  births?: boolean;
  /** Age (years) at which a child becomes a working adult and can be employed. */
  comingOfAgeYears?: number;
  /** Whether the landlord builds new homes when the town is housing-constrained (HP4). */
  construction?: boolean;
  /** Min days between builds (HP4) — paces the construction staircase. */
  buildCooldownDays?: number;
  /** Whether rent responds to housing scarcity (HP2 dynamic rent). */
  dynamicRent?: boolean;
}

/** Numeric index from a `res_N` id — finite for every id we mint (the NaN-id guard). */
function residentIndex(id: string): number {
  return Number(id.split("_")[1] ?? 0);
}

/** A demographic event with a place (HP3 watchability) — drives the map toasts. Ephemeral. */
export type PopulationEventKind = "birth" | "death" | "arrival" | "grewUp" | "build";
export interface PopulationEvent {
  /** Monotonic id, so the renderer can spawn a toast only for events it hasn't seen. */
  seq: number;
  day: number;
  kind: PopulationEventKind;
  /** The map node where it happened (the home involved). */
  nodeId: string;
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
  /** Lifetime demographic tallies (HP3-8), for the demography readout. */
  private migratedCount = 0;
  private bornCount = 0;
  private diedCount = 0;
  /** Children who have reached working age (HP3-9), for the demography feed. */
  private grewUpCount = 0;
  /** Ephemeral demographic event feed with locations (map toasts) — NOT serialized. */
  private readonly eventLog: PopulationEvent[] = [];
  private eventSeq = 0;
  private currentDay = 0;
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
  private readonly mortality: boolean;
  private readonly maxAgeYears: number;
  private readonly daysPerYear: number;
  private readonly births: boolean;
  private readonly comingOfAgeYears: number;
  private readonly construction: boolean;
  private readonly buildCooldownDays: number;
  private readonly dynamicRent: boolean;
  /** Day the last home was built, for the construction cooldown. */
  private lastBuildDay: number;

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
    this.mortality = opts.mortality ?? POPULATION_MORTALITY;
    this.maxAgeYears = opts.maxAgeYears ?? MAX_AGE_YEARS;
    this.daysPerYear = opts.daysPerYear ?? DAYS_PER_YEAR;
    this.births = opts.births ?? POPULATION_BIRTHS;
    this.comingOfAgeYears = opts.comingOfAgeYears ?? COMING_OF_AGE_YEARS;
    this.construction = opts.construction ?? HOUSING_CONSTRUCTION;
    this.buildCooldownDays = opts.buildCooldownDays ?? HOME_BUILD_COOLDOWN_DAYS;
    this.dynamicRent = opts.dynamicRent ?? DYNAMIC_RENT;
    this.lastSpawnDay = -this.cooldownDays;
    this.lastBuildDay = -this.buildCooldownDays;
  }

  update(ctx: SystemContext): void {
    if (!this.enabled && !this.mortality && !this.construction && !this.dynamicRent) return; // inert ⇒ byte-identical
    if (ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    const { day } = ctx.time.time();
    this.currentDay = day; // stamp events logged this tick

    // Deaths first (they free homes + jobs the same-day growth can refill), once a
    // year. Then build housing if the town is full, then admit newcomers into it.
    if (this.mortality && day > 0 && day % this.daysPerYear === 0) this.ageAndReap();
    if (this.construction) this.construct(day);
    if (this.enabled) this.grow(day);
    // Finally, reprice rent off the day's settled occupancy (collected next day).
    if (this.dynamicRent) this.repriceRent();
  }

  /**
   * Dynamic rent (HP2): rents drift with housing scarcity. A town-wide multiplier is
   * derived from overall occupancy — above the neutral occupancy rents climb toward a
   * ceiling, below it they ease toward a floor — and each home's rent drifts smoothly
   * toward its own base × that multiplier (premium homes stay proportionally pricier).
   * This makes housing a market and gives the landlord meaning: scarcity lifts its rent
   * income, which (with HP4) funds the building that relieves the scarcity.
   *
   * Conservation: this only changes the rent *level* — collection is still a capped
   * resident→landlord transfer in EconomySystem, so no money is minted. Determinism:
   * occupancy-driven, no RNG. The base is captured lazily (only when dynamic rent is
   * on), so an off run never writes baseRent and stays byte-identical.
   */
  private repriceRent(): void {
    const occ = occupantsByHome(this.world.residents);
    let totalOcc = 0;
    let totalCap = 0;
    for (const l of this.world.locations) {
      if (l.type !== "home") continue;
      totalOcc += occ.get(l.id) ?? 0;
      totalCap += l.capacity ?? 0;
    }
    if (totalCap <= 0) return;
    const rate = totalOcc / totalCap;
    const m = Math.max(
      RENT_MIN_MULT,
      Math.min(RENT_MAX_MULT, 1 + RENT_SCARCITY_SENSITIVITY * (rate - RENT_NEUTRAL_OCCUPANCY)),
    );
    for (const l of this.world.locations) {
      if (l.type !== "home") continue;
      if (l.baseRent === undefined) l.baseRent = l.rent ?? 0; // lazily capture the seeded/built base
      const target = l.baseRent * m;
      const cur = l.rent ?? l.baseRent;
      l.rent = Math.round((cur + (target - cur) * RENT_ADJUST_FRACTION) * 100) / 100;
    }
  }

  /**
   * Housing construction (HP4): when the town is out of homes, the landlord spends
   * rent income to build one more, lifting the population ceiling so growth doesn't
   * freeze at the seeded cap. Paced by a cooldown, so the town grows in a staircase
   * (build → fill → build). Self-limiting: it only builds while *constrained* (every
   * home full), and growth itself stops once prosperity dilutes — so the town settles
   * at a wealth-supported size rather than ballooning without bound.
   *
   * Conservation: the build cost is a single transfer landlord → factory (paying for
   * materials), capped at the landlord's balance — the new home Location is non-cash,
   * exactly like adding a resident, so `totalMoney()` is unchanged. Determinism: fixed
   * builder, the first active factory, node round-robin by home count, no RNG.
   */
  private construct(day: number): void {
    if (!this.isHousingConstrained()) return; // only build when every home is full
    if (day - this.lastBuildDay < this.buildCooldownDays) return;
    const landlord = this.world.getBusiness("biz_landlord");
    if (!landlord || landlord.cash - HOME_BUILD_COST < HOME_BUILD_RESERVE) return;
    const factory = this.world.businesses.find((b) => b.kind === "factory" && b.active);
    if (!factory) return; // no materials supplier — can't build this cycle

    this.world.transfer(landlord.id, factory.id, HOME_BUILD_COST); // pay for materials (conserved)

    // Co-locate the new home on an existing home node (round-robin), the way the
    // factory shares the mine's node; continues the loc_home_N namespace.
    const homes = this.world.locations.filter((l) => l.type === "home");
    const nodeIds = [...new Set(homes.map((l) => l.nodeId))];
    const node = nodeIds[homes.length % Math.max(1, nodeIds.length)] ?? homes[0]!.nodeId;
    this.world.locations.push({
      id: `loc_home_${homes.length}`,
      name: `Home ${homes.length + 1}`,
      type: "home",
      nodeId: node,
      rent: HOME_BUILD_RENT,
      capacity: HOME_BUILD_CAPACITY,
    });
    this.world.reindex();
    this.logEvent("build", node);
    this.lastBuildDay = day;
  }

  /** The in-migration trigger (HP3-5): admit newcomers when the town is healthy. */
  private grow(day: number): void {
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
    // Clamp it to what housing can actually absorb (HP3-8): growth can't bank a
    // backlog that would flood the town the day a single home frees up.
    this.pressureAccumulator = Math.min(this.pressureAccumulator + this.ratePerDay, slack);
    if (day - this.lastSpawnDay < this.cooldownDays) return; // space arrivals out
    const want = Math.floor(this.pressureAccumulator);
    if (want < 1) return;

    const toSpawn = Math.min(want, slack);
    let spawned = 0;
    for (let i = 0; i < toSpawn; i++) {
      // When births are on, a family grows from within first (a newborn in a parent's
      // home — a dependent until coming-of-age, which is future work). If no parent has
      // room, fall back to in-migration: a working-age newcomer who fills an open job.
      // This keeps a births+mortality town sustainable — as the working generation ages
      // out, migrants replace the labour newborns can't yet provide.
      const born = this.births ? this.spawnBirth() : undefined;
      const r = born ?? this.spawnMigrant();
      if (!r) break; // no eligible parent AND no free home — growth waits
      if (!born) this.seat(r); // newcomers take open producer seats; newborns don't work yet
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
   * Whether the town is out of housing (HP3-8) — every home is at capacity. The
   * trigger HP4 (housing construction) will read to decide when to build more homes,
   * and the renderer can surface "full" to the viewer. Pure, recomputed (never stale).
   */
  isHousingConstrained(): boolean {
    return this.housingSlack() === 0;
  }

  /** Recent demographic events with locations (ephemeral) — drives the map toasts. */
  events(): readonly PopulationEvent[] {
    return this.eventLog;
  }

  private logEvent(kind: PopulationEventKind, nodeId: string): void {
    this.eventSeq += 1;
    this.eventLog.push({ seq: this.eventSeq, day: this.currentDay, kind, nodeId });
    if (this.eventLog.length > 50) this.eventLog.shift();
  }

  /** Read-only demography snapshot (HP3-8) for the macro/HUD readout. Never mutates. */
  demography(): {
    population: number;
    born: number;
    died: number;
    migrated: number;
    grewUp: number;
    housingConstrained: boolean;
  } {
    return {
      population: this.world.residents.length,
      born: this.bornCount,
      died: this.diedCount,
      migrated: this.migratedCount,
      grewUp: this.grewUpCount,
      housingConstrained: this.isHousingConstrained(),
    };
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
    const r = this.create(homeId, "migrant", NEWCOMER_AGE_YEARS);
    this.migratedCount += 1;
    this.logEvent("arrival", this.world.getLocation(homeId).nodeId);
    return r;
  }

  /**
   * A birth (HP3-7): a working parent has a child born into the family home. The
   * parent is the lowest-index employed resident whose home still has a free slot
   * and who can afford the gift. The newborn starts at age 0, jobless (a dependent),
   * and is funded by a parent→child {@link World.transfer} of {@link BIRTH_GIFT} —
   * money relocates between two holders, so nothing is minted. Returns undefined when
   * no eligible parent exists (so growth waits, just like a full town). Exposed
   * publicly for tests/tooling.
   */
  spawnBirth(): Resident | undefined {
    const occ = occupantsByHome(this.world.residents);
    const parent = this.world.residents
      .filter((r) => r.jobId !== "" && r.money >= BIRTH_GIFT && this.homeHasSlot(r.homeId, occ))
      .sort((a, b) => residentIndex(a.id) - residentIndex(b.id))[0];
    if (!parent) return undefined;
    const child = this.create(parent.homeId, "born", 0);
    child.parentId = parent.id;
    this.world.transfer(parent.id, child.id, BIRTH_GIFT); // gift -> child; conserved
    this.bornCount += 1;
    this.logEvent("birth", this.world.getLocation(parent.homeId).nodeId);
    return child;
  }

  /** Whether a home has room for one more occupant, given a precomputed occupancy map. */
  private homeHasSlot(homeId: string, occ: Map<string, number>): boolean {
    const home = this.world.getLocation(homeId);
    return (occ.get(homeId) ?? 0) < (home.capacity ?? 99);
  }

  /**
   * Build and register a new $0, jobless resident in `homeId` (shared by migration
   * and, later, births — only the origin and any funding differ; a birth funds the
   * child with a separate parent→child transfer, never here). Continues the numeric
   * id namespace, draws no RNG, and reindexes so the newcomer is immediately visible
   * to every system and lookup.
   */
  private create(homeId: string, origin: ResidentOrigin, age: number): Resident {
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
      age,
      move: { x: node.x, y: node.y, atNodeId: home.nodeId, path: [], segmentProgress: 0 },
    };
    this.world.residents.push(r);
    this.world.reindex();
    return r;
  }

  /**
   * Age the town one year (HP3-6) and reap anyone who has reached {@link maxAgeYears}.
   * Runs once per sim-year. The seeded cohort is lazily given a deterministic spread
   * of ages the first time (so a realistic age mix appears the moment mortality
   * engages, without baking ages into the seed — keeping mortality-off byte-identical).
   */
  private ageAndReap(): void {
    for (const r of this.world.residents) {
      if (r.age === undefined) r.age = this.initialAge(residentIndex(r.id));
    }
    for (const r of this.world.residents) r.age = (r.age ?? 0) + 1;
    // Tally children who turned working-age this year (exactly once each) — for the
    // demography feed's "grew up and started working" event.
    for (const r of this.world.residents) {
      if (r.origin === "born" && r.age === this.comingOfAgeYears) {
        this.grewUpCount += 1;
        this.logEvent("grewUp", this.world.getLocation(r.homeId).nodeId);
      }
    }
    // Reap the too-old in ascending id order (deterministic), each estate inherited.
    const doomed = this.world.residents
      .filter((r) => (r.age ?? 0) >= this.maxAgeYears)
      .sort((a, b) => residentIndex(a.id) - residentIndex(b.id));
    for (const d of doomed) this.reap(d);

    // Coming of age (HP3-9): grown children — and any of-age jobless adult, e.g. a
    // worker freed by a dead firm — take an open producer seat (id order). This is
    // what replaces the workers mortality just removed, so a births+mortality town
    // sustains its labour force instead of decaying into idle dependents (the death
    // spiral the 20-year observation exposed). Seating is non-cash, so conservation
    // is untouched; deterministic (id order, no RNG).
    const ofAge = this.world.residents
      .filter((r) => r.jobId === "" && (r.age ?? 0) >= this.comingOfAgeYears)
      .sort((a, b) => residentIndex(a.id) - residentIndex(b.id));
    for (const r of ofAge) this.seat(r);
  }

  /**
   * Remove a resident who has died, conserving money: the estate is transferred to
   * the heir (the lowest-id living resident) BEFORE removal — `World.transfer` caps
   * at the balance, so the decedent drains to exactly $0 and removing them changes
   * `totalMoney` by nothing. Their job seat is freed and any firm they owned passes
   * to the heir, so no business is left with a dead owner. Never reaps the last
   * resident (there'd be no heir, which would vanish their money).
   */
  private reap(dead: Resident): void {
    const heir = this.world.residents
      .filter((r) => r.id !== dead.id)
      .sort((a, b) => residentIndex(a.id) - residentIndex(b.id))[0];
    if (!heir) return;

    this.logEvent("death", this.world.getLocation(dead.homeId).nodeId);
    this.world.transfer(dead.id, heir.id, dead.money); // estate -> heir; drains to $0
    if (dead.jobId) {
      const employer = this.world.getBusiness(dead.jobId);
      const i = employer?.employeeIds.indexOf(dead.id) ?? -1;
      if (employer && i >= 0) employer.employeeIds.splice(i, 1);
    }
    for (const b of this.world.businesses) {
      if (b.ownerId === dead.id) b.ownerId = heir.id; // no dead owners left behind
    }
    const idx = this.world.residents.findIndex((r) => r.id === dead.id);
    if (idx >= 0) this.world.residents.splice(idx, 1);
    this.diedCount += 1;
    this.world.reindex();
  }

  /**
   * A deterministic starting age in [0, maxAge) for the seeded cohort, spread by
   * resident index so the town has a realistic age mix the moment mortality engages.
   * No RNG; only ever applied to seeded residents (new arrivals get an explicit age).
   */
  private initialAge(index: number): number {
    const span = Math.max(1, this.baseCount);
    return Math.floor(((index % span) / span) * this.maxAgeYears);
  }

  serialize(): unknown {
    return {
      spawnCount: this.spawnCount,
      pressureAccumulator: this.pressureAccumulator,
      lastSpawnDay: this.lastSpawnDay,
      lastBuildDay: this.lastBuildDay,
      migratedCount: this.migratedCount,
      bornCount: this.bornCount,
      diedCount: this.diedCount,
      grewUpCount: this.grewUpCount,
    };
  }

  restore(state: unknown): void {
    const s = state as
      | {
          spawnCount?: number;
          pressureAccumulator?: number;
          lastSpawnDay?: number;
          lastBuildDay?: number;
          migratedCount?: number;
          bornCount?: number;
          diedCount?: number;
          grewUpCount?: number;
        }
      | undefined;
    this.spawnCount = s?.spawnCount ?? 0;
    this.pressureAccumulator = s?.pressureAccumulator ?? 0;
    this.lastSpawnDay = s?.lastSpawnDay ?? -this.cooldownDays;
    this.lastBuildDay = s?.lastBuildDay ?? -this.buildCooldownDays;
    this.migratedCount = s?.migratedCount ?? 0;
    this.bornCount = s?.bornCount ?? 0;
    this.diedCount = s?.diedCount ?? 0;
    this.grewUpCount = s?.grewUpCount ?? 0;
  }
}
