/**
 * THE 6-PLAYER MELEE — the headline benchmark: six minds, one economy.
 *
 * The six core firms form the town's ENTIRE supply chain — farm → bakery → diner on the food
 * side, mine → factory → goods store on the wares side — so every player runs a link of the
 * economy and every player's supplier is also an adversary. Wage wars have six bidders
 * (scenario v2: residents are agentic, so the labour market is REAL), price wars run down the
 * chain, and one bankruptcy can starve a whole side of town.
 *
 * FAIRNESS BY ROTATION: the seats are wildly asymmetric (producer economics ≠ storefront
 * economics), so one ROUND = 6 games with cyclic seat rotation — in game g, model m sits seat
 * (m+g) mod 6. Every model plays every seat exactly once against a full field; a model's
 * round score is the SUM of its six growth scores, so the seat portfolio is identical for
 * everyone and asymmetry cancels exactly (the duel's home-and-away logic, generalized). With
 * six identical deterministic minds, all six totals TIE — the harness's own fairness proof,
 * pinned by test.
 *
 * Scoring is the hoard-proof GROWTH score via the shared firm helpers (one valuation truth);
 * provider FACTORIES give every game fresh minds (memory ledgers never leak between games);
 * the settle loop waits for every decision, so slow models never desync; `fellback` counts
 * per seat are the per-game integrity gate.
 *
 * v1 is TACIT-ONLY: contestants see each other solely through prices, wages, and poached
 * workers — no message channel. (v2, the flag-gated "town board" for explicit communication —
 * the cartel experiment — is a recorded follow-up in BENCHMARK-REPORT-2026-06-11.md.)
 */
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { DecisionProvider } from "../ai/types";
import { PerBusinessProvider } from "../ai/PerBusinessProvider";
import { firmProductiveWorth } from "./ceoBench";
import {
  BENCH_WEALTH_ELASTICITY,
  BENCH_OWNER_DIVIDEND_SHARE,
  BENCH_CREDIT_ENABLED,
  BENCH_TRADE_ENABLED,
  BENCH_MONETARY_ENABLED,
  BENCH_GROWTH_BRAND_ELASTICITY,
} from "../systems/constants";

/** The six seats — the whole supply chain, in canonical order. */
export const MELEE_SEATS = [
  "biz_diner",
  "biz_goods",
  "biz_farm",
  "biz_mine",
  "biz_bakery",
  "biz_factory",
] as const;

export const MELEE_DAYS = 30;

export type ProviderFactory = () => DecisionProvider;

export interface MeleePlayer {
  label: string;
  make: ProviderFactory;
}

export interface MeleeConfig {
  seed: number;
  /** Sim-days per game (one decision per firm per day). */
  days?: number;
  /** Exactly six players (one per seat per game). */
  players: MeleePlayer[];
  /** Print per-game progress lines (the CLI sets this). */
  verbose?: boolean;
}

export interface MeleeSeatResult {
  game: number;
  seat: string;
  label: string;
  growthScore: number;
  survived: boolean;
  decisions: number;
  fellBack: number;
}

export interface MeleeRoundResult {
  seed: number;
  days: number;
  /** One entry per (game, seat): 36 results for a full round. */
  seatResults: MeleeSeatResult[];
  /** Σ growth score per player label, ranked descending — the round standings. */
  standings: { label: string; total: number; fellBack: number; bankruptcies: number }[];
  moneyConservedAllGames: boolean;
}

/** One melee game: all six firms agentic, each routed to its assigned mind. */
async function runMeleeGame(
  seed: number,
  days: number,
  seating: { seat: string; player: MeleePlayer }[],
): Promise<{ results: MeleeSeatResult[]; conserved: boolean }> {
  const minds = seating.map(({ seat, player }) => ({ seat, label: player.label, mind: player.make() }));
  const routes: Record<string, DecisionProvider> = {};
  for (const m of minds) routes[m.seat] = m.mind;

  const { sim, world, agent } = createCity({
    seed,
    brain: new PerBusinessProvider(routes),
    agenticBusinessIds: [...MELEE_SEATS],
    disasters: false,
    // The duel's frozen scenario contract, minus the second diner (six seats = six firms).
    wealthElasticity: BENCH_WEALTH_ELASTICITY,
    ownerDividendShare: BENCH_OWNER_DIVIDEND_SHARE,
    brandElasticity: BENCH_GROWTH_BRAND_ELASTICITY,
    producerWageFloor: 0,
    creditEnabled: BENCH_CREDIT_ENABLED,
    includeBank: false,
    tradeEnabled: BENCH_TRADE_ENABLED,
    includePort: false,
    monetaryEnabled: BENCH_MONETARY_ENABLED,
    includeAuthority: false,
    labourCompetition: true,
    // Scenario v2 (benchmark F1): the labour market is real — six bidders, agentic workers.
    residentBrain: "rules",
    agenticResidentIds: "all",
  });

  const startMoney = world.totalMoney();
  const baselines = new Map(
    minds.map((m) => [m.seat, firmProductiveWorth(world.getBusiness(m.seat)!)] as const),
  );

  for (let t = 0; t < days; t++) {
    sim.run(TICKS_PER_DAY);
    await agent!.settle();
  }

  const log = agent!.decisions();
  const results = minds.map((m, idx) => {
    const firm = world.getBusiness(m.seat)!;
    return {
      game: -1, // stamped by the round runner
      seat: m.seat,
      label: m.label,
      growthScore: firmProductiveWorth(firm) - (baselines.get(m.seat) ?? 0),
      survived: firm.active,
      decisions: log.filter((e) => e.businessId === m.seat).length,
      fellBack: log.filter((e) => e.businessId === m.seat && e.fallback).length,
      idx,
    };
  });
  return { results, conserved: Math.abs(world.totalMoney() - startMoney) < 1e-6 };
}

