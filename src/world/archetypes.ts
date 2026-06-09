import type { BusinessKind } from "./types";
import { DESIRED_HEADCOUNT } from "../systems/constants";
import { ARCHETYPES } from "./industries";

/**
 * The economic identity of each business archetype (Phase 4) now lives in the **industry
 * registry** ({@link ./industries}) — the single, mutable source slices 4a–4d centralized it
 * into. This module keeps the back-compatible re-exports (so every `from "../world/archetypes"`
 * import still resolves) plus {@link desiredHeadcount}, the one bit of derived *behaviour*.
 *
 * An archetype: `consumes` (resource bought B2B, turned 1:1 into output), `produces` (made from
 * nothing by primary producers, from `consumes` by processors), `sellsToResidents` (storefronts),
 * `target` (output stock refilled toward each day), `maxPerDay` (hard daily ceiling, Phase-14
 * tight), plus the role flags `collectsRent` / `capitalGoodsVendor` (slice 4b).
 */
export { ARCHETYPES, PRODUCER_OF, type Archetype } from "./industries";

/**
 * How many workers a business wants on staff (Phase 15 A). A *producing* business
 * (anything with a daily output ceiling) wants {@link DESIRED_HEADCOUNT}; the
 * landlord produces nothing — it runs on rent — so it wants no crew, which frees
 * the seeded workforce to fully staff the supply chain instead. Drives both the
 * `hiring` signal a job-hunting resident sees and the `understaffed` cue a firm's
 * mind reads to decide whether to bid wages up.
 */
export function desiredHeadcount(kind: BusinessKind): number {
  return ARCHETYPES[kind].maxPerDay > 0 ? DESIRED_HEADCOUNT : 0;
}
