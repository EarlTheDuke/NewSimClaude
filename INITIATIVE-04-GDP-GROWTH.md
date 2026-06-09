# INITIATIVE C: GDP Growth & Scaling — make the economy *compound*, and face the money question

> The **third and final leg** of the free-market program (after A — business creation; B —
> competition). See [ROADMAP.md](ROADMAP.md) + [INITIATIVE-02-BUSINESS-CREATION.md](INITIATIVE-02-BUSINESS-CREATION.md)
> + [INITIATIVE-03-COMPETITION.md](INITIATIVE-03-COMPETITION.md). This is where the **money-creation
> fork** from Initiative #1 comes back by design.

## The question C answers

Initiative #1 (S3) proved a closed, conserved free market **self-circulates without the dividend pump
— but it pools in firm cash and runs quieter and more unequal**. That left a fork: (a) accept it,
(b) **fix recirculation within conservation**, or (c) the **money-creation** fork. We engaged a
half-wean and moved on. C now takes it up properly, reframed as growth: **what lifts the ceilings so
GDP compounds over time instead of plateauing?** The ceilings:

1. **Idle cash pools** (the S3 finding) — money sits in firm reserves instead of funding growth.
2. **Money-supply rigidity** — no way to fund expansion beyond retained earnings.
3. **Population** — a fixed-ish labour force and customer base (HP3 already broadened this).
4. **The closed boundary** — no outside demand; the internal market is the whole world.

## The legs (dependency-ordered)

### C1 — Credit & finance (banking) · **BUILDING** (18a–18c shipped; 18d–18j underway)
A **Bank** as a conserving holder: firms borrow to fund Phase-17 brand / Phase-12 capital faster than
they can self-fund, pay interest as a daily `firm→bank` transfer, service or default under lifecycle
pressure, and (optionally) earn yield on idle cash so hoarding isn't free. **This is the
conservation-first answer to the S3 pooling finding (fork b)** — credit *un-pools* idle reserves by
lending them to where growth pays, with `totalMoney()` conserved to the cent (debt is non-cash
bookkeeping; interest is a transfer; default settles to the lender first). The full slice-by-slice
design (18a–18j, adversarially verified) lives in **[PHASE18-CREDIT.md](PHASE18-CREDIT.md)** — resume
from there.

> **Re-grounding note (important — the design predates Initiative A slice 4d).** PHASE18-CREDIT.md's
> 18a hardcodes a `"bank"` union member + `ARCHETYPES`/`BUSINESS_HEX` record entries "or typecheck
> fails." After **4d** (data-driven `INDUSTRY_REGISTRY`, derived tables) and **4b** (capability flags
> replacing `kind === X`) and the **renderer's `BUSINESS_RGB_DEFAULT` fallback**, that's simpler:
> - the bank is a **registry entry** (added only when `includeBank`, like an extra industry), so the
>   `BusinessKind` union needn't change and the seeded 7-business default is untouched;
> - the bank's special behaviour (larger reserve, no-bankruptcy, lending) keys off a **`bank` role
>   flag** on the archetype (the 4b pattern: `collectsRent`/`capitalGoodsVendor`), not `kind === "bank"`;
> - the renderer already draws an unknown kind in the teal fallback, so no palette change is forced.
>
> So **18a shrinks to**: `CREDIT_*` constants (inert) + `Business.debt?` / `pnl.debtService?` types +
> a no-op `CreditSystem` stub + wiring + a byte-identical test — **no union/record change at all**.
> 18b adds the bank via the registry + role flag. Re-verify every file/line in PHASE18-CREDIT.md
> against current code before building each slice.

### C2 — Population & demographics scaling · mostly shipped (verify + extend)
HP3 already does births / mortality / coming-of-age / in-migration / home construction (the labour
force and customer base *broaden*, not just deepen). C2 is largely **verification** that population
growth compounds GDP under the full A+B+credit stack, plus any targeted extension (e.g. migration
responding to the freed wage). Detail drafted at the boundary (`PHASE19-*`).

### C3 — Government & fiscal · the G in GDP
A **Treasury** holder: taxes (sales/income/corporate) as transfers in, public spending + transfers
out (welfare already prototypes this). A real fiscal lever and a new benchmark scenario; frozen OFF
in the firm-CEO bench. Conserving (every tax/transfer routes through the treasury). Draft `PHASE20-*`.

### C4 — External trade · breaks the closed boundary (**where the money fork really bites**)
A **port** that buys exports and sells imports at world prices — injects **outside demand** and an
external growth/shock channel, lifting the hardest ceiling (the closed economy). This is the leg
where outside money can enter: model the port as a **conserving current-account holder** (trade nets
through it), or make any outside in/outflow **explicit, bounded, and measured** so `totalMoney()`
stays auditable. **The money-creation fork is decided here, with evidence.** Draft `PHASE21-*`.

### C5 — GDP growth measurement + the explicit money decision
A clear **real-GDP-growth** metric over a long soak across the whole program, and the deliberate,
evidence-based call on the Initiative-#1 fork: did credit (C1) + population (C2) + trade (C4) lift
the ceilings enough *within conservation*, or is bounded money creation warranted? Document the
answer like the S3 result.

## Sequencing rationale
**C1 (credit) first** — it directly answers the S3 pooling finding within conservation, is fully
designed, and funds the growth the rest needs. **C2** confirms population compounds it. **C3/C4** add
the remaining macro sectors (G and NX in GDP = C + I + G + NX), with **C4** the boundary-break where
the money question is settled. **C5** measures and decides. Every slice flag-gated, default
byte-identical, frozen OFF in the CEO bench — the NORTH-STAR realism-vs-benchmark discipline.

## Invariants (non-negotiable, every slice)
- **Closed economy by default** — every flow a `World.transfer` between conserving holders;
  `totalMoney()` conserved to the cent. Any *deliberate* outside money (C4) is explicit, bounded, and
  measured — never an accidental mint/burn.
- **Deterministic** — seeded/derived order only; same seed ⇒ identical world; snapshot-complete.
- **Flag-gated, default byte-identical; frozen OFF in the bench** — the seeded baseline and the CEO
  scorecards never move until a knob is deliberately engaged.
