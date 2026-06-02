/**
 * Phase 1 tuning. One day = 1440 ticks (1 tick = 1 sim-minute). Rates are
 * chosen so a resident sleeps ~at night, works the day, eats once or twice,
 * and money stays in healthy circulation across the closed economy.
 */

// Daily schedule (hour of day, 0..23)
export const SLEEP_START_HOUR = 22;
export const WAKE_HOUR = 7;
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;

// Need decay per tick (points/tick; needs are 0..100)
export const HUNGER_DECAY = 0.12;
export const HUNGER_DECAY_ASLEEP = 0.05;
export const ENERGY_DECAY = 0.08;
export const ENERGY_RESTORE = 0.3; // while sleeping
export const SOCIAL_DECAY = 0.05;

// Need thresholds that hijack the schedule
export const HUNGRY_THRESHOLD = 30;
export const TIRED_THRESHOLD = 20;
export const LONELY_THRESHOLD = 35;

// Movement
export const MOVE_SPEED = 20; // world units per tick

// Economy
export const RENT_PER_DAY = 70; // resident -> landlord
export const BUSINESS_RENT_PER_DAY = 120; // diner/goods -> landlord
export const SOCIAL_SPEND = 8; // resident -> social venue per visit
