import { describe, it, expect } from "vitest";
import { runMeleeRound, MELEE_SEATS, type MeleePlayer } from "./melee";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";

const rulesPlayer = (label: string): MeleePlayer => ({ label, make: () => new RuleBasedProvider() });
const SIX = ["A", "B", "C", "D", "E", "F"].map(rulesPlayer);

describe("the 6-player melee (one round = 6 games, full seat rotation)", () => {
  it("rejects a wrong-sized roster", async () => {
    await expect(runMeleeRound({ seed: 9, days: 2, players: SIX.slice(0, 4) })).rejects.toThrow(/exactly 6/);
  });

  it(
    "rotation is a Latin square: every player sits every seat exactly once",
    async () => {
      const round = await runMeleeRound({ seed: 9, days: 2, players: SIX });
      expect(round.seatResults.length).toBe(36); // 6 games × 6 seats
      for (const p of SIX) {
        const seats = round.seatResults.filter((r) => r.label === p.label).map((r) => r.seat);
        expect([...seats].sort()).toEqual([...MELEE_SEATS].sort()); // each seat exactly once
      }
      expect(round.moneyConservedAllGames).toBe(true);
    },
    240_000,
  );

  it(
    "six identical deterministic minds TIE exactly — the rotation's fairness proof",
    async () => {
      const round = await runMeleeRound({ seed: 9, days: 3, players: SIX });
      const totals = round.standings.map((s) => s.total);
      for (const t of totals) expect(t).toBeCloseTo(totals[0]!, 9);
      expect(round.standings.every((s) => s.fellBack === 0)).toBe(true);
      // and per-seat scores are identical across games for the same seat (same mind everywhere
      // ⇒ every game is the SAME deterministic world): the strongest possible determinism check.
      for (const seat of MELEE_SEATS) {
        const scores = round.seatResults.filter((r) => r.seat === seat).map((r) => r.growthScore);
        for (const s of scores) expect(s).toBeCloseTo(scores[0]!, 9);
      }
    },
    240_000,
  );
});
