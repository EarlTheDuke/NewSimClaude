import { Application, Container, Graphics, Text } from "pixi.js";
import type { World } from "../world/World";
import type { Business, Location, Resident, Activity } from "../world/types";
import { skyColor, ambient, windowGlow, windowGlowSharp, dimInt, type Rgb } from "./daynight";
import { worldToScreen as toScreen, screenToWorld, type Camera } from "./camera";
import { prosperityT, fillFraction, FILL_FULL_INVENTORY } from "./economyVisuals";
import { fanOutOffset } from "./residentLayout";
import { rightOf, dashes, lotOffset, ROAD_WIDTH, LANE_OFFSET, PATH_OFFSET, KERB_OFFSET } from "./roadGeometry";
import { INDUSTRY_REGISTRY } from "../world/industries";
import { CAPITAL_BASELINE } from "../systems/constants";
import {
  ROAD_RGB,
  CLOSED_RGB,
  LABEL_RGB,
  HOME_RGB,
  BUSINESS_RGB,
  BUSINESS_RGB_DEFAULT,
  BUILDING,
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
// R3-2 street furniture colours (white geometry, tinted per frame like the asphalt).
const LANE_RGB: Rgb = [176, 162, 92]; // the dashed centre line — faded road paint
const PATH_RGB: Rgb = [104, 110, 122]; // the footpaths flanking the asphalt
const LAMP_POST_RGB: Rgb = [140, 146, 158]; // R3-5 lamp posts, dimmed with the daylight
const LAMP_GLOW = 0xffd9a0; // R3-5 the warm light pool, alpha-driven by dusk
const DOOR_GOLD = 0xffc46b; // R3-13 the staffed-storefront doorway glow

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
  /** R3-4 silhouette parts — white shapes tinted to their colour × ambient each frame. */
  decoParts: { g: Graphics; rgb: Rgb }[];
  deco: Container;
  /** R3-6 posted-wage placard, shown while the firm bids above its base wage. */
  wageTag: Text;
  lastWage: string;
  /** R3-13 doorway glow — storefronts only; lit while staffed during opening hours. */
  door?: Graphics;
  /** R3-7 the Zzz wisp over a home whose occupants are asleep at night. */
  zzz?: Text;
  /** R4 juice — the firm's pennant, waving on the wall-clock breeze. */
  pennant?: Graphics;
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
  car: Container; // R3-3: shown while travelling WITH a vehicle (right-hand lane)
  carBody: Graphics; // the tintable hull
  walker: Container; // R3-3: shown while travelling on foot (the footpath)
  walkerG: Graphics; // the tintable figure
  ringGold: Graphics; // R3-9: thin gold ring — this resident is in the town's top wealth tier
  ringGrey: Graphics; // R3-9: thin grey ring — the bottom tier
  selGlow: Graphics;
  offX: number; // last applied draw offset — fan-out OR lane/footpath (kept so pick() hits the drawn spot)
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
  private laneGfx: Graphics | undefined; // R3-2: dashed centre line, tinted separately
  private pathGfx: Graphics | undefined; // R3-2: footpaths on both sides of the asphalt
  private lampPosts: Graphics | undefined; // R3-5: lamp posts at every crossing
  private lampGlow: Graphics | undefined; // R3-5: their warm pools, alpha = dusk curve
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

  // R4 wave 6 — THE DIRECTOR: an auto-camera that finds the story. directToBusiness()
  // glides toward a firm at a gentle zoom, holds, then eases home to the full view. A
  // human hand on the camera (drag/zoom) suspends direction for a few seconds — the
  // viewer always outranks the director. View-only, wall-clock eased.
  private directTarget: { x: number; y: number; zoom: number; until: number } | undefined;
  private lastUserCamMs = 0;

  // R3-8 — hover name tag: the pointer's last canvas position (undefined when it left),
  // hit-tested per frame so the tag tracks a moving resident under the cursor.
  private hoverX: number | undefined;
  private hoverY: number | undefined;
  private hoverTag: Container | undefined;
  private hoverTagBg: Graphics | undefined;
  private hoverTagText: Text | undefined;

  private roadsBuilt = false;
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly residentViews = new Map<string, ResidentView>();

  // R3-14 — the trade boat: presentation-only state. We watch the city's cumulative
  // trade tally (export revenue + import spend across all firms); every increase
  // launches a sailing — glide in, sit at the pier, glide out — on the wall clock.
  private boatC: Container | undefined;
  private lastTradeTotal: number | undefined;
  private sailStart = 0;

  // R3-26 — arrival/departure puffs: a small expanding ring where someone sets off or
  // arrives. Pooled; expired by wall-clock age. (prevMoving tracks the transitions.)
  private puffLayer: Container | undefined;
  private readonly puffPool: Graphics[] = [];
  private readonly puffs: { x: number; y: number; born: number }[] = [];
  private readonly prevMoving = new Map<string, boolean>();

  // R3-16 — the mint sparkle: fresh-coin sparks burst from the City Reserve whenever the
  // audited ledger ticks up (world.mintedTotal() delta — read-only). Wall-clock burst.
  private mintFx: Graphics | undefined;
  private lastMinted: number | undefined;
  private mintStart = 0;

  // R4 wave 4 (juice) — coin particles on REAL sales: every firm's pnl.revenue accrues
  // tick-by-tick, so a delta between frames is an actual dollar landing. Retail sales float
  // a coin off the storefront; B2B settlements (wave 4b) GLIDE a coin from the consumer firm
  // to its producer along the supply chain — the circulation of money, visible end to end.
  private coinLayer: Container | undefined;
  private readonly coinPool: Graphics[] = [];
  private readonly coins: { x: number; y: number; born: number; tx?: number; ty?: number }[] = [];
  private readonly lastRevenue = new Map<string, number>();
  /** resource → the business kinds that consume it (built once from the industry registry). */
  private consumersOf: Map<string, string[]> | undefined;

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
      // R4 wave 4b — the map earns a bigger share of the screen: the backing store renders
      // at 1.5× the logical 640×480 so the CSS upscale (style.css canvas#city) stays crisp.
      // All world coordinates, picking, and HUD math stay in 640×480 logical space.
      resolution: 1.5,
      autoDensity: false,
      antialias: true,
      background: "#0e1116",
    });
    this.canvas.style.width = ""; // let style.css own the display size
    this.skyGfx = new Graphics();
    this.worldLayer = new Container();
    this.roadsGfx = new Graphics();
    this.laneGfx = new Graphics();
    this.pathGfx = new Graphics();
    this.lampGlow = new Graphics();
    this.lampPosts = new Graphics();
    this.buildingsLayer = new Container();
    this.residentsLayer = new Container();
    this.toastLayer = new Container(); // floating map toasts, above residents, in world space
    this.puffLayer = new Container();
    this.worldLayer.addChild(
      this.pathGfx, // footpaths under the asphalt edge
      this.roadsGfx,
      this.laneGfx, // centre line painted on top of the asphalt
      this.lampGlow, // light pools wash the street, under the buildings
      this.buildingsLayer,
      this.lampPosts, // the posts stand over the street furniture
      this.puffLayer, // arrival puffs under the people who made them
      this.residentsLayer,
      this.toastLayer,
    );
    // R3-14 — the trade boat, built once and hidden until a sailing is due.
    const boat = new Container();
    const hull = new Graphics();
    hull.poly([-9, 0, 9, 0, 5.5, 5, -5.5, 5]).fill(0x8a4a3c);
    hull.stroke({ width: 1, color: 0x0e1116, alpha: 0.5 });
    const mast = new Graphics();
    mast.rect(-0.8, -10, 1.6, 10).fill(0xd9dde6);
    const sail = new Graphics();
    sail.poly([1, -10, 8.5, -3.5, 1, -3.5]).fill(0xe8ecf4);
    const wake = new Graphics();
    wake.ellipse(0, 5.5, 11, 2.5).fill({ color: 0x6fa8d8, alpha: 0.35 });
    boat.addChild(wake, hull, mast, sail);
    boat.visible = false;
    this.worldLayer.addChild(boat);
    this.boatC = boat;
    // R3-16 — the mint sparkle burst, one pooled Graphics redrawn per frame while live.
    this.mintFx = new Graphics();
    this.mintFx.visible = false;
    this.worldLayer.addChild(this.mintFx);
    // R4 juice — the coin layer floats over the buildings.
    this.coinLayer = new Container();
    this.worldLayer.addChild(this.coinLayer);
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

    // Roads — geometry built once (white), recoloured per frame via tint. The street
    // is three tinted layers (R3-2): footpaths, asphalt bed, dashed centre line.
    this.ensureRoads();
    this.roadsGfx.tint = dimInt(ROAD_RGB, a);
    if (this.laneGfx) this.laneGfx.tint = dimInt(LANE_RGB, a);
    if (this.pathGfx) this.pathGfx.tint = dimInt(PATH_RGB, a);
    // R3-5 — street lamps: posts dim with the daylight; the warm pools pop on at dusk
    // (the same sharp curve as the home windows) and wash the crossings all night.
    if (this.lampPosts) this.lampPosts.tint = dimInt(LAMP_POST_RGB, a);
    if (this.lampGlow) this.lampGlow.alpha = windowGlowSharp(hourFloat) * 0.28;

    // Buildings — one persistent view per location, created lazily, mutated here.
    // R3-1: a home's windows light by who is ACTUALLY inside — one golden window per
    // resident standing at their own home — so lights come on as each person walks in
    // the door after dark (and an empty house is dark, full stop). Workplaces keep
    // lighting by who's physically on-site, on the gentle ambient curve.
    const glowHome = windowGlowSharp(hourFloat);
    const peopleHome = new Map<string, number>();
    const sleepersHome = new Map<string, number>(); // R3-7 — who is home AND asleep
    for (const r of this.world.residents) {
      if (r.move.path.length === 0 && r.move.atNodeId) {
        const home = this.world.locations.find((l) => l.id === r.homeId);
        if (home && home.nodeId === r.move.atNodeId) {
          peopleHome.set(r.homeId, (peopleHome.get(r.homeId) ?? 0) + 1);
          if (r.activity === "sleeping") {
            sleepersHome.set(r.homeId, (sleepersHome.get(r.homeId) ?? 0) + 1);
          }
        }
      }
    }
    // R3-13 — storefront doorway light: lit while the shop is staffed during trading
    // hours (the staffed-and-open signal, distinct from bankruptcy boards).
    const openNow = hourFloat >= 7 && hourFloat < 22;
    const seen = new Set<string>();
    for (const loc of this.world.locations) {
      seen.add(loc.id);
      const view = this.ensureBuildingView(loc);
      const biz = this.world.businesses.find((b) => b.locationId === loc.id);
      const isSel = selected?.kind === "business" && !!biz && selected.id === biz.id;
      const homeWindows = loc.type === "home" ? peopleHome.get(loc.id) ?? 0 : undefined;
      const sleepers = loc.type === "home" ? sleepersHome.get(loc.id) ?? 0 : 0;
      const litFraction =
        loc.type === "home" ? 0 : Math.min(1, this.occupantsAt(loc.nodeId) / 3);
      this.updateBuildingView(
        view,
        biz,
        litFraction,
        homeWindows,
        sleepers,
        a,
        glow,
        glowHome,
        openNow,
        isSel,
      );
    }
    this.reapBuildings(seen);

    // Residents — one persistent view per id. R3-44: a standing resident gathers at the
    // DOORSTEP of the place they're at (their destination's corner lot, when it sits on
    // this node) instead of mid-intersection; co-located groups still fan into a
    // countable ring. Movers keep their road position (lane/footpath handled below).
    const standing = new Map<string, { x: number; y: number; ids: string[] }>();
    const anchorOf = (r: Resident): { key: string; x: number; y: number } => {
      const dest = this.world.locations.find((l) => l.id === r.destinationId);
      if (dest && dest.nodeId === r.move.atNodeId) {
        const s = this.buildingSlot(dest);
        return { key: dest.id, x: s.x, y: s.y + BUILDING / 2 + 5 }; // the doorstep
      }
      const n = this.world.getNode(r.move.atNodeId);
      // No door of theirs here: wait on the corner PAVEMENT, never mid-junction.
      return { key: r.move.atNodeId, x: n.x + KERB_OFFSET, y: n.y + KERB_OFFSET };
    };
    for (const r of this.world.residents) {
      if (r.move.path.length === 0 && r.move.atNodeId) {
        const a = anchorOf(r);
        const g = standing.get(a.key);
        if (g) g.ids.push(r.id);
        else standing.set(a.key, { x: a.x, y: a.y, ids: [r.id] });
      }
    }
    for (const g of standing.values()) g.ids.sort(); // stable order → stable ring spots
    // R3-9 — wealth tiers, recomputed per frame (read-only): the top fifth of wallets
    // wear a thin gold ring, the bottom fifth grey — inequality readable on the street.
    // Only meaningful with a real spread; tiny towns or flat wealth show no rings.
    const wealth = this.world.residents.map((r) => r.money).sort((x, y) => x - y);
    const n = wealth.length;
    const richAt = n >= 5 ? wealth[Math.min(n - 1, Math.floor(n * 0.8))]! : Infinity;
    const poorAt = n >= 5 ? wealth[Math.floor(n * 0.2)]! : -Infinity;
    const spread = n >= 5 && richAt > poorAt * 1.5;
    const seenR = new Set<string>();
    for (const r of this.world.residents) {
      seenR.add(r.id);
      const isSel = selected?.kind === "resident" && selected.id === r.id;
      let off = { dx: 0, dy: 0 };
      if (r.move.path.length === 0 && r.move.atNodeId) {
        const a = anchorOf(r);
        const g = standing.get(a.key)!;
        const ring =
          g.ids.length > 1 ? fanOutOffset(g.ids.indexOf(r.id), g.ids.length) : { dx: 0, dy: 0 };
        off = { dx: g.x + ring.dx - r.move.x, dy: g.y + ring.dy - r.move.y };
      }
      const tier = !spread ? undefined : r.money >= richAt ? "rich" : r.money <= poorAt ? "poor" : undefined;
      // R3-26 — a dust puff on every set-off and arrival (the moving-state edge).
      const movingNow = r.move.path.length > 0;
      const was = this.prevMoving.get(r.id);
      if (was !== undefined && was !== movingNow && this.puffs.length < 24) {
        this.puffs.push({ x: r.move.x, y: r.move.y, born: performance.now() });
      }
      this.prevMoving.set(r.id, movingNow);
      this.updateResidentView(this.ensureResidentView(r.id), r, isSel, off, tier);
    }
    this.reapResidents(seenR);
    this.updateHover();
    this.updatePuffs();
    this.updateBoat();
    this.updateMintFx();
    this.updateCoins();
    this.updateDirector();

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

    // R3-8 — the hover name tag: a small pill following the cursor over any resident.
    const tag = new Container();
    const tagBg = new Graphics();
    const tagText = new Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: "bold", fill: 0xe6edf3 },
    });
    tagText.anchor.set(0, 0.5);
    tag.addChild(tagBg, tagText);
    tag.visible = false;
    this.hudLayer.addChild(tag);
    this.hoverTag = tag;
    this.hoverTagBg = tagBg;
    this.hoverTagText = tagText;
  }

  /** R3-8 — show name · activity for the resident under the cursor (no click needed). */
  private updateHover(): void {
    const tag = this.hoverTag;
    if (!tag || !this.hoverTagBg || !this.hoverTagText) return;
    if (this.hoverX === undefined || this.hoverY === undefined) {
      tag.visible = false;
      return;
    }
    const hit = this.pick(this.hoverX, this.hoverY);
    if (!hit || hit.kind !== "resident") {
      tag.visible = false;
      return;
    }
    const r = this.world.getResident(hit.id);
    if (!r) {
      tag.visible = false;
      return;
    }
    const label = `${r.name} · ${r.activity}`;
    if (this.hoverTagText.text !== label) {
      this.hoverTagText.text = label;
      const w = this.hoverTagText.width + 12;
      const h = 16;
      this.hoverTagBg
        .clear()
        .roundRect(0, -h / 2, w, h, 4)
        .fill({ color: 0x0e1116, alpha: 0.88 })
        .stroke({ width: 1, color: 0x788296, alpha: 0.6 });
      this.hoverTagText.position.set(6, 0);
    }
    tag.position.set(
      Math.min(this.hoverX + 12, WIDTH - this.hoverTagText.width - 18),
      Math.max(12, this.hoverY - 14),
    );
    tag.visible = true;
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

  /**
   * R3-2 — the two-lane street, built once in white and tinted per frame: a wide asphalt
   * bed, a dashed centre line splitting it into two lanes, and dashed footpaths flanking
   * BOTH sides (sidewalks, so a walker keeping to their right is always on one). Pure
   * one-time geometry from `world.roads` — zero per-frame cost.
   */
  private ensureRoads(): void {
    if (this.roadsBuilt || !this.roadsGfx || !this.laneGfx || !this.pathGfx) return;
    for (const road of this.world.roads) {
      const p = this.world.getNode(road.a);
      const q = this.world.getNode(road.b);
      this.roadsGfx.moveTo(p.x, p.y).lineTo(q.x, q.y);
      // Centre line: short paint dashes down the middle of the bed.
      for (const d of dashes(p.x, p.y, q.x, q.y, 6, 8)) {
        this.laneGfx.moveTo(d.x1, d.y1).lineTo(d.x2, d.y2);
      }
      // Footpaths: long stitched dashes offset to both sides of the asphalt.
      const r = rightOf(q.x - p.x, q.y - p.y);
      for (const side of [1, -1]) {
        const ox = r.x * PATH_OFFSET * side;
        const oy = r.y * PATH_OFFSET * side;
        for (const d of dashes(p.x + ox, p.y + oy, q.x + ox, q.y + oy, 9, 5)) {
          this.pathGfx.moveTo(d.x1, d.y1).lineTo(d.x2, d.y2);
        }
      }
    }
    this.roadsGfx.stroke({ width: ROAD_WIDTH, color: 0xffffff, cap: "round" });
    this.laneGfx.stroke({ width: 1, color: 0xffffff, cap: "butt" });
    this.pathGfx.stroke({ width: 1.5, color: 0xffffff, cap: "round" });

    // R3-5 — a lamp at every crossing, built once: the post stands on the NW corner
    // pavement (opposite the SE kerb where waiting residents gather), its warm pool
    // pooling onto the junction. Pool alpha is driven per frame by the dusk curve.
    if (this.lampPosts && this.lampGlow) {
      for (const n of this.world.nodes) {
        const lx = n.x - (ROAD_WIDTH / 2 + PATH_OFFSET + 1.5);
        const ly = n.y - (ROAD_WIDTH / 2 + PATH_OFFSET + 1.5);
        this.lampPosts.moveTo(lx, ly).lineTo(lx, ly - 11).stroke({ width: 1.5, color: 0xffffff });
        this.lampPosts.circle(lx, ly - 12.5, 2).fill(0xffffff);
        this.lampGlow.ellipse(lx, ly - 1, 11, 6).fill(LAMP_GLOW);
        this.lampGlow.circle(lx, ly - 12.5, 3.5).fill(LAMP_GLOW);
      }
    }
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

    // R4 juice — a soft drop shadow grounds the building on its lot.
    const drop = new Graphics();
    drop.ellipse(2, half + 1, half + 4, 4).fill({ color: 0x000000, alpha: 0.26 });

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

    // R3-4 — the building's identity: a per-kind silhouette (the port's dock + boat, the
    // bank's columns, the mint's coin, the factory chimney…), built once in white and
    // tinted to its colour × ambient each frame. Homes and unknown kinds get none.
    const deco = new Container();
    const bizHere = this.world.businesses.find((b) => b.locationId === loc.id);
    const decoParts = bizHere ? this.buildDeco(deco, bizHere.kind, half) : [];
    // R3-44 — the driveway: a short stub from the lot back to its road crossing, so every
    // set-back building visibly connects to the street. In container space the node sits
    // at the negated lot offset; the stub runs from just outside the wall to the kerb.
    {
      const siblings = this.world.locations.filter((l) => l.nodeId === loc.nodeId);
      const o = lotOffset(siblings.indexOf(loc));
      const drive = new Graphics();
      drive
        .moveTo(-o.dx * 0.5, -o.dy * 0.5)
        .lineTo(-o.dx * 0.82, -o.dy * 0.82)
        .stroke({ width: 3, color: 0xffffff, cap: "round" });
      deco.addChildAt(drive, 0);
      decoParts.push({ g: drive, rgb: [96, 100, 110] });
    }

    // R3-13 — the doorway: storefronts get a warm door slab at the foot of the facade,
    // lit while the shop is staffed during opening hours (built once, toggled per frame).
    let door: Graphics | undefined;
    if (bizHere && (bizHere.kind === "diner" || bizHere.kind === "goods")) {
      door = new Graphics();
      door.rect(-2.5, half - 7, 5, 7).fill(DOOR_GOLD);
      door.visible = false;
      deco.addChild(door);
    }

    // R3-7 — the Zzz wisp for homes, drifting above the roof while the household sleeps.
    let zzz: Text | undefined;
    if (loc.type === "home") {
      zzz = new Text({
        text: "z z",
        style: { fontFamily: "system-ui, sans-serif", fontSize: 9, fontStyle: "italic", fill: 0xbcd0ff },
      });
      zzz.anchor.set(0.5, 1);
      zzz.visible = false;
      deco.addChild(zzz);
    }

    // R3-6 — the posted-wage placard: visible while the firm bids above its base wage,
    // so the labour war is readable on the map instead of buried in the ticker.
    const wageTag = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 9,
        fontWeight: "bold",
        fill: 0xffe09a,
        stroke: { color: 0x0e1116, width: 3 },
      },
    });
    wageTag.anchor.set(0.5, 1);
    wageTag.position.set(0, -half - 9);
    wageTag.visible = false;

    // R4 juice — the firm's pennant: a small flag in the building's own colour on a corner
    // pole, waving gently per frame (wall-clock). Businesses only; homes stay flagless.
    let pennant: Graphics | undefined;
    if (bizHere) {
      pennant = new Graphics();
      pennant.poly([0, 0, 9, 2.5, 0, 5]).fill(0xffffff); // white; day-tinted via decoParts
      pennant.position.set(-half - 1, -half - 12);
      const pole = new Graphics();
      pole.rect(-half - 2, -half - 13, 1.2, 13).fill(0xffffff);
      deco.addChild(pole, pennant);
      decoParts.push({ g: pole, rgb: [150, 156, 168] });
      decoParts.push({ g: pennant, rgb: BUSINESS_RGB[bizHere.kind] ?? [120, 130, 150] });
    }

    container.addChild(drop, glow, base, windows, mask, planks, deco, bar, workers, label, wageTag, selOutline);
    this.buildingsLayer?.addChild(container);

    const view: BuildingView = {
      container,
      glow,
      base,
      windows,
      planks,
      bar,
      fill,
      workers,
      label,
      selOutline,
      decoParts,
      deco,
      wageTag,
      lastWage: "",
      door,
      zzz,
      pennant,
    };
    this.buildingViews.set(loc.id, view);
    return view;
  }

  /**
   * R3-4 — build a kind's silhouette into `deco` and return its tintable parts. Small,
   * legible shapes anchored to the 26px box: civic trio first (the C4 story buildings),
   * then the seeded seven. White geometry; the caller tints colour × ambient per frame.
   */
  private buildDeco(deco: Container, kind: string, half: number): { g: Graphics; rgb: Rgb }[] {
    const parts: { g: Graphics; rgb: Rgb }[] = [];
    const add = (rgb: Rgb, build: (g: Graphics) => void): void => {
      const g = new Graphics();
      build(g);
      deco.addChild(g);
      parts.push({ g, rgb });
    };
    switch (kind) {
      case "port": {
        // The dock: a water patch off the right gable, pier planks reaching to a moored
        // boat — hull, mast, and a little sail. Boom Town's front door, no longer a box.
        add([46, 89, 134], (g) => g.ellipse(half + 13, 6, 13, 7).fill(0xffffff)); // harbour water
        add([122, 88, 50], (g) => {
          for (let i = 0; i < 3; i++) g.rect(half - 1, 1 + i * 4, 9 + i * 2, 2).fill(0xffffff); // pier planks
        });
        add([140, 60, 48], (g) =>
          g.poly([half + 8, 6, half + 20, 6, half + 17, 10, half + 11, 10]).fill(0xffffff),
        ); // hull
        add([200, 200, 210], (g) => {
          g.rect(half + 13, -4, 1.4, 10).fill(0xffffff); // mast
          g.poly([half + 14.5, -4, half + 20, 1, half + 14.5, 1]).fill(0xffffff); // sail
        });
        break;
      }
      case "bank": {
        add([214, 205, 182], (g) => {
          g.poly([-half - 2, -half, half + 2, -half, 0, -half - 8]).fill(0xffffff); // pediment
          for (const cx of [-7, 0, 7]) g.rect(cx - 1.5, -4, 3, half + 2).fill(0xffffff); // columns
        });
        break;
      }
      case "authority": {
        // The mint: a pediment like the bank's plus a coin face — the printing press's home.
        add([214, 205, 182], (g) => g.poly([-half - 2, -half, half + 2, -half, 0, -half - 8]).fill(0xffffff));
        add([212, 175, 55], (g) => {
          g.circle(0, 2, 6).fill(0xffffff);
          g.circle(0, 2, 6).stroke({ width: 1, color: 0x0e1116, alpha: 0.6 });
          g.rect(-1, -1, 2, 6).fill({ color: 0x0e1116, alpha: 0.6 }); // the $ bar of the coin
        });
        break;
      }
      case "factory": {
        add([90, 70, 110], (g) => {
          g.rect(half - 9, -half - 9, 5, 10).fill(0xffffff); // chimney above the roofline
          g.rect(half - 10, -half - 11, 7, 2.5).fill(0xffffff); // crown
        });
        break;
      }
      case "mine": {
        add([150, 130, 90], (g) => {
          g.moveTo(-8, -half + 2).lineTo(0, -half - 9).stroke({ width: 2, color: 0xffffff }); // pithead A-frame
          g.moveTo(8, -half + 2).lineTo(0, -half - 9).stroke({ width: 2, color: 0xffffff });
          g.circle(0, -half - 9, 2.5).stroke({ width: 1.5, color: 0xffffff }); // the wheel
        });
        break;
      }
      case "farm":
      case "orchard": {
        add([95, 150, 70], (g) => {
          for (let i = 0; i < 3; i++) {
            g.moveTo(-half - 12, -2 + i * 5).lineTo(-half - 2, -2 + i * 5).stroke({ width: 2, color: 0xffffff }); // field rows
          }
        });
        break;
      }
      case "bakery": {
        add([205, 140, 90], (g) => {
          for (let i = 0; i < 4; i++) g.rect(-half + 1 + i * 6.5, -half - 3, 4.5, 4).fill(0xffffff); // striped awning
        });
        break;
      }
      case "diner": {
        add([220, 90, 80], (g) => {
          g.rect(half - 2, -half - 7, 1.5, 7).fill(0xffffff); // sign post
          g.circle(half - 1, -half - 9, 3.5).fill(0xffffff); // the diner sign
        });
        break;
      }
      case "goods": {
        add([90, 140, 210], (g) => {
          g.rect(-half + 2, -half - 5, 12, 4).fill(0xffffff); // shop fascia board
        });
        break;
      }
      default:
        break; // landlord, bank-less homes, unknown data-driven kinds: the plain box stands
    }
    return parts;
  }

  private updateBuildingView(
    v: BuildingView,
    biz: Business | undefined,
    litFraction: number,
    homeWindows: number | undefined,
    sleepers: number,
    a: number,
    glow: number,
    glowHome: number,
    openNow: boolean,
    isSelected: boolean,
  ): void {
    if (biz && !biz.active) {
      v.base.tint = dimInt(CLOSED_RGB, a);
      v.planks.tint = dimInt(PLANK_RGB, a);
      v.planks.visible = true;
      v.windows.visible = false;
      v.deco.visible = false; // a shuttered firm loses its dressing — just boards
    } else {
      const baseRgb = biz ? BUSINESS_RGB[biz.kind] ?? BUSINESS_RGB_DEFAULT : HOME_RGB;
      v.base.tint = dimInt(baseRgb, a);
      v.planks.visible = false;
      if (homeWindows !== undefined) {
        // R3-1 — presence-driven home lights: one window per person inside (capped at
        // the 2×2 grid), full gold once dusk settles, dark when the house is empty.
        // No alpha floor — occupied vs empty reads as ON vs OFF.
        const n = Math.min(homeWindows, v.windows.children.length);
        v.windows.visible = glowHome > 0.02 && n > 0;
        v.windows.alpha = glowHome;
        v.windows.children.forEach((w, i) => {
          w.visible = i < n;
        });
      } else {
        const lit = glow * (0.12 + 0.88 * Math.max(0, Math.min(1, litFraction)));
        v.windows.visible = lit > 0.02;
        v.windows.alpha = lit;
        v.windows.children.forEach((w) => {
          w.visible = true; // workplaces keep the whole grid (ambient office light)
        });
      }
    }
    v.label.tint = dimInt(LABEL_RGB, Math.max(a, 0.7));
    v.selOutline.visible = isSelected;
    // R3-4 — silhouette parts follow the daylight like the building itself.
    if (!(biz && !biz.active)) {
      v.deco.visible = true;
      for (const p of v.decoParts) p.g.tint = dimInt(p.rgb, a);
    }
    // R4 juice — the pennant waves on the wall-clock breeze.
    if (v.pennant) {
      v.pennant.rotation = Math.sin(performance.now() / 600 + v.pennant.position.x) * 0.16;
    }
    // R3-7 — the Zzz wisp: drifts and breathes over a home whose occupants are asleep
    // after dark. Wall-clock motion (like the bubble fade) — presentation only.
    if (v.zzz) {
      const show = sleepers > 0 && glowHome > 0.3;
      v.zzz.visible = show;
      if (show) {
        const now = performance.now();
        v.zzz.position.set(5 + Math.sin(now / 900) * 1.5, -BUILDING / 2 - 4 - Math.sin(now / 700) * 2);
        v.zzz.alpha = 0.55 + 0.25 * Math.sin(now / 850);
      }
    }
    // Visual economic state (R3): prosperity glow (capital), inventory bar, worker
    // figures (headcount) — active firms only; homes + shuttered show none.
    if (biz && biz.active) {
      const t = prosperityT(biz.capital ?? CAPITAL_BASELINE, CAPITAL_BASELINE);
      v.glow.visible = t > 0.02;
      v.glow.alpha = t * 0.55;
      v.glow.scale.set(0.6 + 0.7 * t);
      // R3-19 — prosperity in the architecture: a capital-rich firm's building grows up
      // to ~18% larger; one sliding toward insolvency visibly dims before the boards.
      v.base.scale.set(1 + 0.18 * t);
      if ((biz.insolventDays ?? 0) > 0) v.base.tint = dimInt(BUSINESS_RGB[biz.kind] ?? BUSINESS_RGB_DEFAULT, a * 0.7);
      v.bar.visible = true;
      v.fill.scale.x = fillFraction(biz.inventory, FILL_FULL_INVENTORY);
      const crew = Math.min(biz.employeeIds.length, v.workers.children.length);
      v.workers.children.forEach((c, i) => {
        c.visible = i < crew;
      });
      // R3-13 — the doorway lamp: warm while the shop is staffed during trading hours,
      // brighter as the evening darkens; dark when unstaffed (a different signal from
      // bankruptcy boards: "nobody's serving" vs "gone for good").
      if (v.door) {
        const staffed = biz.employeeIds.length > 0;
        v.door.visible = staffed && openNow;
        v.door.alpha = 0.45 + 0.55 * glow;
      }
      // R3-6 — the posted-wage placard: shown while the firm bids above its base wage,
      // so a labour war reads on the map (rival placards leapfrogging each other).
      const baseWage = biz.baseWagePerTick ?? biz.wagePerTick;
      const bidding = baseWage > 0 && biz.wagePerTick > baseWage * 1.02;
      if (bidding) {
        const tag = `$${biz.wagePerTick.toFixed(2)}/t`;
        if (tag !== v.lastWage) {
          v.wageTag.text = tag;
          v.lastWage = tag;
        }
      }
      v.wageTag.visible = bidding;
    } else {
      v.glow.visible = false;
      v.bar.visible = false;
      v.workers.children.forEach((c) => {
        c.visible = false;
      });
      v.wageTag.visible = false;
      if (v.door) v.door.visible = false;
    }
  }

  /**
   * R3-26 — draw/expire the arrival puffs: each is a ring that grows from 2 to 7 px and
   * fades over 600ms of wall-clock. Pooled Graphics, redrawn per frame (≤ 24 alive).
   */
  private updatePuffs(): void {
    if (!this.puffLayer) return;
    const now = performance.now();
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      if (now - this.puffs[i]!.born > 600) this.puffs.splice(i, 1);
    }
    for (let i = 0; i < this.puffs.length; i++) {
      let g = this.puffPool[i];
      if (!g) {
        g = new Graphics();
        this.puffLayer.addChild(g);
        this.puffPool[i] = g;
      }
      const p = this.puffs[i]!;
      const t = Math.min(1, (now - p.born) / 600);
      g.clear();
      g.circle(p.x, p.y, 2 + 5 * t).stroke({ width: 1.2, color: 0xc9d1d9, alpha: 0.5 * (1 - t) });
      g.visible = true;
    }
    for (let i = this.puffs.length; i < this.puffPool.length; i++) this.puffPool[i]!.visible = false;
  }

  /**
   * R3-14 — the trade boat: whenever the city's cumulative trade tally rises (an export
   * sold or an import landed — read-only off every firm's P&L), a sailing launches at the
   * port: glide in from open water, sit at the pier, glide out. Wall-clock animation, a
   * fresh trade day re-launches it — so busy trade reads as a busy harbour, and a dead
   * port means still water. Hidden entirely in portless cities.
   */
  private updateBoat(): void {
    const boat = this.boatC;
    if (!boat) return;
    const portBiz = this.world.businesses.find((b) => b.id === "biz_port");
    const portLoc = portBiz
      ? this.world.locations.find((l) => l.id === portBiz.locationId)
      : undefined;
    if (!portBiz || !portLoc) {
      boat.visible = false;
      return;
    }
    let total = 0;
    for (const b of this.world.businesses) {
      total += (b.pnl.exportRevenue ?? 0) + (b.pnl.importSpend ?? 0);
    }
    if (this.lastTradeTotal === undefined) {
      this.lastTradeTotal = total; // first observation (fresh build or a Load) — no sailing
    } else if (total > this.lastTradeTotal + 1e-9) {
      this.lastTradeTotal = total;
      this.sailStart = performance.now(); // trade happened — (re)launch the sailing
    }
    const IN = 4000;
    const DOCK = 3000;
    const OUT = 4000;
    const t = performance.now() - this.sailStart;
    if (this.sailStart === 0 || t > IN + DOCK + OUT) {
      boat.visible = false;
      return;
    }
    const slot = this.buildingSlot(portLoc);
    const farX = slot.x + 64;
    const farY = slot.y + 22;
    const pierX = slot.x + BUILDING / 2 + 14;
    const pierY = slot.y + 9;
    const ease = (k: number): number => k * k * (3 - 2 * k);
    let x: number;
    let y: number;
    if (t < IN) {
      const k = ease(t / IN);
      x = farX + (pierX - farX) * k;
      y = farY + (pierY - farY) * k;
    } else if (t < IN + DOCK) {
      x = pierX;
      y = pierY + Math.sin(performance.now() / 400) * 0.8; // bobbing at the pier
    } else {
      const k = ease((t - IN - DOCK) / OUT);
      x = pierX + (farX - pierX) * k;
      y = pierY + (farY - pierY) * k;
    }
    boat.position.set(x, y);
    boat.visible = true;
  }

  /**
   * R3-16 — fresh-coin sparks at the City Reserve: whenever the audited mint ledger rises,
   * eight golden sparks burst from the building and drift outward/up over 1.4s — printed
   * money visibly entering the world. Anchored to the authority's lot; absent in cities
   * with no authority; a Load re-anchors the baseline without a phantom burst.
   */
  private updateMintFx(): void {
    const fx = this.mintFx;
    if (!fx) return;
    const minted = this.world.mintedTotal();
    if (this.lastMinted === undefined) {
      this.lastMinted = minted;
    } else if (minted > this.lastMinted + 1e-9) {
      this.lastMinted = minted;
      this.mintStart = performance.now();
    }
    const LIFE = 1400;
    const t = this.mintStart === 0 ? 1 : (performance.now() - this.mintStart) / LIFE;
    if (t >= 1) {
      fx.visible = false;
      return;
    }
    const authority = this.world.businesses.find((b) => b.id === "biz_authority");
    const loc = authority
      ? this.world.locations.find((l) => l.id === authority.locationId)
      : undefined;
    if (!loc) {
      fx.visible = false;
      return;
    }
    const slot = this.buildingSlot(loc);
    fx.clear();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.4;
      const r = 6 + 18 * t;
      const x = slot.x + Math.cos(ang) * r;
      const y = slot.y - 4 + Math.sin(ang) * r * 0.6 - 10 * t; // drifting upward
      fx.circle(x, y, 1.6).fill({ color: 0xf2c84b, alpha: 0.9 * (1 - t) });
    }
    fx.visible = true;
  }

  /**
   * R4 juice — coin particles on real sales: diff every active firm's revenue tally between
   * frames; each increase floats a gold coin off its storefront (spawn-capped per frame so a
   * 1000x fast-forward doesn't bury the map; alive-capped via the pool). First observation
   * anchors silently, so a Load never showers phantom coins.
   */
  private updateCoins(): void {
    if (!this.coinLayer) return;
    const now = performance.now();
    if (!this.consumersOf) {
      // Built once from the industry registry (static data): resource → consumer kinds.
      this.consumersOf = new Map();
      for (const def of INDUSTRY_REGISTRY) {
        if (!def.consumes) continue;
        const list = this.consumersOf.get(def.consumes) ?? [];
        list.push(def.kind);
        this.consumersOf.set(def.consumes, list);
      }
    }
    let spawned = 0;
    for (const b of this.world.businesses) {
      const prev = this.lastRevenue.get(b.id);
      if (prev === undefined) {
        this.lastRevenue.set(b.id, b.pnl.revenue);
        continue;
      }
      if (b.pnl.revenue > prev + 0.5 && b.active && spawned < 4 && this.coins.length < 28) {
        const loc = this.world.locations.find((l) => l.id === b.locationId);
        if (loc) {
          const slot = this.buildingSlot(loc);
          const def = INDUSTRY_REGISTRY.find((d) => d.kind === b.kind);
          if (def && !def.sellsToResidents && def.produces) {
            // B2B settlement (the nightly market clear): the money came FROM the firms that
            // consume this producer's output — glide a coin from each buyer to the producer.
            const buyers = this.consumersOf.get(def.produces) ?? [];
            for (const kind of buyers) {
              const buyer = this.world.businesses.find((x) => x.kind === kind && x.active);
              const bLoc = buyer
                ? this.world.locations.find((l) => l.id === buyer.locationId)
                : undefined;
              if (bLoc && this.coins.length < 28) {
                const from = this.buildingSlot(bLoc);
                this.coins.push({ x: from.x, y: from.y - BUILDING / 2, tx: slot.x, ty: slot.y - BUILDING / 2, born: now });
                spawned++;
              }
            }
          } else {
            // Retail sale: a coin floats off the storefront the moment the dollar lands.
            const j = (this.coins.length * 7) % 10;
            this.coins.push({ x: slot.x - 5 + j, y: slot.y - BUILDING / 2, born: now });
            spawned++;
          }
        }
      }
      this.lastRevenue.set(b.id, b.pnl.revenue);
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const life = this.coins[i]!.tx !== undefined ? 1300 : 900;
      if (now - this.coins[i]!.born > life) this.coins.splice(i, 1);
    }
    for (let i = 0; i < this.coins.length; i++) {
      let g = this.coinPool[i];
      if (!g) {
        g = new Graphics();
        g.circle(0, 0, 2.2).fill(0xf2c84b);
        g.circle(0, 0, 2.2).stroke({ width: 0.7, color: 0xa87b1d });
        this.coinLayer.addChild(g);
        this.coinPool[i] = g;
      }
      const c = this.coins[i]!;
      if (c.tx !== undefined && c.ty !== undefined) {
        // Glide: ease across town from buyer to producer, a gentle arc, fading at the end.
        const t = Math.min(1, (now - c.born) / 1300);
        const k = t * t * (3 - 2 * t);
        g.position.set(c.x + (c.tx - c.x) * k, c.y + (c.ty - c.y) * k - Math.sin(t * Math.PI) * 9);
        g.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      } else {
        const t = (now - c.born) / 900;
        g.position.set(c.x, c.y - 16 * t);
        g.alpha = 1 - t;
      }
      g.visible = true;
    }
    for (let i = this.coins.length; i < this.coinPool.length; i++) this.coinPool[i]!.visible = false;
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

    // R3-3 — the car: a small top-down hull (white, tinted by activity) with dark wheel
    // nubs and a windshield band near the nose. Built nose-toward-+x; rotated to heading.
    const car = new Container();
    const carBody = new Graphics();
    carBody.roundRect(-6, -3, 12, 6, 2).fill(0xffffff);
    carBody.stroke({ width: 1, color: 0x000000, alpha: 0.5 });
    const wheels = new Graphics();
    for (const [wx, wy] of [[-3.5, -3.4], [3.5, -3.4], [-3.5, 3.4], [3.5, 3.4]] as const) {
      wheels.rect(wx - 1.2, wy - 0.8, 2.4, 1.6).fill(0x14161c);
    }
    const windshield = new Graphics();
    windshield.rect(1, -2.2, 2.2, 4.4).fill({ color: 0x0e1116, alpha: 0.5 });
    car.addChild(wheels, carBody, windshield);
    car.visible = false;

    // R3-3 — the walker: a tiny figure (head + torso, tinted by activity) for the footpath.
    const walker = new Container();
    const walkerG = new Graphics();
    walkerG.circle(0, -3.5, 1.9).fill(0xffffff);
    walkerG.moveTo(0, -1.6).lineTo(0, 2.8).stroke({ width: 2.2, color: 0xffffff, cap: "round" });
    const walkerOutline = new Graphics();
    walkerOutline.circle(0, -3.5, 2.4).stroke({ width: 0.8, color: 0x000000, alpha: 0.4 });
    walker.addChild(walkerOutline, walkerG);
    walker.visible = false;

    // R3-9 — wealth-tier rings: a thin gold halo for the top tier, grey for the bottom,
    // so the Gini card's inequality is readable person-by-person on the street.
    const ringGold = new Graphics();
    ringGold.circle(0, 0, DOT_RADIUS + 1.8).stroke({ width: 1.2, color: 0xf2c84b });
    ringGold.visible = false;
    const ringGrey = new Graphics();
    ringGrey.circle(0, 0, DOT_RADIUS + 1.8).stroke({ width: 1.2, color: 0x8a8f98, alpha: 0.8 });
    ringGrey.visible = false;

    const selGlow = new Graphics();
    selGlow.circle(0, 0, DOT_RADIUS + 3).stroke({ width: 2, color: 0xffffff });
    selGlow.visible = false;
    container.addChild(shadow, tick, car, walker, dot, ringGold, ringGrey, selGlow);
    this.residentsLayer?.addChild(container);
    const view: ResidentView = {
      container,
      shadow,
      tick,
      dot,
      car,
      carBody,
      walker,
      walkerG,
      ringGold,
      ringGrey,
      selGlow,
      offX: 0,
      offY: 0,
    };
    this.residentViews.set(id, view);
    return view;
  }

  private updateResidentView(
    v: ResidentView,
    r: Resident,
    isSelected: boolean,
    off: { dx: number; dy: number },
    tier: "rich" | "poor" | undefined,
  ): void {
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

    const moving = r.move.path.length > 0;
    if (moving) {
      // R3-3 — travellers show as traffic: a car in its right-hand lane, or a walker on
      // the footpath to their right (both offsets from roadGeometry, so two residents
      // passing each other keep to their own sides). The bob is wall-clock presentation
      // (like the bubble fade) — it never touches sim state.
      const next = this.world.getNode(r.move.path[0]!);
      const dx = next.x - r.move.x;
      const dy = next.y - r.move.y;
      const right = rightOf(dx, dy);
      if (r.hasVehicle) {
        const ox = right.x * LANE_OFFSET;
        const oy = right.y * LANE_OFFSET;
        v.offX = ox;
        v.offY = oy;
        v.container.position.set(r.move.x + ox, r.move.y + oy);
        v.car.rotation = Math.atan2(dy, dx);
        v.carBody.tint = ACTIVITY_INT[r.activity];
        v.car.visible = true;
        v.walker.visible = false;
      } else {
        const bob = Math.sin(performance.now() / 130) * 0.7;
        const ox = right.x * PATH_OFFSET;
        const oy = right.y * PATH_OFFSET + bob;
        v.offX = ox;
        v.offY = oy;
        v.container.position.set(r.move.x + ox, r.move.y + oy);
        v.walkerG.tint = ACTIVITY_INT[r.activity];
        v.walker.visible = true;
        v.car.visible = false;
      }
      v.dot.visible = false;
      v.tick.visible = false;
      v.ringGold.visible = false; // rings read on dots; traffic stays clean
      v.ringGrey.visible = false;
    } else {
      // Standing: the classic activity dot (with the co-located fan-out ring).
      v.offX = off.dx;
      v.offY = off.dy;
      v.container.position.set(r.move.x + off.dx, r.move.y + off.dy);
      v.dot.tint = ACTIVITY_INT[r.activity];
      v.dot.visible = true;
      v.car.visible = false;
      v.walker.visible = false;
      v.tick.visible = false;
      v.ringGold.visible = tier === "rich";
      v.ringGrey.visible = tier === "poor";
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

  /**
   * Verbatim port of the canvas building slot (R3-44 — corner lots): each building pulls
   * diagonally into one of its intersection's four corner lots, co-located buildings to
   * DIFFERENT corners. Render-only — the node, and all economics, are untouched.
   */
  private buildingSlot(loc: Location): { x: number; y: number; line: number } {
    const node = this.world.getNode(loc.nodeId);
    const siblings = this.world.locations.filter((l) => l.nodeId === loc.nodeId);
    const i = siblings.indexOf(loc);
    const o = lotOffset(i);
    return { x: node.x + o.dx, y: node.y + o.dy, line: i };
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

  /** R4 wave 6 — point the director's camera at a firm for `holdMs` (default 5s). */
  directToBusiness(bizId: string, holdMs = 5000, zoom = 1.55): void {
    const biz = this.world.getBusiness(bizId);
    const loc = biz ? this.world.locations.find((l) => l.id === biz.locationId) : undefined;
    if (!loc) return;
    const slot = this.buildingSlot(loc);
    this.directTarget = { x: slot.x, y: slot.y, zoom, until: performance.now() + holdMs };
  }

  /**
   * Per-frame director easing: glide toward the target (or home to the full view once the
   * hold expires). Suspended while the viewer drove the camera in the last 8s, or while
   * follow-selected mode owns it.
   */
  private updateDirector(): void {
    const now = performance.now();
    if (this.follow || now - this.lastUserCamMs < 8000) return;
    let wantScale = 1;
    let wantTx = 0;
    let wantTy = 0;
    if (this.directTarget && now < this.directTarget.until) {
      wantScale = this.directTarget.zoom;
      // centre the target in the 640×480 logical viewport at that zoom
      wantTx = WIDTH / 2 - this.directTarget.x * wantScale;
      wantTy = HEIGHT / 2 - this.directTarget.y * wantScale;
    } else if (this.directTarget && now >= this.directTarget.until + 600) {
      this.directTarget = undefined; // brief grace, then the home glide below owns it
    }
    const k = 0.06; // ease factor per frame — cinematic, not snappy
    this.cam.scale += (wantScale - this.cam.scale) * k;
    this.cam.tx += (wantTx - this.cam.tx) * k;
    this.cam.ty += (wantTy - this.cam.ty) * k;
    this.clampCamera();
    this.applyCamera();
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
      const p = toCanvas(e);
      // R3-8 — track the cursor for the hover tag (read per frame in updateHover).
      this.hoverX = p.x;
      this.hoverY = p.y;
      if (!dragging) return;
      this.lastUserCamMs = performance.now(); // the viewer outranks the director (R4 w6)
      this.cam.tx += p.x - lastX;
      this.cam.ty += p.y - lastY;
      lastX = p.x;
      lastY = p.y;
      this.clampCamera();
      this.applyCamera();
    });
    c.addEventListener("pointerleave", () => {
      this.hoverX = undefined;
      this.hoverY = undefined;
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = toCanvas(e);
        const w = screenToWorld(p.x, p.y, this.cam);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.lastUserCamMs = performance.now(); // the viewer outranks the director (R4 w6)
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
      this.directTarget = undefined; // double-click also dismisses the director's shot
      this.lastUserCamMs = performance.now();
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
