/**
 * The melee CLI — six minds, one economy, full seat rotation (see melee.ts).
 *
 *   npx vite-node src/bench/meleeCli.ts                                    # six rules minds (offline)
 *   npx vite-node src/bench/meleeCli.ts -- --models rules,rules,openwebui:qwen3.5:35b,rules,rules,rules
 *   npx vite-node src/bench/meleeCli.ts -- --models openwebui:nemotron-3-ultra,openwebui:qwen3.5:35b,openwebui:qwen3.5:122b,openwebui:qwen3:32b,openwebui:qwen3-coder-next:q8_0,openwebui:driaforall/tiny-agent-a:0.5b --days 30
 *
 * Model specs match duelCli: rules · claude[:model] · openwebui[:model] (.env-configured).
 * THE RUNBOOK (duelCli's F5 rules) applies doubly here: a full LLM round is 6 games × 6
 * seats × days decisions — give it a QUIET box and expect hours. Games run SEQUENTIALLY so
 * a single-GPU box never sees concurrent matches; --nothink applies to openwebui seats.
 * Duplicate model specs get numbered labels (#2, #3…) so standings stay per-SEAT-portfolio.
 */
import { runMeleeRound, formatMeleeRound, MELEE_DAYS, type MeleePlayer } from "./melee";
import { ClaudeDecisionProvider } from "../ai/ClaudeDecisionProvider";
import { OpenAICompatProvider } from "../ai/OpenAICompatProvider";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";

function env(name: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.[`VITE_${name}`] ?? process.env[`VITE_${name}`] ?? process.env[name];
}

function playerFor(spec: string, noThink: boolean, serialize: string | undefined): MeleePlayer {
  if (spec === "rules") return { label: "rules", make: () => new RuleBasedProvider() };
  if (spec === "claude" || spec.startsWith("claude:")) {
    const model = spec.includes(":") ? spec.slice("claude:".length) : undefined;
    return { label: model ?? "claude", make: () => new ClaudeDecisionProvider(model ? { model } : {}) };
  }
  if (spec === "openwebui" || spec.startsWith("openwebui:")) {
    const baseUrl = env("OPENWEBUI_BASE_URL");
    if (!baseUrl) throw new Error("meleeCli: set VITE_OPENWEBUI_BASE_URL in .env for openwebui specs.");
    const model = spec.includes(":") ? spec.slice("openwebui:".length) : env("OPENWEBUI_MODEL");
    if (!model) throw new Error("meleeCli: pass openwebui:<model> or set VITE_OPENWEBUI_MODEL in .env.");
    const apiKey = env("OPENWEBUI_API_KEY");
    // --serialize <substring>: the contended single-GPU local model (e.g. "qwen") serializes
    // its same-model slots so they don't dogpile the box; an external endpoint (nemotron) is
    // left concurrent so its trio runs in parallel and the round stays fast.
    const serializeEndpoint = serialize !== undefined && model.includes(serialize);
    return {
      label: noThink ? `${model}-nothink` : model,
      make: () =>
        new OpenAICompatProvider({
          baseUrl,
          model,
          apiKey,
          timeoutMs: 300_000,
          serializeEndpoint,
          ...(noThink ? { promptSuffix: " /no_think", maxTokens: 4096 } : {}),
        }),
    };
  }
  throw new Error(`meleeCli: unknown model spec "${spec}"`);
}

function arg(name: string, fallback: string): string {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const noThink = process.argv.includes("--nothink");
  // --serialize <substring>: serialize same-model slots whose model id contains the substring
  // (the contended single-GPU local model, e.g. "qwen"); others stay concurrent.
  const serialize = arg("serialize", "");
  const serializeArg = serialize.length > 0 ? serialize : undefined;
  const specs = arg("models", "rules,rules,rules,rules,rules,rules").split(",").map((s) => s.trim());
  const players = specs.map((s) => playerFor(s, noThink, serializeArg));
  // Duplicate labels get numbered so each roster slot's seat portfolio stays distinguishable.
  const seen = new Map<string, number>();
  for (const p of players) {
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    if (n > 1) p.label = `${p.label}#${n}`;
  }
  const seed = parseInt(arg("seed", "9"), 10);
  const days = parseInt(arg("days", String(MELEE_DAYS)), 10);
  console.log(`MELEE: ${players.map((p) => p.label).join(" vs ")} · seed ${seed} · ${days} days/game…`);
  const round = await runMeleeRound({ seed, days, players, verbose: true });
  console.log(formatMeleeRound(round));
}

main();
