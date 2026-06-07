import { describe, it, expect } from "vitest";
import { worldToScreen, screenToWorld, type Camera } from "./camera";

describe("camera transform (R2h/R2i)", () => {
  it("is identity at pan 0 / zoom 1 (so pre-camera picking == canvas)", () => {
    const cam: Camera = { tx: 0, ty: 0, scale: 1 };
    expect(worldToScreen(123, 45, cam)).toEqual({ x: 123, y: 45 });
    expect(screenToWorld(123, 45, cam)).toEqual({ x: 123, y: 45 });
  });

  it("round-trips a known point at zoom≠1, pan≠0 (the case a naive 'centre' camera breaks)", () => {
    const cam: Camera = { tx: 37, ty: -19, scale: 2 };
    const world = { x: 200, y: 150 };
    const screen = worldToScreen(world.x, world.y, cam);
    expect(screen).toEqual({ x: 200 * 2 + 37, y: 150 * 2 - 19 }); // 437, 281
    const back = screenToWorld(screen.x, screen.y, cam);
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });

  it("zoom-to-cursor keeps the world point under the cursor fixed", () => {
    // The renderer derives t so the world point under the cursor stays put when scale changes.
    const cursor = { x: 400, y: 300 };
    const cam: Camera = { tx: 10, ty: 20, scale: 1 };
    const worldUnder = screenToWorld(cursor.x, cursor.y, cam);
    const newScale = 2.5;
    const next: Camera = { tx: cursor.x - worldUnder.x * newScale, ty: cursor.y - worldUnder.y * newScale, scale: newScale };
    // The same world point now maps back to the same screen cursor.
    const s = worldToScreen(worldUnder.x, worldUnder.y, next);
    expect(s.x).toBeCloseTo(cursor.x, 9);
    expect(s.y).toBeCloseTo(cursor.y, 9);
  });
});
