import type { BusinessAction, DecisionLogEntry } from "../ai/types";
import type { ResidentAction, ResidentDecisionLogEntry } from "../ai/residentTypes";

/**
 * Decision narration (Phase R1 — the visualization "moat").
 *
 * Pure, read-only helpers that turn the decision logs the agents already keep
 * (`agent.decisions()` / `residentAgent.decisions()`) into human-readable
 * narration for the screen: a compact one-line summary of what each mind did,
 * a merged city-wide ticker, and a lookup for the latest decision behind a
 * selected entity (the "why now?" trace).
 *
 * This module is deliberately free of any `World`, wall-clock, or RNG coupling:
 * it takes plain log rows + name resolvers and returns plain data/strings, so it
 * is fully unit-testable and survives a future renderer swap (R2 Pixi) unchanged.
 * Bubble lifecycle/fade (which *is* wall-clock) lives in the view layer, not here.
 */

/** A single narration row for the city ticker (and the source of a thought bubble). */
export interface NarrationItem {
  day: number;
  kind: "business" | "resident";
  /** The deciding entity's id (businessId / residentId) — for click-through + bubble placement. */
  actorId: string;
  actorName: string;
  /** Compact lever summary, e.g. "price→$18, +1 hire" or "hold". */
  summary: string;
  reason: string;
  /** True when the primary mind failed and the rule-based fallback covered. */
  fallback: boolean;
}

const dollars = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * One-line summary of the levers a business actually pulled (post-clamp). Covers
 * every lever the model can move; an empty action reads as "hold". Order is fixed
 * (price, staffing, invest, brand, wage, payout) so the same action always renders
 * identically — deterministic narration.
 */
export function summarizeBusinessAction(a: BusinessAction): string {
  const parts: string[] = [];
  if (a.setPrice !== undefined) parts.push(`price→${dollars(a.setPrice)}`);
  if (a.hire) parts.push(a.hire > 0 ? `+${a.hire} hire` : `${a.hire} layoff`);
  if (a.invest) parts.push(`invest ${dollars(a.invest)}`);
  if (a.brand) parts.push(`brand ${dollars(a.brand)}`);
  if (a.setWage !== undefined) parts.push(`wage→${a.setWage.toFixed(3)}`);
  if (a.setPayout !== undefined) parts.push(`payout→${Math.round(a.setPayout * 100)}%`);
  return parts.length > 0 ? parts.join(", ") : "hold";
}

/**
 * One-line summary of a resident's life move. `resolveName` turns a business/home
 * id into a readable name (falls back to the raw id if unknown).
 */
export function summarizeResidentAction(
  a: ResidentAction,
  resolveName: (id: string) => string,
): string {
  const parts: string[] = [];
  if (a.switchJobTo) parts.push(`job→${resolveName(a.switchJobTo)}`);
  if (a.reHomeTo) parts.push(`home→${resolveName(a.reHomeTo)}`);
  if (a.buyVehicle) parts.push("buy vehicle");
  if (a.sellVehicle) parts.push("sell vehicle");
  if (a.negotiateRaise) parts.push("ask for raise");
  return parts.length > 0 ? parts.join(", ") : "hold";
}

export interface TickerResolvers {
  /** Display name for a business id. */
  businessName: (id: string) => string;
  /** Display name for any id a resident move references (job/home). */
  resolveName: (id: string) => string;
}

/**
 * Merge the business + resident decision logs into a single newest-first feed —
 * the city's "news ticker" of AI decisions. Sorted by day descending; within a
 * day, businesses then residents (a stable, deterministic order). `limit` caps
 * the feed to the most recent N rows.
 */
export function tickerItems(
  businessLog: readonly DecisionLogEntry[],
  residentLog: readonly ResidentDecisionLogEntry[],
  resolvers: TickerResolvers,
  limit = 12,
): NarrationItem[] {
  const items: NarrationItem[] = [];
  for (const e of businessLog) {
    items.push({
      day: e.day,
      kind: "business",
      actorId: e.businessId,
      actorName: resolvers.businessName(e.businessId),
      summary: summarizeBusinessAction(e.action),
      reason: e.reason,
      fallback: e.fallback,
    });
  }
  for (const e of residentLog) {
    items.push({
      day: e.day,
      kind: "resident",
      actorId: e.residentId,
      actorName: e.residentName,
      summary: summarizeResidentAction(e.action, resolvers.resolveName),
      reason: e.reason,
      fallback: e.fallback,
    });
  }
  // Stable newest-first: higher day first; businesses before residents within a
  // day (kind compare); otherwise keep insertion order via the index tiebreak.
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      if (b.it.day !== a.it.day) return b.it.day - a.it.day;
      if (a.it.kind !== b.it.kind) return a.it.kind === "business" ? -1 : 1;
      return a.i - b.i;
    })
    .slice(0, limit)
    .map((x) => x.it);
}

/**
 * The latest business decision for each business id, in the order businesses
 * first appear in the log — the source set for thought bubbles (one bubble per
 * firm, showing its most recent move). A later day always wins.
 */
export function latestBusinessDecisions(
  businessLog: readonly DecisionLogEntry[],
): Map<string, DecisionLogEntry> {
  const latest = new Map<string, DecisionLogEntry>();
  for (const e of businessLog) {
    const prev = latest.get(e.businessId);
    if (!prev || e.day >= prev.day) latest.set(e.businessId, e);
  }
  return latest;
}

/** The most recent decision (business or resident) for a given entity id, if any. */
export function latestDecisionFor(
  id: string,
  businessLog: readonly DecisionLogEntry[],
  residentLog: readonly ResidentDecisionLogEntry[],
): DecisionLogEntry | ResidentDecisionLogEntry | undefined {
  let best: DecisionLogEntry | ResidentDecisionLogEntry | undefined;
  for (const e of businessLog) if (e.businessId === id && (!best || e.day >= best.day)) best = e;
  for (const e of residentLog) if (e.residentId === id && (!best || e.day >= best.day)) best = e;
  return best;
}
