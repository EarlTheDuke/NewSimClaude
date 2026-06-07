# PHASE-RENDER R2 — Port the renderer to Pixi.js + camera

> Companion to [VISION-RENDER.md](VISION-RENDER.md) / [PHASE-RENDER.md](PHASE-RENDER.md). R2 is the
> **Pixi foundation**: swap the proven `CanvasRenderer` for a `PixiRenderer` behind a flag, reach
> signed-off **parity first**, then add pan/zoom/follow. House cadence — small flag-gated sub-slices,
> each verify-green (`typecheck` + `test:run` + `build`) + committed, each with a **browser gate**.
> Designed via a 10-agent workflow (3 designs — parity-first/scene-graph/risk-first — adversarially
> verified; scene-graph-idiomatic won at 74, executed risk-first). Every `mustFix` resolved in §6.

## 1. Decision summary
- **Pixi.js v8, exact-pinned.** ESM-native, tree-shakes under Vite 6, the foundation R3 (sprites)/
  R4 (vehicles/particles)/R6 (filters) build on. Its one real cost — **async `Application.init()`** vs
  our synchronous `main.ts` — is engineered around (§6.1), not a reason to take EOL v7.
- **Why port:** the canvas is immediate-mode (re-issues every shape each frame). R3+ needs WebGL's
  retained scene graph + GPU batching. R2 buys that, changing **zero** visible behavior until the default flips.
- **Bundle cost (accepted):** ~71 KB raw / ~23 KB gzip today; Pixi adds ~150–200 KB gzip (~7–9×).
  Acceptable for a WebGL app; import **named submodules only**; record the delta at the R2a gate.
- **Swap seam:** a shared `CityRenderer` interface (`src/render/CityRenderer.ts`) both renderers
  implement; a one-line factory at the single construction site, gated on `?renderer=pixi`. **Canvas
  stays the default through R2a–R2f**; R2g flips it while keeping `CanvasRenderer` reachable via
  `?renderer=canvas`. `CanvasRenderer` is **never deleted** in R2. Only 3 seam points in `main.ts`:
  the construction, the one `renderer.draw(...)`, the one `renderer.pick(...)`.

## 2. Scene-graph architecture
One `PIXI.Application` on the existing `<canvas id="city">` (640×480), `resolution:1`,
`autoDensity:false` (so click math + "world==canvas space" hold on HiDPI). Layers back-to-front:
- `skyLayer` (NOT under camera) — `skyGfx` full-rect, refilled `skyColor(hour)` only when the hex changes.
- `worldLayer` (**the camera container**: `.position`=pan, `.scale`=zoom) — `roadsGfx` (geometry once,
  recolored per frame); `buildingsLayer` (one persistent `BuildingView` per `location.id`: base · 4-window
  grid · boarded planks · selection outline · label); `residentsLayer` (one persistent `ResidentView`
  per `resident.id`: shadow · heading tick · dot · selection glow); `overlayWorld` (disaster ring + glyph,
  world-anchored).
- `hudLayer` (NOT under camera, screen-fixed) — legend · sun/moon badge · disaster banner · pooled bubbleLayer.

**Retained-mode:** display objects created **once** (ctor for static topology; lazy `ensureView(id)` for
runtime-born entities like `biz_<kind>_genN`). `draw()` is a cheap per-frame sync of `.tint/.alpha/.visible/
.position`; geometry re-issued only on a *shape* change. **Zero per-frame allocation in the hot path** — so
a heavier GPU only drops FPS, never sim-time.

**Day/night = per-object, NOT a global filter** (canvas doesn't dim uniformly — windows/moon brighten at
night, labels have a floor): sky filled with `skyColor()` verbatim; roads/bases/labels tinted via a new
`dimInt()` on **white** objects; windows golden at `alpha=lit`, hidden at `lit≤0.02`. A `ColorMatrixFilter`
is reserved for R6.

**R1 overlay + selection:** thought bubbles live in `hudLayer` (screen-space, crisp text) but anchor to a
firm via `worldPosOf(id)` + `worldToScreen` (the renderer owns bubble position, as canvas does via
`locateTarget`); `alpha` is the unchanged `main.ts` wall-clock fade. Selection outline/glow ride each
entity's view (inside `worldLayer`, so they pan/zoom). Disaster ring/glyph world-anchored; banner screen-fixed.

**Picking under camera:** `main.ts` click handler unchanged (normalizes to 640×480, calls `pick(x,y)`). The
inverse transform lives **inside** `PixiRenderer.pick()`: `world=(canvas - t)/scale`, then the **verbatim**
canvas hit-test (resident ≤9px, else building AABB ≤13px) in world units. At pan=0/zoom=1 it's identity →
byte-identical to canvas.

