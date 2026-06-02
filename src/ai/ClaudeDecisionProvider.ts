import Anthropic from "@anthropic-ai/sdk";
import type {
  BusinessAction,
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
  ProviderUsage,
} from "./types";

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
}

const DEFAULTS = {
  model: "claude-haiku-4-5-20251001",
  timeoutMs: 8000,
  maxTokens: 512,
  // Rough Haiku-class rates ($/token); adjust to live pricing.
  inputCostPerToken: 1 / 1_000_000,
  outputCostPerToken: 5 / 1_000_000,
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

  constructor(opts: ClaudeProviderOptions = {}) {
    const apiKey = opts.apiKey ?? readEnvKey();
    if (!apiKey) {
      throw new Error(
        "ClaudeDecisionProvider: no API key (set VITE_ANTHROPIC_API_KEY or pass apiKey).",
      );
    }
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = opts.model ?? DEFAULTS.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens;
    this.inputCostPerToken = opts.inputCostPerToken ?? DEFAULTS.inputCostPerToken;
    this.outputCostPerToken = opts.outputCostPerToken ?? DEFAULTS.outputCostPerToken;
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
      system:
        "You run a single small business in a watchable city economy. Decide " +
        "this day's move using only the three levers in the `set_business_plan` " +
        "tool. Be conservative and profit-seeking; values outside the limits are " +
        "clamped, so stay within them. Always give a one-sentence reason.",
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
              produce: {
                type: "integer",
                description: `Units to produce, 0-${limits.maxProducePerReview}. Omit for none.`,
              },
              reason: { type: "string", description: "One sentence: why." },
            },
            required: ["reason"],
          },
        },
      ],
      messages: [{ role: "user", content: this.observationText(o) }],
    });

    const block = response.content.find((c) => c.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("ClaudeDecisionProvider: model returned no tool call.");
    }
    const input = block.input as Record<string, unknown>;

    const action: BusinessAction = {};
    if (typeof input.setPrice === "number") action.setPrice = input.setPrice;
    if (typeof input.hire === "number") action.hire = input.hire;
    if (typeof input.produce === "number") action.produce = input.produce;

    const usage: ProviderUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd:
        response.usage.input_tokens * this.inputCostPerToken +
        response.usage.output_tokens * this.outputCostPerToken,
    };

    return {
      action,
      reason: typeof input.reason === "string" ? input.reason : "(no reason given)",
      usage,
    };
  }

  private observationText(o: DecisionRequest["observation"]): string {
    return [
      `Business: ${o.name} (${o.kind}), day ${o.day}.`,
      `Cash ${round(o.cash)}, inventory ${o.inventory}, price ${round(o.price)}.`,
      `Staff ${o.employeeCount} at wage ${o.wagePerTick}/tick; ${o.unemployedCount} people available to hire.`,
      `Yesterday: revenue ${round(o.dayRevenue)}, wages ${round(o.dayWages)}, rent ${round(o.dayRent)}, net ${round(o.dayProfit)}.`,
      `Choose this day's plan.`,
    ].join(" ");
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
