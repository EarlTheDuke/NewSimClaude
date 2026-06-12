# BENCHMARK MATCH REPORT — the first live LLM duels (2026-06-11)

*The twin-diner duel (Pilot B instrument): seed 9, 30 days/game, home-and-away (seats swapped,
score = sum of both games), growth-scored (hoard-proof, mark-to-market), `--nothink` mode.
Every match deterministic-world + live-model; `[N fellback]` = turns the model lost to the
rules fallback (the integrity counter).*

## The ladder

| Rank | Contestant | Record |
|---|---|---|
| 🥇 | **nemotron-3-ultra** | def. qwen3.5:35b by **$988** · def. Claude-in-the-loop by **$1,650** |
| 🥈 | **qwen3.5:35b** | def. rules by **$181** · L vs nemotron · *(vs Claude: see Match 5)* |
| 🥈 | **Claude (Fable 5, live)** | won its home head-to-head vs nemotron (+$332) · best-ever protocol (60/60 turns) · L vs nemotron |
| 🏠 | rules | the deterministic floor — never goes positive, never goes bankrupt |

## The matches

### Match 1 — rules vs rules (90d, the fairness proof)
`TIE to the cent` — identical brains, identical totals across the seat swap. Measured the raw
seat bias the format exists to cancel: home −$82 vs away −$3,720 over 90 days.

### Match 2 — rules vs qwen3.5:35b (30d) → **qwen by $181**
```
game 1: rules @ home $0        vs qwen @ away −$2,595
game 2: qwen @ home +$263      vs rules @ away −$2,540
TOTALS: qwen −$2,332*          vs rules −$2,540        (*as printed: −$2,359 vs −$2,540)
```
qwen's skill showed at the home seat (+$263 vs the rules $0); its signature: early `setPayout 0`
(it finds the dividend drain), steady late-game climb. All turns clean.

### Match 3 — nemotron vs qwen, FIRST ATTEMPT → **VOID** (the suffocation)
On paper qwen "won" by $984 — but nemotron missed **56 of 60 turns**: it ignores the qwen-style
`/no_think` switch, reasoned invisibly into the old 512-token cap, and was cut off before
emitting a single character (`finish_reason=length`, empty content) — every such turn fell to
the rules fallback. Caught by the fellback counter; fixed by raising the `--nothink` cap to
4096 (switch-honoring models stop early anyway). **Lesson: probe new models with MATCH-SIZED
prompts, not one-liners.**

### Match 4 — nemotron vs qwen, REMATCH (clean) → **NEMOTRON by $988**
```
game 1: nemotron @ home +$771 [1 fellback]  vs qwen @ away −$3,286
game 2: qwen @ home +$146 [1 fellback]      vs nemotron @ away −$2,923 [3 fellback]
TOTALS: nemotron −$2,152 vs qwen −$3,140
```
- nemotron's **+$771 home game is the all-time record** (triple qwen's best) — five-lever
  aggression: undercut pricing + wage pressure + marketing + full retention.
- A clean sweep: nemotron was better at BOTH seats.
- **Opponents are part of the environment:** both models bled $400–700 worse at the away seat
  against each other than anyone bled against rules; qwen's home scores decline as opponents
  sharpen (+$263 vs rules → +$146 vs nemotron).
- The reasoning tax: nemotron writes ~1,200 think-tokens per turn → a ~2-hour match vs qwen's
  seconds-per-move. Quality-per-wall-clock is a real benchmark axis now.

### Match 5 — Claude (live, file protocol) vs nemotron → **NEMOTRON by $1,650**
```
game 1: Claude @ home −$2,319             vs nemotron @ away −$2,651 [4 fellback]
game 2: nemotron @ home −$386             vs Claude @ away −$2,369
TOTALS: Claude −$4,688 vs nemotron −$3,038
```
- I won my home head-to-head (+$332 *through* its 11-day max-wage assault) and posted the
  **second-best away game ever** (−$2,369) — but its untroubled home cruise (−$386) against my
  gentle game-2 opening decided the match. **The aggressor sets the defender's bill:** it spent
  ~$150/day attacking; I spent ~$290/day defending.
