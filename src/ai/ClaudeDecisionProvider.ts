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
  objective:
    "Maximize your firm's net worth at the final day: cash + inventory (valued at the market " +
    "reference price, not your own ask) + equipment above the common baseline.",
};

/**
 * The default system briefing — the benchmark's information contract with the model.
 *
 * THE FAIRNESS LINE (set during the Pilot-A evaluation): the briefing discloses everything a
 * real CEO would know — how time works, their grading objective, and their OWN firm's standing
 * policies (the reserve sweep, payroll mechanics, restocking, depreciation) — and deliberately
 * does NOT disclose market behaviour (demand curves, customers' reservation prices, rivals'
 * tactics), which must be learned from the ledger. It also contains ZERO strategy advice: the
 * old prompt coached ("invest only when capacity-bound…"), which contaminates a skill
 * measurement. How to play is the thing being measured.
 */
export function defaultBriefing(objective: string): string {
  return (
    "You are the CEO of one firm in a small, fully simulated town economy.\n\n" +
    "HOW TIME WORKS: you make ONE decision each morning through the tool; the day then runs " +
    "without you — your staff sell and produce on their shifts, customers shop by their own " +
    "tastes and budgets, suppliers and rent settle automatically. Levers apply from today; " +
    "results show in tomorrow's books.\n\n" +
    `YOUR OBJECTIVE: ${objective}\n\n` +
    "YOUR FIRM'S STANDING POLICIES (your own bylaws — you know these exactly):\n" +
    "- Working reserve: cash above about $3000 counts as surplus.\n" +
    "- Dividends: each day the surplus (up to about $900/day) is paid out to the town, scaled " +
    "by your payout fraction — the setPayout lever; 1.0 (the default) pays it all out, 0 " +
    "retains everything as cash.\n" +
    "- Payroll: each staffer on shift is automatically paid your posted wage per tick; staff " +
    "have rotating days off, so the daily wage bill naturally swings.\n" +
    "- Restocking: the shop automatically buys its input at the market price and restocks " +
    "toward its warehouse target, limited by staffing and equipment capacity.\n" +
    "- Equipment: invest converts cash into capacity 1:1; only the part above the common " +
    "baseline counts toward your worth, and it wears out about 1%/day.\n" +
    "- Marketing (brand): spending builds brand equity that raises what customers will pay, " +
    "with diminishing returns and daily decay.\n\n" +
    "WHAT YOU DO NOT KNOW (and must learn from your books): how many customers buy at a given " +
    "price, what rivals will do, how the town's wages and prices will move. Your own recent " +
    "mornings — observations, choices, and outcomes — are provided as YOUR LEDGER. Use it.\n\n" +
    "RULES: out-of-range values are clamped to the stated limits; omitted levers stay as they " +
    "are. Always give a one-sentence reason. How you play is entirely up to you."
  );
}

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
  private readonly memoryTurns: number;
  /**
   * The CEO's ledger, per business: one compact line per past morning (what the books said,
   * what was chosen, why). Rides in the prompt so the model can learn across turns — without
   * it every call is amnesiac and a price probe teaches nothing. Provider-local presentation
   * of its OWN past requests/replies (never privileged world state), capped to bound growth.
   */
  private readonly ledgers = new Map<string, string[]>();

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
    this.memoryTurns = opts.memoryTurns ?? DEFAULTS.memoryTurns;
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
      messages: [{ role: "user", content: this.promptFor(o) }],
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
    if (typeof input.setPayout === "number") action.setPayout = input.setPayout;

    const usage: ProviderUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd:
        response.usage.input_tokens * this.inputCostPerToken +
        response.usage.output_tokens * this.outputCostPerToken,
    };

    const reason = typeof input.reason === "string" ? input.reason : "(no reason given)";
    this.recordLedger(o, action, reason);
    return { action, reason, usage };
  }

  /** The user message: the CEO's own ledger (when any), then today's books. */
  private promptFor(o: DecisionRequest["observation"]): string {
    const today = this.observationText(o);
    if (this.memoryTurns <= 0) return today;
    const ledger = (this.ledgers.get(o.businessId) ?? []).slice(-this.memoryTurns);
    if (ledger.length === 0) return today;
    return `YOUR LEDGER (your last ${ledger.length} mornings — observation → your choice):\n${ledger.join("\n")}\n\nTODAY:\n${today}`;
  }

  /**
   * Append one compact ledger line: the morning's key figures and what this provider chose.
   * Strictly the provider's own request/reply history — nothing the model didn't already see —
   * so memory adds continuity, never information.
   */
  private recordLedger(
    o: DecisionRequest["observation"],
    action: BusinessAction,
    reason: string,
  ): void {
    if (this.memoryTurns <= 0) return;
    const chose = Object.keys(action).length > 0 ? JSON.stringify(action) : "held steady";
    const line =
      `Day ${o.day}: cash ${round(o.cash)}, price ${round(o.price)}, inv ${o.inventory}, ` +
      `rev ${round(o.dayRevenue)}, netCash ${round(o.dayProfit)}` +
      (o.dayDistributed !== undefined && o.dayDistributed > 0
        ? `, paidOut ${round(o.dayDistributed)}`
        : "") +
      ` → ${chose} ("${reason}")`;
    const ledger = this.ledgers.get(o.businessId) ?? [];
    ledger.push(line);
    if (ledger.length > 60) ledger.shift(); // bound growth; far beyond any prompt window we use
    this.ledgers.set(o.businessId, ledger);
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
    if (o.payoutRate !== undefined && o.payoutRate < 1) {
      lines.push(`You currently retain ${Math.round((1 - o.payoutRate) * 100)}% of your surplus as working capital (paying out the rest).`);
    }
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
