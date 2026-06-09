import { Application, Container, Graphics, Text } from "pixi.js";
import type { World } from "../world/World";
import type { Business, Location, Resident, Activity } from "../world/types";
import { skyColor, ambient, windowGlow, dimInt, type Rgb } from "./daynight";
import { worldToScreen as toScreen, screenToWorld, type Camera } from "./camera";
import { prosperityT, fillFraction, FILL_FULL_INVENTORY } from "./economyVisuals";
import { fanOutOffset } from "./residentLayout";
import { occupantsByHome } from "../world/housing";
import { CAPITAL_BASELINE } from "../systems/constants";
import {
  ROAD_RGB,
  CLOSED_RGB,
  LABEL_RGB,
  HOME_RGB,
  BUSINESS_RGB,
  BUSINESS_RGB_DEFAULT,
  BUILDING,
  COLOCATE_DX,
  ACTIVITY_COLOR,
  DOT_RADIUS,
  DISASTER_STYLE,
} from "./CanvasRenderer";
import type { CityRenderer, Pick, DisasterMarker, ThoughtBubble, MapToast } from "./CityRenderer";

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
  glow: Graphics;
  base: Graphics;
  windows: Container;
  planks: Graphics;
  bar: Container; // inventory warehouse bar (track + fill), shown for businesses
  fill: Graphics; // the fill rect, scaled per frame by inventory
  workers: Container; // staff-count figures
  label: Text;
  selOutline: Graphics;
}

// Life-stage styling (HP3) — purely visual thresholds so the age structure reads at
// a glance: children render smaller (a figure that grows toward adult size), elders
// fade a touch. Absent age (mortality off) ⇒ everyone renders adult ⇒ unchanged.
const CHILD_MAX_AGE = 18; // below this a resident is a growing child (smaller dot)
const ELDER_AGE = 60; // at/after this a resident is an elder (slightly faded)

/** Persistent Pixi objects for one resident (created once, mutated per frame). */
interface ResidentView {
  container: Container;
  shadow: Graphics;
  tick: Graphics;
  dot: Graphics;
  selGlow: Graphics;
  offX: number; // last applied fan-out offset (kept so pick() hits the drawn dot)
  offY: number;
}

/** A pooled thought-bubble (R1 overlay): a rounded callout + tail + fitted text. */
interface BubbleView {
  container: Container;
  gfx: Graphics;
  text: Text;
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
  private toastLayer: Container | undefined;
  /** Pooled Text objects for floating map toasts (created lazily, reused per frame). */
  private readonly toastPool: Text[] = [];
  private hudLayer: Container | undefined; // screen-fixed (never under the camera)
  private sunC: Container | undefined;
  private moonC: Container | undefined;
  private overlayWorld: Container | undefined; // world-anchored disaster ring/badge
  private disasterRing: Graphics | undefined;
  private disasterBadge: Container | undefined;
  private disasterBadgeCircle: Graphics | undefined;
  private disasterGlyph: Text | undefined;
  private disasterBanner: Container | undefined;
  private disasterBannerBox: Graphics | undefined;
  private disasterBannerDot: Graphics | undefined;
  private disasterBannerText: Text | undefined;

  private bubbleLayer: Container | undefined;
  private readonly bubblePool: BubbleView[] = [];
  // Shared offscreen 2D context to measure text exactly like the canvas renderer,
  // so bubble ellipsis breakpoints match (§6.4).
  private readonly measureCtx = document.createElement("canvas").getContext("2d");

