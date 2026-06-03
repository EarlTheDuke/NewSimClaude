import "./style.css";
import { createCity, type BrainOption, type ResidentBrainOption } from "./createCity";
import { SPEED_OPTIONS, type SpeedMultiplier } from "./core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "./utils/serialization";
import { CanvasRenderer, type Pick, type DisasterMarker } from "./render/CanvasRenderer";
import { ARCHETYPES } from "./world/archetypes";
import type { ResourceKind } from "./world/types";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];

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

const { sim, world, market, macro, agent, residentAgent, events } = createCity({
  seed: 1,
  brain,
  residentBrain,
  agenticResidentIds,
  disasters: true,
});

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>CityWithLifeClaude — Phase 6 (disasters &amp; drama)</h1>
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
  <div class="hud trace">
    <h2>Business decisions <span class="hint" id="brainTag"></span></h2>
    <div id="traceLog"><p class="hint">No decisions yet — businesses review once a day.</p></div>
  </div>
  <div class="hud trace">
    <h2>Resident decisions <span class="hint" id="resBrainTag"></span></h2>
    <div id="resTraceLog"><p class="hint">No decisions yet — residents review their life once a day.</p></div>
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
    inspectorEl.innerHTML = `
      <h2>${r.name}</h2>
      <p class="tag">${r.activity}</p>
      <p>${money(r.money)} · ${r.hasVehicle ? "has vehicle" : "no vehicle"}</p>
      <p>home: ${home.name} · rent ${money(home.rent ?? 0)}/day</p>
      <p>job: ${job?.name ?? "—"}${r.jobId ? ` · wage ${r.wagePerTick.toFixed(2)}/tick` : ""}</p>
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
    inspectorEl.innerHTML = `
      <h2>${b.name}</h2>
      <p class="tag">${b.kind}${b.active ? "" : " · CLOSED"}</p>
      <p>cash: ${money(b.cash)} · inventory: ${b.inventory} · price: ${money(b.price)}</p>
      <p>chain: ${chain}</p>
      <p>resources: ${stock}</p>
      <p>employees: ${b.employeeIds.length}</p>
      ${insolvent > 0 ? `<p class="warn">insolvent ${insolvent}d</p>` : ""}
      <p class="pnl">revenue ${money(b.pnl.revenue)} · wages ${money(b.pnl.wagesPaid)} · rent ${money(b.pnl.rentCollected)}</p>
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
      if (e.action.produce) levers.push(`+${e.action.produce} stock`);
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
      vitalCard("Payroll / day", money(latest.payroll), history.map((s) => s.payroll), "#2ea043"),
      vitalCard("Rent / day", money(latest.rent), history.map((s) => s.rent), "#d29922"),
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
  renderTrace();
  renderResidentTrace();
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
