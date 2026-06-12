/**
 * Pilot B — the twin-diner DUEL: the flagship model-vs-model benchmark format.
 *
 * Two minds, one market. `biz_diner` and `biz_diner_2` are constructed as near-twins fighting
 * over the same lunch crowd (price + distance split the customers; labour competition is ON, so
 * the wage war is a live second front). Each seat is driven by its own provider through the
 * {@link PerBusinessProvider} router — model A literally cannot see model B's books.
 *
 * FAIRNESS BY HOME-AND-AWAY: the seats are *near*-twins, not perfect twins (geography differs;
 * the staffing round-robin seeds the first diner 2 staff, the rival 1), so a single game is not
 * apples-to-apples. {@link runHomeAndAway} plays the SAME seed twice with the seats swapped and
 * scores each model on the SUM of its two games — any seat advantage cancels exactly, like
 * swapping colors in chess. With two identical deterministic brains the totals tie to the cent
 * (pinned by test — the harness's own fairness proof).
 *
 * Scoring is the hoard-proof GROWTH score (productive worth delta) via the shared firm helpers,
 * so duels are immune to both the payout-retention trick and the ask-pump exploit (Pilot-A).
 *
 * Memory hygiene: configs take provider FACTORIES — each game constructs fresh minds, so a
 * model's ledger never leaks between games (one provider instance = one episode).
 */
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { DecisionProvider } from "../ai/types";
import { PerBusinessProvider } from "../ai/PerBusinessProvider";
import { firmNetWorth, firmProductiveWorth } from "./ceoBench";
import {
  BENCH_WEALTH_ELASTICITY,
  BENCH_OWNER_DIVIDEND_SHARE,
  BENCH_CREDIT_ENABLED,
  BENCH_TRADE_ENABLED,
  BENCH_MONETARY_ENABLED,
  BENCH_GROWTH_BRAND_ELASTICITY,
} from "../systems/constants";

const HOME_SEAT = "biz_diner";
const AWAY_SEAT = "biz_diner_2";
export const DUEL_DAYS = 90;

/** A factory so every game gets a FRESH mind (ledgers must not leak between games). */
export type ProviderFactory = () => DecisionProvider;

export interface DuelConfig {
  seed: number;
  /** Sim-days per game (one decision per firm per day). */
  days?: number;
  a: { label: string; make: ProviderFactory };
  b: { label: string; make: ProviderFactory };
  /** Print per-day progress (the CLI sets this; slow local models make silent runs unnerving). */
  verbose?: boolean;
}

export interface DuelSide {
  label: string;
  seat: string;
  /** The headline: hoard-proof productive-worth delta over the game. */
  growthScore: number;
  finalNetWorth: number;
  survived: boolean;
  decisions: number;
  fellBack: number;
}

export interface DuelResult {
  seed: number;
  days: number;
  a: DuelSide;
  b: DuelSide;
  moneyConserved: boolean;
}

export interface HomeAndAwayResult {
  seed: number;
  days: number;
  /** Game 1: A at the home seat; game 2: seats swapped. */
  games: [DuelResult, DuelResult];
  aLabel: string;
  bLabel: string;
  aTotal: number;
  bTotal: number;
  /** "a" | "b" | "tie" on summed growth score. */
  winner: "a" | "b" | "tie";
}

/**
 * One duel game: both diners agentic, each routed to its own mind, stepped one day at a time
 * with the in-flight (possibly async/LLM) decisions drained before the next day — so a slow
 * model never desynchronizes the match.
 */