**Camera convention (fixed):** store `{tx, ty, scale}` applied to `worldLayer` — **never** a "center" (avoids
the off-by-`viewport/2` trap). Forward `screen=world*scale+t`; inverse `world=(screen-t)/scale`. Pan: `t+=Δ`.
Zoom-to-cursor (clamp [0.5,4]): keep the world point under the cursor fixed by deriving `t`. Follow: ease `t`
toward `center - entityWorld*scale`; manual pan/zoom cancels follow. Camera state is **view-only, never serialized**.

## 3. Sub-slices (dependency-ordered)
- **R2a** — Pixi foundation behind swap flag (canvas still default): add `pixi.js`, `CityRenderer` interface,
  a `PixiRenderer` that mounts + paints only the sky; **+ the rAF delta-clamp + async `ready` guard**.
- **R2b** — Static world parity: roads + buildings (base/windows/shuttered) + labels, via `dimInt` on white.
- **R2c** — Residents parity: dot + shadow + heading tick + activity color (per-id view, lazy, alloc-free).
- **R2d** — HUD parity: legend + sun/moon badge (screen-space).
- **R2e** — Selection (building+resident) + disaster ring + glyph + banner.
- **R2f** — R1 thought-bubble overlay + `pick()` (verbatim hit-test, identity transform) — parity-complete candidate.
- **R2-PARITY** — Parity sign-off gate (no new code): A/B harness, screenshot diff noon/dusk/midnight, **user
  waiver** for the 3 glow approximations. **Camera is gated behind this.**
- **R2g** — Flip default to Pixi; keep canvas via `?renderer=canvas`.
- **R2h** — Camera: pan (drag) + zoom-to-cursor on `worldLayer` (HUD stays fixed) + Reset View.
- **R2i** — Click→world picking under camera (inverse in `pick()`) + follow-cam on selection — **completes R2 GATE**.

## 4. Per-slice gates + rollback
Each slice: `?renderer=pixi` shows the new element matching canvas; default URL unchanged; `typecheck +
test:run + build` green; soak untouched. Rollback always = drop `?renderer=pixi` (canvas is default through
R2f) / after R2g append `?renderer=canvas` or revert the one-line default. Detail per slice:
- **R2a gate:** default = byte-identical canvas; `?renderer=pixi` shows the day/night **sky** crossfading
  (proves mount + rAF + swap + clean async init, no console errors, deferred first paint). Record bundle delta.
- **R2b:** A/B at the same paused tick — roads, all buildings (colors, fan-out, factory/mine pair), night-lit
  windows, a shuttered/boarded building, labels — all match.
- **R2c:** A/B — every dot at the same pos/activity color/shadow/heading tick; recolor across a day matches.
- **R2d:** legend rows + sun-at-noon/moon-at-midnight crossfade match.
- **R2e:** God-Mode disaster → ring+glyph over target + banner match; selection ring placed right (drive
  `selected` via `window.cwlc` until R2f).
- **R2f:** pause → fading thought bubble with real reason; ticker/why-now DOM still work; click resident + building
  selects the same entity as canvas. **Parity-complete candidate.**
- **R2-PARITY:** user confirms `?renderer=pixi` is perceptually indistinguishable (≤2/255 tint tolerance) at
  noon/dusk/midnight + picking matches, modulo the 3 waived glow approximations. **Only then R2g.**
- **R2g:** default renders Pixi; `?renderer=canvas` restores canvas; soak+save/reload byte-identical.
- **R2h:** drag pans, scroll zooms-to-cursor; HUD stays fixed; sim clock advances at the same rate while panning.
- **R2i:** pan/zoom then click selects the right entity (inverse-transform picking); follow-cam eases to the
  selection; a drag cancels follow. FPS ≥ old renderer. **R2 GATE complete.**

## 5. Parity checklist
Drive both renderers to the **same paused tick** (A/B harness §6.7); tolerance **≤2/255 per channel** for
tints, **exact** for sky, glow halos perceptual (waived). Verify: sky color (4 times of day); ambient dim;
window glow vs occupancy; roads; building bases per kind; strip-mall fan-out + factory/mine pair; lit windows
(hidden ≤0.02); shuttered base + boarded X; labels (no overprint); resident dot/shadow/heading-tick/activity
recolor; legend; sun/moon crossfade; disaster banner; selection outline (30×30) + glow*; disaster ring (r=19)
+ glyph + badge glow*; thought bubble (callout+tail+fitted text+fade); `fitText` ellipsis + banner width
(shared `measureText`); pick (resident ≤9px then building ≤13px); pick under camera (round-trip at zoom≠1,pan≠0).
*= glow approximation, waived at R2-PARITY.

