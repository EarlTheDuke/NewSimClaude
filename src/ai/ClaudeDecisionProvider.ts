import Anthropic from "@anthropic-ai/sdk";
import type {
  BusinessAction,
  BusinessDecision,
  DecisionProvider,
  DecisionRequest,
  ProviderUsage,
} from "./types";

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
        "You are the CEO of one firm in a small, closed city economy, maximizing " +
        "your firm's net worth (cash + inventory + equipment) over many days. Each " +
        "day you set a plan with the `set_business_plan` tool — adjust price, " +
        "hire/lay off staff, invest cash in equipment, set the wage, and spend on " +
        "marketing to grow demand. Play it " +
        "well: price near the going market rate and never below your unit cost; " +
        "invest in equipment only when you are capacity-bound (utilization near " +
        "100%) and still hold a cash cushion; spend on marketing to lift customers' " +
        "willingness-to-pay and grow your demand when you have room to sell more; " +
        "raise the wage to attract or keep " +
        "staff when short-handed, and ease it back when fully crewed and cash is " +
        "tight; hire when you are profitable and short-handed. Values outside the " +
        "limits are clamped, so stay within them. Always give a one-sentence reason.",
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
    if (typeof input.invest === "number") action.invest = input.invest;
    if (typeof input.setWage === "number") action.setWage = input.setWage;
    if (typeof input.brand === "number") action.brand = input.brand;

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
    const lines = [
      `You run ${o.name} (a ${o.kind}). Day ${o.day}.`,
      `Cash ${round(o.cash)}, inventory ${o.inventory} units, your price ${round(o.price)}.`,
      `Staff ${o.employeeCount}${o.understaffed ? " (SHORT-HANDED — a seat is open)" : " (fully crewed)"} at wage ${o.wagePerTick}/tick (role base ${o.baseWagePerTick}); ${o.unemployedCount} people are looking for work.`,
    ];
    if (o.referencePrice !== undefined) lines.push(`The going rate for your goods is about ${round(o.referencePrice)}.`);
    if (o.rivalPrice !== undefined) lines.push(`A competitor across town charges ${round(o.rivalPrice)}.`);
    if (o.unitCost !== undefined) lines.push(`Each unit costs you ${round(o.unitCost)} to stock — selling below that loses money.`);
    if (o.capital !== undefined) {
      const util = o.capacityUtilization;
      const utilStr = util !== undefined ? `, running at ${Math.round(util * 100)}% of capacity${util > 0.9 ? " (capacity-bound — more equipment would pay off)" : ""}` : "";
      lines.push(`Equipment (capital) ${round(o.capital)}${utilStr}.`);
    }
    if (o.brand !== undefined) lines.push(`Brand equity ${round(o.brand)} — marketing spend lifts it, growing how much customers will pay and buy.`);
    const distNote = o.dayDistributed !== undefined ? `, distributed ${round(o.dayDistributed)}` : "";
    lines.push(`Yesterday: revenue ${round(o.dayRevenue)}, wages ${round(o.dayWages)}, rent/COGS ${round(o.dayRent)}${distNote}, net cash ${round(o.dayProfit)}.`);
    lines.push(`Choose this day's plan.`);
    return lines.join(" ");
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
