/**
 * TimeSystem — the fundamental primitive. Everything in the city happens in
 * ticks, and one clock drives every system.
 *
 * Time model:
 *   1 tick      = 1 simulated minute
 *   60 ticks    = 1 simulated hour
 *   1440 ticks  = 1 simulated day
 *
 * Two ways to advance:
 *   - tick(n)            discrete stepping for headless runs + tests (speed-independent)
 *   - advanceRealTime(ms) wall-clock pacing for the live, watchable browser loop
 *
 * At 1x, one tick elapses per real second, so a 20-minute commute takes ~20
 * real seconds — slow enough to follow a single resident. 1000x compresses a
 * day into well under a minute.
 */

export const TICKS_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY; // 1440
export const DAYS_PER_WEEK = 7;

/** Simulated ticks advanced per real second at 1x. */
export const BASE_TICKS_PER_SECOND = 1;

export type SpeedMultiplier = 1 | 10 | 100 | 1000;
export const SPEED_OPTIONS: readonly SpeedMultiplier[] = [1, 10, 100, 1000];

export interface TimeOfDay {
  totalTicks: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
}

export interface TimeSnapshot {
  totalTicks: number;
  speed: SpeedMultiplier;
  paused: boolean;
}

export class TimeSystem {
  private totalTicks = 0;
  private speed: SpeedMultiplier = 1;
  private paused = false;
  /** Fractional-tick carry for wall-clock advancement (transient, not serialized for determinism). */
  private carry = 0;

  /** Advance exactly `n` whole ticks. Speed-independent; used by headless runs and tests. */
  tick(n = 1): void {
    if (n < 0) throw new Error("TimeSystem.tick: n must be >= 0");
    this.totalTicks += n;
  }

  /**
   * Pacing helper for the live browser loop: given real elapsed milliseconds
   * and the current speed, return how many whole ticks the simulation should
   * run this frame. Returns 0 while paused. Fractional remainder is carried to
   * the next call.
   *
   * This does NOT advance the clock itself — the simulation loop calls tick(1)
   * for each simulated tick so per-tick time stays correct. This method only
   * decides the tick *budget*.
   */
  ticksForRealTime(deltaMs: number): number {
    if (this.paused || deltaMs <= 0) return 0;
    const exact =
      this.carry + (deltaMs / 1000) * BASE_TICKS_PER_SECOND * this.speed;
    const whole = Math.floor(exact);
    this.carry = exact - whole;
    return whole;
  }

  getSpeed(): SpeedMultiplier {
    return this.speed;
  }

  setSpeed(speed: SpeedMultiplier): void {
    if (!SPEED_OPTIONS.includes(speed)) {
      throw new Error(`TimeSystem.setSpeed: invalid speed ${speed}`);
    }
    this.speed = speed;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.carry = 0; // avoid a burst of catch-up ticks after a long pause
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  isPaused(): boolean {
    return this.paused;
  }

  get ticks(): number {
    return this.totalTicks;
  }

  time(): TimeOfDay {
    const tickOfDay = this.totalTicks % TICKS_PER_DAY;
    const day = Math.floor(this.totalTicks / TICKS_PER_DAY);
    return {
      totalTicks: this.totalTicks,
      day,
      dayOfWeek: day % DAYS_PER_WEEK,
      hour: Math.floor(tickOfDay / TICKS_PER_HOUR),
      minute: tickOfDay % TICKS_PER_HOUR,
    };
  }

  /** "HH:MM" clock string for the HUD. */
  clockString(): string {
    const { hour, minute } = this.time();
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  serialize(): TimeSnapshot {
    return {
      totalTicks: this.totalTicks,
      speed: this.speed,
      paused: this.paused,
    };
  }

  restore(snapshot: TimeSnapshot): void {
    this.totalTicks = snapshot.totalTicks;
    this.speed = snapshot.speed;
    this.paused = snapshot.paused;
    this.carry = 0;
  }
}
