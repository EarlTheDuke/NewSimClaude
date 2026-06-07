import { Application, Container, Graphics, Text } from "pixi.js";
import type { World } from "../world/World";
import type { Business, Location, Resident, Activity } from "../world/types";
import { skyColor, ambient, windowGlow, dimInt, type Rgb } from "./daynight";
import {
  ROAD_RGB,
  CLOSED_RGB,
  LABEL_RGB,
  HOME_RGB,
  BUSINESS_RGB,
  BUILDING,
  COLOCATE_DX,
  ACTIVITY_COLOR,
  DOT_RADIUS,
} from "./CanvasRenderer";
import type { CityRenderer, Pick, DisasterMarker, ThoughtBubble } from "./CityRenderer";

const WIDTH = 640;
const HEIGHT = 480;
const WIN_SIZE = 6;
const WIN_GAP = 4;
const WIN_GOLD = 0xffd17a; // rgba(255, 209, 122) — the lit-window colour
const PLANK_RGB: Rgb = [84, 84, 92]; // boarded-up plank colour, dimmed by ambient

/** Activity colours as packed ints, for tinting a white resident dot (parity with canvas). */
const ACTIVITY_INT: Record<Activity, number> = Object.fromEntries(
  Object.entries(ACTIVITY_COLOR).map(([k, v]) => [k, parseInt(v.slice(1), 16)]),
) as Record<Activity, number>;

/** The persistent Pixi display objects for one building (created once, mutated per frame). */
interface BuildingView {
  container: Container;
  base: Graphics;
  windows: Container;
  planks: Graphics;
  label: Text;
}

/** Persistent Pixi objects for one resident (created once, mutated per frame). */
interface ResidentView {
  container: Container;
  shadow: Graphics;
  tick: Graphics;
  dot: Graphics;
}

/**
 * The WebGL renderer (visualization R2) — a retained Pixi.js scene graph that
 * implements the same read-only {@link CityRenderer} contract as the canvas
 * renderer. Built slice by slice toward parity:
 *   R2a sky · R2b roads + buildings · R2c residents · R2d HUD · R2e selection +
 *   disasters · R2f bubbles + picking · R2h–i camera.
 *
 * Retained-mode: display objects are created **once** (lazily per entity id) and
 * each `draw()` only mutates `.tint`/`.alpha`/`.visible`/`.position`, so the hot
 * path is allocation-free and a heavier GPU can only drop FPS, never sim-time. It
 * never mutates the World. Tints use {@link dimInt} on **white** objects so the
 * colours match the canvas channel-for-channel (modulo GPU 8-bit quantization).
 *
 * Pixi v8's `Application.init()` is async while `main.ts` drives `draw()`
 * synchronously, so a `ready` flag guards both `draw()` and `pick()` until the GPU
 * context is live; mounted `resolution:1, autoDensity:false` to keep the canvas
 * 640×480 (so picking + HUD stay correct on HiDPI).
 */
export class PixiRenderer implements CityRenderer {
  private readonly app: Application;
  private ready = false;
  private lastSky = "";

  // Layers (built on init). worldLayer becomes the camera container in R2h.
  private skyGfx: Graphics | undefined;
  private worldLayer: Container | undefined;
  private roadsGfx: Graphics | undefined;
  private buildingsLayer: Container | undefined;
  private residentsLayer: Container | undefined;

