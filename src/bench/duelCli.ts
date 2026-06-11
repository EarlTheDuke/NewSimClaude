/**
 * The duel CLI (Pilot B) — pit two minds on the twin diners, home-and-away.
 *
 *   npx vite-node src/bench/duelCli.ts                                  # rules vs rules (offline)
 *   npx vite-node src/bench/duelCli.ts -- --b claude                    # rules vs Claude (default model)
 *   npx vite-node src/bench/duelCli.ts -- --a claude:claude-sonnet-4-6 --b claude:claude-haiku-4-5-20251001
 *   npx vite-node src/bench/duelCli.ts -- --days 90 --seed 9
 *
 * A "claude[:model]" spec needs ANTHROPIC_API_KEY; each game constructs FRESH provider
 * instances (the memory ledgers never leak between games). Sync-vs-sync matches are fully
 * deterministic and replayable.
 */
import { runHomeAndAway, formatHomeAndAway, DUEL_DAYS, type ProviderFactory } from "./duel";
import { ClaudeDecisionProvider } from "../ai/ClaudeDecisionProvider";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";

function factoryFor(spec: string): { label: string; make: ProviderFactory } {
  if (spec === "rules") return { label: "rules", make: () => new RuleBasedProvider() };
  if (spec === "claude" || spec.startsWith("claude:")) {
    const model = spec.includes(":") ? spec.slice("claude:".length) : undefined;
    const label = model ?? "claude";
    return { label, make: () => new ClaudeDecisionProvider(model ? { model } : {}) };
  }
  throw new Error(`duelCli: unknown brain spec "${spec}" (use "rules" or "claude[:model]")`);
}

function arg(name: string, fallback: string): string {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const a = factoryFor(arg("a", "rules"));
  const b = factoryFor(arg("b", "rules"));
  const seed = parseInt(arg("seed", "9"), 10);
  const days = parseInt(arg("days", String(DUEL_DAYS)), 10);
  console.log(`Duel: ${a.label} vs ${b.label} · seed ${seed} · ${days} days/game · home-and-away…`);
  const match = await runHomeAndAway({ seed, days, a, b });
  console.log(formatHomeAndAway(match));
}

main();
