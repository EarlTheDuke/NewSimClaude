import type { World } from "../world/World";
import type { Activity, BusinessKind, Business, Resident, Location } from "../world/types";
import type { DisasterKind } from "../systems/disasters";
import { skyColor, ambient, windowGlow, dim, hexToRgb, type Rgb } from "./daynight";
import type { CityRenderer } from "./CityRenderer";

export const ACTIVITY_COLOR: Record<Activity, string> = {
  sleeping: "#5b6ee1",
  working: "#5bd16e",
  eating: "#e1a35b",
  socializing: "#e15bc8",
  commuting: "#e1d65b",
  idle: "#9aa0a6",
};

const BUSINESS_HEX: Record<BusinessKind, string> = {
  diner: "#7a4a1f",
  goods: "#1f4a7a",
  landlord: "#4a4a4a",
  farm: "#3f6e2a",
  mine: "#6e5a2a",
  bakery: "#8a5a2f",
  factory: "#5a2f6e",
};

export const BUSINESS_RGB = Object.fromEntries(
  Object.entries(BUSINESS_HEX).map(([k, v]) => [k, hexToRgb(v)]),
) as Record<BusinessKind, Rgb>;

// Shared rendering palette/geometry — exported so the Pixi renderer (R2) reproduces
// the exact same colours and sizes for parity. The canvas renderer is their origin.
export const HOME_RGB = hexToRgb("#3a3320");
export const ROAD_RGB: Rgb = [43, 47, 58]; // #2b2f3a
export const CLOSED_RGB: Rgb = [46, 46, 52];
export const LABEL_RGB: Rgb = [174, 180, 189];

export const BUILDING = 26;
export const DOT_RADIUS = 5;
/** Horizontal fan-out for buildings that share one map node (a strip mall). */
export const COLOCATE_DX = 34;

/** Per-kind glyph + accent colour for the on-canvas disaster marker. */
export const DISASTER_STYLE: Record<DisasterKind, { color: string; glyph: string }> = {
  fire: { color: "#e0533a", glyph: "!" },
  festival: { color: "#e1d65b", glyph: "*" },
  illness: { color: "#5bd1c0", glyph: "+" },
  supplyShock: { color: "#d29922", glyph: "$" },
  grant: { color: "#2ea043", glyph: "$" },
};

export interface Pick {
  kind: "resident" | "business";
  id: string;
}

/** The disaster the renderer should flag this frame (today's headline). */
export interface DisasterMarker {
  kind: DisasterKind;
  headline: string;
  targetId?: string;
}

/**
 * A floating "thought bubble" over a business — its latest decision, shown the
 * moment its brain decides and fading out. `alpha` is a presentation-only fade
 * (0..1) computed from wall-clock in the view layer; it never touches sim state.
 */
export interface ThoughtBubble {
  businessId: string;
  text: string;
  alpha: number;
}

/**
 * A floating "map toast" — a short glyph (👶 birth, 🧳 arrival, 🎓 came of age,
 * 🏠 home built, 🕯️ a parting) that pops at a world position and floats up as it
 * fades. Position is in WORLD coordinates; `alpha` is a view-layer fade (0..1). Pure
 * presentation — never touches sim state.
 */
export interface MapToast {
  x: number;
  y: number;
  text: string;
  alpha: number;
}

/**
 * Read-only view of the world: roads, buildings, and residents painted onto the
 * canvas. Phase 5 makes it breathe — the whole scene is tinted and dimmed by
 * the hour of day, and buildings light their windows after dark in proportion
 * to how many residents are home. It never mutates the simulation.
 */
