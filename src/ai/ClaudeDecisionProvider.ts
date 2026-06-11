import Anthropic from "@anthropic-ai/sdk";
import type {
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
  ProviderUsage,
} from "./types";
import { CeoLedger, DEFAULT_OBJECTIVE, actionFromInput, defaultBriefing } from "./ceoPrompt";

// The information contract (briefing + observation wording + ledger format) lives in
// ceoPrompt.ts and is shared VERBATIM by every vendor adapter — a fair match requires all
// contestants to see the identical contract. Re-exported for back-compat.
export { defaultBriefing } from "./ceoPrompt";

/** The slice of the Anthropic client this provider actually uses — enough for a test stub. */
export type MessagesClient = Pick<Anthropic, "messages">;

export interface ClaudeProviderOptions {
  /** API key. Falls back to VITE_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Model id. Defaults to a fast, cheap model — this runs once per business per day. */
  model?: string;
  /** Hard ceiling on a single call, in ms. The call rejects past this. */
  timeoutMs?: number;
  maxTokens?: number;
  /** USD per input token. Estimate — override to match current pricing. */
  inputCostPerToken?: number;
  /** USD per output token. Estimate — override to match current pricing. */
  outputCostPerToken?: number;
  /**
   * Inject a client (or a stub) instead of constructing one from an API key —
   * for tests, so the request-building and reply-parsing run without a network
   * call or a key. When set, the key requirement is skipped.
   */
  client?: MessagesClient;
  /**
   * The exact objective the CEO is graded on, injected by the benchmark per scoring mode
   * (classic vs growth) — a real CEO knows their KPI, so disclosing it is fair. Defaults to
   * the classic net-worth wording.
   */
  objective?: string;
  /**
   * Override the entire system briefing. The benchmark freezes this string per version so
   * every model sees the identical contract. Default: {@link defaultBriefing} — a
   * mechanics-only briefing (see its fairness note).
   */
  briefing?: string;
  /**
   * How many of the CEO's own past mornings ride in the prompt as their ledger (memory).
   * Without it the model is stateless per call and cannot learn across turns (e.g. its own
   * price probes are forgotten). Default 12; 0 disables. One provider instance = one run —
   * construct a fresh provider per episode so ledgers never leak between games.
   */
  memoryTurns?: number;
}

const DEFAULTS = {
  model: "claude-haiku-4-5-20251001",
  timeoutMs: 8000,
  maxTokens: 512,
  // Rough Haiku-class rates ($/token); adjust to live pricing.
  inputCostPerToken: 1 / 1_000_000,
  outputCostPerToken: 5 / 1_000_000,
  memoryTurns: 12,
  objective: DEFAULT_OBJECTIVE,
};

/**
 * The Claude-backed business mind. Async, networked, and the *only* sanctioned
 * source of non-determinism in the simulation — all of it sits behind this one
 * provider. It returns a structured {@link BusinessDecision}; on timeout, a
 * malformed reply, or any error it rejects, and {@link BusinessAgentSystem}
 * silently falls back to the rule-based provider.
 *
 * Output is wrung through a single tool so the model must answer in the exact
 * action shape — no brittle free-text JSON parsing.
 */
export class ClaudeDecisionProvider implements DecisionProvider {
  readonly id = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly inputCostPerToken: number;
  private readonly outputCostPerToken: number;
  private readonly briefing: string;
  /** The CEO's per-business memory (shared CeoLedger — see ceoPrompt.ts). */
  private readonly ledger: CeoLedger;

  constructor(opts: ClaudeProviderOptions = {}) {
    if (opts.client) {
      // Test/seam injection — no key or network needed.
      this.client = opts.client as Anthropic;
    } else {
      const apiKey = opts.apiKey ?? readEnvKey();
      if (!apiKey) {
        throw new Error(
          "ClaudeDecisionProvider: no API key (set VITE_ANTHROPIC_API_KEY or pass apiKey).",
        );
      }
      this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    }
    this.model = opts.model ?? DEFAULTS.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens;
    this.inputCostPerToken = opts.inputCostPerToken ?? DEFAULTS.inputCostPerToken;
    this.outputCostPerToken = opts.outputCostPerToken ?? DEFAULTS.outputCostPerToken;
    this.briefing = opts.briefing ?? defaultBriefing(opts.objective ?? DEFAULTS.objective);
    this.ledger = new CeoLedger(opts.memoryTurns ?? DEFAULTS.memoryTurns);
  }

  async decide(req: DecisionRequest): Promise<BusinessDecision> {
    const started = now();
    const decision = await withTimeout(this.call(req), this.timeoutMs, started);
    decision.usage = { ...decision.usage, latencyMs: now() - started };
    return decision;
  }

  private async call(req: DecisionRequest): Promise<BusinessDecision> {
    const { observation: o, limits } = req;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // The frozen information contract (see defaultBriefing's fairness note): mechanics
      // disclosed, market behaviour withheld, zero strategy coaching.
      system: this.briefing,
      tool_choice: { type: "tool", name: "set_business_plan" },
      tools: [
        {
          name: "set_business_plan",
          description: "Set this business's plan for the coming day.",
          input_schema: {
            type: "object",
            properties: {
              setPrice: {
                type: "number",
                description: `New unit price (current ${o.price}, allowed ${limits.minPrice}-${limits.maxPrice}). Omit to keep.`,
              },
              hire: {
                type: "integer",
                description: `Net headcount change, +hire / -layoff, within ±${limits.maxHirePerReview}. Omit for none.`,
              },
              invest: {
                type: "number",
                description: `Cash to spend on equipment this day (0-${limits.maxInvestPerReview}); raises future output but only pays off when capacity-bound. Omit for none.`,
              },
              setWage: {
                type: "number",
                description: `New wage per tick (current ${o.wagePerTick}, role base ${o.baseWagePerTick}); raise toward roughly twice the base to attract/keep staff, never below base. Omit to keep.`,
              },
              brand: {
                type: "number",
                description: `Cash to spend on marketing/quality this day (0-${limits.maxBrandPerReview}); builds brand equity that lifts customers' willingness-to-pay and grows demand, with diminishing returns + decay. Omit for none.`,
              },
              setPayout: {
                type: "number",
                description: `Fraction of profit to pay out as dividends, 0-1 (current ${o.payoutRate ?? 1}); the rest is retained as cash to reinvest. Lower it to fund growth, raise toward 1 to pay out. Omit to keep.`,
              },
              reason: { type: "string", description: "One sentence: why." },
            },
            required: ["reason"],
          },
        },
      ],
      messages: [{ role: "user", content: this.ledger.promptFor(o) }],
    });

    const block = response.content.find((c) => c.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("ClaudeDecisionProvider: model returned no tool call.");
    }
    const input = block.input as Record<string, unknown>;
    const action = actionFromInput(input);

    const usage: ProviderUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd:
        response.usage.input_tokens * this.inputCostPerToken +
        response.usage.output_tokens * this.outputCostPerToken,
    };

    const reason = typeof input.reason === "string" ? input.reason : "(no reason given)";
    this.ledger.record(o, action, reason);
    return { action, reason, usage };
  }
}

function readEnvKey(): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = viteEnv?.VITE_ANTHROPIC_API_KEY;
  if (fromVite) return fromVite;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.ANTHROPIC_API_KEY;
}

function withTimeout<T>(p: Promise<T>, ms: number, started: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ClaudeDecisionProvider: timed out after ${now() - started}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
