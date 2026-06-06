import "./style.css";
import { createCity, type BrainOption, type ResidentBrainOption } from "./createCity";
import { SPEED_OPTIONS, type SpeedMultiplier } from "./core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "./utils/serialization";
import { CanvasRenderer, type Pick, type DisasterMarker } from "./render/CanvasRenderer";
import { ARCHETYPES } from "./world/archetypes";
import type { ResourceKind } from "./world/types";
import type { DisasterKind } from "./systems/disasters";
import { CAPITAL_BASELINE, GRANT_AMOUNT, MOVE_SPEED, VEHICLE_SPEED_MULT } from "./systems/constants";
import { compareExperiments, formatComparison } from "./experiment/harness";
import { summarizeCost } from "./ai/cost";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

const SAVE_KEY = "cwlc.save.v1";
const WIDTH = 640;
const HEIGHT = 480;

// The businesses run on the deterministic rule-based brain by default — fully
// watchable, zero-config. To run them on Claude instead, swap in the provider:
//   import { ClaudeDecisionProvider } from "./ai/ClaudeDecisionProvider";
//   const brain: BrainOption = new ClaudeDecisionProvider(); // needs VITE_ANTHROPIC_API_KEY
const brain: BrainOption = "rules";

// The residents likewise run on deterministic rules by default. To hand one (or
// all) of them to Claude, swap in the provider:
//   import { ClaudeResidentProvider } from "./ai/ClaudeResidentProvider";
//   const residentBrain: ResidentBrainOption = new ClaudeResidentProvider();
const residentBrain: ResidentBrainOption = "rules";
const agenticResidentIds = ["res_0", "res_1", "res_2", "res_3"];

// A rival diner across town (Phase 11b): residents now choose between two food
// sellers on price + distance, and both re-price under the brain — so the live
// city shows storefront competition, not just a lone monopolist. The newcomer
// shares the goods store's node (a strip mall) at the bottom-right.
const { sim, world, market, macro, agent, residentAgent, events, god } = createCity({
  seed: 1,
  brain,
  residentBrain,
  agenticResidentIds,
  agenticBusinessIds: ["biz_diner", "biz_diner_2", "biz_goods"],
  secondDiner: true,
  disasters: true,
});

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>CityWithLifeClaude — Phase 8 (hardening, persistence &amp; cost)</h1>
  <div class="hud">
    <div class="clock"><span id="clock">00:00</span><span class="day" id="day">Day 0</span></div>
    <div class="controls" id="controls"></div>
    <div class="stats" id="stats"></div>
  </div>
  <div class="stage">
    <canvas id="city" width="${WIDTH}" height="${HEIGHT}"></canvas>
    <div class="inspector" id="inspector"><p class="hint">Click a resident or building to inspect.</p></div>
  </div>
  <div class="hud econ">
    <h2>Economy <span class="hint" id="econTag"></span></h2>
    <div class="vitals" id="vitals"><p class="hint">No data yet — vitals post at each day boundary.</p></div>
    <div class="pricebook" id="pricebook"></div>
  </div>
  <div class="hud trace">
    <h2>City events <span class="hint" id="eventsTag"></span></h2>
    <div id="eventsLog"><p class="hint">All quiet — disasters strike at the start of a day.</p></div>
  </div>
  <div class="hud god">
    <h2>God Mode <span class="hint">· reach in and meddle (money-conserving)</span></h2>
    <div class="controls" id="godControls"></div>
    <div id="godLog"><p class="hint">No interventions yet — strike a disaster or bless the city.</p></div>
  </div>
  <div class="hud god">
    <h2>Experiment harness <span class="hint">· headless A/B over shared seeds</span></h2>
    <div class="controls" id="expControls"></div>
    <pre class="exp-output" id="expOutput">Run the A/B to compare disasters on vs off across seeds 1–3 (40 days each).</pre>
  </div>
  <div class="hud trace">
    <h2>Business decisions <span class="hint" id="brainTag"></span></h2>
    <div id="traceLog"><p class="hint">No decisions yet — businesses review once a day.</p></div>
  </div>
  <div class="hud trace">
    <h2>Resident decisions <span class="hint" id="resBrainTag"></span></h2>
    <div id="resTraceLog"><p class="hint">No decisions yet — residents review their life once a day.</p></div>
  </div>
  <div class="hud cost">
    <h2>LLM cost <span class="hint">· spend across both brains (rules = free)</span></h2>
    <div class="pricebook" id="costPanel"></div>
  </div>