export async function runDuel(config: DuelConfig): Promise<DuelResult> {
  const days = config.days ?? DUEL_DAYS;
  const mindA = config.a.make();
  const mindB = config.b.make();
  const router = new PerBusinessProvider({ [HOME_SEAT]: mindA, [AWAY_SEAT]: mindB });

  const { sim, world, agent } = createCity({
    seed: config.seed,
    brain: router,
    agenticBusinessIds: [HOME_SEAT, AWAY_SEAT],
    secondDiner: true,
    disasters: false,
    // The bench freezes (one shared contract with ceoBench): demand/dividend/credit/trade/
    // monetary pinned so a live-knob retune never moves historical match results. Brand runs
    // at the GROWTH elasticity — marketing is a real weapon in the duel.
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
    // The duel's second front: rivals see each other's wages and may poach staff.
    labourCompetition: true,
    // SCENARIO v2 (benchmark F1+F3, 2026-06-12): v1 shipped with NO resident agency — wage
    // levers were inert cost in every v1 match (the "phantom war"; see
    // BENCHMARK-REPORT-2026-06-11.md). v2 seats every working-age resident on the rules mind,
    // so the wage front is REAL: under-bid your crew against a hiring rival and they walk.
    // balancedDiners (F3) starts both seats at 1/1 staffing so each game carries skill
    // signal. v1 results stand as their own scenario version.
    residentBrain: "rules",
    agenticResidentIds: "all",
    balancedDiners: true,
  });

  const home = world.getBusiness(HOME_SEAT)!;
  const away = world.getBusiness(AWAY_SEAT)!;
  const startMoney = world.totalMoney();
  const startHome = firmProductiveWorth(home);
  const startAway = firmProductiveWorth(away);

  for (let t = 0; t < days; t++) {
    sim.run(TICKS_PER_DAY);
    await agent!.settle(); // drain both minds' decisions before the next day
    if (config.verbose && ((t + 1) % 5 === 0 || t + 1 === days)) {
      console.log(
        `    day ${t + 1}/${days} · ${config.a.label} worth ${Math.round(firmProductiveWorth(home) - startHome)} · ${config.b.label} worth ${Math.round(firmProductiveWorth(away) - startAway)}`,
      );
    }
  }

  const log = agent!.decisions();
  const side = (label: string, seat: string, firm: typeof home, start: number): DuelSide => ({
    label,
    seat,
    growthScore: firmProductiveWorth(firm) - start,
    finalNetWorth: firmNetWorth(firm),
    survived: firm.active,
    decisions: log.filter((e) => e.businessId === seat).length,
    fellBack: log.filter((e) => e.businessId === seat && e.fallback).length,
  });

  return {
    seed: config.seed,
    days,
    a: side(config.a.label, HOME_SEAT, home, startHome),
    b: side(config.b.label, AWAY_SEAT, away, startAway),
    moneyConserved: Math.abs(world.totalMoney() - startMoney) < 1e-6,
  };
}

/**
 * The fair match: the same seed played twice with the seats swapped; each model is scored on
 * the SUM of its home and away games, so any built-in seat advantage cancels exactly.
 */
export async function runHomeAndAway(config: DuelConfig): Promise<HomeAndAwayResult> {
  const game1 = await runDuel(config);
  const game2 = await runDuel({ ...config, a: config.b, b: config.a }); // seats swapped, fresh minds
  const aTotal = game1.a.growthScore + game2.b.growthScore;
  const bTotal = game1.b.growthScore + game2.a.growthScore;
  return {
    seed: config.seed,
    days: game1.days,
    games: [game1, game2],
    aLabel: config.a.label,
    bLabel: config.b.label,
    aTotal,
    bTotal,
    winner: Math.abs(aTotal - bTotal) < 1e-6 ? "tie" : aTotal > bTotal ? "a" : "b",
  };
}

const money = (n: number): string => `${n < 0 ? "−" : "+"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** Render a match report: both games, both totals, the verdict. */
export function formatHomeAndAway(m: HomeAndAwayResult): string {
  const lines: string[] = [];
  lines.push(`DUEL · seed ${m.seed} · ${m.days} days/game · growth-scored (hoard-proof, mark-to-market)`);
  for (let g = 0; g < 2; g++) {
    const game = m.games[g]!;
    lines.push(
      `  game ${g + 1}: ${game.a.label} @ ${game.a.seat} ${money(game.a.growthScore)}` +
        `${game.a.survived ? "" : " (BANKRUPT)"}${game.a.fellBack ? ` [${game.a.fellBack} fellback]` : ""}` +
        `  vs  ${game.b.label} @ ${game.b.seat} ${money(game.b.growthScore)}` +
        `${game.b.survived ? "" : " (BANKRUPT)"}${game.b.fellBack ? ` [${game.b.fellBack} fellback]` : ""}` +
        `${game.moneyConserved ? "" : "  ⚠ MONEY NOT CONSERVED"}`,
    );
  }
  lines.push(
    `  TOTALS: ${m.aLabel} ${money(m.aTotal)}  vs  ${m.bLabel} ${money(m.bTotal)}  →  ` +
      (m.winner === "tie" ? "TIE" : `${m.winner === "a" ? m.aLabel : m.bLabel} WINS`),
  );
  return lines.join("\n");
}
