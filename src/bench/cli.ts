/**
 * Phase 10d — the CEO benchmark CLI.
 *
 * A Vending-Bench-style scored scenario: one storefront recapitalized to
 * $50,000, run 42 turns under a chosen mind, scored on final net worth. The
 * rule-based CEO is measured against the no-op baseline ("off") on the same
 * seed — both deterministic and offline, so this prints the identical scorecard
 * every time.
 *
 *   npx vite-node src/bench/cli.ts            # offline: off vs rules
 *   npx vite-node src/bench/cli.ts --claude   # also pit the live LM-as-CEO
 *
 * The --claude arm runs the async harness (one API call per turn) and needs
 * ANTHROPIC_API_KEY; without a key it is skipped with a note, so the default
 * path never touches the network.
 */
import {
  runCeoBenchmark,
  runCeoBenchmarkAsync,
  formatCeoScorecard,
  type CeoBenchResult,
} from "./ceoBench";
import { ClaudeDecisionProvider } from "../ai/ClaudeDecisionProvider";

const SEED = 9;

async function main(): Promise<void> {
  const wantClaude = process.argv.includes("--claude");

  const results: CeoBenchResult[] = [
    runCeoBenchmark({ seed: SEED, brain: "off" }),
    runCeoBenchmark({ seed: SEED, brain: "rules" }),
  ];

  if (wantClaude) {
    try {
      const claude = new ClaudeDecisionProvider();
      console.log("Running the Claude CEO live (one API call per turn)…");
      results.push(await runCeoBenchmarkAsync({ seed: SEED, brain: claude }));
    } catch (err) {
      console.log(`(skipping --claude: ${(err as Error).message})`);
    }
  }

  console.log(formatCeoScorecard(results));
  if (!wantClaude) {
    console.log(
      "\nTip: pass --claude to pit the live LM-as-CEO against these baselines (needs ANTHROPIC_API_KEY).",
    );
  }
}

main();
