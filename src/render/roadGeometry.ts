/**
 * Road geometry helpers (R3-2/R3-3) — pure, deterministic functions shared by both renderers
 * for the two-lane street look and the traffic that drives on it:
 *
 *   - each road paints as an asphalt bed with a dashed centre line and a footpath on BOTH
 *     sides (sidewalks), so the street reads as two lanes plus walking trails;
 *   - a resident WITH a vehicle drives offset to the RIGHT of their heading (right-hand
 *     traffic — two cars passing each other keep to their own lanes);
 *   - a resident WITHOUT one walks on the footpath to the right of their heading, exactly
 *     like keeping to your side of the trail.
 *
 * All pure arithmetic on positions the sim already produces — rendering only reads.
 */

/** Asphalt bed width (px) — wide enough to read as two lanes. */
export const ROAD_WIDTH = 10;
/** A driving resident's sideways offset from the road centre — their right-hand lane. */
export const LANE_OFFSET = 2.8;
/** A walking resident's sideways offset — the footpath beside the asphalt. */
export const PATH_OFFSET = 8.5;

/**
 * The unit vector pointing to the RIGHT of a heading `(dx, dy)` in screen coordinates
 * (y grows downward, so "right of travel" is `(-dy, dx)` normalized). A zero heading
 * returns (0, 0) so a stationary entity never jumps sideways.
 */
export function rightOf(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

/** One painted dash of a dashed line, in world coordinates. */
export interface Dash {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Split the segment p→q into regular dashes (`dashLen` on, `gapLen` off), centred phase —
 * the centre-line / footpath stippling both renderers paint once at build time. The final
 * dash is clipped to the segment end so it never overshoots an intersection.
 */
export function dashes(
  px: number,
  py: number,
  qx: number,
  qy: number,
  dashLen: number,
  gapLen: number,
): Dash[] {
  const dx = qx - px;
  const dy = qy - py;
  const len = Math.hypot(dx, dy);
  if (len === 0 || dashLen <= 0) return [];
  const ux = dx / len;
  const uy = dy / len;
  const out: Dash[] = [];
  for (let s = 0; s < len; s += dashLen + gapLen) {
    const e = Math.min(s + dashLen, len);
    out.push({ x1: px + ux * s, y1: py + uy * s, x2: px + ux * e, y2: py + uy * e });
  }
  return out;
}
