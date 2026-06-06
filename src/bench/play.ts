/**
 * Interactive "Claude-as-CEO" play harness (throwaway / dev tool).
 *
 * Lets a human-in-the-loop (me) play the $50k / 42-turn CEO benchmark scenario one
 * decision at a time, instead of handing it to a provider. Deterministic: the whole
 * game is replayed from a saved list of actions each invocation, so it is stateless
 * and reproducible.
 *
 *   npx vite-node src/bench/play.ts -- reset                 # start over, show turn 0 + baselines
 *   npx vite-node src/bench/play.ts -- add '{"invest":500}'  # apply my action, advance a day, show the new state
 *   npx vite-node src/bench/play.ts -- show                  # re-show current state (no new action)
 *
 * An action is a BusinessAction: { setPrice?, hire?, invest?, setWage? }. Values are
 * clamped (price ±25%/review within [1,100]; hire within ±2; invest 0..500; wage to
 * [base, base*2]). Scenario matches ceoBench exactly (seed 9, goods store, dividend +
 * elasticity frozen) so the score is comparable to the printed baselines.
 */
import * as fs from "fs";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { MockProvider } from "../ai/MockProvider";
import { runCeoBenchmark } from "./ceoBench";
import {
  BENCH_START_CAPITAL,
  BENCH_TURNS,
  BENCH_WEALTH_ELASTICITY,
  BENCH_OWNER_DIVIDEND_SHARE,
  CAPITAL_BASELINE,
  BUSINESS_RESERVE,
} from "../systems/constants";
import type { BusinessAction } from "../ai/types";

const ACTIONS_FILE = "play-actions.json";
const TARGET = "biz_goods";
const SEED = 9;

function loadActions(): BusinessAction[] {
  try {
    return JSON.parse(fs.readFileSync(ACTIONS_FILE, "utf8")) as BusinessAction[];
  } catch {
    return [];
  }
}
function saveActions(a: BusinessAction[]): void {
  fs.writeFileSync(ACTIONS_FILE, JSON.stringify(a));
}

function netWorth(ceo: { cash: number; inventory: number; price: number; capital?: number }): number {
  return ceo.cash + ceo.inventory * ceo.price + Math.max(0, (ceo.capital ?? CAPITAL_BASELINE) - CAPITAL_BASELINE);
}

type DayHook = (day: number, ceo: any, market: any, prevCash: number, prevPnl: any) => void;

function replay(actions: BusinessAction[], onDay?: DayHook) {
  const decisions = actions.length
    ? actions.map((a) => ({ action: a, reason: "claude" }))
    : [{ action: {} as BusinessAction, reason: "noop" }];
  const provider = new MockProvider({ decisions });
  const { sim, world, market } = createCity({
    seed: SEED,
    brain: provider,
    agenticBusinessIds: [TARGET],
    disasters: false,
    wealthElasticity: BENCH_WEALTH_ELASTICITY,
    ownerDividendShare: BENCH_OWNER_DIVIDEND_SHARE,
  });
  const ceo = world.getBusiness(TARGET)!;
  ceo.cash = BENCH_START_CAPITAL; // genesis recapitalization
  let prevCash = ceo.cash;
  let prevPnl = { ...ceo.pnl };
  for (let t = 0; t < actions.length; t++) {
    prevCash = ceo.cash;
    prevPnl = { ...ceo.pnl };
    sim.run(TICKS_PER_DAY);
    onDay?.(t + 1, ceo, market, prevCash, prevPnl);
  }
  return { world, market, ceo, prevCash, prevPnl };
}

