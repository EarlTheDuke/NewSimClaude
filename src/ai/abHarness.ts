import { createCity, type BrainOption, type CitySimOptions } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { Business } from "../world/types";
import type { DecisionLogEntry } from "./types";

export interface ArmResult {
  label: string;
  brain: string;
  totalMoney: number;
  businesses: BusinessSummary[];
  decisions: DecisionLogEntry[];
}

export interface BusinessSummary {
  id: string;
  cash: number;
  inventory: number;
  price: number;
  employees: number;
  revenue: number;
  wagesPaid: number;
}

export interface ABResult {
  seed: number;
  days: number;
  control: ArmResult; // brain off — the Phase 1 baseline
  treatment: ArmResult; // brain on
}

/**
 * Run the same seed twice — businesses unmanaged ("off") vs managed by a brain
 * — and report each arm's end state. The control arm is, by construction, an
 * untouched Phase 1 run; the treatment arm differs only in the decisions the
 * brain made. That isolation is the whole point: any divergence is the brain's.
 */
export function runAB(
  brain: BrainOption,
  opts: { seed?: number; days?: number } & Omit<CitySimOptions, "seed" | "brain"> = {},
): ABResult {
  const seed = opts.seed ?? 1;
  const days = opts.days ?? 30;
  const ticks = TICKS_PER_DAY * days;
  const { seed: _s, days: _d, ...cityOpts } = opts as Record<string, unknown>;

  const control = runArm("control (off)", { ...cityOpts, seed, brain: "off" }, ticks);
  const treatment = runArm("treatment", { ...cityOpts, seed, brain }, ticks);

  return { seed, days, control, treatment };
}

function runArm(label: string, options: CitySimOptions, ticks: number): ArmResult {
  const { sim, world, agent } = createCity(options);
  sim.run(ticks);
  return {
    label,
    brain: options.brain === "off" || options.brain === "rules"
      ? options.brain
      : (options.brain?.id ?? "off"),
    totalMoney: world.totalMoney(),
    businesses: world.businesses.map(summarize),
    decisions: agent ? [...agent.decisions()] : [],
  };
}

function summarize(b: Business): BusinessSummary {
  return {
    id: b.id,
    cash: b.cash,
    inventory: b.inventory,
    price: b.price,
    employees: b.employeeIds.length,
    revenue: b.pnl.revenue,
    wagesPaid: b.pnl.wagesPaid,
  };
}