/**
 * One full ROUND: 6 games with cyclic rotation — game g seats player p at
 * MELEE_SEATS[(p + g) % 6]. Sequential (one game at a time), so a single-GPU box never sees
 * concurrent matches.
 */
export async function runMeleeRound(config: MeleeConfig): Promise<MeleeRoundResult> {
  if (config.players.length !== MELEE_SEATS.length) {
    throw new Error(`melee: exactly ${MELEE_SEATS.length} players required (got ${config.players.length})`);
  }
  const days = config.days ?? MELEE_DAYS;
  const seatResults: MeleeSeatResult[] = [];
  let conservedAll = true;

  for (let g = 0; g < MELEE_SEATS.length; g++) {
    const seating = config.players.map((player, p) => ({
      seat: MELEE_SEATS[(p + g) % MELEE_SEATS.length]!,
      player,
    }));
    if (config.verbose) {
      console.log(`  game ${g + 1}/6 · ` + seating.map((s) => `${s.player.label}@${s.seat.replace("biz_", "")}`).join(" · "));
    }
    const { results, conserved } = await runMeleeGame(config.seed, days, seating);
    conservedAll = conservedAll && conserved;
    for (const r of results) seatResults.push({ ...r, game: g + 1 });
    if (config.verbose) {
      console.log(
        `    scores: ` + results.map((r) => `${r.label} ${r.growthScore >= 0 ? "+" : "−"}$${Math.abs(Math.round(r.growthScore))}${r.fellBack ? ` [${r.fellBack}fb]` : ""}`).join(" · "),
      );
    }
  }

  const byLabel = new Map<string, { total: number; fellBack: number; bankruptcies: number }>();
  for (const r of seatResults) {
    const s = byLabel.get(r.label) ?? { total: 0, fellBack: 0, bankruptcies: 0 };
    s.total += r.growthScore;
    s.fellBack += r.fellBack;
    if (!r.survived) s.bankruptcies++;
    byLabel.set(r.label, s);
  }
  const standings = [...byLabel.entries()]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => b.total - a.total || (a.label < b.label ? -1 : 1));

  return { seed: config.seed, days, seatResults, standings, moneyConservedAllGames: conservedAll };
}

const money = (n: number): string => `${n < 0 ? "−" : "+"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** The round report: standings, then the per-seat matrix (who did what where). */
export function formatMeleeRound(r: MeleeRoundResult): string {
  const lines: string[] = [];
  lines.push(`MELEE ROUND · seed ${r.seed} · ${r.days} days/game · 6 games, full seat rotation · growth-scored`);
  lines.push(`  STANDINGS:`);
  r.standings.forEach((s, i) => {
    lines.push(
      `    ${i + 1}. ${s.label}  ${money(s.total)}` +
        `${s.fellBack ? `  [${s.fellBack} fellback]` : ""}${s.bankruptcies ? `  💀×${s.bankruptcies}` : ""}`,
    );
  });
  // Duplicate-model rosters (e.g. 3×nemotron vs 3×qwen — the one-resident-local-model pattern
  // for single-GPU boxes): aggregate the numbered slots by base model for the headline.
  const byModel = new Map<string, { total: number; slots: number; fellBack: number; bankruptcies: number }>();
  for (const s of r.standings) {
    const base = s.label.replace(/#\d+$/, "");
    const m = byModel.get(base) ?? { total: 0, slots: 0, fellBack: 0, bankruptcies: 0 };
    m.total += s.total;
    m.slots++;
    m.fellBack += s.fellBack;
    m.bankruptcies += s.bankruptcies;
    byModel.set(base, m);
  }
  if (byModel.size < r.standings.length) {
    lines.push(`  BY MODEL (slot totals summed — each model played every seat slots× times):`);
    [...byModel.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([base, m], i) => {
        lines.push(
          `    ${i + 1}. ${base} ×${m.slots}  ${money(m.total)}` +
            `${m.fellBack ? `  [${m.fellBack} fellback]` : ""}${m.bankruptcies ? `  💀×${m.bankruptcies}` : ""}`,
        );
      });
  }
  lines.push(`  PER-SEAT MATRIX (game: seat → score):`);
  for (const sr of r.seatResults) {
    lines.push(
      `    g${sr.game} ${sr.seat.replace("biz_", "").padEnd(8)} ${sr.label.padEnd(28)} ${money(sr.growthScore)}` +
        `${sr.survived ? "" : " BANKRUPT"}${sr.fellBack ? ` [${sr.fellBack}fb]` : ""}`,
    );
  }
  lines.push(r.moneyConservedAllGames ? `  money conserved across all games ✓` : `  ⚠ MONEY NOT CONSERVED`);
  return lines.join("\n");
}