  private roadsBuilt = false;
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly residentViews = new Map<string, ResidentView>();

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
    this.worldLayer = new Container();
    this.roadsGfx = new Graphics();
    this.buildingsLayer = new Container();
    this.residentsLayer = new Container();
    this.worldLayer.addChild(this.roadsGfx, this.buildingsLayer, this.residentsLayer);
    this.app.stage.addChild(this.skyGfx, this.worldLayer);
    this.ready = true;
    // Deferred first paint when the tab's rAF is throttled (background preview);
    // production's live rAF loop paints next frame regardless.
    const w = window as unknown as { cwlc?: { renderFrame?: () => void } };
    w.cwlc?.renderFrame?.();
  }

  draw(hourFloat: number, _selected?: Pick, _disaster?: DisasterMarker, _bubbles?: ThoughtBubble[]): void {
    if (!this.ready || !this.skyGfx || !this.roadsGfx) return;
    const a = ambient(hourFloat);
    const glow = windowGlow(hourFloat);

    // Sky — refilled only when the colour changes (allocation-free hot path).
    const sky = skyColor(hourFloat);
    if (sky !== this.lastSky) {
      this.lastSky = sky;
      this.skyGfx.clear();
      this.skyGfx.rect(0, 0, WIDTH, HEIGHT).fill(sky);
    }

    // Roads — geometry built once (white), recoloured per frame via tint.
    this.ensureRoads();
    this.roadsGfx.tint = dimInt(ROAD_RGB, a);

    // Buildings — one persistent view per location, created lazily, mutated here.
    const seen = new Set<string>();
    for (const loc of this.world.locations) {
      seen.add(loc.id);
      const view = this.ensureBuildingView(loc);
      const biz = this.world.businesses.find((b) => b.locationId === loc.id);
      this.updateBuildingView(view, biz, this.occupantsAt(loc.nodeId), a, glow);
    }
    this.reapBuildings(seen);

    // Residents — one persistent view per id (created lazily, mutated here).
    const seenR = new Set<string>();
    for (const r of this.world.residents) {
      seenR.add(r.id);
      this.updateResidentView(this.ensureResidentView(r.id), r);
    }
    this.reapResidents(seenR);
  }

  private ensureRoads(): void {
    if (this.roadsBuilt || !this.roadsGfx) return;
    for (const road of this.world.roads) {
      const p = this.world.getNode(road.a);
      const q = this.world.getNode(road.b);
      this.roadsGfx.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
    this.roadsGfx.stroke({ width: 6, color: 0xffffff, cap: "round" });
    this.roadsBuilt = true;
  }

  private ensureBuildingView(loc: Location): BuildingView {
    const existing = this.buildingViews.get(loc.id);
    if (existing) return existing;

    const container = new Container();
    const slot = this.buildingSlot(loc);
    container.position.set(slot.x, slot.y);
    const half = BUILDING / 2;

    // White base rect (centred) — tinted per frame to the dimmed building colour.
    const base = new Graphics();
    base.rect(-half, -half, BUILDING, BUILDING).fill(0xffffff);

    // 2×2 golden window grid, built once; group alpha = lit per frame.
    const windows = new Container();
    const span = 2 * WIN_SIZE + WIN_GAP;
    const o = -span / 2;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const wgfx = new Graphics();
        wgfx
          .rect(o + col * (WIN_SIZE + WIN_GAP), o + row * (WIN_SIZE + WIN_GAP), WIN_SIZE, WIN_SIZE)
          .fill(WIN_GOLD);
        windows.addChild(wgfx);
      }
    }

    // Boarded-up diagonal planks, masked to the box, shown only when shuttered.
    const planks = new Graphics();
    for (let p = -BUILDING; p <= BUILDING; p += 7) {
      planks.moveTo(-half + p, -half).lineTo(-half + p + BUILDING, -half + BUILDING);
    }
    planks.stroke({ width: 2, color: 0xffffff });
    const mask = new Graphics().rect(-half, -half, BUILDING, BUILDING).fill(0xffffff);
    planks.mask = mask;
    planks.visible = false;

    const label = new Text({
      text: loc.name,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fill: 0xffffff },
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(0, half + 11 + slot.line * 11);

    container.addChild(base, windows, mask, planks, label);
    this.buildingsLayer?.addChild(container);

    const view: BuildingView = { container, base, windows, planks, label };
    this.buildingViews.set(loc.id, view);
    return view;
  }

  private updateBuildingView(
    v: BuildingView,
    biz: Business | undefined,
    occupants: number,
    a: number,
    glow: number,
  ): void {
    if (biz && !biz.active) {
      v.base.tint = dimInt(CLOSED_RGB, a);
      v.planks.tint = dimInt(PLANK_RGB, a);
      v.planks.visible = true;
      v.windows.visible = false;
    } else {
      const baseRgb = biz ? BUSINESS_RGB[biz.kind] : HOME_RGB;
      v.base.tint = dimInt(baseRgb, a);
      v.planks.visible = false;
      const lit = glow * (0.12 + 0.88 * (Math.min(occupants, 3) / 3));
      v.windows.visible = lit > 0.02;
      v.windows.alpha = lit;
    }
    v.label.tint = dimInt(LABEL_RGB, Math.max(a, 0.7));
  }

  /** Remove views whose location is gone (e.g. after a Load swaps the world). */
  private reapBuildings(seen: Set<string>): void {
    for (const [id, view] of this.buildingViews) {
      if (!seen.has(id)) {
        view.container.destroy({ children: true });
        this.buildingViews.delete(id);
      }
    }
  }

  private ensureResidentView(id: string): ResidentView {
    const existing = this.residentViews.get(id);
    if (existing) return existing;
    const container = new Container();
    const shadow = new Graphics();
    shadow
      .ellipse(0, DOT_RADIUS + 1, DOT_RADIUS, DOT_RADIUS * 0.45)
      .fill({ color: 0x000000, alpha: 0.35 });
    const tick = new Graphics();
    tick.visible = false;
    const dot = new Graphics();
    dot.circle(0, 0, DOT_RADIUS).fill(0xffffff);
    dot.stroke({ width: 1, color: 0x000000, alpha: 0.55 });
    container.addChild(shadow, tick, dot);
    this.residentsLayer?.addChild(container);
    const view: ResidentView = { container, shadow, tick, dot };
    this.residentViews.set(id, view);
    return view;
  }

  private updateResidentView(v: ResidentView, r: Resident): void {
    v.container.position.set(r.move.x, r.move.y);
    v.dot.tint = ACTIVITY_INT[r.activity];
    if (r.move.path.length > 0) {
      const next = this.world.getNode(r.move.path[0]!);
      const dx = next.x - r.move.x;
      const dy = next.y - r.move.y;
      const len = Math.hypot(dx, dy) || 1;
      v.tick.clear();
      v.tick
        .moveTo(0, 0)
        .lineTo((dx / len) * 9, (dy / len) * 9)
        .stroke({ width: 2, color: 0xe1d65b, alpha: 0.55 });
      v.tick.visible = true;
    } else {
      v.tick.visible = false;
    }
  }

  private reapResidents(seen: Set<string>): void {
    for (const [id, view] of this.residentViews) {
      if (!seen.has(id)) {
        view.container.destroy({ children: true });
        this.residentViews.delete(id);
      }
    }
  }

  /** Verbatim port of the canvas building slot (incl. colocated strip-mall fan-out). */
  private buildingSlot(loc: Location): { x: number; y: number; line: number } {
    const node = this.world.getNode(loc.nodeId);
    const siblings = this.world.locations.filter((l) => l.nodeId === loc.nodeId);
    const i = siblings.indexOf(loc);
    const dx = (i - (siblings.length - 1) / 2) * COLOCATE_DX;
    return { x: node.x + dx, y: node.y, line: i };
  }

  private occupantsAt(nodeId: string): number {
    let n = 0;
    for (const r of this.world.residents) if (r.move.atNodeId === nodeId) n++;
    return n;
  }

  pick(_x: number, _y: number): Pick | undefined {
    return undefined; // wired in R2f (canvas-space) and R2i (under the camera)
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
