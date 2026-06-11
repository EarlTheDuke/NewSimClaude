/**
 * The duel CLI (Pilot B) — pit two minds on the twin diners, home-and-away.
 *
 *   npx vite-node src/bench/duelCli.ts                                  # rules vs rules (offline)
 *   npx vite-node src/bench/duelCli.ts -- --b claude                    # rules vs Claude (default model)
 *   npx vite-node src/bench/duelCli.ts -- --b openwebui                 # rules vs the local model (.env)
 *   npx vite-node src/bench/duelCli.ts -- --a claude --b openwebui:nemotron-3
 *   npx vite-node src/bench/duelCli.ts -- --days 90 --seed 9
 *
 * Brain specs: "rules" · "claude[:model]" (needs VITE_ANTHROPIC_API_KEY) ·
 * "openwebui[:model]" — any OpenAI-compatible server (Open WebUI, Ollama, LM Studio…),
 * configured in the gitignored .env:
 *   VITE_OPENWEBUI_BASE_URL=http://localhost:3000/api   (Ollama native: http://localhost:11434/v1)
 *   VITE_OPENWEBUI_API_KEY=sk-…                          (omit if the server runs open)
 *   VITE_OPENWEBUI_MODEL=nemotron-3:latest               (default when the spec has no :model)
 *
 * Each game constructs FRESH provider instances (the memory ledgers never leak between
 * games). Sync-vs-sync matches are fully deterministic and replayable.
 */
import { runHomeAndAway, formatHomeAndAway, DUEL_DAYS, type ProviderFactory } from "./duel";
import { ClaudeDecisionProvider } from "../ai/ClaudeDecisionProvider";
import { OpenAICompatProvider } from "../ai/OpenAICompatProvider";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";

function env(name: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.[`VITE_${name}`] ?? process.env[`VITE_${name}`] ?? process.env[name];
}

function factoryFor(spec: string): { label: string; make: ProviderFactory } {
  if (spec === "rules") return { label: "rules", make: () => new RuleBasedProvider() };
  if (spec === "claude" || spec.startsWith("claude:")) {
    const model = spec.includes(":") ? spec.slice("claude:".length) : undefined;
    const label = model ?? "claude";
    return { label, make: () => new ClaudeDecisionProvider(model ? { model } : {}) };
  }
  if (spec === "openwebui" || spec.startsWith("openwebui:")) {
    const baseUrl = env("OPENWEBUI_BASE_URL");
    if (!baseUrl) throw new Error("duelCli: set VITE_OPENWEBUI_BASE_URL in .env for the openwebui spec.");
    const model = spec.includes(":") ? spec.slice("openwebui:".length) : env("OPENWEBUI_MODEL");
    if (!model) throw new Error("duelCli: pass openwebui:<model> or set VITE_OPENWEBUI_MODEL in .env.");
    const apiKey = env("OPENWEBUI_API_KEY");
    // --nothink: local reasoning models can take minutes per decision thinking out loud;
    // qwen's /no_think switch trades deliberation for tractable wall-clock. A different
    // contestant mode — the label says so.
    const noThink = process.argv.includes("--nothink");
    return {
      label: noThink ? `${model}-nothink` : model,
      make: () =>
        new OpenAICompatProvider({
          baseUrl,
          model,
          apiKey,
          timeoutMs: 300_000, // a busy single-GPU box queues requests; be patient
          ...(noThink ? { promptSuffix: " /no_think", maxTokens: 512 } : {}),
        }),
    };
  }
  throw new Error(`duelCli: unknown brain spec "${spec}" (use "rules", "claude[:model]", or "openwebui[:model]")`);
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
  const match = await runHomeAndAway({ seed, days, a, b, verbose: true });
  console.log(formatHomeAndAway(match));
}

main();
