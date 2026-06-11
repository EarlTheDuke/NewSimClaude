/**
 * R4 — THE BROADCAST layer (wave 1+2): the Leaderboard Tower and the Thought Cam.
 *
 * Turns the dashboard into a show: a persistent F1-style rail ranking every PLAYER firm by the
 * official growth score (with momentum and bankruptcy-countdown badges), and slide-in cards
 * showing each LLM decision as it lands — the action as chips, the model's reason verbatim,
 * the think time. See PHASE-RENDER-R4-BROADCAST.md.
 *
 * RENDERING ONLY READS: this module receives the world and the decision log as read-only
 * inputs and returns plain data/HTML strings. No system, no serialization, no sim writes.
 * Scores use the exported bench helpers — ONE valuation truth with the scored instrument.
 */
import type { Business } from "../world/types";
import type { World } from "../world/World";
import type { BusinessAction, DecisionLogEntry } from "../ai/types";
import { firmProductiveWorth } from "../bench/ceoBench";
import { RETAIL_REFERENCE_PRICE, BRAND_BASELINE } from "../systems/constants";

/** One row of the tower — everything a glance needs. */
export interface FirmCard {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  /** The official score: productive worth minus the baseline at watch start. */
  score: number;
  rank: number;
  /** Positive = climbed since the last sample day (▲), negative = fell (▼). */
  rankDelta: number;
  /** Score change over the last ≤7 sampled days — the momentum arrow. */
  momentum: number;
  /** Days until $0 cash at the recent burn rate; Infinity when not burning. */
  runwayDays: number;
  staff: number;
  /** Posted wage as a multiple of the role base (1 = base). */
  wageMult: number;
  /** Price vs the kind's reference anchor, as a fraction (−0.1 = undercutting 10%). */
  pricePosture: number;
  /** Brand equity above the common baseline. */
  brandValue: number;
}

interface FirmTrack {
  scores: number[]; // one per sampled day
  cashes: number[];
}

/**
 * The read-only scorecard model: baselines anchor at construction (the opening bell of the
 * WATCH — a reload re-anchors; the headless duelCli remains the instrument of record), then
 * one sample per sim-day feeds ranks, momentum, and runway.
 */
export class BroadcastModel {
  private readonly baselines = new Map<string, number>();
  private readonly tracks = new Map<string, FirmTrack>();
  private prevRanks = new Map<string, number>();
  private ranks = new Map<string, number>();

  constructor(
    world: World,
    /** The PLAYER firms (the agentic list) — infrastructure (port, bank…) is staff, not cast. */
    private readonly playerIds: readonly string[],
  ) {
    for (const id of playerIds) {
      const b = world.getBusiness(id);
      if (b) this.baselines.set(id, firmProductiveWorth(b));
    }
  }

  /** Call once per sim-day (and once at start). Order of work: sample → re-rank. */
  sampleDay(world: World): void {
    for (const id of this.playerIds) {
      const b = world.getBusiness(id);
      if (!b) continue;
      const t = this.tracks.get(id) ?? { scores: [], cashes: [] };
      t.scores.push(this.scoreOf(b));
      t.cashes.push(b.cash);
      if (t.scores.length > 30) {
        t.scores.shift();
        t.cashes.shift();
      }
      this.tracks.set(id, t);
    }
    this.prevRanks = this.ranks;
    this.ranks = new Map(
      [...this.playerIds]
        .map((id) => ({ id, b: world.getBusiness(id) }))
        .filter((x): x is { id: string; b: Business } => !!x.b)
        .sort((x, y) => this.scoreOf(y.b) - this.scoreOf(x.b) || (x.id < y.id ? -1 : 1))
        .map((x, i) => [x.id, i + 1] as const),
    );
  }

