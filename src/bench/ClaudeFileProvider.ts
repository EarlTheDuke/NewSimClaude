/**
 * Claude-in-the-loop duel seat (dev harness, like bench/play.ts but for LIVE matches).
 *
 * The conversation-Claude plays a real duel seat against a live API opponent: each morning
 * this provider writes the seat's observation to `claude-duel-obs.json` and BLOCKS the match
 * until matching actions appear in `claude-duel-actions.json` (written by Claude via the
 * chat session driving the run). Actions arrive in CHUNKS — a queue of {action, reason} the
 * seat consumes one per day, re-prompting when it runs dry — so Claude commits a few days of
 * policy at a time and adapts between chunks, while the opponent's API calls proceed live.
 *
 * The duel's settle() loop waits for every decision, so the sim simply pauses on Claude's
 * turn — no timeouts, no fallback, every move genuinely Claude's. Protocol files are
 * runtime artifacts (gitignored). One provider instance per game; `seat` tags ("g1"/"g2")
 * keep stale files from crossing games.
 */
import * as fs from "fs";
import type { BusinessAction, BusinessDecision, DecisionProvider, DecisionRequest } from "../ai/types";

export const CLAUDE_OBS_FILE = "claude-duel-obs.json";
export const CLAUDE_ACT_FILE = "claude-duel-actions.json";

interface ActionFile {
  seat: string;
  turn: number;
  actions: { action: BusinessAction; reason?: string }[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ClaudeFileProvider implements DecisionProvider {
  readonly id = "claude-fable-5";
  private queue: { action: BusinessAction; reason?: string }[] = [];
  private turn = 0;

  constructor(private readonly seat: string) {}

  async decide(req: DecisionRequest): Promise<BusinessDecision> {
    this.turn++;
    const queued = this.queue.shift();
    if (queued) {
      return { action: queued.action, reason: queued.reason ?? "Claude (committed plan)" };
    }
    // Out of committed moves — hand Claude the books and wait at the morning bell.
    fs.writeFileSync(
      CLAUDE_OBS_FILE,
      JSON.stringify(
        { seat: this.seat, turn: this.turn, waitingSince: new Date().toISOString(), observation: req.observation, limits: req.limits },
        null,
        2,
      ),
    );
    for (;;) {
      await sleep(1500);
      try {
        const raw = JSON.parse(fs.readFileSync(CLAUDE_ACT_FILE, "utf8")) as ActionFile;
        if (raw.seat === this.seat && raw.turn === this.turn && Array.isArray(raw.actions) && raw.actions.length > 0) {
          this.queue = raw.actions.slice(1);
          const first = raw.actions[0]!;
          return { action: first.action, reason: first.reason ?? "Claude" };
        }
      } catch {
        // not written yet / mid-write — keep waiting; the match clock is paused on us
      }
    }
  }
}
