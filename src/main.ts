import "./style.css";
import { createCity, type BrainOption } from "./createCity";
import { SPEED_OPTIONS, type SpeedMultiplier } from "./core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "./utils/serialization";
import { CanvasRenderer, type Pick } from "./render/CanvasRenderer";

const SAVE_KEY = "cwlc.save.v1";
const WIDTH = 640;
const HEIGHT = 480;

// The businesses run on the deterministic rule-based brain by default — fully
// watchable, zero-config. To run them on Claude instead, swap in the provider:
//   import { ClaudeDecisionProvider } from "./ai/ClaudeDecisionProvider";
//   const brain: BrainOption = new ClaudeDecisionProvider(); // needs VITE_ANTHROPIC_API_KEY
const brain: BrainOption = "rules";

const { sim, world, agent } = createCity({ seed: 1, brain });

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>CityWithLifeClaude — Phase 2 (the businesses think)</h1>
  <div class="hud">
    <div class="clock"><span id="clock">00:00</span><span class="day" id="day">Day 0</span></div>
    <div class="controls" id="controls"></div>
    <div class="stats" id="stats"></div>
  </div>
  <div class="stage">
    <canvas id="city" width="${WIDTH}" height="${HEIGHT}"></canvas>
    <div class="inspector" id="inspector"><p class="hint">Click a resident or building to inspect.</p></div>
  </div>
  <div class="hud trace">
    <h2>Decision trace <span class="hint" id="brainTag"></span></h2>
    <div id="traceLog"><p class="hint">No decisions yet — businesses review once a day.</p></div>
  </div>
`;

const clockEl = el<HTMLSpanElement>("#clock");
const dayEl = el<HTMLSpanElement>("#day");
const statsEl = el<HTMLDivElement>("#stats");
const controlsEl = el<HTMLDivElement>("#controls");
const inspectorEl = el<HTMLDivElement>("#inspector");
const traceLogEl = el<HTMLDivElement>("#traceLog");
const canvas = el<HTMLCanvasElement>("#city");

el<HTMLSpanElement>("#brainTag").textContent = agent ? `· ${brain === "rules" ? "rules" : "claude"} brain` : "· brain off";

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

function renderInspector(): void {
  if (!selected) return; // keep the hint
  if (selected.kind === "resident") {
    const r = world.getResident(selected.id);
    if (!r) return;
    const job = world.getBusiness(r.jobId);
    inspectorEl.innerHTML = `
      <h2>${r.name}</h2>
      <p class="tag">${r.activity}</p>
      <p>${money(r.money)} · home: ${world.getLocation(r.homeId).name}</p>
      <p>job: ${job?.name ?? "—"}</p>
      ${bar("Hunger", r.needs.hunger)}
      ${bar("Energy", r.needs.energy)}
      ${bar("Social", r.needs.social)}
    `;
  } else {
    const b = world.getBusiness(selected.id);
    if (!b) return;
    inspectorEl.innerHTML = `
      <h2>${b.name}</h2>
      <p class="tag">${b.kind}</p>
      <p>cash: ${money(b.cash)} · inventory: ${b.inventory} · price: ${money(b.price)}</p>
      <p>employees: ${b.employeeIds.length}</p>
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

function renderFrame(): void {
  const t = sim.time.time();
  clockEl.textContent = sim.time.clockString();
  dayEl.textContent = `Day ${t.day}`;
  statsEl.textContent = `tick ${t.totalTicks.toLocaleString()} · ${sim.time.getSpeed()}x · ${
    sim.time.isPaused() ? "paused" : "running"
  }`;
  syncControls();
  renderer.draw(selected);
  renderInspector();
  renderTrace();
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