  /** Tower rows, ranked. */
  cards(world: World): FirmCard[] {
    const out: FirmCard[] = [];
    for (const id of this.playerIds) {
      const b = world.getBusiness(id);
      if (!b) continue;
      const t = this.tracks.get(id);
      const score = this.scoreOf(b);
      const rank = this.ranks.get(id) ?? 0;
      const prev = this.prevRanks.get(id);
      const momentum =
        t && t.scores.length >= 2 ? score - t.scores[Math.max(0, t.scores.length - 8)]! : 0;
      const ref = RETAIL_REFERENCE_PRICE[b.kind];
      out.push({
        id,
        name: b.name,
        kind: b.kind,
        active: b.active,
        score,
        rank,
        rankDelta: prev !== undefined && rank > 0 ? prev - rank : 0,
        momentum,
        runwayDays: runway(b.cash, t?.cashes ?? []),
        staff: b.employeeIds.length,
        wageMult: (b.baseWagePerTick ?? b.wagePerTick) > 0 ? b.wagePerTick / (b.baseWagePerTick ?? b.wagePerTick) : 1,
        pricePosture: ref !== undefined && ref > 0 ? b.price / ref - 1 : 0,
        brandValue: (b.brand ?? BRAND_BASELINE) - BRAND_BASELINE,
      });
    }
    return out.sort((a, z) => (a.rank || 99) - (z.rank || 99));
  }

  private scoreOf(b: Business): number {
    return firmProductiveWorth(b) - (this.baselines.get(b.id) ?? 0);
  }
}

/** Days until $0 at the average burn over the last ≤7 sampled days; Infinity if not burning. */
export function runway(cash: number, cashHistory: readonly number[]): number {
  if (cashHistory.length < 3) return Infinity; // one day's dip isn't a trend — don't cry wolf
  const window = cashHistory.slice(-8);
  const burn = (window[window.length - 1]! - window[0]!) / (window.length - 1);
  if (burn >= -1e-9) return Infinity;
  return cash / -burn;
}

const money = (n: number): string =>
  `${n < 0 ? "−" : "+"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** The Tower as an HTML string (main.ts owns mounting + the click-to-select wiring). */
export function towerHTML(cards: readonly FirmCard[], selectedId?: string): string {
  if (cards.length === 0) return `<p class="hint">No player firms in this scenario.</p>`;
  const rows = cards.map((c) => {
    const move =
      c.rankDelta > 0
        ? `<span class="tw-up">▲${c.rankDelta}</span>`
        : c.rankDelta < 0
          ? `<span class="tw-down">▼${-c.rankDelta}</span>`
          : `<span class="tw-flat">·</span>`;
    const mom = c.momentum > 1 ? "🔥" : c.momentum < -1 ? "🧊" : "";
    const danger = !c.active
      ? `<span class="tw-dead">BANKRUPT</span>`
      : c.runwayDays < 7
        ? `<span class="tw-danger">🔴 ${Math.max(1, Math.round(c.runwayDays))}d cash</span>`
        : c.runwayDays < 15
          ? `<span class="tw-warn">🟠 ${Math.round(c.runwayDays)}d cash</span>`
          : "";
    const posture = [
      `${c.staff}👤`,
      c.wageMult > 1.05 ? `wage ${c.wageMult.toFixed(1)}×` : "",
      Math.abs(c.pricePosture) > 0.05
        ? `${c.pricePosture > 0 ? "premium" : "undercut"} ${Math.round(Math.abs(c.pricePosture) * 100)}%`
        : "",
      c.brandValue > 1 ? `brand ${Math.round(c.brandValue)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      `<div class="tw-row${c.id === selectedId ? " tw-sel" : ""}${c.active ? "" : " tw-out"}" data-biz="${c.id}">` +
      `<span class="tw-rank">P${c.rank}</span>` +
      `<span class="tw-chip tw-${c.kind}"></span>` +
      `<span class="tw-name">${c.name}</span>${move}` +
      `<span class="tw-score">${money(c.score)}${mom}</span>` +
      `<span class="tw-posture">${posture}</span>${danger}` +
      `</div>`
    );
  });
  return rows.join("");
}

// ── The Thought Cam (R4-2) ────────────────────────────────────────────────────────────────

/** A landed LLM decision, ready to render as a card. */
export interface ThoughtCard {
  businessId: string;
  firmName: string;
  day: number;
  chips: string[];
  reason: string;
  /** Seconds of deliberation (undefined for instant minds). */
  thinkSeconds?: number;
  /** True when the model missed the turn and rules covered. */
  missedTurn: boolean;
  providerLabel: string;
}

