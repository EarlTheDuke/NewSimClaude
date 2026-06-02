import type {
  ResidentDecision,
  ResidentDecisionProvider,
  ResidentDecisionRequest,
} from "./residentTypes";

export interface MockResidentProviderOptions {
  id?: string;
  /** Decisions returned in order; the last one repeats once the queue drains. */
  decisions?: ResidentDecision[];
  /** A single fixed decision (ignored if `decisions` is given). */
  fixed?: ResidentDecision;
  /** Return a Promise instead of a value, to exercise the async path. */
  async?: boolean;
  /** Fail every call — sync throw, or async rejection when `async` is set. */
  fail?: boolean;
}

/**
 * A scripted resident provider for tests. Replays canned decisions
 * deterministically and can be told to fail, so the agent system's fallback and
 * async paths can be driven without touching the network.
 */
export class MockResidentProvider implements ResidentDecisionProvider {
  readonly id: string;
  private readonly queue: ResidentDecision[];
  private readonly fixed: ResidentDecision;
  private readonly async: boolean;
  private readonly fail: boolean;
  /** Number of times decide() has been called — handy for assertions. */
  calls = 0;

  constructor(opts: MockResidentProviderOptions = {}) {
    this.id = opts.id ?? "mock";
    this.queue = opts.decisions ? [...opts.decisions] : [];
    this.fixed = opts.fixed ?? { action: {}, reason: "mock: no-op" };
    this.async = opts.async ?? false;
    this.fail = opts.fail ?? false;
  }

  decide(_req: ResidentDecisionRequest): ResidentDecision | Promise<ResidentDecision> {
    this.calls += 1;
    if (this.fail) {
      const err = new Error("MockResidentProvider: forced failure");
      return this.async ? Promise.reject(err) : raise(err);
    }
    const next = this.queue.length > 1 ? this.queue.shift()! : this.queue[0] ?? this.fixed;
    return this.async ? Promise.resolve(next) : next;
  }
}

function raise(err: Error): never {
  throw err;
}