  // Camera (R2h/R2i) — view-only, never serialized, never feeds the sim.
  private readonly cam: Camera = { tx: 0, ty: 0, scale: 1 };
  private follow = false;
  private lastSelId: string | undefined;

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
    this.toastLayer = new Container(); // floating map toasts, above residents, in world space
    this.worldLayer.addChild(this.roadsGfx, this.buildingsLayer, this.residentsLayer, this.toastLayer);
    this.app.stage.addChild(this.skyGfx, this.worldLayer);
    this.hudLayer = new Container();
    this.app.stage.addChild(this.hudLayer);
    this.buildHud();
    this.buildDisaster();
    this.bubbleLayer = new Container();
    this.hudLayer.addChild(this.bubbleLayer);
    this.attachCamera();
    this.ready = true;
    // Deferred first paint when the tab's rAF is throttled (background preview);
    // production's live rAF loop paints next frame regardless.
    const w = window as unknown as { cwlc?: { renderFrame?: () => void } };
    w.cwlc?.renderFrame?.();
  }

  draw(
    hourFloat: number,
    selected?: Pick,
    disaster?: DisasterMarker,
    bubbles?: ThoughtBubble[],
    toasts?: MapToast[],
  ): void {
    if (!this.ready || !this.skyGfx || !this.roadsGfx) return;
    this.updateFollow(selected);
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
    // A home's windows now light by how full it is (residents who LIVE there ÷ its
    // capacity), so the skyline shows occupancy at a glance — full homes glow, a fresh
    // or empty home is dim. Workplaces keep lighting by who's physically on-site.
    const homeOcc = occupantsByHome(this.world.residents);
    const seen = new Set<string>();
    for (const loc of this.world.locations) {
      seen.add(loc.id);
      const view = this.ensureBuildingView(loc);
      const biz = this.world.businesses.find((b) => b.locationId === loc.id);
      const isSel = selected?.kind === "business" && !!biz && selected.id === biz.id;
      let litFraction: number;
      if (loc.type === "home") {
        const cap = loc.capacity ?? 3;
        litFraction = cap > 0 ? Math.min(1, (homeOcc.get(loc.id) ?? 0) / cap) : 0;
      } else {
        litFraction = Math.min(1, this.occupantsAt(loc.nodeId) / 3);
      }
      this.updateBuildingView(view, biz, litFraction, a, glow, isSel);
    }
    this.reapBuildings(seen);

    // Residents — one persistent view per id. Co-located, stationary residents fan
    // out into a ring (so the crowd is countable); movers keep their road position.
    const atNode = new Map<string, string[]>();
    for (const r of this.world.residents) {
      if (r.move.path.length === 0 && r.move.atNodeId) {
        const arr = atNode.get(r.move.atNodeId);
        if (arr) arr.push(r.id);
        else atNode.set(r.move.atNodeId, [r.id]);
      }
    }
    for (const arr of atNode.values()) arr.sort(); // stable order → stable offsets
    const seenR = new Set<string>();
    for (const r of this.world.residents) {
      seenR.add(r.id);
      const isSel = selected?.kind === "resident" && selected.id === r.id;
      let off = { dx: 0, dy: 0 };
      if (r.move.path.length === 0 && r.move.atNodeId) {
        const group = atNode.get(r.move.atNodeId);
        if (group && group.length > 1) off = fanOutOffset(group.indexOf(r.id), group.length);
      }
      this.updateResidentView(this.ensureResidentView(r.id), r, isSel, off);
    }
    this.reapResidents(seenR);

    this.updateSkyBadge(hourFloat);
    this.updateDisaster(disaster);
    this.updateBubbles(bubbles ?? []);
    this.updateToasts(toasts ?? []);
  }

  /** Floating demographic toasts (HP3): a glyph that pops at a home and drifts up as
   *  it fades. World-space (pans/zooms with the map). Pooled Text, reused per frame. */
  private updateToasts(toasts: MapToast[]): void {
    if (!this.toastLayer) return;
    for (let i = 0; i < toasts.length; i++) {
      let t = this.toastPool[i];
      if (!t) {
        t = new Text({
          text: "",
          style: { fontFamily: "system-ui, sans-serif", fontSize: 16, fill: 0xffffff },
        });
        t.anchor.set(0.5, 1);
        this.toastLayer.addChild(t);
        this.toastPool[i] = t;
      }
      const m = toasts[i]!;
      t.text = m.text;
      t.position.set(m.x, m.y - 14 - (1 - m.alpha) * 22); // rises as it fades
      t.alpha = Math.max(0, Math.min(1, m.alpha));
      t.visible = true;
    }
    for (let i = toasts.length; i < this.toastPool.length; i++) this.toastPool[i]!.visible = false;
  }

  /** Legend (bottom-left) + sun/moon badge (top-right), built once in screen space. */
  private buildHud(): void {
    if (!this.hudLayer) return;
    const items = Object.entries(ACTIVITY_COLOR);
    const lineH = 13;
    const padX = 8;
    const padY = 6;
    const sw = 8;
    const boxW = 96;
    const boxH = padY * 2 + items.length * lineH;
    const x = 8;
    const y = HEIGHT - 8 - boxH; // HEIGHT constant, never canvas.height (§6.5)
    const legend = new Container();
    const bg = new Graphics();
    bg.rect(x, y, boxW, boxH)
      .fill({ color: 0x0e1116, alpha: 0.66 })
      .stroke({ width: 1, color: 0x788296, alpha: 0.35 });
    legend.addChild(bg);
    items.forEach(([act, color], i) => {
      const cy = y + padY + i * lineH + lineH / 2;
      const swatch = new Graphics();
      swatch.rect(x + padX, cy - sw / 2, sw, sw).fill(parseInt(color.slice(1), 16));
      const t = new Text({
        text: act,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fill: 0xc9d1d9 },
      });
      t.anchor.set(0, 0.5);
      t.position.set(x + padX + sw + 6, cy);
      legend.addChild(swatch, t);
    });
    this.hudLayer.addChild(legend);

    const cx = WIDTH - 30;
    const cyy = 30;
    const rad = 10;
    const moon = new Container();
    moon.position.set(cx, cyy);
    const mc = new Graphics();
    mc.circle(0, 0, rad).fill(0xdfe6f2);
    const cr1 = new Graphics();
    cr1.circle(-3, -2, 2.4).fill({ color: 0x788296, alpha: 0.5 });
    const cr2 = new Graphics();
    cr2.circle(3, 3, 1.8).fill({ color: 0x788296, alpha: 0.5 });
    moon.addChild(mc, cr1, cr2);

    const sun = new Container();
    sun.position.set(cx, cyy);
    const halo = new Graphics(); // soft halo — the shadowBlur glow approximation (R2-PARITY waiver)
    halo.circle(0, 0, rad + 6).fill({ color: 0xffd27a, alpha: 0.22 });
    const rays = new Graphics();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      rays
        .moveTo(Math.cos(ang) * (rad + 3), Math.sin(ang) * (rad + 3))
        .lineTo(Math.cos(ang) * (rad + 7), Math.sin(ang) * (rad + 7));
    }
    rays.stroke({ width: 2, color: 0xffcf6b });
    const sc = new Graphics();
    sc.circle(0, 0, rad).fill(0xffd27a);
    sun.addChild(halo, rays, sc);

    this.hudLayer.addChild(moon, sun);
    this.moonC = moon;
    this.sunC = sun;
  }

  /** Crossfade sun↔moon by time of day (same `day = 1 - windowGlow` math as canvas). */
  private updateSkyBadge(hourFloat: number): void {
    if (!this.sunC || !this.moonC) return;
    const day = 1 - windowGlow(hourFloat);
    this.moonC.visible = day < 0.98;
    this.moonC.alpha = Math.min(1, 1 - day + 0.02);
    this.sunC.visible = day > 0.02;
    this.sunC.alpha = Math.min(1, day + 0.02);
  }

  /** Build the (hidden) disaster ring/badge (world-anchored) + banner (screen-fixed). */
  private buildDisaster(): void {
    if (!this.worldLayer || !this.hudLayer) return;
    this.overlayWorld = new Container();
    this.worldLayer.addChild(this.overlayWorld);

    this.disasterRing = new Graphics();
    this.disasterRing.visible = false;
    const badge = new Container();
    badge.visible = false;
    const badgeCircle = new Graphics();
    const glyph = new Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "bold", fill: 0x0e1116 },
    });
    glyph.anchor.set(0.5, 0.5);
    badge.addChild(badgeCircle, glyph);
    this.overlayWorld.addChild(this.disasterRing, badge);
    this.disasterBadge = badge;
    this.disasterBadgeCircle = badgeCircle;
    this.disasterGlyph = glyph;

    const banner = new Container();
    banner.visible = false;
    const box = new Graphics();
    const dot = new Graphics();
    const text = new Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "bold", fill: 0xe6edf3 },
    });
    text.anchor.set(0.5, 0.5);
    banner.addChild(box, dot, text);
    this.hudLayer.addChild(banner);
    this.disasterBanner = banner;
    this.disasterBannerBox = box;
    this.disasterBannerDot = dot;
    this.disasterBannerText = text;
  }

  /** Flag today's disaster: a ring + glyph over the target + a top-centre banner. */
  private updateDisaster(disaster?: DisasterMarker): void {
    const ring = this.disasterRing;
    const badge = this.disasterBadge;
    const banner = this.disasterBanner;
    if (!ring || !badge || !banner) return;
    if (!disaster) {
      ring.visible = false;
      badge.visible = false;
      banner.visible = false;
      return;
    }
    const style = DISASTER_STYLE[disaster.kind];
    const color = parseInt(style.color.slice(1), 16);
    const half = BUILDING / 2;
    const pos = this.worldPosOf(disaster.targetId);
    if (pos) {
      ring.clear();
      ring.circle(pos.x, pos.y, half + 6).stroke({ width: 2, color });
      ring.visible = true;
      badge.position.set(pos.x, pos.y - half - 13);
      this.disasterBadgeCircle?.clear().circle(0, 0, 8).fill(color);
      if (this.disasterGlyph) this.disasterGlyph.text = style.glyph;
      badge.visible = true;
    } else {
      ring.visible = false;
      badge.visible = false;
    }
    const text = this.disasterBannerText!;
    text.text = disaster.headline;
    text.style.fill = color;
    const w = Math.min(WIDTH - 40, text.width + 32);
    const h = 22;
    const x = (WIDTH - w) / 2;
    const y = 8;
    this.disasterBannerBox
      ?.clear()
      .rect(x, y, w, h)
      .fill({ color: 0x0e1116, alpha: 0.82 })
      .stroke({ width: 1.5, color });
    this.disasterBannerDot?.clear().circle(x + 12, y + h / 2, 4).fill(color);
    text.position.set(x + w / 2 + 8, y + h / 2);
    banner.visible = true;
  }

  /** World position of a disaster target (a building's slot, or a resident's spot). */
  private worldPosOf(targetId?: string): { x: number; y: number } | undefined {
    if (!targetId) return undefined;
    const biz = this.world.businesses.find((b) => b.id === targetId);
    if (biz) {
      const loc = this.world.locations.find((l) => l.id === biz.locationId);
      if (loc) {
        const slot = this.buildingSlot(loc);
        return { x: slot.x, y: slot.y };
      }
    }
    const res = this.world.residents.find((r) => r.id === targetId);
    if (res) return { x: res.move.x, y: res.move.y };
    return undefined;
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

    // Prosperity glow (R3a) — a soft gold halo behind the building, scaled + faded
    // per frame by the firm's capital. Built once at a base radius.
    const glow = new Graphics();
    glow.circle(0, 0, BUILDING).fill(0xffd27a);
    glow.visible = false;

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

    const selOutline = new Graphics();
    selOutline.rect(-half - 2, -half - 2, BUILDING + 4, BUILDING + 4).stroke({ width: 2, color: 0xffffff });
    selOutline.visible = false;

    // Inventory warehouse bar (R3b): a dark track + a green fill scaled per frame.
    const barW = BUILDING;
    const barH = 3;
    const barY = half + 3;
    const bar = new Container();
    const track = new Graphics();
    track.rect(-barW / 2, barY, barW, barH).fill({ color: 0x2b2f3a, alpha: 0.85 });
    const fill = new Graphics();
    fill.rect(0, 0, barW, barH).fill(0x3fb950);
    fill.position.set(-barW / 2, barY);
    bar.addChild(track, fill);
    bar.visible = false;

    // Worker figures (R3c): up to 5 small dots above the building, shown by headcount.
    const workers = new Container();
    for (let i = 0; i < 5; i++) {
      const wd = new Graphics();
      wd.circle(-8 + i * 4, -half - 4, 1.5).fill(0xc9d1d9);
      wd.visible = false;
      workers.addChild(wd);
    }

    container.addChild(glow, base, windows, mask, planks, bar, workers, label, selOutline);
    this.buildingsLayer?.addChild(container);

    const view: BuildingView = { container, glow, base, windows, planks, bar, fill, workers, label, selOutline };
    this.buildingViews.set(loc.id, view);
    return view;
  }

  private updateBuildingView(
    v: BuildingView,
    biz: Business | undefined,
    litFraction: number,
    a: number,
    glow: number,
    isSelected: boolean,
  ): void {
    if (biz && !biz.active) {
      v.base.tint = dimInt(CLOSED_RGB, a);
      v.planks.tint = dimInt(PLANK_RGB, a);
      v.planks.visible = true;
      v.windows.visible = false;
    } else {
      const baseRgb = biz ? BUSINESS_RGB[biz.kind] ?? BUSINESS_RGB_DEFAULT : HOME_RGB;
      v.base.tint = dimInt(baseRgb, a);
      v.planks.visible = false;
      const lit = glow * (0.12 + 0.88 * Math.max(0, Math.min(1, litFraction)));
      v.windows.visible = lit > 0.02;
      v.windows.alpha = lit;
    }
    v.label.tint = dimInt(LABEL_RGB, Math.max(a, 0.7));
    v.selOutline.visible = isSelected;
    // Visual economic state (R3): prosperity glow (capital), inventory bar, worker
    // figures (headcount) — active firms only; homes + shuttered show none.
    if (biz && biz.active) {
      const t = prosperityT(biz.capital ?? CAPITAL_BASELINE, CAPITAL_BASELINE);
      v.glow.visible = t > 0.02;
      v.glow.alpha = t * 0.55;
      v.glow.scale.set(0.6 + 0.7 * t);
      v.bar.visible = true;
      v.fill.scale.x = fillFraction(biz.inventory, FILL_FULL_INVENTORY);
      const crew = Math.min(biz.employeeIds.length, v.workers.children.length);
      v.workers.children.forEach((c, i) => {
        c.visible = i < crew;
      });
    } else {
      v.glow.visible = false;
      v.bar.visible = false;
      v.workers.children.forEach((c) => {
        c.visible = false;
      });
    }
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
    const selGlow = new Graphics();
    selGlow.circle(0, 0, DOT_RADIUS + 3).stroke({ width: 2, color: 0xffffff });
    selGlow.visible = false;
    container.addChild(shadow, tick, dot, selGlow);
    this.residentsLayer?.addChild(container);
    const view: ResidentView = { container, shadow, tick, dot, selGlow, offX: 0, offY: 0 };
    this.residentViews.set(id, view);
    return view;
  }

  private updateResidentView(
    v: ResidentView,
    r: Resident,
    isSelected: boolean,
    off: { dx: number; dy: number },
  ): void {
    v.offX = off.dx;
    v.offY = off.dy;
    v.container.position.set(r.move.x + off.dx, r.move.y + off.dy);
    v.dot.tint = ACTIVITY_INT[r.activity];
    v.selGlow.visible = isSelected;
    // Life-stage size/fade (HP3): a child grows from ~half size to full by adulthood;
    // an elder fades slightly. Keeps the activity tint intact. No-op when age is unset.
    const age = r.age;
    if (age === undefined) {
      v.container.scale.set(1);
      v.container.alpha = 1;
    } else {
      v.container.scale.set(age < CHILD_MAX_AGE ? 0.55 + 0.45 * (age / CHILD_MAX_AGE) : 1);
      v.container.alpha = age >= ELDER_AGE ? 0.7 : 1;
    }
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

  pick(x: number, y: number): Pick | undefined {
    if (!this.ready) return undefined;
    // R2i: map the canvas-space click through the inverse camera transform, then run
    // the verbatim canvas hit-test in WORLD units — resident first (≤9px), then
    // building AABB (≤13px). At pan 0 / zoom 1 the inverse is the identity, so this
    // is byte-identical to the canvas pick.
    const world = screenToWorld(x, y, this.cam);
    const wx = world.x;
    const wy = world.y;
    let best: { id: string; d: number } | undefined;
    for (const r of this.world.residents) {
      // Hit-test the DRAWN dot (true position + its fan-out offset) so a click on a
      // fanned-out dot selects that resident, not whoever is nearest the node centre.
      const v = this.residentViews.get(r.id);
      const rx = r.move.x + (v?.offX ?? 0);
      const ry = r.move.y + (v?.offY ?? 0);
      const d = Math.hypot(rx - wx, ry - wy);
      if (d <= DOT_RADIUS + 4 && (!best || d < best.d)) best = { id: r.id, d };
    }
    if (best) return { kind: "resident", id: best.id };
    for (const loc of this.world.locations) {
      const slot = this.buildingSlot(loc);
      const half = BUILDING / 2;
      if (Math.abs(slot.x - wx) <= half && Math.abs(slot.y - wy) <= half) {
        const biz = this.world.businesses.find((b) => b.locationId === loc.id);
        if (biz) return { kind: "business", id: biz.id };
      }
    }
    return undefined;
  }

  /** World→screen through the live camera (for screen-space bubble placement). */
  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return toScreen(x, y, this.cam);
  }

  private applyCamera(): void {
    this.worldLayer?.position.set(this.cam.tx, this.cam.ty);
    this.worldLayer?.scale.set(this.cam.scale);
  }

  /** Keep the 640×480 world from being panned entirely out of view. */
  private clampCamera(): void {
    const s = this.cam.scale;
    this.cam.tx = Math.max(WIDTH - WIDTH * s - 100, Math.min(100, this.cam.tx));
    this.cam.ty = Math.max(HEIGHT - HEIGHT * s - 100, Math.min(100, this.cam.ty));
  }

  /** Pointer-drag pan, wheel zoom-to-cursor (clamped), double-click reset. View-only. */
  private attachCamera(): void {
    const c = this.canvas;
    const toCanvas = (e: { clientX: number; clientY: number }) => {
      const rect = c.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * WIDTH,
        y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
      };
    };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    c.addEventListener("pointerdown", (e) => {
      dragging = true;
      const p = toCanvas(e);
      lastX = p.x;
      lastY = p.y;
      this.follow = false; // manual control wins
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
    });
    c.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const p = toCanvas(e);
      this.cam.tx += p.x - lastX;
      this.cam.ty += p.y - lastY;
      lastX = p.x;
      lastY = p.y;
      this.clampCamera();
      this.applyCamera();
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = toCanvas(e);
        const w = screenToWorld(p.x, p.y, this.cam);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.cam.scale = Math.max(0.5, Math.min(4, this.cam.scale * factor));
        this.cam.tx = p.x - w.x * this.cam.scale; // keep the world point under the cursor fixed
        this.cam.ty = p.y - w.y * this.cam.scale;
        this.follow = false;
        this.clampCamera();
        this.applyCamera();
      },
      { passive: false },
    );
    c.addEventListener("dblclick", () => {
      this.cam.tx = 0;
      this.cam.ty = 0;
      this.cam.scale = 1;
      this.follow = false;
      this.applyCamera();
    });
  }

  /** Follow-cam: when a fresh selection is made, ease the camera to centre it; any
   *  manual pan/zoom cancels follow (set in the input handlers). */
  private updateFollow(selected?: Pick): void {
    if (selected && selected.id !== this.lastSelId) {
      this.follow = true;
      this.lastSelId = selected.id;
    }
    if (!selected) {
      this.lastSelId = undefined;
      this.follow = false;
    }
    if (this.follow && selected) {
      const wp = this.worldPosOf(selected.id);
      if (wp) {
        const targetTx = WIDTH / 2 - wp.x * this.cam.scale;
        const targetTy = HEIGHT / 2 - wp.y * this.cam.scale;
        this.cam.tx += (targetTx - this.cam.tx) * 0.15;
        this.cam.ty += (targetTy - this.cam.ty) * 0.15;
        this.clampCamera();
        this.applyCamera();
      }
    }
  }

  /**
   * The R1 thought bubbles, pooled in screen space but anchored over the deciding
   * firm via worldPosOf + worldToScreen. `alpha` is the unchanged wall-clock fade
   * computed in main.ts (presentation only — never sim state).
   */
  private updateBubbles(bubbles: ThoughtBubble[]): void {
    let used = 0;
    for (const b of bubbles) {
      if (b.alpha <= 0.02) continue;
      const wp = this.worldPosOf(b.businessId);
      if (!wp) continue;
      const sa = this.worldToScreen(wp.x, wp.y);
      const screen = { x: sa.x, y: sa.y - (BUILDING / 2) * this.cam.scale - 6 };
      const v = this.getBubble(used++);
      const fitted = this.fitText(b.text, 172);
      const padX = 7;
      const h = 18;
      const w = fitted.width + padX * 2;
      v.gfx.clear();
      v.gfx
        .roundRect(-w / 2, -h, w, h, 5)
        .fill({ color: 0x0e1116, alpha: 0.9 })
        .stroke({ width: 1, color: 0x58a6ff });
      v.gfx.moveTo(-4, 0).lineTo(4, 0).lineTo(0, 5).closePath().fill({ color: 0x0e1116, alpha: 0.9 });
      v.text.text = fitted.text;
      v.text.position.set(0, -h / 2);
      v.container.position.set(screen.x, screen.y);
      v.container.alpha = b.alpha;
      v.container.visible = true;
    }
    for (let i = used; i < this.bubblePool.length; i++) this.bubblePool[i]!.container.visible = false;
  }

  private getBubble(i: number): BubbleView {
    const existing = this.bubblePool[i];
    if (existing) return existing;
    const container = new Container();
    const gfx = new Graphics();
    const text = new Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "bold", fill: 0xe6edf3 },
    });
    text.anchor.set(0.5, 0.5);
    container.addChild(gfx, text);
    this.bubbleLayer?.addChild(container);
    const v: BubbleView = { container, gfx, text };
    this.bubblePool[i] = v;
    return v;
  }

  /** Truncate to fit `maxW` using the shared canvas measureText (matches the canvas bubble). */
  private fitText(text: string, maxW: number): { text: string; width: number } {
    const ctx = this.measureCtx;
    if (!ctx) return { text, width: text.length * 6 };
    ctx.font = "bold 11px system-ui, sans-serif";
    if (ctx.measureText(text).width <= maxW) return { text, width: ctx.measureText(text).width };
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    const out = `${t}…`;
    return { text: out, width: ctx.measureText(out).width };
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
