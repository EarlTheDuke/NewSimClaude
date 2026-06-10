import "./style.css";
import { createCity, type BrainOption, type ResidentBrainOption } from "./createCity";
import { RuleBasedResidentProvider } from "./ai/RuleBasedResidentProvider";
import type {
  ResidentDecision,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
} from "./ai/residentTypes";
import type { MonetarySystem } from "./systems/MonetarySystem";
import { SPEED_OPTIONS, type SpeedMultiplier } from "./core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "./utils/serialization";
import { CanvasRenderer, type Pick, type DisasterMarker, type ThoughtBubble, type MapToast } from "./render/CanvasRenderer";
import type { PopulationEventKind } from "./systems/PopulationSystem";
import { PixiRenderer } from "./render/PixiRenderer";
import type { CityRenderer } from "./render/CityRenderer";
import {
  tickerItems,
  latestDecisionFor,
  summarizeBusinessAction,
  summarizeResidentAction,
} from "./render/DecisionNarration";
import { ARCHETYPES } from "./world/archetypes";
import type { BusinessKind, ResourceKind } from "./world/types";
import type { DisasterKind } from "./systems/disasters";
import { CAPITAL_BASELINE, GRANT_AMOUNT, MOVE_SPEED, VEHICLE_SPEED_MULT } from "./systems/constants";
import { compareExperiments, formatComparison } from "./experiment/harness";
import { summarizeCost } from "./ai/cost";

