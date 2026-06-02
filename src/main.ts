import "./style.css";
import { createCity } from "./createCity";
import { SPEED_OPTIONS, type SpeedMultiplier } from "./core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "./utils/serialization";
import { CanvasRenderer, type Pick } from "./render/CanvasRenderer";

const SAVE_KEY = "cwlc.save.v1";
const WIDTH = 640;
const HEIGHT = 480;

const { sim, world } = createCity({ seed: 1 });

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>CityWithLifeClaude — Phase 1 (the city is alive)</h1>
  <div class="hud">
    <div class="clock"><span id="clock">00:00</span><span class="day" id="day">Day 0</span></div>
    <div class="controls" id="controls"></div>
    <div class="stats" id="stats"></div>
  </div>
  <div class="stage">
    <canvas id="city" width="${WIDTH}" height="${HEIGHT}"></canvas>
    <div class="inspector" id="inspector"><p class="hint">Click a resident or building to inspect.</p></div>
  </div>
`;

const clockEl = el<HTMLSpanElement>("#clock");
const dayEl = el<HTMLSpanElement>("#day");
const statsEl = el<HTMLDivElement>("#stats");
const controlsEl = el<HTMLDivElement>("#controls");
const inspectorEl = el<HTMLDivElement>("#inspector");
const canvas = el<HTMLCanvasElement>("#city");

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
      <p>cash: ${money(b.cash)} · inventory: ${b.inventory}</p>
      <p>employees: ${b.employeeIds.length}</p>
      <p class="pnl">revenue ${money(b.pnl.revenue)} · wages ${money(b.pnl.wagesPaid)} · rent ${money(b.pnl.rentCollected)}</p>
    `;
  }
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
