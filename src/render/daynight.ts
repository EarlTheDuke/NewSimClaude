/**
 * Phase 5 — day/night palette. Pure functions mapping the hour of day
 * (0..24, fractional allowed) to the scene's ambient look. The renderer reads
 * these to tint the world; nothing here touches simulation state, so the
 * visuals are a deterministic function of the clock alone.
 *
 * The city keeps its dark aesthetic at every hour: "daylight" lifts and cools
 * the scene rather than painting the sky blue, night dims it and lights the
 * windows, and dawn (~6:30) and dusk (~18:00) carry a warm tint.
 */

export type Rgb = [number, number, number];

/** Lowest scene brightness, reached at deep midnight. */
export const NIGHT_AMBIENT = 0.5;

/** Sky colour control points across the day; interpolated linearly between. */
const SKY_KEYFRAMES: ReadonlyArray<{ h: number; rgb: Rgb }> = [
  { h: 0, rgb: [10, 13, 22] }, // midnight — deepest, faintly blue
  { h: 5, rgb: [12, 15, 26] }, // pre-dawn
  { h: 6.5, rgb: [46, 34, 44] }, // dawn — warm
  { h: 9, rgb: [24, 28, 36] }, // morning
  { h: 12, rgb: [30, 34, 44] }, // noon — lightest (still dark, lifted + cool)
  { h: 16, rgb: [26, 30, 40] }, // afternoon
  { h: 18, rgb: [52, 32, 38] }, // dusk — warm
  { h: 20, rgb: [16, 18, 30] }, // evening
  { h: 24, rgb: [10, 13, 22] }, // wraps to midnight
];

/** Wrap any hour into [0, 24). */
function wrap(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/** 0 at midnight, 1 at noon — a smooth cosine sweep through dawn and dusk. */
function daylight(hour: number): number {
  return 0.5 - 0.5 * Math.cos((wrap(hour) / 24) * Math.PI * 2);
}

/** Scene brightness multiplier in [NIGHT_AMBIENT, 1]: night dim, noon full. */
export function ambient(hour: number): number {
  return NIGHT_AMBIENT + (1 - NIGHT_AMBIENT) * daylight(hour);
}

/** How strongly lit windows read, in [0, 1]: 1 at midnight, 0 at noon. */
export function windowGlow(hour: number): number {
  return 1 - daylight(hour);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function channelHex(c: number): string {
  return Math.round(Math.max(0, Math.min(255, c)))
    .toString(16)
    .padStart(2, "0");
}

/** The background/sky colour for the hour, as a #rrggbb string. */
export function skyColor(hour: number): string {
  const h = wrap(hour);
  let lo = SKY_KEYFRAMES[0]!;
  let hi = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1]!;
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const a = SKY_KEYFRAMES[i]!;
    const b = SKY_KEYFRAMES[i + 1]!;
    if (h >= a.h && h <= b.h) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi.h - lo.h || 1;
  const t = (h - lo.h) / span;
  return `#${channelHex(lerp(lo.rgb[0], hi.rgb[0], t))}${channelHex(
    lerp(lo.rgb[1], hi.rgb[1], t),
  )}${channelHex(lerp(lo.rgb[2], hi.rgb[2], t))}`;
}

/**
 * Scale an RGB triple toward black by `factor` (0..1). Used to dim roads and
 * buildings as ambient light falls. Returns an "rgb(r, g, b)" string.
 */
export function dim(rgb: Rgb, factor: number): string {
  const f = Math.max(0, Math.min(1, factor));
  return `rgb(${Math.round(rgb[0] * f)}, ${Math.round(rgb[1] * f)}, ${Math.round(rgb[2] * f)})`;
}

/** Parse a #rrggbb string into an Rgb triple (for tinting hex constants). */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