/** `{setPrice: 14, hire: 1}` → `["PRICE → $14", "HIRE +1"]` — shared by cards and banners. */
export function chipify(action: BusinessAction): string[] {
  const chips: string[] = [];
  if (action.setPrice !== undefined) chips.push(`PRICE → $${round2(action.setPrice)}`);
  if (action.hire !== undefined && action.hire !== 0)
    chips.push(action.hire > 0 ? `HIRE +${action.hire}` : `CUT ${-action.hire}`);
  if (action.invest !== undefined && action.invest > 0) chips.push(`INVEST $${round2(action.invest)}`);
  if (action.setWage !== undefined) chips.push(`WAGE → ${round2(action.setWage)}`);
  if (action.brand !== undefined && action.brand > 0) chips.push(`MARKETING $${round2(action.brand)}`);
  if (action.setPayout !== undefined) chips.push(`RETAIN ${Math.round((1 - action.setPayout) * 100)}%`);
  if (action.setExportShare !== undefined) chips.push(`EXPORT ${Math.round(action.setExportShare * 100)}%`);
  if (action.borrow !== undefined && action.borrow > 0) chips.push(`BORROW $${round2(action.borrow)}`);
  if (action.repay !== undefined && action.repay > 0) chips.push(`REPAY $${round2(action.repay)}`);
  if (chips.length === 0) chips.push("HOLD");
  return chips;
}

/**
 * Watches the decision log for NEW entries from the LLM seats and turns them into cards.
 * Rules firms stay quiet (their moves live in the trace panel) — no card spam.
 */
export class ThoughtCam {
  private seen = 0;

  constructor(
    /** The businessIds driven by an LLM (the duel: the rival diner). */
    private readonly llmSeats: ReadonlySet<string>,
    private readonly providerLabel: string,
  ) {}

  /** Returns cards for entries that landed since the last poll. */
  poll(log: readonly DecisionLogEntry[], world: World): ThoughtCard[] {
    const fresh = log.slice(this.seen);
    this.seen = log.length;
    const out: ThoughtCard[] = [];
    for (const e of fresh) {
      if (!this.llmSeats.has(e.businessId)) continue;
      const firm = world.getBusiness(e.businessId);
      out.push({
        businessId: e.businessId,
        firmName: firm?.name ?? e.businessId,
        day: e.day,
        chips: chipify(e.action),
        reason: e.reason,
        thinkSeconds: e.usage?.latencyMs !== undefined ? e.usage.latencyMs / 1000 : undefined,
        missedTurn: e.fallback,
        providerLabel: this.providerLabel,
      });
    }
    return out;
  }
}

/** One thought card as HTML (the big moment when a mind shows its work). */
export function thoughtCardHTML(c: ThoughtCard): string {
  if (c.missedTurn) {
    return (
      `<div class="tc-card tc-missed">` +
      `<div class="tc-head"><b>${c.firmName}</b> · day ${c.day} · <span class="tc-miss">⏱ missed the turn — rules covered</span></div>` +
      `</div>`
    );
  }
  const think =
    c.thinkSeconds !== undefined && c.thinkSeconds > 1
      ? `<span class="tc-think">deliberated ${c.thinkSeconds >= 90 ? `${(c.thinkSeconds / 60).toFixed(1)}m` : `${Math.round(c.thinkSeconds)}s`}</span>`
      : "";
  return (
    `<div class="tc-card">` +
    `<div class="tc-head"><b>${c.firmName}</b> · day ${c.day} · <span class="tc-model">${c.providerLabel}</span> ${think}</div>` +
    `<div class="tc-chips">${c.chips.map((ch) => `<span class="tc-chip">${ch}</span>`).join("")}</div>` +
    `<div class="tc-reason">“${escapeHtml(c.reason)}”</div>` +
    `</div>`
  );
}

// ── The Drama Booth (R4 wave 3) ───────────────────────────────────────────────────────────

/** A broadcast-worthy moment. Severity 2 interrupts (kill-feed banner); 1 is a small banner. */
export interface DramaEvent {
  kind: "bankrupt" | "founded" | "poach" | "hire" | "press" | "trade" | "record";
  severity: 1 | 2;
  day: number;
  headline: string;
  /** The firm at the centre of the moment, when one exists — the director's shot (wave 6). */
  subjectId?: string;
}

/**
 * Detects drama by diffing the world day-over-day — bankruptcies, new challengers, poaches
 * between player firms, the press switching on, the first export sale, and revenue records.
 * Renderer-side state only; reads the world, never writes it.
 */
export class DramaDetector {
  private prevActive = new Map<string, boolean>();
  private prevJobs = new Map<string, { jobId: string; name: string }>();
  private prevRevenue = new Map<string, number>();
  private knownBiz = new Set<string>();
  private pressSeen = false;
  private tradeSeen = false;
  private revenueRecord = 0;
  private primed = false;

