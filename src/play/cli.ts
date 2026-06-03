/**
 * Phase 9 — the playthrough turn engine.
 *
 * A headless, turn-based driver so I (Claude) can live in the city as the
 * resident "Joy" from a god-level vantage. Each invocation:
 *
 *   1. reads a small `play.command.json` (my move for Joy, optional God-Mode
 *      "experiments", and how many days to advance),
 *   2. restores the running city from `playthrough.save.json` (or builds a
 *      fresh one when `reset` is set or no save exists),
 *   3. applies any God-Mode experiments, then runs the day(s) — Joy's choice
 *      fires through {@link ScriptedResidentProvider} at the day boundary,
 *   4. prints a god-level report and re-saves the snapshot.
 *
 * Run it with the vite-node binary that ships with vitest:
 *   npx vite-node src/play/cli.ts
 *
 * The config (seed, who's agentic) is fixed for a playthrough; only the
 * per-turn command varies. Delete the save (or pass `reset`) to start over.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotFromJSON, snapshotToJSON } from "../utils/serialization";
import { ScriptedResidentProvider } from "./ScriptedResidentProvider";
import { DEFAULT_RESIDENT_LIMITS } from "../ai/residentClamp";
import type { ResidentAction, ResidentDecision } from "../ai/residentTypes";
import type { Needs, ResourceKind } from "../world/types";
import type { DisasterKind } from "../systems/disasters";

const SEED = 9;
const AVATAR = "res_9"; // "Joy"
const SAVE = "playthrough.save.json";
const COMMAND = "play.command.json";

/** A God-Mode "experiment" I can run before the day advances. */
type GodMove =
  | { op: "strike"; kind: DisasterKind }
  | { op: "subsidize"; from: string; to: string; amount: number }
  | { op: "bailOutPoorest"; amount: number }
  | { op: "setNeed"; residentId: string; need: keyof Needs; value: number }
  | { op: "healAll" }
  | { op: "exhaustAll" }
  | { op: "setActive"; bizId: string; active: boolean }
  | { op: "shockPrice"; resource: ResourceKind; multiplier?: number };

/** Joy's deliberate move for this turn — a resident action plus my reasoning. */
type JoyMove = ResidentAction & { reason?: string };

interface PlayCommand {
  /** Ignore any save and start a fresh playthrough. */
  reset?: boolean;
  /** Sim-days to advance this turn (default 1). */
  days?: number;
  /** Joy's strategic move, applied at the next day boundary. Omit to stand pat. */
  joy?: JoyMove;
  /** God-Mode experiments, applied before the day advances. */
  god?: GodMove[];
}

function readCommand(): PlayCommand {
  if (!existsSync(COMMAND)) return {};
  return JSON.parse(readFileSync(COMMAND, "utf8")) as PlayCommand;
}

function toAction(j: JoyMove): ResidentAction {
  const a: ResidentAction = {};
  if (j.switchJobTo !== undefined) a.switchJobTo = j.switchJobTo;
  if (j.reHomeTo !== undefined) a.reHomeTo = j.reHomeTo;
  if (j.negotiateRaise !== undefined) a.negotiateRaise = j.negotiateRaise;
  if (j.buyVehicle !== undefined) a.buyVehicle = j.buyVehicle;
  if (j.sellVehicle !== undefined) a.sellVehicle = j.sellVehicle;
  if (j.buyLuxury !== undefined) a.buyLuxury = j.buyLuxury;
  if (j.setSavingsGoal !== undefined) a.setSavingsGoal = j.setSavingsGoal;
  return a;
}

type God = ReturnType<typeof createCity>["god"];

