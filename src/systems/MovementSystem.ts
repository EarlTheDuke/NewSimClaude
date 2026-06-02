import type { System } from "../core/types";
import type { World } from "../world/World";
import type { Resident } from "../world/types";
import { MOVE_SPEED } from "./constants";

/**
 * Walks residents along the road network toward the destination the brain
 * chose. While in transit the activity is "commuting"; on arrival the brain's
 * intended activity (set this same tick, before this system runs) stands.
 */
export class MovementSystem implements System {
  readonly id = "movement";
  constructor(private readonly world: World) {}

  update(): void {
    for (const resident of this.world.residents) {
      this.step(resident);
    }
  }

  private step(resident: Resident): void {
    const dest = this.world.getLocation(resident.destinationId);
    const targetNode = dest.nodeId;
    const m = resident.move;

    const arrived = m.atNodeId === targetNode && m.path.length === 0;
    if (arrived) return; // brain's intended activity stands

    // (Re)compute the route if we have none or it no longer ends at the target.
    if (m.path.length === 0 || m.path[m.path.length - 1] !== targetNode) {
      m.path = this.world.findPath(m.atNodeId, targetNode);
      m.segmentProgress = 0;
    }
    if (m.path.length === 0) return; // already at target node (or unreachable)

    let budget = MOVE_SPEED;
    while (budget > 0 && m.path.length > 0) {
      const from = this.world.getNode(m.atNodeId);
      const next = this.world.getNode(m.path[0]!);
      const segLen = Math.hypot(next.x - from.x, next.y - from.y);
      const remaining = segLen - m.segmentProgress;
      if (budget >= remaining) {
        budget -= remaining;
        m.atNodeId = m.path.shift()!;
        m.segmentProgress = 0;
        m.x = next.x;
        m.y = next.y;
      } else {
        m.segmentProgress += budget;
        const t = m.segmentProgress / segLen;
        m.x = from.x + (next.x - from.x) * t;
        m.y = from.y + (next.y - from.y) * t;
        budget = 0;
      }
    }

    const nowArrived = m.atNodeId === targetNode && m.path.length === 0;
    if (!nowArrived) resident.activity = "commuting";
  }
}
