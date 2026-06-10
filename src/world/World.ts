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
 * owns no behaviour beyond lookups, pathfinding, money movement, and snapshot.
 *
 * Money is only ever moved with {@link transfer}, so the sum across all
 * residents and businesses is conserved — the closed economy the MVP is built
 * to demonstrate. ONE sanctioned exception exists (Initiative C / C4 path b,
 * the user's explicit 2026-06-09 decision): the audited {@link mint} /
 * {@link burn} primitives, which change the supply by exactly what they log —
 * so the invariant generalizes to `totalMoney() === genesis + mintedTotal() −
 * burnedTotal()`, auditable to the cent. Nothing in the default city (or the
 * CEO bench) ever calls them: with both counters at 0 the strict invariant is
 * unchanged.
 */
export class World {
  nodes: MapNode[] = [];
  roads: Road[] = [];
  locations: Location[] = [];
  businesses: Business[] = [];
  residents: Resident[] = [];

  /** Cumulative money created via {@link mint} (the audit ledger's credit side). */
  private minted = 0;
  /** Cumulative money destroyed via {@link burn} (the audit ledger's debit side). */
  private burned = 0;

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

  /**
   * Create `amount` of NEW money at a holder (Initiative C / C4 path b) — the monetary
   * authority's printing press, and the ONE sanctioned way money enters the world after genesis.
   * Deliberately separate from {@link transfer}: a transfer moves existing money and cannot
   * change the total; a mint changes the total by exactly what it logs into {@link mintedTotal},
   * keeping `totalMoney() === genesis + minted − burned` auditable to the cent. Real-world: the
   * central bank crediting an account with newly issued currency. Returns the amount minted.
   * NEVER call this from ordinary economic code — only a monetary-policy system may.
   */
  mint(toId: string, amount: number): number {
    if (amount <= 0) return 0;
    const to = this.holderBalance(toId); // throws on an unknown holder — no minting into the void
    to.set(to.get() + amount);
    this.minted += amount;
    return amount;
  }

  /**
   * Destroy up to `amount` of money at a holder (C4 path b) — the printing press run in reverse,
   * capped at the holder's balance so no balance ever goes negative. Logs into
   * {@link burnedTotal}, preserving the audit identity. Real-world: the central bank retiring
   * currency from circulation. Returns the amount actually burned.
   */
  burn(fromId: string, amount: number): number {
    if (amount <= 0) return 0;
    const from = this.holderBalance(fromId);
    const burned = Math.min(amount, from.get());
    if (burned <= 0) return 0;
    from.set(from.get() - burned);
    this.burned += burned;
    return burned;
  }

  /** Cumulative money ever minted (0 in any strictly-conserved run). */
  mintedTotal(): number {
    return this.minted;
  }

  /** Cumulative money ever burned (0 in any strictly-conserved run). */
  burnedTotal(): number {
    return this.burned;
  }

  /**
   * Total money across residents + businesses. Invariant: equals genesis in a strictly-conserved
   * run, and `genesis + mintedTotal() − burnedTotal()` once a monetary authority operates.
   */
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
      // The monetary audit ledger rides in the snapshot ONLY once it is non-zero, so every
      // strictly-conserved save (all of them, until path b is engaged) is byte-identical.
      ...(this.minted > 0 || this.burned > 0
        ? { monetary: { minted: this.minted, burned: this.burned } }
        : {}),
    });
  }

  restore(snapshot: WorldSnapshot): void {
    const s = structuredClone(snapshot);
    this.nodes = s.nodes;
    this.roads = s.roads;
    this.locations = s.locations;
    this.businesses = s.businesses;
    this.residents = s.residents;
    this.minted = s.monetary?.minted ?? 0; // pre-C4b saves carry no ledger ⇒ strictly conserved
    this.burned = s.monetary?.burned ?? 0;
    this.reindex();
  }
}