export class CanvasRenderer implements CityRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CanvasRenderer: 2D context unavailable");
    this.ctx = ctx;
  }

  /** Paint a frame for the given hour of day (0..24, fractional for smoothness). */
  draw(hourFloat: number, selected?: Pick, disaster?: DisasterMarker, bubbles?: ThoughtBubble[]): void {
    const { ctx, canvas, world } = this;
    const a = ambient(hourFloat);
    const glow = windowGlow(hourFloat);

    ctx.fillStyle = skyColor(hourFloat);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Roads — dim toward black as ambient light falls.
    ctx.strokeStyle = dim(ROAD_RGB, a);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const road of world.roads) {
      const p = world.getNode(road.a);
      const q = world.getNode(road.b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }

    // Buildings — dimmed by ambient, windows lit by night occupancy.
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const loc of world.locations) {
      const slot = this.buildingSlot(loc);
      const biz = world.businesses.find((b) => b.locationId === loc.id);
      this.drawBuilding(slot.x, slot.y, biz, this.occupantsAt(loc.nodeId), a, glow);
      if (biz && selected?.kind === "business" && selected.id === biz.id) {
        this.outlineBuilding(slot.x, slot.y);
      }
      ctx.fillStyle = dim(LABEL_RGB, Math.max(a, 0.7));
      ctx.fillText(loc.name, slot.x, slot.y + BUILDING / 2 + 11 + slot.line * 11);
    }

    // Residents — colour by activity, with shadow, heading tick, selection glow.
    for (const r of world.residents) {
      this.drawResident(r, selected?.kind === "resident" && selected.id === r.id);
    }

    this.drawLegend();
    this.drawSky(hourFloat);
    if (disaster) this.drawDisaster(disaster);
    if (bubbles && bubbles.length > 0) this.drawThoughtBubbles(bubbles);
  }

  /**
   * Decision narration (Phase R1): a fading callout over each business that just
   * decided, showing the lever(s) it pulled. Placed above the building, drawn last
   * so it sits over everything. Pure read-only paint — the bubble list + fade are
   * computed in the view layer.
   */
  private drawThoughtBubbles(bubbles: ThoughtBubble[]): void {
    for (const b of bubbles) {
      if (b.alpha <= 0.02) continue;
      const pos = this.locateTarget(b.businessId);
      if (pos) this.drawBubble(pos.x, pos.y - BUILDING / 2 - 6, b.text, b.alpha);
    }
  }

  /** One rounded callout with a downward tail, its text fitted to a max width. */
  private drawBubble(cx: number, anchorY: number, text: string, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padX = 7;
    const h = 18;
    const label = this.fitText(text, 172);
    const w = ctx.measureText(label).width + padX * 2;
    const x = cx - w / 2;
    const y = anchorY - h;

    this.roundRectPath(x, y, w, h, 5);
    ctx.fillStyle = "rgba(14, 17, 22, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 4, y + h);
    ctx.lineTo(cx + 4, y + h);
    ctx.lineTo(cx, y + h + 5);
    ctx.closePath();
    ctx.fillStyle = "rgba(14, 17, 22, 0.9)";
    ctx.fill();

    ctx.fillStyle = "#e6edf3";
    ctx.fillText(label, cx, y + h / 2 + 0.5);
    ctx.restore();
  }

  /** Trace a rounded-rect path (arcTo — universally supported). */
  private roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Truncate `text` with an ellipsis so it fits within `maxW` at the current font. */
  private fitText(text: string, maxW: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  private drawResident(r: Resident, isSelected: boolean): void {
    const { ctx } = this;
    const { x, y } = r.move;

    // Soft contact shadow grounds the dot on the map.
    ctx.beginPath();
    ctx.ellipse(x, y + DOT_RADIUS + 1, DOT_RADIUS, DOT_RADIUS * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();

    // Heading tick toward the next node while commuting.
    if (r.move.path.length > 0) {
      const next = this.world.getNode(r.move.path[0]!);
      const dx = next.x - x;
      const dy = next.y - y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = "rgba(225, 214, 91, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (dx / len) * 9, y + (dy / len) * 9);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ACTIVITY_COLOR[r.activity];
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.stroke();

    if (isSelected) {
      ctx.save();
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Activity colour key, bottom-left, over a translucent backdrop. */
  private drawLegend(): void {
    const { ctx, canvas } = this;
    const items = Object.entries(ACTIVITY_COLOR) as [Activity, string][];
    const lineH = 13;
    const padX = 8;
    const padY = 6;
    const sw = 8;
    const boxW = 96;
    const boxH = padY * 2 + items.length * lineH;
    const x = 8;
    const y = canvas.height - 8 - boxH;

    ctx.save();
    ctx.fillStyle = "rgba(14, 17, 22, 0.66)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = "rgba(120, 130, 150, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "10px system-ui, sans-serif";
    items.forEach(([act, color], i) => {
      const cy = y + padY + i * lineH + lineH / 2;
      ctx.fillStyle = color;
      ctx.fillRect(x + padX, cy - sw / 2, sw, sw);
      ctx.fillStyle = "#c9d1d9";
      ctx.fillText(act, x + padX + sw + 6, cy);
    });
    ctx.restore();
  }

  /** A sun or moon badge, top-right, crossfading by time of day. */
  private drawSky(hourFloat: number): void {
    const { ctx, canvas } = this;
    const day = 1 - windowGlow(hourFloat); // 0 at night, 1 at noon
    const cx = canvas.width - 30;
    const cy = 30;
    const rad = 10;

    if (day < 0.98) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 1 - day + 0.02);
      ctx.fillStyle = "#dfe6f2";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(120, 130, 150, 0.5)";
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 3, cy + 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (day > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, day + 0.02);
      ctx.strokeStyle = "#ffcf6b";
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * (rad + 3), cy + Math.sin(ang) * (rad + 3));
        ctx.lineTo(cx + Math.cos(ang) * (rad + 7), cy + Math.sin(ang) * (rad + 7));
        ctx.stroke();
      }
      ctx.shadowColor = "#ffd27a";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private occupantsAt(nodeId: string): number {
    let n = 0;
    for (const r of this.world.residents) if (r.move.atNodeId === nodeId) n++;
    return n;
  }

  /**
   * Where a building actually paints. Most nodes hold one building, which sits
   * dead-centre on its node (dx = 0) exactly as before. When two businesses
   * share a node — the strip mall (Maker Goods + Riverside Diner) or the
   * factory/mine pair — they fan apart horizontally so both are visible and
   * separately clickable, and the slot index stacks their labels so the names
   * don't overprint. Render-only: the node itself is untouched, so every
   * distance and all the economics are exactly as before.
   */
  private buildingSlot(loc: Location): { x: number; y: number; line: number } {
    const node = this.world.getNode(loc.nodeId);
    const siblings = this.world.locations.filter((l) => l.nodeId === loc.nodeId);
    const i = siblings.indexOf(loc);
    const dx = (i - (siblings.length - 1) / 2) * COLOCATE_DX;
    return { x: node.x + dx, y: node.y, line: i };
  }

  private drawBuilding(
    cx: number,
    cy: number,
    biz: Business | undefined,
    occupants: number,
    a: number,
    glow: number,
  ): void {
    const { ctx } = this;
    const half = BUILDING / 2;
    const x = cx - half;
    const y = cy - half;

    if (biz && !biz.active) {
      // Shuttered: a dark box with boarded-up diagonal planks.
      ctx.fillStyle = dim(CLOSED_RGB, a);
      ctx.fillRect(x, y, BUILDING, BUILDING);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, BUILDING, BUILDING);
      ctx.clip();
      ctx.strokeStyle = dim([84, 84, 92], a);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let o = -BUILDING; o <= BUILDING; o += 7) {
        ctx.moveTo(x + o, y);
        ctx.lineTo(x + o + BUILDING, y + BUILDING);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    const base: Rgb = biz ? BUSINESS_RGB[biz.kind] : HOME_RGB;
    ctx.fillStyle = dim(base, a);
    ctx.fillRect(x, y, BUILDING, BUILDING);

    // Lit windows: scaled by how dark it is and how many residents are here.
    const lit = glow * (0.12 + 0.88 * (Math.min(occupants, 3) / 3));
    if (lit <= 0.02) return;
    const wsize = 6;
    const gap = 4;
    const span = 2 * wsize + gap;
    const ox = x + (BUILDING - span) / 2;
    const oy = y + (BUILDING - span) / 2;
    ctx.fillStyle = `rgba(255, 209, 122, ${lit.toFixed(3)})`;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillRect(ox + col * (wsize + gap), oy + row * (wsize + gap), wsize, wsize);
      }
    }
  }

  private outlineBuilding(cx: number, cy: number): void {
    const { ctx } = this;
    const half = BUILDING / 2;
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - half - 2, cy - half - 2, BUILDING + 4, BUILDING + 4);
    ctx.restore();
  }

  /**
   * Flag today's disaster: a colour-coded badge over the affected building or
   * resident (when the target has a place on the map), plus a headline banner
   * across the top so city-wide and resource shocks are still legible.
   */
  private drawDisaster(marker: DisasterMarker): void {
    const style = DISASTER_STYLE[marker.kind];
    const pos = this.locateTarget(marker.targetId);

    if (pos) {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, BUILDING / 2 + 6, 0, Math.PI * 2);
      ctx.stroke();

      const bx = pos.x;
      const by = pos.y - BUILDING / 2 - 13;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0e1116";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(style.glyph, bx, by);
      ctx.restore();
    }

    this.drawDisasterBanner(marker.headline, style.color);
  }

  /** Resolve a disaster target id to a canvas position (building or resident). */
  private locateTarget(targetId?: string): { x: number; y: number } | undefined {
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

  /** Top-of-canvas headline banner for the current disaster. */
  private drawDisasterBanner(text: string, color: string): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.min(canvas.width - 40, ctx.measureText(text).width + 32);
    const h = 22;
    const x = (canvas.width - w) / 2;
    const y = 8;
    ctx.fillStyle = "rgba(14, 17, 22, 0.82)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 12, y + h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(text, x + w / 2 + 8, y + h / 2);
    ctx.restore();
  }

  /** Map a canvas-space click to a resident (preferred) or a building. */
  pick(x: number, y: number): Pick | undefined {
    const { world } = this;
    let best: { id: string; d: number } | undefined;
    for (const r of world.residents) {
      const d = Math.hypot(r.move.x - x, r.move.y - y);
      if (d <= DOT_RADIUS + 4 && (!best || d < best.d)) best = { id: r.id, d };
    }
    if (best) return { kind: "resident", id: best.id };

    for (const loc of world.locations) {
      const slot = this.buildingSlot(loc);
      const half = BUILDING / 2;
      if (Math.abs(slot.x - x) <= half && Math.abs(slot.y - y) <= half) {
        const biz = world.businesses.find((b) => b.locationId === loc.id);
        if (biz) return { kind: "business", id: biz.id };
      }
    }
    return undefined;
  }
}
