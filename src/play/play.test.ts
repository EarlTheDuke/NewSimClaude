import { describe, it, expect } from "vitest";
import { createCity } from "../createCity";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import { snapshotToJSON, snapshotFromJSON } from "../utils/serialization";
import { ScriptedResidentProvider } from "./ScriptedResidentProvider";
import type { ResidentDecision, ResidentDecisionRequest } from "../ai/residentTypes";

const AVATAR = "res_9"; // "Joy"
const dummyReq = {} as unknown as ResidentDecisionRequest;

const playConfig = (provider: ScriptedResidentProvider) =>
  ({
    seed: 9,
    brain: "rules" as const,
    residentBrain: provider,
    agenticResidentIds: [AVATAR],
    disasters: true,
  });

describe("Phase 9 — ScriptedResidentProvider", () => {
  it("returns queued moves in order, then stands pat", () => {
    const m1: ResidentDecision = { action: { negotiateRaise: true }, reason: "ask for more" };
    const m2: ResidentDecision = { action: { buyVehicle: true }, reason: "treat myself" };
    const p = new ScriptedResidentProvider([m1, m2]);

    expect(p.pending).toBe(2);
    expect(p.decide(dummyReq)).toBe(m1);
    expect(p.decide(dummyReq)).toBe(m2);
    expect(p.pending).toBe(0);

    const standPat = p.decide(dummyReq);
    expect(standPat.action).toEqual({});
    expect(standPat.reason).toMatch(/stood pat/i);
  });
});

describe("Phase 9 — playthrough seam", () => {
  it("applies my injected choice for Joy through the real agent seam", () => {
    const provider = new ScriptedResidentProvider([
      { action: { negotiateRaise: true }, reason: "I've earned a bump." },
    ]);
    const { sim, world, residentAgent } = createCity(playConfig(provider));

    const joyBefore = world.getResident(AVATAR)!;
    const wageBefore = joyBefore.wagePerTick;

    sim.run(TICKS_PER_DAY); // one day → one review at the boundary

    const joy = world.getResident(AVATAR)!;
    expect(joy.wagePerTick).toBeGreaterThan(wageBefore);

    const mine = residentAgent!.decisions().filter((e) => e.residentId === AVATAR);
    expect(mine.length).toBe(1);
    expect(mine[0]!.providerId).toBe("claude-joy");
    expect(mine[0]!.fallback).toBe(false);
    expect(mine[0]!.action.negotiateRaise).toBe(true);
  });

  it("save → restore → advance continues bit-for-bit (my choices included)", () => {
    // Arm A: run 3 days with the move applied on day 1, then snapshot.
    const a = createCity(
      playConfig(new ScriptedResidentProvider([{ action: { negotiateRaise: true }, reason: "raise" }])),
    );
    a.sim.run(TICKS_PER_DAY * 3);
    const json = snapshotToJSON(a.sim.serialize());

    // Arm B: fresh city (empty queue — the move was already spent), restore, run 2 more days.
    const b = createCity(playConfig(new ScriptedResidentProvider([])));
    b.sim.restore(snapshotFromJSON(json));
    b.sim.run(TICKS_PER_DAY * 2);

    // Arm C: one continuous 5-day run with the same single move on day 1.
    const c = createCity(
      playConfig(new ScriptedResidentProvider([{ action: { negotiateRaise: true }, reason: "raise" }])),
    );
    c.sim.run(TICKS_PER_DAY * 5);

    const jb = b.world.getResident(AVATAR)!;
    const jc = c.world.getResident(AVATAR)!;

    expect(b.world.totalMoney()).toBeCloseTo(c.world.totalMoney(), 6);
    expect(jb.money).toBeCloseTo(jc.money, 6);
    expect(jb.wagePerTick).toBeCloseTo(jc.wagePerTick, 6);
    expect(jb.jobId).toBe(jc.jobId);
    expect(jb.homeId).toBe(jc.homeId);
    expect(jb.needs).toEqual(jc.needs);
    expect(b.sim.time.time().day).toBe(5);
  });
});
