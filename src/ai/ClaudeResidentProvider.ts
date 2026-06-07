import Anthropic from "@anthropic-ai/sdk";
import type {
  ResidentAction,
  ResidentDecision,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
  ResidentObservation,
  ResidentProviderUsage,
} from "./residentTypes";

export interface ClaudeResidentProviderOptions {
  /** API key. Falls back to VITE_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Model id. Defaults to a fast, cheap model — this runs once per resident per day. */
  model?: string;
  /** Hard ceiling on a single call, in ms. The call rejects past this. */
  timeoutMs?: number;
  maxTokens?: number;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
}

const DEFAULTS = {
  model: "claude-haiku-4-5-20251001",
  timeoutMs: 8000,
  maxTokens: 512,
  inputCostPerToken: 1 / 1_000_000,
  outputCostPerToken: 5 / 1_000_000,
};

/**
 * The Claude-backed resident mind. Async, networked, and a contained source of
 * non-determinism — it sits behind the same seam as every other provider. It
 * returns a structured {@link ResidentDecision}; on timeout, a malformed reply,
 * or any error it rejects, and {@link ResidentAgentSystem} silently falls back
 * to the rule-based provider.
 *
 * Output is wrung through a single tool so the model must answer in the exact
 * action shape — no brittle free-text JSON parsing.
 */
export class ClaudeResidentProvider implements ResidentDecisionProvider {
  readonly id = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly inputCostPerToken: number;
  private readonly outputCostPerToken: number;

  constructor(opts: ClaudeResidentProviderOptions = {}) {
    const apiKey = opts.apiKey ?? readEnvKey();
    if (!apiKey) {
      throw new Error(
        "ClaudeResidentProvider: no API key (set VITE_ANTHROPIC_API_KEY or pass apiKey).",
      );
    }
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = opts.model ?? DEFAULTS.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens;
    this.inputCostPerToken = opts.inputCostPerToken ?? DEFAULTS.inputCostPerToken;
    this.outputCostPerToken = opts.outputCostPerToken ?? DEFAULTS.outputCostPerToken;
  }

  async decide(req: ResidentDecisionRequest): Promise<ResidentDecision> {
    const started = now();
    const decision = await withTimeout(this.call(req), this.timeoutMs, started);
    decision.usage = { ...decision.usage, latencyMs: now() - started };
    return decision;
  }

  private async call(req: ResidentDecisionRequest): Promise<ResidentDecision> {
    const { observation: o, limits } = req;
    const jobIds = o.jobOptions.filter((j) => j.hiring).map((j) => j.businessId);
    const homeIds = o.homeOptions.map((h) => h.homeId);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system:
        "You live one life in a watchable city economy. Each day you may make " +
        "ONE deliberate move with the `set_life_plan` tool — switch jobs, move " +
        "home, buy or sell a vehicle — and optionally ask for a raise, set a " +
        "savings goal, or treat yourself to a luxury once you're above that " +
        "goal. Be prudent: keep money positive, prefer higher pay and lower " +
        "rent, and only spend on a vehicle or luxuries with comfortable " +
        "savings. Invalid or out-of-bounds choices are dropped, so choose from " +
        "the listed options. Always give a one-sentence reason.",
      tool_choice: { type: "tool", name: "set_life_plan" },
      tools: [
        {
          name: "set_life_plan",
          description: "Set this resident's plan for the coming day. Make at most one structural move.",
          input_schema: {
            type: "object",
            properties: {
              switchJobTo: {
                type: "string",
                description: `Business id to take a job at. Allowed: ${jobIds.join(", ") || "(none hiring)"}. Omit to keep current job.`,
              },
              reHomeTo: {
                type: "string",
                description: `Home id to move to. Allowed: ${homeIds.join(", ") || "(none)"}. Omit to stay.`,
              },
              negotiateRaise: {
                type: "boolean",
                description: `Ask your employer for a raise (wage capped at ${limits.maxWageMultiple}x base). Omit for no.`,
              },
              buyVehicle: {
                type: "boolean",
                description: `Buy a vehicle for ${limits.vehicleCost} (faster commute). Omit for no.`,
              },
              sellVehicle: {
                type: "boolean",
                description: `Sell your vehicle for ${limits.vehicleResale}. Omit for no.`,
              },
              setSavingsGoal: {
                type: "number",
                description: `Set the cash buffer to keep before splurging (0..${limits.maxSavingsGoal}). Omit to leave unchanged.`,
              },
              buyLuxury: {
                type: "boolean",
                description: `Treat yourself to a luxury for ${limits.luxuryCost} (only fires when money is above your savings goal). Omit for no.`,
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
      throw new Error("ClaudeResidentProvider: model returned no tool call.");
    }
    const input = block.input as Record<string, unknown>;

    const action: ResidentAction = {};
    if (typeof input.switchJobTo === "string") action.switchJobTo = input.switchJobTo;
    if (typeof input.reHomeTo === "string") action.reHomeTo = input.reHomeTo;
    if (input.negotiateRaise === true) action.negotiateRaise = true;
    if (input.buyVehicle === true) action.buyVehicle = true;
    if (input.sellVehicle === true) action.sellVehicle = true;
    if (input.buyLuxury === true) action.buyLuxury = true;
    if (typeof input.setSavingsGoal === "number") action.setSavingsGoal = input.setSavingsGoal;

    const usage: ResidentProviderUsage = {
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

  private observationText(o: ResidentObservation): string {
    const jobs = o.jobOptions
      .map((j) => `${j.businessId} (${j.name}, wage ${j.wagePerTick}${j.hiring ? "" : ", not hiring"})`)
      .join("; ");
    const homes = o.homeOptions.map((h) => `${h.homeId} (${h.name}, rent ${h.rent}${h.hasVacancy ? "" : ", FULL"})`).join("; ");
    return [
      `You are ${o.name}, day ${o.day}.`,
      `Money ${round(o.money)}.`,
      o.employed
        ? `Job: ${o.jobName} at wage ${o.wagePerTick}/tick (base ${o.jobBaseWage}), ${o.daysSinceJobChange} days since you last switched.`
        : `You are jobless (no wage).`,
      `Home: ${o.homeName}, rent ${o.rent}/day. Vehicle: ${o.hasVehicle ? "yes" : "no"}.`,
      `Savings goal ${round(o.savingsGoal)}, luxuries owned ${o.luxuriesOwned}.`,
      `Needs — hunger ${round(o.needs.hunger)}, energy ${round(o.needs.energy)}, social ${round(o.needs.social)}.`,
      `Job options: ${jobs || "(none)"}.`,
      `Home options: ${homes || "(none)"}.`,
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
      reject(new Error(`ClaudeResidentProvider: timed out after ${now() - started}ms`));
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