  constructor(private readonly playerIds: readonly string[]) {}

  /** Call once per sim-day. The first call only anchors (no phantom drama on load). */
  sampleDay(world: World, day: number): DramaEvent[] {
    const out: DramaEvent[] = [];
    const players = new Set(this.playerIds);

    for (const b of world.businesses) {
      const wasActive = this.prevActive.get(b.id);
      const known = this.knownBiz.has(b.id);
      if (this.primed && !known) {
        out.push({
          kind: "founded",
          severity: 2,
          day,
          headline: `🏗 NEW CHALLENGER — ${b.name} opens its doors (${b.kind})`,
          subjectId: b.id,
        });
      }
      if (this.primed && known && wasActive === true && !b.active) {
        out.push({
          kind: "bankrupt",
          severity: 2,
          day,
          headline: `💀 ${b.name.toUpperCase()} IS BANKRUPT — ${b.employeeIds.length} jobs gone, the niche is open`,
          subjectId: b.id,
        });
      }
      // Revenue record — players only, with a floor so day-2 doesn't "break" a $40 record.
      if (players.has(b.id)) {
        const prevRev = this.prevRevenue.get(b.id) ?? b.pnl.revenue;
        const todays = b.pnl.revenue - prevRev;
        if (this.primed && todays > Math.max(150, this.revenueRecord * 1.15)) {
          this.revenueRecord = todays;
          out.push({
            kind: "record",
            severity: 1,
            day,
            headline: `📈 RECORD DAY — ${b.name} books $${Math.round(todays)} in a single day`,
            subjectId: b.id,
          });
        } else if (todays > this.revenueRecord) {
          this.revenueRecord = todays; // quietly ratchet (no banner unless it SMASHES it)
        }
        this.prevRevenue.set(b.id, b.pnl.revenue);
      }
      this.prevActive.set(b.id, b.active);
      this.knownBiz.add(b.id);
    }

    // Poaches: a resident who left one PLAYER firm for another overnight — the wage war on camera.
    for (const r of world.residents) {
      const prev = this.prevJobs.get(r.id);
      if (
        this.primed &&
        prev &&
        prev.jobId !== r.jobId &&
        r.jobId !== "" &&
        prev.jobId !== "" &&
        players.has(r.jobId) &&
        players.has(prev.jobId)
      ) {
        const from = world.getBusiness(prev.jobId);
        const to = world.getBusiness(r.jobId);
        out.push({
          kind: "poach",
          severity: 2,
          day,
          headline: `⚔️ POACHED — ${r.name} walks out of ${from?.name ?? prev.jobId} and into ${to?.name ?? r.jobId}`,
          subjectId: r.jobId,
        });
      }
      this.prevJobs.set(r.id, { jobId: r.jobId, name: r.name });
    }

    // One-time regime banners: the press's first dollar, the port's first export sale.
    if (this.primed && !this.pressSeen && world.mintedTotal() > 0) {
      this.pressSeen = true;
      out.push({
        kind: "press",
        severity: 2,
        day,
        headline: `🖨 THE PRESS IS ON — the City Reserve mints its first dollars`,
        subjectId: "biz_authority",
      });
    }
    if (!this.tradeSeen) {
      let x = 0;
      for (const b of world.businesses) x += b.pnl.exportRevenue ?? 0;
      if (this.primed && x > 0) {
        this.tradeSeen = true;
        out.push({
          kind: "trade",
          severity: 1,
          day,
          headline: `⛵ FIRST SAIL — the Harbor Port starts buying local exports`,
          subjectId: "biz_port",
        });
      } else if (x > 0) {
        this.tradeSeen = true; // trade already flowing at anchor time — not news
      }
    }
    if (world.mintedTotal() > 0) this.pressSeen = true;

    this.primed = true;
    return out;
  }
}

/** One banner as HTML — severity 2 interrupts, severity 1 stays modest. */
export function bannerHTML(e: DramaEvent): string {
  return `<div class="bn bn-s${e.severity} bn-${e.kind}"><span class="bn-day">DAY ${e.day}</span>${escapeHtml(e.headline)}</div>`;
}

