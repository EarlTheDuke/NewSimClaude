/**
 * Economic→visual mappings (visualization R3). Pure functions that turn a firm's
 * economic state into the numbers the renderer paints — a prosperity glow from
 * capital, a warehouse fill bar from inventory. Kept pure + unit-tested so the
 * "buildings come alive" visuals are deterministic and verifiable, and never
 * touch simulation state (the renderer only reads).
 */

/** Capital ABOVE baseline at which the prosperity glow saturates (the engine peaks ~2600). */
export const GLOW_FULL_CAPITAL = 2000;

/** Inventory at which a warehouse fill bar reads full. */
export const FILL_FULL_INVENTORY = 200;

/**
 * Prosperity factor 0..1 from a firm's capital. 0 at (or below) baseline, ramping
 * to 1 as capital deepens — drives the glow's size + brightness so a thriving,
 * capital-rich firm visibly glows and a baseline one doesn't.
 */
export function prosperityT(capital: number, baseline: number): number {
  return clamp01((capital - baseline) / GLOW_FULL_CAPITAL);
}

/** Fill fraction 0..1 for a warehouse bar (inventory relative to a reference cap). */
export function fillFraction(value: number, cap: number): number {
  if (cap <= 0) return 0;
  return clamp01(value / cap);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