- My errors, on the record: a premium-price experiment at the away seat that gifted it margin
  room; a failed counter-raid; and ~$1,300 of wage-shield spending on a threat that — see
  FINDING 1 — could never have materialized.
- Protocol note: Claude played 60/60 turns clean — the only flawless protocol performance.

### Match 6 — Claude vs qwen3.5:35b (corrected doctrine) → **CLAUDE by $2,999**
```
game 1: Claude @ home −$85            vs qwen @ away −$2,805
game 2: qwen @ home −$670             vs Claude @ away −$391  ← away record SMASHED
TOTALS: Claude −$476 vs qwen −$3,475          (Claude: 60/60 turns clean again)
```
- **The away seat was conquered:** −$391 at Riverside beats the previous record (−$2,369) by
  ~$2,000 — and beats qwen's HOME game (−$670) outright. The doctrine: `setPayout 0` + an
  immediate day-1 price edge (17.5 vs 18) + base wage forever (the inert lever, F1) + zero
  clamped spending + **no gambits**. Riverside's "death sentence" was mostly self-inflicted
  overhead, all along.
- −$476 is the best match total ever recorded (previous best: nemotron's −$2,152).
- Knowledge advantage disclosure: Claude played with verified mechanics knowledge (F1's inert
  wage lever, F2's spend clamp) that API contestants don't have — sanctioned for this test.
  The fair version of this comparison is exactly why F1/F2's observation fixes matter: give
  EVERY contestant the same mechanical clarity, then re-measure.

### Match 7 — Claude vs nemotron, THE TITLE REMATCH → **NEMOTRON RETAINS, by $359**
```
game 1: Claude @ home −$442            vs nemotron @ away −$955
game 2: nemotron @ home +$39           vs Claude @ away −$832
TOTALS: nemotron −$915 vs Claude −$1,274       (Claude: 60/60 clean again)
```
- The margin collapsed **$1,650 → $359** once Claude played informed (no phantom-war tax) —
  most of the first loss WAS the tax. But the champion earned the retention: it **adapted**.
  No wage raid this time; instead a price attack ($17 undercut) at its home seat and a
  monstrous closing surge: −$528 at day 10 → **+$39 at day 30** (+$567 in 20 days, its
  signature late grind). Claude won game 1 (+$513) but declined the margin spiral in game 2
  and paid for it — discipline was the right call vs qwen and the wrong call vs an aggressor
  with home geography.
- Two matches, two different nemotron strategies, both wins. That behavioural range — raid in
  match 1, price war in match 2 — is the strongest evidence yet that the duel measures
  adaptive intelligence, not a memorized playbook.

### Still queued — the multi-seed series (error bars)
One seed per pairing so far; seeds 10/11 for the top pairings run next session.

---

## FINAL LADDER (end of 2026-06-11 session, seed 9, no-think, 30d home-and-away)

| Rank | Contestant | Head-to-head record | Signature |
|---|---|---|---|
| 🥇 | **nemotron-3-ultra** | def. qwen $988 · def. Claude $1,650 · def. Claude (informed) $359 | Adaptive aggression: wage raid in one match, price war in the next; the late-game surge (two +$500-class closing runs) |
| 🥈 | **Claude (Fable 5, live)** | def. qwen $2,999 (biggest win recorded) · 2L vs nemotron (margin closing) | The conquered away seat (−$391 record, beat qwen's HOME from away); only flawless protocol (180/180 turns lifetime); doctrine improved every match |
| 🥉 | **qwen3.5:35b** | def. rules $181 | Finds the dividend drain fast; consistent but static — declines as opponents sharpen |
| 🏠 | rules | the floor | Never positive, never bankrupt |

*Caveat: knowledge asymmetry — Claude played with verified mechanics knowledge (sanctioned
handicap for this test); API contestants discover mechanics from the ledger only. F1/F2's
observation fixes would level this; re-measure after.*

---

## FINDINGS — fixes and improvements for the sim & benchmark

### F1 (headline, verified in code) — **duels have NO labour market: every wage move was inert**
`createCity` defaults `agenticResidentIds` to **none**, and the duel scenario never sets it —
so residents NEVER review jobs in any duel played to date. Job-switching is impossible;
poaching is impossible. Nemotron's max-wage raids, my shields and counter-raids, every wage
lever pulled by every contestant: **pure cost, zero function**. (`labourCompetition: true`
only surfaces rival wages in observations — switching needs resident agents.)
**Fix options:** (a) add `agenticResidentIds: "all"` (rules minds) to the duel scenario so the
wage front is REAL — this is scenario v2, old results stand as v1; or (b) keep v1 and strip
`setWage` from the duel action space (don't offer a dead lever). **Recommend (a)** — the wage
war is the most watchable, most strategic front, and the briefing already implies it works.

### F2 — the silent spend clamp is an observation gap
Below the $3,000 reserve, `invest` and `brand` are clamped to zero — correct economics
(the cash shield), but the CEO is **never told**. My brand "maintenance" spends no-opped for
20+ days before I noticed via brand decay; my invest-300 vanished silently. Models will burn
turns on dead levers. **Fix:** add `spendBlocked: true` (or clamped-to amounts) to the
observation, and a line in the briefing ("spending levers lock below your reserve").

### F3 — half of every match measures the map, not the mind
The away seat (Riverside: 1 starting staffer, worse geography) bleeds $2,400–3,300 in 30 days
for every pilot. Home-and-away cancels it, but variance there swamps skill signal. **Fix:** a
`balancedDiners` option (equal staffing/geometry) so BOTH games carry signal; keep the
asymmetric variant as a separate "hard-seat" scenario.

### F4 — observation/metric polish
- `capacityUtilization` read 12% while selling ~10/21 units (capacity basis unclear) — make it
  units-sold ÷ max-units, documented.
- `dayProfit` mixes restock cash-flow with operating margin — a CEO can look loss-making while
  converting cash→inventory (score-neutral). Add `dayUnitsSold` and `dayGrossMargin` to the
  observation so models can see real economics.
- The wage display in the play harness confused schedules with costs once already (fixed);
  same clarity pass belongs in the observation docs.

### F5 — benchmark runbook (operational, learned the hard way)
1. **Scored matches get a QUIET box** — spectator tabs share the GPU queue; closing a tab
   mid-generation leaves zombie generations that Ollama finishes anyway (the queue self-heals
   only once tabs STAY closed).
2. **Probe new models with match-sized prompts** before seating them (the suffocation).
3. **Roomy token caps always** — switch-honoring models stop early; switch-ignoring models
   need room to think AND answer.
4. The fellback counter is the integrity gate: >3 missed turns per game = void and re-run.
5. One seed ≠ a result: error bars need a 3–5 seed series (started with Match 7).

### F6 — ideas the matches surfaced for the sim itself
- **Tacit collusion is observable** (nemotron followed my price UP to $19 and pocketed margin
  — then later broke the truce). The melee + a flag-gated message channel ("town board") makes
  this a publishable cartel experiment: tacit vs explicit communication, prices vs welfare.
- **Aggression asymmetry**: attacking is cheaper than defending in this economy (the attacker
  picks the battlefield). Worth measuring deliberately: an "aggression index" per model from
  decision logs (wage/price moves directed at rivals).
- **The away-seat economics** suggest a real phenomenon worth keeping (location quality), but
  the spectator should SHOW it (a "tough market" badge on the seat) so viewers read losses
  correctly.
- Drama detector should banner **price-war truces and breaks** (rival price convergence/
  divergence) — the most strategic story in every match so far and currently invisible.

*(Report assembled live during the AFK block; Matches 6–7 results below.)*