## 6. Determinism / perf / read-only resolutions (every mustFix)
- **6.1 Async-init race:** ctor starts `init()`, `ready=false`; `draw()` no-ops + `pick()` returns undefined
  until ready; on resolve, build the scene graph + call `renderFrame()` once (deferred first paint). [R2a]
- **6.2 `dim()` is a string:** author `dimInt(rgb, factor): number` in `daynight.ts` (same `Math.round`-per-
  channel, packed to `0xRRGGBB`), tint a **white** base; forbid float-tinting a colored base. Unit test:
  `dimInt` == `hexToRgb(dim(...))` channel-for-channel. Residual drift = GPU 8-bit only (≤2/255). [R2b]
- **6.3 Delta-clamp:** clamp `deltaMs` to ~100 ms before `sim.advanceRealTime` in the rAF loop, so an
  init/tab stall can't inject a sim-time jump (presentation guard; seeded tick logic unchanged). [R2a]
- **6.4 Text metrics:** measure via a **shared hidden-canvas `measureText`** (one offscreen 2D ctx) so
  `fitText` ellipsis + banner width match canvas; render the fitted string with `PIXI.Text`. DOM-text fallback
  if glyphs unacceptable. [R2f/R2e]
- **6.5 DPR/mount:** `resolution:1`, `autoDensity:false`, keep canvas 640×480 attrs + CSS; HUD geometry reads
  the `WIDTH/HEIGHT` constants, never `canvas.width/height`; single renderer per element (factory guarantees). [R2a]
- **6.6 Camera convention + test:** store `{t, scale}`, never a center; round-trip unit test forward→inverse
  at `scale=2, t=(37,-19)`. [R2i, math from R2h]
- **6.7 A/B harness:** extend dev-only `window.cwlc` with the renderer + a deterministic `seekToTick(n)`; the
  harness seeks canvas + `?renderer=pixi` to the same tick and pixel-diffs (≤2/255, glow masked). [R2b → R2-PARITY]
- **6.8 `shadowBlur` (3 sites):** no Pixi equivalent → soft larger semi-transparent stroke/circle (no extra
  dep over `pixi-filters`). The "EXACTLY" constraint is met as: headless sim byte-identical + render
  perceptually-equal ≤2/255 + 3 **user-waived** glow halos at R2-PARITY.
- **6.9 Load path:** on first `draw()` after a Load, `ensureView` all current ids + immediately reap absent
  ones (stale firms/residents don't linger). [R2c/R2d]
- **Determinism/read-only/perf proofs:** no renderer is imported by any test or headless path (soak =
  `createCity`+`sim.run`, node env); the sim steps **before** the paint; camera/bubble fade are wall-clock
  presentation only, never written back or serialized; renderer only reads `world`; retained views + pooled
  bubbles = strictly cheaper than immediate-mode.

## 7. Test impact
`daynight.test` (pure math) untouched + gains a `dimInt` parity assertion (new green test). `DecisionNarration.
test` untouched. `soak.test` (365-day + conservation + save/reload, headless node) cannot be touched; re-run at
R2g/R2i to prove the sim is byte-identical. New tests: `dimInt` channel-parity; camera round-trip. Watch TS:
`import type` for Pixi type-only imports (verbatimModuleSyntax/isolatedModules); `noUnusedLocals` on the interface.

## 8. Risks & rollback (top items)
1. async init races sync draw → `ready` guard (§6.1). 2. `dim()` string not tint → `dimInt` (§6.2). 3. stall
injects sim-time jump → delta-clamp (§6.3). 4. DPR breaks picking/HUD → `resolution:1`+consts (§6.5). 5. glow
has no Pixi equiv → soft-stroke + user waiver (§6.8). 6. text-metrics drift → shared `measureText` (§6.4). 7.
camera off-by-center → `{t,scale}` + round-trip test (§6.6). 8. A/B not reproducible → `seekToTick` (§6.7). 9.
stale views post-Load → reap (§6.9). 10. bundle +150–200KB → named imports, default canvas until R2g.
**Master rollback:** canvas is default + Pixi opt-in through R2f; after R2g `?renderer=canvas` (or revert one
line) restores the exact pre-R2 renderer; camera is isolated in `PixiRenderer`.
