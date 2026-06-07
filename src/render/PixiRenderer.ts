import { Application, Graphics } from "pixi.js";
import type { World } from "../world/World";
import { skyColor } from "./daynight";
import type { CityRenderer, Pick, DisasterMarker, ThoughtBubble } from "./CityRenderer";

const WIDTH = 640;
const HEIGHT = 480;

/**
 * The WebGL renderer (visualization R2) — a retained Pixi.js scene graph that
 * implements the same read-only {@link CityRenderer} contract as the canvas
 * renderer. R2a is the foundation slice: it mounts a Pixi Application on the
 * existing `#city` canvas and paints only the day/night **sky**, proving the
 * mount + render loop + the async-init guard. Parity for roads, buildings,
 * residents, HUD, selection, disasters and the R1 thought bubbles arrives in
 * R2b–R2f; the camera in R2h–R2i. It never mutates the World.
 *
 * Pixi v8's `Application.init()` is async, but `main.ts` drives `draw()`
 * synchronously (and before init can resolve). We guard with a `ready` flag:
 * `draw()`/`pick()` are no-ops until the GPU context is live, then we paint a
 * deferred first frame. Mounted at `resolution: 1, autoDensity: false` so the
 * canvas stays 640×480 and the "world space == canvas space" click math holds on
 * HiDPI displays.
 */
export class PixiRenderer implements CityRenderer {
  private readonly app: Application;
  private ready = false;
  private skyGfx: Graphics | undefined;
  private lastSky = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    this.app = new Application();
    void this.init();
  }

  private async init(): Promise<void> {
    await this.app.init({
      canvas: this.canvas,
      width: WIDTH,
      height: HEIGHT,
      resolution: 1,
      autoDensity: false,
      antialias: true,
      background: "#0e1116",
    });
    this.skyGfx = new Graphics();
    this.app.stage.addChild(this.skyGfx);
    this.ready = true;
    // Deferred first paint: when the tab's rAF is throttled (e.g. a background
    // preview), nothing would repaint after init resolves. The dev handle's
    // renderFrame covers that; in production the live rAF loop paints next frame.
    const w = window as unknown as { cwlc?: { renderFrame?: () => void } };
    w.cwlc?.renderFrame?.();
  }

  draw(hourFloat: number, _selected?: Pick, _disaster?: DisasterMarker, _bubbles?: ThoughtBubble[]): void {
    if (!this.ready || !this.skyGfx) return;
    // R2a paints only the sky (reuses skyColor() verbatim — the first proof the
    // shared day/night math renders identically under Pixi). Repaint only when the
    // colour actually changes, so the hot path stays allocation-free.
    const sky = skyColor(hourFloat);
    if (sky !== this.lastSky) {
      this.lastSky = sky;
      this.skyGfx.clear();
      this.skyGfx.rect(0, 0, WIDTH, HEIGHT).fill(sky);
    }
    // Touch world so the read-only dependency is explicit (parity slices read it).
    void this.world;
  }

  pick(_x: number, _y: number): Pick | undefined {
    return undefined; // wired in R2f (canvas-space) and R2i (under the camera)
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
