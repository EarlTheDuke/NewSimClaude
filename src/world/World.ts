import type {
  MapNode,
  Road,
  Location,
  Business,
  Resident,
  WorldSnapshot,
} from "./types";

/**
 * The shared, mutable city state. Systems read and mutate it each tick; it
 * owns no behaviour beyond lookups, pathfinding, money transfer, and snapshot.
 *
 * Money is only ever moved with {@link transfer}, so the sum across all
 * residents and businesses is conserved — the closed economy the MVP is built
 * to demonstrate.
 */
export class World {
  nodes: MapNode[] = [];
  roads: Road[] = [];
  locations: Location[] = [];
  businesses: Business[] = [];
  residents: Resident[] = [];

  private nodeById = new Map<string, MapNode>();
  private locationById = new Map<string, Location>();
  private adjacency = new Map<string, string[]>();

  /** Rebuild the lookup indices after entities or the map change. */
  reindex(): void {
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));
    this.locationById = new Map(this.locations.map((l) => [l.id, l]));
    this.adjacency = new Map(this.nodes.map((n) => [n.id, []]));
    for (const road of this.roads) {
      this.adjacency.get(road.a)?.push(road.b);
      this.adjacency.get(road.b)?.push(road.a);
    }
    // Stable neighbour order keeps pathfinding deterministic.
    for (const list of this.adjacency.values()) list.sort();
  }

  getNode(id: string): MapNode {
    const n = this.nodeById.get(id);
    if (!n) throw new Error(`World.getNode: unknown node "${id}"`);
    return n;
  }

  getLocation(id: string): Location {
    const l = this.locationById.get(id);
    if (!l) throw new Error(`World.getLocation: unknown location "${id}"`);
    return l;
  }

  getBusiness(id: string): Business | undefined {
    return this.businesses.find((b) => b.id === id);
  }

  getResident(id: string): Resident | undefined {
    return this.residents.find((r) => r.id === id);
  }

  /** Euclidean distance between two nodes (world units). */
  distance(aId: string, bId: string): number {
    const a = this.getNode(aId);
    const b = this.getNode(bId);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Shortest path along roads from one node to another (Dijkstra, weighted by
   * segment length). Returns the ordered node ids to walk through, EXCLUDING
   * the start and INCLUDING the destination. Empty if already there or
   * unreachable. Deterministic: ties broken by node id.
   */
  findPath(fromNodeId: string, toNodeId: string): string[] {
    if (fromNodeId === toNodeId) return [];
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    dist.set(fromNodeId, 0);

    while (true) {
      // Pick the unvisited node with the smallest tentative distance.
      let current: string | undefined;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && (d < best || (d === best && (current === undefined || id < current)))) {
          best = d;
          current = id;
        }
      }
      if (current === undefined) break; // no remaining reachable nodes
      if (current === toNodeId) break;
      visited.add(current);

      for (const next of this.adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        const nd = best + this.distance(current, next);
        if (nd < (dist.get(next) ?? Infinity)) {
          dist.set(next, nd);
          prev.set(next, current);
        }
      }
    }

    if (!prev.has(toNodeId) && fromNodeId !== toNodeId) return [];
    const path: string[] = [];
    let step: string | undefined = toNodeId;
    while (step !== undefined && step !== fromNodeId) {
      path.unshift(step);
      step = prev.get(step);
    }
    return path;
  }

  /**
   * Move `amount` of money from one holder to another. Holders are resident or
   * business ids. Returns the amount actually moved (capped at the payer's
   * balance) so the economy never creates money from nothing.
   */
  transfer(fromId: string, toId: string, amount: number): number {
    if (amount <= 0) return 0;
    const from = this.holderBalance(fromId);
    const moved = Math.min(amount, from.get());
    if (moved <= 0) return 0;
    from.set(from.get() - moved);
    const to = this.holderBalance(toId);
    to.set(to.get() + moved);
    return moved;
  }

  private holderBalance(id: string): { get: () => number; set: (v: number) => void } {
    const resident = this.getResident(id);
    if (resident) {
      return { get: () => resident.money, set: (v) => (resident.money = v) };
    }
    const business = this.getBusiness(id);
    if (business) {
      return { get: () => business.cash, set: (v) => (business.cash = v) };
    }
    throw new Error(`World.transfer: unknown money holder "${id}"`);
  }

  /** Total money across residents + businesses — should be invariant. */
  totalMoney(): number {
    let sum = 0;
    for (const r of this.residents) sum += r.money;
    for (const b of this.businesses) sum += b.cash;
    return sum;
  }

  serialize(): WorldSnapshot {
    return structuredClone({
      nodes: this.nodes,
      roads: this.roads,
      locations: this.locations,
      businesses: this.businesses,
      residents: this.residents,
    });
  }

  restore(snapshot: WorldSnapshot): void {
    const s = structuredClone(snapshot);
    this.nodes = s.nodes;
    this.roads = s.roads;
    this.locations = s.locations;
    this.businesses = s.businesses;
    this.residents = s.residents;
    this.reindex();
  }
}
