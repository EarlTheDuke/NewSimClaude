/**
 * Housing helpers (HP1). Pure, deterministic functions over the resident list —
 * no World/RNG/wall-clock — so occupancy is unit-testable and the homing logic
 * (observation, clamp, apply) shares one definition of "who lives where."
 *
 * A home's occupancy is simply how many residents name it as their `homeId`;
 * capacity lives on the home `Location`. Re-homing is gated on a free slot, which
 * also makes housing the population ceiling for HP3 (growth fills the vacancies).
 */
export function occupantsByHome(residents: readonly { homeId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of residents) counts.set(r.homeId, (counts.get(r.homeId) ?? 0) + 1);
  return counts;
}

/** Whether a home has room for one more, given its current occupant count + capacity. */
export function hasVacancy(occupants: number, capacity: number): boolean {
  return occupants < capacity;
}

/**
 * The cheapest home that still has a free slot — by rent, ties broken by location
 * id for determinism — or `undefined` when every home is full (HP3-2). One shared
 * definition so both in-migration placement and capacity-aware eviction (HP3-3)
 * honour the HP1 occupancy cap: a $0 newcomer or an evictee can never be stacked
 * into a dwelling that's already at capacity. Pure — reads only homeId / type /
 * rent / capacity, never money, no RNG. A home with no explicit capacity is treated
 * as unbounded (99), matching the rest of the housing code's back-compat convention.
 */
export function cheapestVacantHome(
  residents: readonly { homeId: string }[],
  locations: readonly { id: string; type: string; rent?: number; capacity?: number }[],
): string | undefined {
  const occ = occupantsByHome(residents);
  let bestId: string | undefined;
  let bestRent = Infinity;
  for (const loc of locations) {
    if (loc.type !== "home") continue;
    const occupants = occ.get(loc.id) ?? 0;
    const capacity = loc.capacity ?? 99;
    if (!hasVacancy(occupants, capacity)) continue;
    const rent = loc.rent ?? 0;
    if (rent < bestRent || (rent === bestRent && (bestId === undefined || loc.id < bestId))) {
      bestRent = rent;
      bestId = loc.id;
    }
  }
  return bestId;
}