function applyGod(god: God, m: GodMove): string {
  switch (m.op) {
    case "strike":
      return god.strike(m.kind)?.headline ?? `(strike ${m.kind} fizzled)`;
    case "subsidize":
      return god.subsidize(m.from, m.to, m.amount)?.headline ?? "(subsidy: nothing moved)";
    case "bailOutPoorest":
      return god.bailOutPoorest(m.amount)?.headline ?? "(bailout: nothing moved)";
    case "setNeed":
      return god.setNeed(m.residentId, m.need, m.value)?.headline ?? "(setNeed: no such resident)";
    case "healAll":
      return god.healAll().headline;
    case "exhaustAll":
      return god.exhaustAll().headline;
    case "setActive":
      return god.setActive(m.bizId, m.active)?.headline ?? "(setActive: no such business)";
    case "shockPrice":
      return god.shockPrice(m.resource, m.multiplier).headline;
  }
}

const money = (n: number): string => `$${n.toFixed(0)}`;
const money2 = (n: number): string => `$${n.toFixed(2)}`;
const bar = (v: number): string => {
  const filled = Math.round(v / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${v.toFixed(0).padStart(3)}`;
};

function main(): void {
  const cmd = readCommand();
  const days = Math.max(1, Math.floor(cmd.days ?? 1));

  const moves: ResidentDecision[] = cmd.joy
    ? [{ action: toAction(cmd.joy), reason: cmd.joy.reason ?? "(no reason given)" }]
    : [];

  const city = createCity({
    seed: SEED,
    brain: "rules",
    residentBrain: new ScriptedResidentProvider(moves),
    agenticResidentIds: [AVATAR],
    disasters: true,
  });
  const { sim, world, market, macro, residentAgent, events, god } = city;

  const fresh = cmd.reset || !existsSync(SAVE);
  if (!fresh) sim.restore(snapshotFromJSON(readFileSync(SAVE, "utf8")));

  const godResults = (cmd.god ?? []).map((m) => applyGod(god, m));

  const dayBefore = sim.time.time().day;
  sim.run(TICKS_PER_DAY * days);
  const dayAfter = sim.time.time().day;

  writeFileSync(SAVE, snapshotToJSON(sim.serialize()));

  // ---- god-level report --------------------------------------------------
  const joy = world.getResident(AVATAR);
  if (!joy) throw new Error(`avatar ${AVATAR} not found`);
  const job = joy.jobId ? world.getBusiness(joy.jobId) : undefined;
  const home = world.getLocation(joy.homeId);
  const L = DEFAULT_RESIDENT_LIMITS;

  const out: string[] = [];
  out.push("");
  out.push("══════════════════════════════════════════════════════════════");
  out.push(
    fresh
      ? `  NEW PLAYTHROUGH · seed ${SEED} · advanced to Day ${dayAfter}`
      : `  Day ${dayBefore + 1}${dayAfter > dayBefore + 1 ? `–${dayAfter}` : ""} · seed ${SEED}`,
  );
  out.push("══════════════════════════════════════════════════════════════");

  out.push("");
  out.push(`JOY (${AVATAR}) — currently ${joy.activity}`);
  out.push(`  hunger  ${bar(joy.needs.hunger)}`);
  out.push(`  energy  ${bar(joy.needs.energy)}`);
  out.push(`  social  ${bar(joy.needs.social)}`);
  out.push(`  wallet  ${money2(joy.money)}`);
  out.push(
    `  job     ${job ? `${job.name} @ ${money2(joy.wagePerTick)}/tick (base ${money2(job.wagePerTick)})` : "— unemployed —"}`,
  );
  out.push(`  home    ${home.name} @ ${money2(home.rent ?? 0)}/day rent`);
  out.push(`  vehicle ${joy.hasVehicle ? "yes" : "no"}`);
  out.push(`  savings goal ${money2(joy.savingsGoal ?? 0)} · luxuries ${joy.luxuriesOwned ?? 0}`);

  // Joy's applied decisions during this run (after clamping).
  const myMoves = (residentAgent?.decisions() ?? []).filter(
    (e) => e.residentId === AVATAR && e.day > dayBefore,
  );
  out.push("");
  out.push("JOY'S DECISIONS THIS TURN:");
  if (myMoves.length === 0) {
    out.push("  (none — the day boundary did not trigger a review)");
  } else {
    for (const e of myMoves) {
      const acted = Object.keys(e.action).length > 0;
      const tag = e.fallback ? " [FELL BACK TO RULES]" : "";
      out.push(`  Day ${e.day}: ${acted ? JSON.stringify(e.action) : "stood pat"}${tag}`);
      out.push(`         “${e.reason}”`);
    }
  }

  // The menu of legal moves, so my next choice is informed.
  out.push("");
  out.push(`JOB OPTIONS (switchJobTo · cooldown ${L.jobChangeCooldownDays}d):`);
  for (const b of world.businesses.filter((b) => b.id !== joy.jobId)) {
    out.push(`  ${b.id.padEnd(14)} ${b.name.padEnd(20)} ${money2(b.wagePerTick)}/tick${b.active ? "" : " [CLOSED]"}`);
  }
  out.push("HOME OPTIONS (reHomeTo):");
  for (const l of world.locations.filter((l) => l.type === "home" && l.id !== joy.homeId)) {
    out.push(`  ${l.id.padEnd(14)} ${l.name.padEnd(20)} ${money2(l.rent ?? 0)}/day`);
  }
  out.push(
    `OTHER LEVERS: negotiateRaise (×${1 + L.raiseFraction}, cap ${L.maxWageMultiple}× base, cooldown ${L.raiseCooldownDays}d) · ` +
      `buyVehicle (${money(L.vehicleCost)}) · sellVehicle (refund ${money(L.vehicleResale)}) · ` +
      `setSavingsGoal (0..${money(L.maxSavingsGoal)}) · buyLuxury (${money(L.luxuryCost)}, above your goal)`,
  );

  // City vitals + prices.
  const m = macro.latest();
  out.push("");
  out.push("CITY VITALS (latest day):");
  if (m) {
    out.push(
      `  GDP ${money(m.gdp)} · payroll ${money(m.payroll)} · rent ${money(m.rent)} · ` +
        `unemployed ${m.unemployed}/${world.residents.length} · active biz ${m.activeBusinesses}/${world.businesses.length}`,
    );
    out.push(`  total money ${money(m.totalMoney)} (conserved) · avg resource price ${money2(m.avgResourcePrice)}`);
  }
  const pb = market.priceBook();
  out.push(`  prices  grain ${money2(pb.grain)} · materials ${money2(pb.materials)} · food ${money2(pb.food)} · wares ${money2(pb.wares)}`);

  out.push("");
  out.push("BUSINESSES:");
  for (const b of world.businesses) {
    out.push(
      `  ${b.name.padEnd(20)} cash ${money(b.cash).padStart(7)} · inv ${String(b.inventory).padStart(3)} · ` +
        `price ${money2(b.price)} · emp ${b.employeeIds.length}${b.active ? "" : " · CLOSED"}`,
    );
  }

  // Disasters / events that fired during this run.
  const newEvents = (events?.events() ?? []).filter((e) => e.day > dayBefore);
  if (newEvents.length > 0) {
    out.push("");
    out.push("EVENTS THIS TURN:");
    for (const e of newEvents) out.push(`  Day ${e.day} · ${e.kind}: ${e.headline}`);
  }

  if (godResults.length > 0) {
    out.push("");
    out.push("GOD-MODE EXPERIMENTS APPLIED:");
    for (const r of godResults) out.push(`  ⚡ ${r}`);
  }

  // Machine-readable tail so I never misread a number.
  out.push("");
  out.push("===STATE===");
  out.push(
    JSON.stringify({
      day: dayAfter,
      joy: {
        money: joy.money,
        needs: joy.needs,
        activity: joy.activity,
        jobId: joy.jobId,
        jobName: job?.name ?? null,
        wagePerTick: joy.wagePerTick,
        jobBaseWage: job?.wagePerTick ?? 0,
        homeId: joy.homeId,
        homeName: home.name,
        rent: home.rent ?? 0,
        hasVehicle: joy.hasVehicle,
      },
      vitals: m ?? null,
      prices: pb,
    }),
  );

  console.log(out.join("\n"));
}

main();
