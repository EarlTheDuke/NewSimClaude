import type { World } from "../world/World";
import type { Activity, BusinessKind } from "../world/types";

const ACTIVITY_COLOR: Record<Activity, string> = {
  sleeping: "#5b6ee1",
  working: "#5bd16e",
  eating: "#e1a35b",
  socializing: "#e15bc8",
  commuting: "#e1d65b",
  idle: "#9aa0a6",
};

const BUSINESS_COLOR: Record<BusinessKind, string> = {
  diner: "#7a4a1f",
  goods: "#1f4a7a",
  landlord: "#4a4a4a",
  farm: "#3f6e2a",
  mine: "#6e5a2a",
  bakery: "#8a5a2f",
  factory: "#5a2f6e",
};

const HOME_COLOR = "#3a3320";
const BUILDING = 26;
const DOT_RADIUS = 5;

export interface Pick {
  kind: "resident" | "business";
  id: string;
}

/**
 * Minimal read-only view of the world: roads as lines, buildings as labelled
 * squares, residents as dots coloured by what they are doing. It never mutates
 * the simulation — it only reads and paints.
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

  draw(selected?: Pick): void {
    const { ctx, canvas, world } = this;
    ctx.fillStyle = "#11131a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Roads
    ctx.strokeStyle = "#2b2f3a";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const road of world.roads) {
      const a = world.getNode(road.a);
      const b = world.getNode(road.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Buildings
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const loc of world.locations) {
      const node = world.getNode(loc.nodeId);
      const biz = world.businesses.find((b) => b.locationId === loc.id);
      ctx.fillStyle = biz ? BUSINESS_COLOR[biz.kind] : HOME_COLOR;
      const half = BUILDING / 2;
      ctx.fillRect(node.x - half, node.y - half, BUILDING, BUILDING);
      if (biz && selected?.kind === "business" && selected.id === biz.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(node.x - half - 2, node.y - half - 2, BUILDING + 4, BUILDING + 4);
      }
      ctx.fillStyle = "#aeb4bd";
      ctx.fillText(loc.name, node.x, node.y + half + 11);
    }

    // Residents
    for (const r of world.residents) {
      ctx.beginPath();
      ctx.arc(r.move.x, r.move.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = ACTIVITY_COLOR[r.activity];
      ctx.fill();
      if (selected?.kind === "resident" && selected.id === r.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
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