const RESOURCES: ResourceKind[] = ["grain", "materials", "food", "wares"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

// ── Scenario seam — "?scenario=boom" loads Boom Town (Phase 9 Arc 3, live) ──────────────
// The C4 playthrough city, watchable: the Harbor Port trades from day one, the City Reserve
// stands dormant until God sets a policy (dev handle → monetary.setPolicy), and Joy (res_9)
// is PLAYED rather than ruled — her moves are queued via window.cwlc.joy.queue, and she
// stands pat between them. Every other resident lives on the rules mind, newcomers included.
// No param ⇒ the default demo below, byte-for-byte as before.
const boom = new URLSearchParams(location.search).get("scenario") === "boom";

const SAVE_KEY = boom ? "cwlc.save.boom.v1" : "cwlc.save.v1"; // scenario-scoped, so saves never cross worlds
const WIDTH = 640;
const HEIGHT = 480;

/**
 * The Boom Town resident mind: the whole town runs on the deterministic rules — except the
 * avatar, who is played live. Queued decisions apply one per daily review (the play-harness
 * contract); an empty queue means Joy stands pat, because her life belongs to her player.
 */
class JoyAndTheTown implements ResidentDecisionProvider {
  readonly id = "claude-joy";
  private readonly rules = new RuleBasedResidentProvider();
  private readonly queued: ResidentDecision[] = [];
  constructor(private readonly avatar: string) {}
  /** Queue Joy's next move (applied at the next day boundary). Returns the queue depth. */
  queue(action: ResidentDecision["action"], reason: string): number {
    this.queued.push({ action, reason });
    return this.queued.length;
  }
  decide(req: ResidentDecisionRequest): ResidentDecision | Promise<ResidentDecision> {
    if (req.observation.residentId !== this.avatar) return this.rules.decide(req);
    return this.queued.shift() ?? { action: {}, reason: "Living the day as it comes." };
  }
}
const joyMind = boom ? new JoyAndTheTown("res_9") : undefined;
// Joy's opening move ships with the scenario, so every Boom Town window starts the same story:
// at the first dawn she walks from the farm to the foundry (the Arc 3 opener, now with the whole
// town awake to fight back). Later moves are queued live through the dev handle.
joyMind?.queue(
  { switchJobTo: "biz_factory" },
  "Day one in Boom Town, and I've read this story before: the foundry pays double the farm, and every growing firm will need its machines. This time the whole town is awake — so I'm getting there first.",
);

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
// The full living firm economy (Phase 15): EVERY resident is an agent, so the whole
// labour market is live — workers chase better-paying jobs, firms that fall short
// of staff bid wages up, and the supply chain reshuffles itself in front of you.
// "all" = every working-age resident is an agent — so HP3 newcomers and grown-up
// children live their own economic lives (chase jobs, ask for raises, spend) just
// like the seeded twelve; newborns are dependents until they come of age.
const agenticResidentIds = "all" as const;

// Every firm runs the brain too (a rival diner included, Phase 11b — two food
// sellers competing on price + distance, sharing the goods store's node in a strip
// mall). So the live city shows the whole thing at once: producers and storefronts
// pricing, hiring, bidding wages and investing in equipment; owners enriching on
// dividends; and — over a long watch — marginal firms going bankrupt and fresh ones
// being *founded* by resident-entrepreneurs to refill the niches (Phase 15 D). This
// is the watchable AI city economy the project is for; the decision traces narrate
// every move. (Set agenticBusinessIds back to just the storefronts for the calmer,
// pre-Phase-15 view.)
const { sim, world, market, macro, agent, residentAgent, events, god, population, welfare } = createCity(
  boom
    ? {
        // ── BOOM TOWN (?scenario=boom) — Phase 9 Arc 3, live and watchable ──────────────
        // The whole verified free-market program + the C4 money fork: the Harbor Port trades
        // from day one (its $20k reserve is the finite foreign demand battery), credit and
        // competition run hot, the town can grow — and unlike the headless arc, EVERY
        // resident is agentic, so the labour market can carry the boom to the street (the
        // P11-4 contrast, played out on screen). The City Reserve is seeded and ARMED
        // (monetaryEnabled) but inert at rate 0 / cap 0 — God flips the press live via
        // cwlc.monetary.setPolicy(rate, cap). Joy (res_9) is the player's avatar.
        seed: 9,
        brain,
        residentBrain: joyMind!,
        agenticResidentIds: "all",
        agenticBusinessIds: [
          "biz_diner",
          "biz_diner_2",
          "biz_goods",
          "biz_farm",
          "biz_mine",
          "biz_bakery",
          "biz_factory",
        ],
        secondDiner: true,
        disasters: true,
        populationGrowth: true,
        populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
        wageCapMult: 8,
        welfareRatio: 0.5,
        welfareSubsistence: 2,
        dividendWean: 0.5,
        producerCompetition: 2,
        labourCompetition: true,
        opportunityEntry: true,
        includeBank: true,
        creditEnabled: true,
        creditDailyRate: 0.003,
        creditMaxPrincipal: 4000,
        includePort: true,
        tradeEnabled: true,
        includeAuthority: true,
        monetaryEnabled: true, // armed; rate 0 + cap 0 keep it inert until God sets a policy
      }
    : {
  seed: 1,
  brain,
  residentBrain,
  agenticResidentIds,
  agenticBusinessIds: [
    "biz_diner",
    "biz_diner_2",
    "biz_goods",
    "biz_farm",
    "biz_mine",
    "biz_bakery",
    "biz_factory",
  ],
  secondDiner: true,
  disasters: true,
  // HP3 — the living, GROWING city: as the town prospers, families have children
  // and newcomers move in, filling the spare housing (HP1) so firms gain real
  // customers and the open seats (14 producer seats vs the 12 seeded residents)
  // get staffed. Residents age, children come of age and take jobs (HP3-9), and the
  // old eventually pass on with their estate inherited — a full, self-sustaining
  // demographic cycle. Verified over 40 sim-years: employment holds ~13/16, every
  // producer kind stays staffed, revenue grows, money conserved. Default-OFF in
  // createCity (tests/bench unchanged); engaged here so the town lives before you.
  populationGrowth: true,
  // ...and when every home is full, the landlord builds more (HP4), so the town keeps
  // growing in a staircase rather than freezing at the seeded cap — self-limiting as
  // prosperity dilutes, so it settles at a wealth-supported size. Rents respond to
  // housing scarcity (HP2): they climb as the town fills and ease as the landlord
  // builds — a real housing market that gives the landlord meaning.
  populationOptions: { births: true, mortality: true, construction: true, dynamicRent: true },
  // Free-market experiment (INITIATIVE-01) — ENGAGED here so the town runs as a free labour
  // market with a single control. Both default-OFF in createCity (tests/bench byte-identical);
  // turned on only in this live view.
  //   • wageCapMult 8 — "free the wage": short-staffed firms may bid well past the old 2× cap to
  //     win scarce labour, so the wage/profit split EMERGES from competition instead of a decree.
  //   • welfareRatio 0.5 — the one control: every non-earner gets ~half the average worker's daily
  //     income, funded by a levy on business surplus (capital, not wages). A 6-year A/B showed
  //     this is what actually keeps the closed economy circulating (highest velocity, lowest Gini,
  //     least unemployment) — free wages ALONE pooled wealth and stalled.
  //   • dividendWean 0.5 — the S3 result, engaged: the artificial UBI-like recirculation pump is
  //     half removed, so wages + welfare carry more of the circulation. A verified 12-year/3-seed
  //     experiment found the closed economy SELF-CIRCULATES without the pump (stable low velocity,
  //     solvent non-workers) — money creation is NOT required — but fully removing it (wean 0)
  //     leaves it near-frozen with money pooled in firm cash, so we keep it half-on here so the
  //     town stays lively to watch. See INITIATIVE-01-WAGE-CIRCULATION.md "S3 Results".
  wageCapMult: 8,
  welfareRatio: 0.5,
  welfareSubsistence: 2,
  dividendWean: 0.5,
  // Business creation & industries (INITIATIVE-02 / "Initiative A") — ENGAGED here so the economy
  // SELF-EXPANDS before your eyes. Both default-OFF in createCity (tests/bench byte-identical);
  // turned on only in this live view.
  //   • opportunityEntry — a storefront or producer that runs flat-out AND stays solvent draws a
  //     RIVAL: a second firm of its kind is founded (storefronts open across town, producers
  //     co-locate), funded by a resident-entrepreneur out of savings (no money minted) and crewed
  //     from the jobless pool. Watch the town-life feed + the map for a new firm born into a busy
  //     niche as population growth lifts demand against capacity.
  //   • extraIndustries — a genuinely NEW, data-driven industry registered at build time: an
  //     "orchard" producing grain, which the bakery buys alongside the farm via the multi-producer
  //     chain. It appears on the map in TEAL — the fallback colour for a kind the palette doesn't
  //     know, i.e. a brand-new industry. (Its kind is outside the seeded union, hence the one cast.)
  opportunityEntry: true,
  extraIndustries: [
    { kind: "orchard" as BusinessKind, produces: "grain", sellsToResidents: false, target: 50, maxPerDay: 36 },
  ],
      },
);

// Boom Town opens at 10x — one sim-day ≈ 2.4 real minutes, the watch-along commentary pace.
// (The speed buttons / 1–4 keys still work; this only sets the opening tempo.)
if (boom) sim.time.setSpeed(10);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>NewSimClaude — ${boom ? "BOOM TOWN <span class=\"hint\">· Arc 3 live: the harbor trades, the City Reserve waits, and Joy is played (seed 9, port 5174)</span>" : "Free-Market Economy <span class=\"hint\">· free wage + welfare + business entry + new industry (port 5174)</span>"}</h1>
  <div class="hud">
    <div class="clock"><span id="clock">00:00</span><span class="day" id="day">Day 0</span></div>
    <div class="controls" id="controls"></div>
    <div class="stats" id="stats"></div>
    <div class="stats" id="popline" title="Live demography (HP3/HP4)"></div>
  </div>
  <div class="stage">
    <canvas id="city" width="${WIDTH}" height="${HEIGHT}"></canvas>
    <div class="inspector" id="inspector"><p class="hint">Click a resident or building to inspect.</p></div>
  </div>
  <div class="ticker" id="ticker"><span class="hint">The city's decisions will scroll here as days roll…</span></div>
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
    <h2>Town life <span class="hint">· births, arrivals, kids growing up, partings &amp; building</span></h2>
    <div id="townLife"><p class="hint">The town's comings and goings will appear here as days roll…</p></div>
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
const popLineEl = el<HTMLDivElement>("#popline");
const controlsEl = el<HTMLDivElement>("#controls");
const inspectorEl = el<HTMLDivElement>("#inspector");
const vitalsEl = el<HTMLDivElement>("#vitals");
const pricebookEl = el<HTMLDivElement>("#pricebook");
const econTagEl = el<HTMLSpanElement>("#econTag");
const traceLogEl = el<HTMLDivElement>("#traceLog");
const resTraceLogEl = el<HTMLDivElement>("#resTraceLog");
const eventsLogEl = el<HTMLDivElement>("#eventsLog");
const eventsTagEl = el<HTMLSpanElement>("#eventsTag");
const townLifeEl = el<HTMLDivElement>("#townLife");

// Town-life feed + population history (HP3/HP4 watchability) — rendering-only state.
// Sampled once per sim-day in renderFrame; the feed narrates demographic events as
// the cumulative counts tick up, the sparkline traces the town's growth curve.
const popHistory: number[] = [];
// Welfare disbursed per sampled day (Initiative #1 S2) — charted as its own vital.
const welfareHistory: number[] = [];
let lastWelfarePaid = 0;
const townLife: string[] = [];
let lastDemoDay = -1;
let lastDemoCounts = { born: 0, died: 0, migrated: 0, grewUp: 0 };
let lastHomeCount = world.locations.filter((l) => l.type === "home").length;
const godControlsEl = el<HTMLDivElement>("#godControls");
const godLogEl = el<HTMLDivElement>("#godLog");
const expControlsEl = el<HTMLDivElement>("#expControls");
const expOutputEl = el<HTMLPreElement>("#expOutput");
const costPanelEl = el<HTMLDivElement>("#costPanel");
const canvas = el<HTMLCanvasElement>("#city");
const tickerEl = el<HTMLDivElement>("#ticker");

// Name resolvers for the decision narration (read-only). A business id → its
// name; any id a resident move references → a business or a location name.
const businessNameOf = (id: string): string => world.getBusiness(id)?.name ?? id;
const resolveName = (id: string): string => {
  const b = world.getBusiness(id);
  if (b) return b.name;
  return world.locations.find((l) => l.id === id)?.name ?? id;
};

eventsTagEl.textContent = events ? "· disasters on" : "· disasters off";

el<HTMLSpanElement>("#brainTag").textContent = agent ? `· ${brain === "rules" ? "rules" : "claude"} brain` : "· brain off";
el<HTMLSpanElement>("#resBrainTag").textContent = residentAgent
  ? `· ${residentBrain === "rules" ? "rules" : "claude"} brain · all agentic`
  : "· brain off";

// Renderer seam (visualization R2g): the WebGL Pixi renderer is now the default —
// parity with the canvas was verified per-slice and signed off. ?renderer=canvas
// rolls back to the original CanvasRenderer (kept compiled as the live fallback).
const useCanvas = new URLSearchParams(location.search).get("renderer") === "canvas";
const renderer: CityRenderer = useCanvas
  ? new CanvasRenderer(canvas, world)
  : new PixiRenderer(canvas, world);
let selected: Pick | undefined;

// Thought-bubble lifecycle + narration toggle (presentation-only). The fade is
// wall-clock (performance.now) — it animates the view and never touches sim state,
// so determinism is untouched.
let narrationOn = true;
const BUBBLE_TTL_MS = 4500;
interface LiveBubble {
  businessId: string;
  summary: string;
  bornMs: number;
}
let liveBubbles: LiveBubble[] = [];
let lastBizDecisionCount = 0;

// Floating map toasts for demographic events (HP3 watchability). A glyph pops at the
// home where each birth/arrival/coming-of-age/build/parting happens and drifts up as
// it fades. Driven by PopulationSystem's monotonic event log (seq → toast once).
const TOAST_TTL_MS = 2600;
const TOAST_GLYPH: Record<PopulationEventKind, string> = {
  birth: "👶",
  arrival: "🧳",
  grewUp: "🎓",
  build: "🏠",
  death: "🕯️",
};
interface LiveToast {
  x: number;
  y: number;
  text: string;
  bornMs: number;
}
const liveToasts: LiveToast[] = [];
let lastToastSeq = 0;

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

// Decision-narration toggle (thought bubbles + ticker), default on.
const narrationBtn = button("Narration: on", () => {
  narrationOn = !narrationOn;
  narrationBtn.textContent = `Narration: ${narrationOn ? "on" : "off"}`;
  narrationBtn.classList.toggle("active", narrationOn);
  tickerEl.classList.toggle("hidden", !narrationOn);
  renderFrame();
});
narrationBtn.classList.add("active");
controlsEl.append(narrationBtn);

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

/**
 * One vitals card (R3-10 upgrade): alongside the sparkline, each card now shows a 7-day
 * trend arrow — green for improving, red for worsening (`goodWhenDown` flips the moral for
 * metrics like Gini and unemployment) — and an optional amber alert outline when the metric
 * is moving fast in the wrong direction. Pure presentation over `macro.history()`.
 */
function vitalCard(
  label: string,
  value: string,
  values: readonly number[],
  color: string,
  opts?: { goodWhenDown?: boolean; alertWhen?: (delta7d: number) => boolean },
): string {
  let trend = "";
  let alert = false;
  if (values.length >= 8) {
    const prev = values[values.length - 8]!;
    const cur = values[values.length - 1]!;
    const delta = cur - prev;
    const rel = Math.abs(prev) > 1e-9 ? delta / Math.abs(prev) : delta;
    if (Math.abs(rel) >= 0.02) {
      const up = delta > 0;
      const good = opts?.goodWhenDown ? !up : up;
      trend = `<span style="color:${good ? "#3fb950" : "#f85149"};font-size:10px">${up ? "▲" : "▼"}</span> `;
    }
    alert = opts?.alertWhen?.(delta) ?? false;
  }
  const outline = alert ? ' style="outline:1px solid #d29922;border-radius:4px"' : "";
  return `<div class="card"${outline}><div class="card-top"><span>${label}</span><b>${trend}${value}</b></div>${sparkline(values, color)}</div>`;
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
    const decR = latestDecisionFor(r.id, agent?.decisions() ?? [], residentAgent?.decisions() ?? []);
    const whyNowRes =
      decR && "residentId" in decR
        ? `<div class="whynow"><div class="wn-head">Why now? · Day ${decR.day}</div>` +
          `<p class="wn-move"><b>${summarizeResidentAction(decR.action, resolveName)}</b>${decR.fallback ? ' <span class="fallback">fallback</span>' : ""}</p>` +
          `<p class="wn-reason">“${decR.reason}”</p>` +
          `<p class="wn-signals">money ${money(r.money)} · wage ${r.wagePerTick.toFixed(2)} · hunger ${Math.round(r.needs.hunger)} · energy ${Math.round(r.needs.energy)} · social ${Math.round(r.needs.social)}</p></div>`
        : "";
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
      ${whyNowRes}
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
    const net = b.pnl.revenue + b.pnl.rentCollected - b.pnl.wagesPaid - b.pnl.distributed;
    const ownerName = world.getResident(b.ownerId)?.name ?? "—";
    const decB = latestDecisionFor(b.id, agent?.decisions() ?? [], residentAgent?.decisions() ?? []);
    const whyNowBiz =
      decB && "businessId" in decB
        ? `<div class="whynow"><div class="wn-head">Why now? · Day ${decB.day}</div>` +
          `<p class="wn-move"><b>${summarizeBusinessAction(decB.action)}</b>${decB.fallback ? ' <span class="fallback">fallback</span>' : ""}</p>` +
          `<p class="wn-reason">“${decB.reason}”</p>` +
          `<p class="wn-signals">cash ${money(b.cash)} · util ${utilStr} · price ${money(b.price)} · capital ${(b.capital ?? CAPITAL_BASELINE).toFixed(0)} · inv ${b.inventory}</p></div>`
        : "";
    inspectorEl.innerHTML = `
      <h2>${b.name}</h2>
      <p class="tag">${b.kind}${b.active ? "" : " · CLOSED"}</p>
      <p>cash: ${money(b.cash)} · inventory: ${b.inventory} · price: ${money(b.price)}</p>
      <p>chain: ${chain}</p>
      <p>resources: ${stock}</p>
      <p>owner: ${ownerName}</p>
      <p>employees: ${b.employeeIds.length} · wage ${b.wagePerTick.toFixed(2)}/tick</p>
      <p>capital: ${(b.capital ?? CAPITAL_BASELINE).toFixed(0)} · utilization: ${utilStr}</p>
      ${insolvent > 0 ? `<p class="warn">insolvent ${insolvent}d</p>` : ""}
      <p class="pnl">lifetime · revenue ${money(b.pnl.revenue)} · wages ${money(b.pnl.wagesPaid)} · rent ${money(b.pnl.rentCollected)} · dist ${money(b.pnl.distributed)} · net ${money(net)}</p>
      ${whyNowBiz}
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
      if (e.action.setWage !== undefined) levers.push(`wage→${e.action.setWage.toFixed(3)}`);
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

/**
 * The city decision ticker — a single newest-first strip merging every mind's
 * latest moves (businesses + residents) with the one-line reason behind each.
 * The "news feed" of the AI economy; reads the same logs the panels do.
 */
/**
 * Spawn/expire the floating thought bubbles. A new business decision spawns a
 * bubble over that firm (one live bubble per firm — newest wins); each fades over
 * BUBBLE_TTL_MS. The wall-clock fade is presentation-only — never sim state.
 */
function syncBubbles(): void {
  if (!agent) return;
  const log = agent.decisions();
  if (log.length > lastBizDecisionCount) {
    const nowMs = performance.now();
    for (const e of log.slice(lastBizDecisionCount)) {
      liveBubbles = liveBubbles.filter((b) => b.businessId !== e.businessId);
      liveBubbles.push({
        businessId: e.businessId,
        summary: summarizeBusinessAction(e.action),
        bornMs: nowMs,
      });
    }
    lastBizDecisionCount = log.length;
  }
  const cutoff = performance.now() - BUBBLE_TTL_MS;
  liveBubbles = liveBubbles.filter((b) => b.bornMs > cutoff);
}

// Spawn a floating map toast for each new demographic event, and retire faded ones.
// Tracks the event log's monotonic seq so each event toasts exactly once; resets if
// the log was cleared (e.g. after a save/reload). Presentation-only — reads, never mutates.
function pumpToasts(): void {
  const evs = population.events();
  if (evs.length > 0) {
    if (evs[evs.length - 1]!.seq < lastToastSeq) lastToastSeq = 0; // log reset (restore)
    const nowMs = performance.now();
    for (const e of evs) {
      if (e.seq <= lastToastSeq) continue;
      const node = world.getNode(e.nodeId);
      liveToasts.push({ x: node.x, y: node.y, text: TOAST_GLYPH[e.kind], bornMs: nowMs });
    }
    lastToastSeq = evs[evs.length - 1]!.seq;
  }
  const cutoff = performance.now() - TOAST_TTL_MS;
  for (let i = liveToasts.length - 1; i >= 0; i--) {
    if (liveToasts[i]!.bornMs <= cutoff) liveToasts.splice(i, 1);
  }
}

function renderTicker(): void {
  if (!narrationOn) return;
  const items = tickerItems(
    agent?.decisions() ?? [],
    residentAgent?.decisions() ?? [],
    { businessName: businessNameOf, resolveName },
    14,
  );
  if (items.length === 0) return;
  tickerEl.innerHTML = items
    .map((it) => {
      const fb = it.fallback ? ' <span class="fallback">fallback</span>' : "";
      const cls = it.kind === "business" ? "tk-biz" : "tk-res";
      return `<span class="tk ${cls}"><b>D${it.day}</b> ${it.actorName}: <i>${it.summary}</i>${fb}<span class="tk-why"> — ${it.reason}</span></span>`;
    })
    .join("");
}

// Sample population once per sim-day and narrate any demographic events since the
// last sample (cumulative-count deltas, so a multi-day frame jump misses none).
function sampleDemography(day: number): void {
  if (day === lastDemoDay) return;
  lastDemoDay = day;
  popHistory.push(world.residents.length);
  if (popHistory.length > 400) popHistory.shift();

  // Welfare flow since the last sample (cumulative-total delta — a multi-day frame jump folds
  // the missed days into one bar, so no money is dropped from the chart).
  const wp = welfare.paidTotal();
  welfareHistory.push(wp - lastWelfarePaid);
  lastWelfarePaid = wp;
  if (welfareHistory.length > 400) welfareHistory.shift();

  const d = population.demography();
  const homes = world.locations.filter((l) => l.type === "home").length;
  const add = (text: string): void => {
    townLife.push(`<p class="trace-row"><b>Day ${day}</b> ${text}</p>`);
    if (townLife.length > 60) townLife.shift();
  };
  for (let i = 0; i < d.born - lastDemoCounts.born; i++) add(`👶 a child was born`);
  for (let i = 0; i < d.migrated - lastDemoCounts.migrated; i++) add(`🧳 a newcomer moved to town`);
  for (let i = 0; i < d.grewUp - lastDemoCounts.grewUp; i++) add(`🎓 a young resident came of age and started working`);
  for (let i = 0; i < homes - lastHomeCount; i++) add(`🏠 the landlord opened a newly built home`);
  for (let i = 0; i < d.died - lastDemoCounts.died; i++) add(`🕯️ a resident passed away (estate inherited)`);
  lastDemoCounts = { born: d.born, died: d.died, migrated: d.migrated, grewUp: d.grewUp };
  lastHomeCount = homes;
}

function renderTownLife(): void {
  if (townLife.length === 0) return;
  townLifeEl.innerHTML = townLife.slice(-12).reverse().join("");
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
  // Creative destruction at a glance (Phase 15 D): how many firms have been founded
  // by entrepreneurs and how many have closed over the run. Shown only once it starts.
  const founded = world.businesses.filter((b) => b.id.includes("_gen")).length;
  const closed = world.businesses.filter((b) => !b.active).length;
  const churn = founded > 0 || closed > 0 ? ` · ${founded} founded · ${closed} closed` : "";
  econTagEl.textContent = latest
    ? `· day ${latest.day} · ${active} active${churn}`
    : `· ${active} active${churn}`;

  if (latest) {
    vitalsEl.innerHTML = [
      vitalCard("Population", String(world.residents.length), popHistory, "#7ee787"),
      vitalCard("GDP / day", money(latest.gdp), history.map((s) => s.gdp), "#58a6ff"),
      vitalCard("Investment / day", money(latest.investment), history.map((s) => s.investment), "#a371f7"),
      vitalCard("Payroll / day", money(latest.payroll), history.map((s) => s.payroll), "#2ea043"),
      vitalCard("Rent / day", money(latest.rent), history.map((s) => s.rent), "#d29922"),
      vitalCard("Capital stock", latest.totalCapital.toFixed(0), history.map((s) => s.totalCapital), "#56d4dd"),
      vitalCard("Avg price", money2(latest.avgResourcePrice), history.map((s) => s.avgResourcePrice), "#e15bc8"),
      vitalCard("Total money", money(latest.totalMoney), history.map((s) => s.totalMoney), "#9aa0a6"),
      vitalCard("Unemployed", String(latest.unemployed), history.map((s) => s.unemployed), "#e1a35b", { goodWhenDown: true }),
      // Observatory metrics (free-market study): the emergent labour/capital split,
      // inequality, and whether money is actually circulating.
      vitalCard("Labour share", `${Math.round(latest.labourShare * 100)}%`, history.map((s) => s.labourShare), "#f778ba"),
      // R3-10 — the Gini card goes amber when inequality climbs fast (Δ7d > 0.05).
      vitalCard("Inequality (Gini)", latest.gini.toFixed(2), history.map((s) => s.gini), "#db6d28", {
        goodWhenDown: true,
        alertWhen: (d) => d > 0.05,
      }),
      vitalCard("Velocity", latest.velocity.toFixed(2), history.map((s) => s.velocity), "#3fb950"),
      vitalCard("Welfare / day", money(welfareHistory[welfareHistory.length - 1] ?? 0), welfareHistory, "#ffa657"),
      // C4 trade + money cards — live wherever a port/authority exists; 0-flat otherwise.
      ...(boom
        ? [
            vitalCard("Exports / day", money(latest.exports), history.map((s) => s.exports), "#58d6ff"),
            vitalCard("Imports / day", money(latest.imports), history.map((s) => s.imports), "#ff9e58"),
            // R3-11 — the trade-balance gauge: green selling more than buying, red the reverse.
            vitalCard(
              "Trade balance",
              `${latest.exports - latest.imports >= 0 ? "+" : "−"}${money(Math.abs(latest.exports - latest.imports))}`,
              history.map((s) => s.exports - s.imports),
              latest.exports - latest.imports >= 0 ? "#3fb950" : "#f85149",
            ),
            vitalCard(
              "Port reserve",
              money(world.getBusiness("biz_port")?.cash ?? 0),
              history.map(() => world.getBusiness("biz_port")?.cash ?? 0),
              "#7ee787",
            ),
            // R3-12 — the press status light: green while money was minted today, dark when idle.
            vitalCard(
              `<span style="color:${latest.minted > 0 ? "#3fb950" : "#5a6069"}">●</span> Minted / day`,
              money(latest.minted),
              history.map((s) => s.minted),
              "#f778ba",
            ),
          ]
        : []),
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
  // Live demography (HP3/HP4) — read-only. Shows the town growing and turning over.
  const demo = population.demography();
  const jobless = world.residents.filter((r) => r.jobId === "").length;
  const homes = world.locations.filter((l) => l.type === "home").length;
  const perCap = Math.round(world.totalMoney() / Math.max(1, demo.population));
  popLineEl.textContent =
    `pop ${demo.population} · ${demo.population - jobless} working / ${jobless} not · ` +
    `${homes} homes${demo.housingConstrained ? " (full)" : ""} · ` +
    `births ${demo.born} · deaths ${demo.died} · arrivals ${demo.migrated} · $${perCap.toLocaleString()}/head`;
  syncControls();
  const todays = events?.latest();
  const marker: DisasterMarker | undefined =
    todays && todays.day === t.day
      ? { kind: todays.kind, headline: todays.headline, targetId: todays.targetId }
      : undefined;
  syncBubbles();
  pumpToasts();
  const nowMs = performance.now();
  const bubbleViews: ThoughtBubble[] = narrationOn
    ? liveBubbles.map((b) => ({
        businessId: b.businessId,
        text: b.summary,
        alpha: Math.max(0, 1 - (nowMs - b.bornMs) / BUBBLE_TTL_MS),
      }))
    : [];
  const toastViews: MapToast[] = liveToasts.map((t) => ({
    x: t.x,
    y: t.y,
    text: t.text,
    alpha: Math.max(0, 1 - (nowMs - t.bornMs) / TOAST_TTL_MS),
  }));
  renderer.draw(t.hour + t.minute / 60, selected, marker, bubbleViews, toastViews);
  sampleDemography(t.day);
  renderInspector();
  renderMacro();
  renderEvents();
  renderTownLife();
  renderGod();
  renderTrace();
  renderResidentTrace();
  renderTicker();
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
  // Clamp the wall-clock delta (R2 §6.3): a tab/init stall must never inject a
  // sim-time jump — the renderer may only affect FPS, not sim-time. This bounds
  // owed-ticks-per-frame; the seeded per-tick logic is unchanged.
  sim.advanceRealTime(Math.min(now - last, 100));
  last = now;
  renderFrame();
  requestAnimationFrame(frame);
}

// Dev-only debug handle for the visualization track's verification gates — lets a
// browser console (or the preview harness) drive + inspect the live sim when the
// tab's requestAnimationFrame is throttled. Read-only against determinism: stepping
// via sim.run is the same deterministic advance the rAF loop performs. Stripped from
// production builds (import.meta.env.DEV is false there), so it never ships.
const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
if (isDev) {
  (window as unknown as { cwlc?: unknown }).cwlc = {
    sim,
    world,
    market,
    macro,
    agent,
    residentAgent,
    population,
    renderFrame,
    renderer,
    god,
    welfare,
    // Boom Town levers (undefined in the default demo): God's printing press + the played Joy.
    monetary: sim.getSystem<MonetarySystem>("monetary"),
    joy: joyMind,
  };
}

renderFrame();
requestAnimationFrame(frame);