function report(actions: BusinessAction[]): void {
  const { world, market, ceo, prevCash, prevPnl } = replay(actions);
  const turn = actions.length;
  const wares = market.priceBook().wares;
  const util = market.capacityUtilizationFor(ceo.id);
  const dayRevenue = ceo.pnl.revenue - prevPnl.revenue;
  const dayWages = ceo.pnl.wagesPaid - prevPnl.wagesPaid;
  const dayCash = ceo.cash - prevCash;
  const unemployed = world.residents.filter((r) => r.jobId === "").length;
  const base = ceo.baseWagePerTick ?? ceo.wagePerTick;
  const nw = netWorth(ceo);
  console.log(`\n=== TURN ${turn} / ${BENCH_TURNS}  (day ${turn}) ===`);
  console.log(`NET WORTH: $${nw.toFixed(0)}   [cash $${ceo.cash.toFixed(0)} + inventory ${ceo.inventory}@$${ceo.price.toFixed(2)}=$${(ceo.inventory * ceo.price).toFixed(0)} + capital-above-base $${Math.max(0, (ceo.capital ?? 100) - 100).toFixed(0)}]`);
  console.log(`reserve floor $${BUSINESS_RESERVE} (cash above this is distributed away each day, capped ~$900/day)`);
  console.log(`price $${ceo.price.toFixed(2)} (anchor $34) | unit cost (wares) $${wares.toFixed(2)} | inventory ${ceo.inventory}`);
  console.log(`staff ${ceo.employeeIds.length}${util === undefined ? "" : ""} @ wage ${ceo.wagePerTick.toFixed(3)} (base ${base.toFixed(2)}, max ${(base * 2).toFixed(2)}) | utilization ${util !== undefined ? (util * 100).toFixed(0) + "%" : "n/a"}`);
  console.log(`capital ${(ceo.capital ?? 100).toFixed(0)} (baseline 100) | unemployed in town ${unemployed}`);
  if (turn > 0) console.log(`yesterday: revenue $${dayRevenue.toFixed(0)} | wages $${dayWages.toFixed(0)} | net cashΔ $${dayCash.toFixed(0)}`);
  console.log(`levers: { setPrice?, hire? (±2), invest? (0-500), setWage? } — omit to leave alone`);
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const cmd = args[0] ?? "show";

  if (cmd === "reset") {
    saveActions([]);
    report([]);
    const off = runCeoBenchmark({ seed: SEED, brain: "off" });
    const rules = runCeoBenchmark({ seed: SEED, brain: "rules" });
    console.log(`\nBASELINES to beat @ ${BENCH_TURNS} turns:  no-op $${off.finalNetWorth.toFixed(0)}  |  rules $${rules.finalNetWorth.toFixed(0)}`);
    return;
  }

  if (cmd === "add") {
    const raw = args[1];
    if (!raw) throw new Error("play add: missing action JSON");
    const action = JSON.parse(raw) as BusinessAction;
    const a = loadActions();
    a.push(action);
    saveActions(a);
    report(a);
    return;
  }

  if (cmd === "hold") {
    const n = parseInt(args[1] ?? "1", 10);
    const a = loadActions();
    for (let i = 0; i < n; i++) a.push({});
    saveActions(a);
    report(a);
    return;
  }

  if (cmd === "log") {
    const a = loadActions();
    console.log("day | price | inv | util | dayRev | dayWage* | cash | netWorth   (*wage tally incl. distribution — see PLAYTHROUGH.md bug #1)");
    replay(a, (day, ceo, market, prevCash, prevPnl) => {
      const util = market.capacityUtilizationFor(ceo.id);
      const dayRev = ceo.pnl.revenue - prevPnl.revenue;
      const dayWage = ceo.pnl.wagesPaid - prevPnl.wagesPaid;
      console.log(
        `${String(day).padStart(3)} | $${ceo.price.toFixed(0).padStart(3)} | ${String(ceo.inventory).padStart(3)} | ${(util !== undefined ? (util * 100).toFixed(0) + "%" : "-").padStart(4)} | $${dayRev.toFixed(0).padStart(4)} | $${dayWage.toFixed(0).padStart(5)} | $${ceo.cash.toFixed(0).padStart(6)} | $${netWorth(ceo).toFixed(0).padStart(6)}`,
      );
    });
    return;
  }

  report(loadActions());
}

main();
