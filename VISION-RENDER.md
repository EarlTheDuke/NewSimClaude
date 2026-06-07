# Vision — Making the City 10× More Watchable

## Where we are
The sim is a correct, deterministic economy with a small functional map: colored squares for
buildings, dots for people, a day/night tint, and a stack of text panels. It works — but it
reads like *a dashboard with a map attached*. You don't quite *feel* the city living, and the
single most special thing about this project is invisible: **every choice on screen is made by
a reasoning AI, and right now you can't watch it think.**

## What "10× better" actually means
Not photorealism — **legibility + life.** You should be able to sit back, press play, and
understand the city at a glance, across three threads at once:

- **Spatial** — a real little town: roads, buildings that *show their state*, and people (and
  vehicles) actually moving along the streets.
- **Economic** — money visibly *flows*; profit, capacity, and brand read as glow and heat, not
  just numbers buried in a panel.
- **Narrative (the moat)** — the AI's reasoning is *on the screen*: a thought bubble when a
  firm decides, a live ticker of decisions across the city, and click-to-ask **"why now?"** that
  shows the exact numbers that triggered the choice.

## The immersion thesis
**No other city sim shows you the mind behind every decision.** That is our unfair advantage,
so we over-invest there. Pretty graphics make people *look*; **exposed AI reasoning makes them
stay and understand.** Watchability beats flash — a polished, legible 2D city where you can see
*why* everything happens is worth far more than a shiny 3D one where you still can't tell.

## Deliberately OUT of scope
- **True 3D / photorealism (Three.js)** — overkill for a one-developer hobby project; the
  watchability gain doesn't justify the asset and engineering cost.
- **Any change to the simulation, economy, or the AI seam** — *rendering only reads.*
  Determinism, money-conservation to the cent, and save/reload parity stay sacred. The 365-day
  soak must never notice we were here.
- **Multiplayer, mobile, hand-drawn art pipelines.**
- **Rebuilding the dashboards** — we *upgrade* them into live charts; we never duplicate or
  touch what `MacroSystem` already computes.

## How we get there
Small, independently shippable slices, each ending with something you can **watch in the
browser** — and each gated: *if a slice doesn't visibly improve watchability, we don't move on.*
We start with the moat (decision narrative) on the **current** renderer — real value, zero
engine risk — then upgrade the rendering foundation and layer on sprites, vehicles,
economic-flow effects, live charts, story moments, and (muted-by-default) sound.

Full phased plan, per-phase browser gates, and the Phase-1 technical spec: **PHASE-RENDER.md**.
