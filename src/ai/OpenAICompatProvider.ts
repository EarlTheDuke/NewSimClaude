/**
 * The OpenAI-compatible business mind — the adapter for LOCAL and third-party models served
 * over the de-facto `/v1/chat/completions` dialect: Open WebUI, Ollama, LM Studio, vLLM, or
 * any hosted OpenAI-style endpoint. Built for the first live duel (Ben's local Nemotron via
 * Open WebUI).
 *
 * FAIRNESS: it sends the IDENTICAL information contract as the Claude adapter — the same
 * {@link defaultBriefing}, the same observation wording, the same {@link CeoLedger} memory —
 * via the shared ceoPrompt module. The only vendor difference is transport: many local models
 * lack reliable tool-calling, so this adapter asks for a bare JSON object and parses it
 * tolerantly (reasoning traces like `<think>…</think>` and prose around the JSON are fine;
 * the LAST balanced JSON object in the reply wins). A malformed reply rejects, and the agent
 * seam falls back to rules — loudly logged, never silent.
 *
 * Local-model realities baked in: generous default timeout (a consumer GPU can take ~a minute
 * per decision), generous max_tokens (reasoning models think out loud), zero cost accounting.
 */
import type { BusinessDecision, DecisionProvider, DecisionRequest, ProviderUsage } from "./types";
import { CeoLedger, DEFAULT_OBJECTIVE, actionFromInput, defaultBriefing } from "./ceoPrompt";

/** The slice of fetch this provider uses — injectable for tests (no network, no server). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OpenAICompatOptions {
  /** Endpoint base, e.g. `http://localhost:3000/api` (Open WebUI) or `http://localhost:11434/v1` (Ollama). */
  baseUrl: string;
  /** Exact model id as the server knows it (e.g. `nemotron-3:latest`). */
  model: string;
  /** Bearer token; optional — many local servers run open. */
  apiKey?: string;
  /** Hard ceiling on a single call, in ms. Local models are slow; default 120s. */
  timeoutMs?: number;
  maxTokens?: number;
  /** Sampling temperature passed through (default 0.2 — decisions, not poetry). */
  temperature?: number;
  /** Same knobs as the Claude adapter — the shared contract. */
  objective?: string;
  briefing?: string;
  memoryTurns?: number;
  /**
   * Appended to every user message — for model-level switches like qwen's `/no_think`
   * (local reasoning models can take MINUTES per decision thinking out loud; the switch
   * trades deliberation for tractable match wall-clock). Changes the contestant's mode, so
   * label the match accordingly (e.g. `qwen3.5:35b-nothink`).
   */
  promptSuffix?: string;
  /** Inject a fetch stub for tests. */
  fetchImpl?: FetchLike;
}

const DEFAULTS = {
  timeoutMs: 120_000,
  maxTokens: 2048,
  temperature: 0.2,
  memoryTurns: 12,
};

export class OpenAICompatProvider implements DecisionProvider {
  readonly id: string;
  private readonly fetchImpl: FetchLike;
  private readonly briefing: string;
  private readonly ledger: CeoLedger;
  private readonly opts: Required<Pick<OpenAICompatOptions, "baseUrl" | "model" | "timeoutMs" | "maxTokens" | "temperature">> &
    Pick<OpenAICompatOptions, "apiKey">;

  constructor(options: OpenAICompatOptions) {
    if (!options.baseUrl) throw new Error("OpenAICompatProvider: baseUrl is required.");
    if (!options.model) throw new Error("OpenAICompatProvider: model is required.");
    this.opts = {
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      model: options.model,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
      temperature: options.temperature ?? DEFAULTS.temperature,
    };
    this.id = `openai-compat(${options.model})`;
    // Wrapped, not referenced: a bare `fetch` reference loses its Window binding in browsers
    // ("Illegal invocation") while working fine in Node — the spectator duel found this.
    this.fetchImpl = options.fetchImpl ?? (((url, init) => fetch(url, init)) as FetchLike);
    this.briefing = options.briefing ?? defaultBriefing(options.objective ?? DEFAULT_OBJECTIVE);
    this.ledger = new CeoLedger(options.memoryTurns ?? DEFAULTS.memoryTurns);
    this.promptSuffix = options.promptSuffix ?? "";
  }

  private readonly promptSuffix: string;

  async decide(req: DecisionRequest): Promise<BusinessDecision> {
    const started = Date.now();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = setTimeout(() => controller?.abort(), this.opts.timeoutMs);
    try {
      const decision = await this.call(req, controller?.signal);
      decision.usage = { ...decision.usage, latencyMs: Date.now() - started };
      return decision;
    } finally {
      clearTimeout(timer);
    }
  }

  private async call(req: DecisionRequest, signal?: AbortSignal): Promise<BusinessDecision> {
    const { observation: o, limits } = req;
    // No reliable tool-calling on local models: the action spec rides in the user message and
    // the reply must be a bare JSON object. Same levers, same limits as the Claude tool schema.
    const spec =
      `\n\nReply with ONLY a JSON object (no code fence needed) of this shape — include only ` +
      `the levers you want to change, plus a mandatory one-sentence "reason":\n` +
      `{"setPrice": number (current ${o.price}, allowed ${limits.minPrice}-${limits.maxPrice}), ` +
      `"hire": integer (net headcount change, within ±${limits.maxHirePerReview}), ` +
      `"invest": number (equipment spend this day, 0-${limits.maxInvestPerReview}), ` +
      `"setWage": number (current ${o.wagePerTick}, role base ${o.baseWagePerTick}, never below base), ` +
      `"brand": number (marketing spend this day, 0-${limits.maxBrandPerReview}), ` +
      `"setPayout": number (dividend fraction 0-1, current ${o.payoutRate ?? 1}), ` +
      `"reason": string}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens,
        temperature: this.opts.temperature,
        messages: [
          { role: "system", content: this.briefing },
          { role: "user", content: this.ledger.promptFor(o) + spec + this.promptSuffix },
        ],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAICompatProvider: HTTP ${res.status} from ${this.opts.baseUrl}`);

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("OpenAICompatProvider: empty completion.");
    }

    const input = extractJsonObject(content);
    if (!input) throw new Error("OpenAICompatProvider: no JSON object in the reply.");
    const action = actionFromInput(input);
    const reason = typeof input.reason === "string" ? input.reason : "(no reason given)";

    const usage: ProviderUsage = {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      costUsd: 0, // local inference — electricity not billed here
    };

    this.ledger.record(o, action, reason);
    return { action, reason, usage };
  }
}

/**
 * Pull the LAST balanced top-level JSON object out of free text — tolerant of reasoning
 * traces (`<think>…</think>`), prose, and ```json fences. Last wins because reasoning models
 * often sketch a draft object while thinking and emit the real one at the end.
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  let result: Record<string, unknown> | undefined;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < stripped.length; j++) {
      const ch = stripped[j];
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(stripped.slice(i, j + 1)) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              result = parsed as Record<string, unknown>;
            }
          } catch {
            // not valid JSON — keep scanning
          }
          i = j; // resume after this candidate
          break;
        }
      }
    }
  }
  return result;
}
