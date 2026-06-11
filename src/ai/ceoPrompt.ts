/**
 * The CEO prompt contract — shared by EVERY LLM vendor adapter (Claude, OpenAI-compatible
 * locals, whatever comes next), so all benchmark contestants receive the IDENTICAL briefing,
 * observation wording, and ledger format. The Pilot-A lesson applied to prompts: duplicated
 * contract text drifts silently, and a drifted contract is an unfair match.
 */
import type { BusinessAction, DecisionRequest } from "./types";

export const DEFAULT_OBJECTIVE =
  "Maximize your firm's net worth at the final day: cash + inventory (valued at the market " +
  "reference price, not your own ask) + equipment above the common baseline.";

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
    "HOW TIME WORKS: you make ONE decision each morning; the day then runs " +
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

/** Today's books, in the shared wording every vendor adapter sends. */
export function observationText(o: DecisionRequest["observation"]): string {
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

/**
 * The CEO's ledger — one compact line per past morning (what the books said, what was chosen,
 * why), per business. Rides in the prompt so the model can learn across turns; without it
 * every call is amnesiac and a price probe teaches nothing. Strictly the provider's OWN
 * request/reply history (never privileged world state), capped to bound growth. Per-business,
 * so routed minds can never read another firm's books through their memory.
 */
export class CeoLedger {
  private readonly lines = new Map<string, string[]>();

  constructor(
    /** How many past mornings ride in the prompt. 0 disables (the stateless control arm). */
    private readonly memoryTurns: number,
  ) {}

  /** The user message: the CEO's own ledger (when any), then today's books. */
  promptFor(o: DecisionRequest["observation"]): string {
    const today = observationText(o);
    if (this.memoryTurns <= 0) return today;
    const ledger = (this.lines.get(o.businessId) ?? []).slice(-this.memoryTurns);
    if (ledger.length === 0) return today;
    return `YOUR LEDGER (your last ${ledger.length} mornings — observation → your choice):\n${ledger.join("\n")}\n\nTODAY:\n${today}`;
  }

  /** Append one morning: the key figures and what the mind chose. */
  record(o: DecisionRequest["observation"], action: BusinessAction, reason: string): void {
    if (this.memoryTurns <= 0) return;
    const chose = Object.keys(action).length > 0 ? JSON.stringify(action) : "held steady";
    const line =
      `Day ${o.day}: cash ${round(o.cash)}, price ${round(o.price)}, inv ${o.inventory}, ` +
      `rev ${round(o.dayRevenue)}, netCash ${round(o.dayProfit)}` +
      (o.dayDistributed !== undefined && o.dayDistributed > 0 ? `, paidOut ${round(o.dayDistributed)}` : "") +
      ` → ${chose} ("${reason}")`;
    const ledger = this.lines.get(o.businessId) ?? [];
    ledger.push(line);
    if (ledger.length > 60) ledger.shift(); // bound growth; far beyond any prompt window we use
    this.lines.set(o.businessId, ledger);
  }
}

/** Pull the typed action fields out of a parsed reply object (shared across adapters). */
export function actionFromInput(input: Record<string, unknown>): BusinessAction {
  const action: BusinessAction = {};
  if (typeof input.setPrice === "number") action.setPrice = input.setPrice;
  if (typeof input.hire === "number") action.hire = input.hire;
  if (typeof input.invest === "number") action.invest = input.invest;
  if (typeof input.setWage === "number") action.setWage = input.setWage;
  if (typeof input.brand === "number") action.brand = input.brand;
  if (typeof input.setPayout === "number") action.setPayout = input.setPayout;
  return action;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