`;

const clockEl = el<HTMLSpanElement>("#clock");
const dayEl = el<HTMLSpanElement>("#day");
const statsEl = el<HTMLDivElement>("#stats");
const controlsEl = el<HTMLDivElement>("#controls");
const inspectorEl = el<HTMLDivElement>("#inspector");
const vitalsEl = el<HTMLDivElement>("#vitals");
const pricebookEl = el<HTMLDivElement>("#pricebook");
const econTagEl = el<HTMLSpanElement>("#econTag");
const traceLogEl = el<HTMLDivElement>("#traceLog");
const resTraceLogEl = el<HTMLDivElement>("#resTraceLog");
const eventsLogEl = el<HTMLDivElement>("#eventsLog");
const eventsTagEl = el<HTMLSpanElement>("#eventsTag");
const godControlsEl = el<HTMLDivElement>("#godControls");
const godLogEl = el<HTMLDivElement>("#godLog");
const expControlsEl = el<HTMLDivElement>("#expControls");
const expOutputEl = el<HTMLPreElement>("#expOutput");
const costPanelEl = el<HTMLDivElement>("#costPanel");
const canvas = el<HTMLCanvasElement>("#city");

eventsTagEl.textContent = events ? "· disasters on" : "· disasters off";

el<HTMLSpanElement>("#brainTag").textContent = agent ? `· ${brain === "rules" ? "rules" : "claude"} brain` : "· brain off";
el<HTMLSpanElement>("#resBrainTag").textContent = residentAgent
  ? `· ${residentBrain === "rules" ? "rules" : "claude"} brain · ${agenticResidentIds.length} agentic`
  : "· brain off";

const renderer = new CanvasRenderer(canvas, world);
let selected: Pick | undefined;

const pauseBtn = button("Pause", () => {
  sim.time.togglePause();
  syncControls();
});
const speedBtns = new Map<SpeedMultiplier, HTMLButtonElement>();
for (const speed of SPEED_OPTIONS) {
  const btn = button(`${speed}x`, () => {
    sim.time.setSpeed(speed);
    if (sim.time.isPaused()) sim.time.resume();
    syncControls();
  });
  speedBtns.set(speed, btn);
  controlsEl.append(btn);
}
controlsEl.append(pauseBtn);
controlsEl.append(
  button("Save", () => localStorage.setItem(SAVE_KEY, snapshotToJSON(sim.serialize()))),
);
controlsEl.append(
  button("Load", () => {
    const json = localStorage.getItem(SAVE_KEY);
    if (json) sim.restore(snapshotFromJSON(json));
    renderFrame();
  }),
);

// God Mode — every act is money-conserving; we redraw right away so the
// intervention (glyph, needs, prices) shows on the next painted frame.
const STRIKES: { label: string; kind: DisasterKind }[] = [
  { label: "Fire", kind: "fire" },
  { label: "Festival", kind: "festival" },
  { label: "Illness", kind: "illness" },
  { label: "Supply shock", kind: "supplyShock" },
  { label: "Grant", kind: "grant" },
];
for (const s of STRIKES) {
  godControlsEl.append(button(s.label, () => {
    god.strike(s.kind);
    renderFrame();
  }));
}
godControlsEl.append(button("Heal all", () => { god.healAll(); renderFrame(); }));
godControlsEl.append(button("Exhaust all", () => { god.exhaustAll(); renderFrame(); }));
godControlsEl.append(button("Bail out poorest", () => { god.bailOutPoorest(GRANT_AMOUNT); renderFrame(); }));

// Experiment harness — runs fresh headless cities, fully independent of the
// live sim. Deferred a tick so the "running…" state paints before it blocks.
expControlsEl.append(button("Run A/B (disasters on/off)", () => {
  expOutputEl.textContent = "running…";
  setTimeout(() => {
    const shared = { brain, residentBrain, agenticResidentIds };
    const results = compareExperiments(
      [
        { label: "off", options: { ...shared, disasters: false }, days: 40 },
        { label: "on", options: { ...shared, disasters: true }, days: 40 },
      ],
      [1, 2, 3],
    );
    expOutputEl.textContent = formatComparison(results);
  }, 0);
}));

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
  selected = renderer.pick(x, y);
  renderFrame();
});

function el<T extends Element>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function syncControls(): void {
  const speed = sim.time.getSpeed();
  for (const [s, btn] of speedBtns) {
    btn.classList.toggle("active", s === speed && !sim.time.isPaused());
  }
  pauseBtn.textContent = sim.time.isPaused() ? "Resume" : "Pause";
  pauseBtn.classList.toggle("active", sim.time.isPaused());
}

function bar(label: string, value: number): string {
  const pct = Math.round(value);
  return `<div class="bar"><span>${label}</span><div class="track"><div style="width:${pct}%"></div></div><b>${pct}</b></div>`;
}

function money(n: number): string {
  return `$${n.toFixed(0)}`;
}

function money2(n: number): string {
  return `$${n.toFixed(2)}`;
}

function money4(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** A tiny inline-SVG sparkline of a metric's recent history. */
function sparkline(values: readonly number[], color: string): string {
  const w = 120;
  const h = 26;
  const pad = 2;
  if (values.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = (i / (n - 1)) * (w - 2 * pad) + pad;
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" /></svg>`;
}

