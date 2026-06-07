/**
 * Resident fan-out (visualization). Pure, deterministic geometry: when several
 * residents stand on the same node (a workplace or home), their dots would draw
 * at the identical pixel and collapse into one. `fanOutOffset` spreads member
 * `index` of a co-located group of `count` onto a small ring around the true
 * node position, so the crowd is countable. A lone resident (count ≤ 1) gets no
 * offset, so movers and solo nodes are byte-identical to before. Read-only — the
 * offset is presentation; the resident's real sim position is untouched.
 */
export function fanOutOffset(index: number, count: number): { dx: number; dy: number } {
  if (count <= 1) return { dx: 0, dy: 0 };
  const spacing = 7; // px between adjacent dots on the ring (dot radius is 5)
  const radius = Math.max(7, (count * spacing) / (2 * Math.PI));
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2; // first dot at the top
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}
