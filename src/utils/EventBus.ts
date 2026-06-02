/**
 * Minimal typed publish/subscribe bus for loose coupling between systems.
 *
 * Systems emit domain events ("dayRolled", "wagePaid", ...) without knowing
 * who listens. Rendering and UI subscribe to observe; they never reach into
 * system internals.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  /** Subscribe for a single emission, then auto-unsubscribe. */
  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(fn as Listener<unknown>);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Iterate a copy so listeners may unsubscribe during dispatch.
    for (const fn of [...set]) {
      (fn as Listener<Events[K]>)(payload);
    }
  }

  /** Number of active listeners for an event (useful in tests). */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Remove all listeners (e.g. when tearing down a simulation). */
  clear(): void {
    this.listeners.clear();
  }
}
