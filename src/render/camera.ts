/**
 * Camera transform (visualization R2h/R2i) — pure math, no Pixi/DOM, so it is
 * unit-testable and the single source of the world↔screen mapping shared by the
 * renderer's `worldToScreen` (bubble placement) and `pick()` (the inverse).
 *
 * Stored as `{tx, ty, scale}` applied to the world container as
 * `position = (tx, ty)`, `scale = scale` — never a "centre" (that invites the
 * off-by-viewport/2 trap). Forward: screen = world*scale + t. Inverse:
 * world = (screen − t)/scale.
 */
export interface Camera {
  tx: number;
  ty: number;
  scale: number;
}

export function worldToScreen(wx: number, wy: number, cam: Camera): { x: number; y: number } {
  return { x: wx * cam.scale + cam.tx, y: wy * cam.scale + cam.ty };
}

export function screenToWorld(sx: number, sy: number, cam: Camera): { x: number; y: number } {
  return { x: (sx - cam.tx) / cam.scale, y: (sy - cam.ty) / cam.scale };
}