function vitalCard(label: string, value: string, values: readonly number[], color: string): string {
  return `<div class="card"><div class="card-top"><span>${label}</span><b>${value}</b></div>${sparkline(values, color)}</div>`;
}

function renderInspector(): void {
  if (!selected) return; // keep the hint
  if (selected.kind === "resident") {
    const r = world.getResident(selected.id);
    if (!r) return;
    const job = world.getBusiness(r.jobId);
    const home = world.getLocation(r.homeId);
    const arrears = r.rentMissedDays ?? 0;
    const speed = r.hasVehicle ? MOVE_SPEED * VEHICLE_SPEED_MULT : MOVE_SPEED;
    const off =
      r.schedule && r.schedule.daysOff.length > 0
        ? r.schedule.daysOff.map((d) => WEEKDAYS[d] ?? `d${d}`).join(", ")
        : "none";
    inspectorEl.innerHTML = `
      <h2>${r.name}</h2>
      <p class="tag">${r.activity}</p>
      <p>${money(r.money)} · ${r.hasVehicle ? "has vehicle" : "no vehicle"} · ${speed.toFixed(0)} u/tick</p>
      <p>home: ${home.name} · rent ${money(home.rent ?? 0)}/day</p>
      <p>job: ${job?.name ?? "—"}${r.jobId ? ` · wage ${r.wagePerTick.toFixed(2)}/tick` : ""}</p>
      ${r.schedule ? `<p>shift ${hh(r.schedule.startHour)}–${hh(r.schedule.endHour)} · off ${off}</p>` : ""}
      <p>last paycheck ${money(r.lastPaycheck ?? 0)} · earned today ${money(r.earnedThisPeriod ?? 0)}</p>
      <p>savings goal ${money(r.savingsGoal ?? 0)} · luxuries ${r.luxuriesOwned ?? 0}</p>
      ${arrears > 0 ? `<p class="warn">rent unpaid ${arrears}d</p>` : ""}
      ${bar("Hunger", r.needs.hunger)}
      ${bar("Energy", r.needs.energy)}
      ${bar("Social", r.needs.social)}
    `;
  } else {
    const b = world.getBusiness(selected.id);
    if (!b) return;
    const a = ARCHETYPES[b.kind];
    const chain =
      [a.consumes && `consumes ${a.consumes}`, a.produces && `produces ${a.produces}`]
        .filter(Boolean)
        .join(" · ") || "no production";
    const stock =
      Object.entries(b.resources)
        .filter(([, v]) => (v ?? 0) > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "—";
    const insolvent = b.insolventDays ?? 0;
    const util = market.capacityUtilizationFor(b.id);
    const utilStr = util !== undefined ? `${(util * 100).toFixed(0)}%` : "—";
    const net = b.pnl.revenue + b.pnl.rentCollected - b.pnl.wagesPaid;
    inspectorEl.innerHTML = `
      <h2>${b.name}</h2>
      <p class="tag">${b.kind}${b.active ? "" : " · CLOSED"}</p>
      <p>cash: ${money(b.cash)} · inventory: ${b.inventory} · price: ${money(b.price)}</p>
      <p>chain: ${chain}</p>
      <p>resources: ${stock}</p>
      <p>employees: ${b.employeeIds.length} · wage ${b.wagePerTick.toFixed(2)}/tick</p>
      <p>capital: ${(b.capital ?? CAPITAL_BASELINE).toFixed(0)} · utilization: ${utilStr}</p>
      ${insolvent > 0 ? `<p class="warn">insolvent ${insolvent}d</p>` : ""}
      <p class="pnl">revenue ${money(b.pnl.revenue)} · wages ${money(b.pnl.wagesPaid)} · rent ${money(b.pnl.rentCollected)} · net ${money(net)}</p>
    `;
  }
}

function renderTrace(): void {
  if (!agent) return;
  const entries = agent.decisions();
  if (entries.length === 0) return;
  const rows = entries
    .slice(-8)
    .reverse()
    .map((e) => {
      const biz = world.getBusiness(e.businessId);
      const levers: string[] = [];
      if (e.action.setPrice !== undefined) levers.push(`price→${money(e.action.setPrice)}`);
      if (e.action.hire) levers.push(e.action.hire > 0 ? `+${e.action.hire} hire` : `${e.action.hire} layoff`);
      if (e.action.invest) levers.push(`+${money(e.action.invest)} invest`);
      const act = levers.length > 0 ? levers.join(", ") : "hold";
      const cost = e.usage?.costUsd !== undefined ? ` · $${e.usage.costUsd.toFixed(4)}` : "";
      const lat = e.usage?.latencyMs !== undefined ? ` · ${Math.round(e.usage.latencyMs)}ms` : "";
      const tag = e.fallback ? ' <span class="fallback">fallback</span>' : "";
      return `<p class="trace-row"><b>Day ${e.day}</b> ${biz?.name ?? e.businessId}: ${act}${tag}<br><span class="hint">${e.reason}${cost}${lat}</span></p>`;
    })
    .join("");
  traceLogEl.innerHTML = rows;
}

function renderResidentTrace(): void {
  if (!residentAgent) return;
  const entries = residentAgent.decisions();
  if (entries.length === 0) return;
  const rows = entries
    .slice(-8)
    .reverse()
    .map((e) => {
      const a = e.action;
      const moves: string[] = [];
      if (a.switchJobTo) moves.push(`job→${world.getBusiness(a.switchJobTo)?.name ?? a.switchJobTo}`);
      if (a.reHomeTo) moves.push(`home→${world.getLocation(a.reHomeTo).name}`);
      if (a.buyVehicle) moves.push("buy vehicle");
      if (a.sellVehicle) moves.push("sell vehicle");
      if (a.negotiateRaise) moves.push("raise");
      const act = moves.length > 0 ? moves.join(", ") : "hold";
      const cost = e.usage?.costUsd !== undefined ? ` · $${e.usage.costUsd.toFixed(4)}` : "";
      const lat = e.usage?.latencyMs !== undefined ? ` · ${Math.round(e.usage.latencyMs)}ms` : "";
      const tag = e.fallback ? ' <span class="fallback">fallback</span>' : "";
      return `<p class="trace-row"><b>Day ${e.day}</b> ${e.residentName}: ${act}${tag}<br><span class="hint">${e.reason}${cost}${lat}</span></p>`;
    })
    .join("");
  resTraceLogEl.innerHTML = rows;
}

function renderEvents(): void {
  if (!events) return;
  const entries = events.events();
  if (entries.length === 0) return;
  eventsLogEl.innerHTML = entries
    .slice(-10)
    .reverse()
    .map(
      (e) =>
        `<p class="trace-row"><b>Day ${e.day}</b> <span class="evt evt-${e.kind}">${e.kind}</span> ${e.headline}</p>`,
    )
    .join("");
}

function renderGod(): void {
  const acts = god.interventions();
  if (acts.length === 0) return;
  godLogEl.innerHTML = acts
    .slice(-10)
    .reverse()
    .map(
      (a) =>
        `<p class="trace-row"><b>Day ${a.day}</b> <span class="evt act">${a.kind}</span> ${a.headline}</p>`,
    )
    .join("");
}

function renderCost(): void {
  // Folds both decision logs into one spend/latency line. With the default rules
  // brains there's no usage, so it reads $0.0000 — the meter is live regardless,
  // ready to tally the moment a Claude provider is wired in.
  const s = summarizeCost(agent?.decisions() ?? [], residentAgent?.decisions() ?? []);
  const lat = s.avgLatencyMs > 0 ? `${Math.round(s.avgLatencyMs)}ms` : "—";
  costPanelEl.innerHTML =
    `<span class="price"><span>spend</span><b>${money4(s.totalCostUsd)}</b></span>` +
    `<span class="price"><span>decisions</span><b>${s.calls}</b></span>` +
    `<span class="price"><span>fallbacks</span><b>${s.fallbacks}</b></span>` +
    `<span class="price"><span>tokens</span><b>${s.inputTokens}/${s.outputTokens}</b></span>` +
    `<span class="price"><span>avg latency</span><b>${lat}</b></span>`;
}

function renderMacro(): void {
  const history = macro.history();
  const latest = macro.latest();
  const active = world.businesses.filter((b) => b.active).length;
  econTagEl.textContent = latest
    ? `· day ${latest.day} · ${active}/${world.businesses.length} active`
    : `· ${active}/${world.businesses.length} active`;

  if (latest) {
    vitalsEl.innerHTML = [
      vitalCard("GDP / day", money(latest.gdp), history.map((s) => s.gdp), "#58a6ff"),
      vitalCard("Investment / day", money(latest.investment), history.map((s) => s.investment), "#a371f7"),
      vitalCard("Payroll / day", money(latest.payroll), history.map((s) => s.payroll), "#2ea043"),
      vitalCard("Rent / day", money(latest.rent), history.map((s) => s.rent), "#d29922"),
      vitalCard("Capital stock", latest.totalCapital.toFixed(0), history.map((s) => s.totalCapital), "#56d4dd"),
      vitalCard("Avg price", money2(latest.avgResourcePrice), history.map((s) => s.avgResourcePrice), "#e15bc8"),
      vitalCard("Total money", money(latest.totalMoney), history.map((s) => s.totalMoney), "#9aa0a6"),
      vitalCard("Unemployed", String(latest.unemployed), history.map((s) => s.unemployed), "#e1a35b"),
    ].join("");
  }

  const pb = market.priceBook();
  pricebookEl.innerHTML =
    `<span class="pb-title">Resource prices</span>` +
    RESOURCES.map((r) => `<span class="price"><span>${r}</span><b>${money2(pb[r])}</b></span>`).join("");
}

function renderFrame(): void {
  const t = sim.time.time();
  clockEl.textContent = sim.time.clockString();
  dayEl.textContent = `Day ${t.day}`;
  statsEl.textContent = `tick ${t.totalTicks.toLocaleString()} · ${sim.time.getSpeed()}x · ${
    sim.time.isPaused() ? "paused" : "running"
  }`;
  syncControls();
  const todays = events?.latest();
  const marker: DisasterMarker | undefined =
    todays && todays.day === t.day
      ? { kind: todays.kind, headline: todays.headline, targetId: todays.targetId }
      : undefined;
  renderer.draw(t.hour + t.minute / 60, selected, marker);
  renderInspector();
  renderMacro();
  renderEvents();
  renderGod();
  renderTrace();
  renderResidentTrace();
  renderCost();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    sim.time.togglePause();
  } else if (e.key >= "1" && e.key <= "4") {
    const speed = SPEED_OPTIONS[Number(e.key) - 1];
    if (speed !== undefined) {
      sim.time.setSpeed(speed);
      if (sim.time.isPaused()) sim.time.resume();
    }
  }
  renderFrame();
});

let last = performance.now();
function frame(now: number): void {
  sim.advanceRealTime(now - last);
  last = now;
  renderFrame();
  requestAnimationFrame(frame);
}

renderFrame();
requestAnimationFrame(frame);
