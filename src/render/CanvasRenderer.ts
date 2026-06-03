import type { World } from "../world/World";
import type { Activity, BusinessKind, Business, Resident } from "../world/types";
import { skyColor, ambient, windowGlow, dim, hexToRgb, type Rgb } from "./daynight";

const ACTIVITY_COLOR: Record<Activity, string> = {
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

const BUSINESS_RGB = Object.fromEntries(
  Object.entries(BUSINESS_HEX).map(([k, v]) => [k, hexToRgb(v)]),
) as Record<BusinessKind, Rgb>;

const HOME_RGB = hexToRgb("#3a3320");
const ROAD_RGB: Rgb = [43, 47, 58]; // #2b2f3a
const CLOSED_RGB: Rgb = [46, 46, 52];
const LABEL_RGB: Rgb = [174, 180, 189];

const BUILDING = 26;
const DOT_RADIUS = 5;

export interface Pick {
  kind: "resident" | "business";
  id: string;
}

/**
 * Read-only view of the world: roads, buildings, and residents painted onto the
 * canvas. Phase 5 makes it breathe — the whole scene is tinted and dimmed by
 * the hour of day, and buildings light their windows after dark in proportion
 * to how many residents are home. It never mutates the simulation.
 */
export class CanvasRenderer {
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
  draw(hourFloat: number, selected?: Pick): void {
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
      const node = world.getNode(loc.nodeId);
      const biz = world.businesses.find((b) => b.locationId === loc.id);
      this.drawBuilding(node.x, node.y, biz, this.occupantsAt(loc.nodeId), a, glow);
      if (biz && selected?.kind === "business" && selected.id === biz.id) {
        this.outlineBuilding(node.x, node.y);
      }
      ctx.fillStyle = dim(LABEL_RGB, Math.max(a, 0.7));
      ctx.fillText(loc.name, node.x, node.y + BUILDING / 2 + 11);
    }

    // Residents — colour by activity, with shadow, heading tick, selection glow.
    for (const r of world.residents) {
      this.drawResident(r, selected?.kind === "resident" && selected.id === r.id);
    }

    this.drawLegend();
    this.drawSky(hourFloat);
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
      const node = world.getNode(loc.nodeId);
      const half = BUILDING / 2;
      if (Math.abs(node.x - x) <= half && Math.abs(node.y - y) <= half) {
        const biz = world.businesses.find((b) => b.locationId === loc.id);
        if (biz) return { kind: "business", id: biz.id };
      }
    }
    return undefined;
  }
}