/**
 * The highlight timeline (R4 wave 6): one dot per drama moment under the map. Clicking a dot
 * sends the director's camera to the subject and re-surfaces the headline (main.ts wires the
 * clicks; this renders the strip). Newest last; the title carries the story for hover.
 */
export function highlightStripHTML(highlights: readonly DramaEvent[]): string {
  if (highlights.length === 0) return "";
  const dots = highlights
    .map(
      (h, i) =>
        `<span class="hl-dot hl-${h.kind} hl-s${h.severity}" data-hl="${i}" title="Day ${h.day}: ${escapeHtml(h.headline)}">●</span>`,
    )
    .join("");
  return `<span class="hl-label">HIGHLIGHTS</span>${dots}`;
}

// ── The Eval Bar + match framing (R4 wave 5) ─────────────────────────────────────────────

/**
 * The chess-broadcast eval bar: a win probability from the score gap plus momentum (the
 * trend is information — a firm $100 behind but climbing fast is not losing 90/10). Pure
 * presentation arithmetic: logistic over (gap + 0.6×momentum-difference), scaled so a ~$250
 * combined edge reads as roughly 75/25. Symmetric by construction: P(A) + P(B) = 1.
 */
export function winProbability(a: FirmCard, b: FirmCard): number {
  if (!a.active && b.active) return 0.02; // a bankrupt player has lost, near-certainly
  if (a.active && !b.active) return 0.98;
  const edge = a.score - b.score + 0.6 * (a.momentum - b.momentum);
  return 1 / (1 + Math.exp(-edge / 250));
}

/** The eval bar as HTML: two names, a split bar, the live percentage. */
export function evalBarHTML(a: FirmCard, b: FirmCard): string {
  const p = winProbability(a, b);
  const pct = Math.round(p * 100);
  return (
    `<div class="ev-wrap">` +
    `<span class="ev-name${p >= 0.5 ? " ev-lead" : ""}">${escapeHtml(a.name)}</span>` +
    `<div class="ev-bar"><div class="ev-fill" style="width:${pct}%"></div><span class="ev-pct">${pct}% — ${100 - pct}%</span></div>` +
    `<span class="ev-name${p < 0.5 ? " ev-lead" : ""}">${escapeHtml(b.name)}</span>` +
    `</div>`
  );
}

/** The pre-match tale of the tape (rendered once at the opening bell of a duel watch). */
export function taleOfTheTapeHTML(
  a: { label: string; seat: string },
  b: { label: string; seat: string },
  seed: number,
  matchDays: number,
): string {
  return (
    `<div class="tape">` +
    `<div class="tape-side"><b>${escapeHtml(a.label)}</b><span>${escapeHtml(a.seat)}</span></div>` +
    `<div class="tape-mid">VS<span>seed ${seed} · ${matchDays} days · growth-scored</span></div>` +
    `<div class="tape-side"><b>${escapeHtml(b.label)}</b><span>${escapeHtml(b.seat)}</span></div>` +
    `</div>`
  );
}

/**
 * The post-match report card, auto-written from the watch (shown once when the match length
 * is reached; the town keeps living afterwards — this is the broadcast's full-time whistle,
 * not a sim event). Spectator-grade: single game, seat bias included; duelCli home-and-away
 * remains the scored instrument.
 */
export function reportCardHTML(
  a: FirmCard & { decisions: number; missed: number },
  b: FirmCard & { decisions: number; missed: number },
  days: number,
): string {
  const winner = !a.active && b.active ? b : !b.active && a.active ? a : a.score >= b.score ? a : b;
  const margin = Math.abs(a.score - b.score);
  const row = (c: FirmCard & { decisions: number; missed: number }): string =>
    `<div class="rc-row${c.id === winner.id ? " rc-win" : ""}"><b>${escapeHtml(c.name)}</b>` +
    `<span>${money(c.score)}</span>` +
    `<span>${c.decisions} moves${c.missed > 0 ? ` · ${c.missed} missed` : ""}</span>` +
    `<span>${c.active ? `${c.staff}👤 staffed` : "BANKRUPT"}</span></div>`;
  return (
    `<div class="rc-card">` +
    `<div class="rc-head">FULL TIME — DAY ${days}</div>` +
    `<div class="rc-verdict">${escapeHtml(winner.name)} WINS by ${money(margin).replace("+", "")}</div>` +
    row(a) +
    row(b) +
    `<button class="rc-dismiss" id="rcDismiss">continue watching</button>` +
    `</div>`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
