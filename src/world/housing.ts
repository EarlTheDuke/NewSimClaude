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
