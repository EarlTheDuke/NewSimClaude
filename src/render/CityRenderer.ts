import type { Pick, DisasterMarker, ThoughtBubble, MapToast } from "./CanvasRenderer";

/**
 * The renderer seam (visualization R2). Both the original {@link CanvasRenderer}
 * and the WebGL {@link PixiRenderer} implement this identical read-only contract,
 * so `main.ts` can swap engines with a one-line factory and zero behavioral
 * coupling. Like every renderer in this project, an implementation **only reads**
 * the World — it never mutates simulation state.
 */
export interface CityRenderer {
  /** Paint a frame for the given hour of day (0..24, fractional for smoothness). */
  draw(
    hourFloat: number,
    selected?: Pick,
    disaster?: DisasterMarker,
    bubbles?: ThoughtBubble[],
    toasts?: MapToast[],
  ): void;
  /** Map a canvas-space click to the resident or building under it. */
  pick(x: number, y: number): Pick | undefined;
  /**
   * R4 wave 6 — THE DIRECTOR: glide the camera to a firm's building for `holdMs`, then ease
   * home. Optional — Pixi implements it; the canvas fallback has no camera (R2 waiver), so
   * callers use `renderer.directToBusiness?.(…)`.
   */
  directToBusiness?(bizId: string, holdMs?: number, zoom?: number): void;
  /** Tear down GPU/DOM resources (Pixi). Optional — the canvas renderer needs none. */
  destroy?(): void;
}

export type { Pick, DisasterMarker, ThoughtBubble, MapToast } from "./CanvasRenderer";
