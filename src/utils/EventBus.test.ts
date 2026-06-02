import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./EventBus";

interface TestEvents {
  ping: { value: number };
  tick: number;
}

describe("EventBus", () => {
  it("delivers payloads to subscribers", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("ping", fn);
    bus.emit("ping", { value: 7 });
    expect(fn).toHaveBeenCalledWith({ value: 7 });
  });

  it("supports multiple listeners for one event", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("tick", a);
    bus.on("tick", b);
    bus.emit("tick", 1);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("unsubscribes via the returned function", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    const off = bus.on("tick", fn);
    bus.emit("tick", 1);
    off();
    bus.emit("tick", 2);
    expect(fn).toHaveBeenCalledOnce();
    expect(bus.listenerCount("tick")).toBe(0);
  });

  it("once() fires exactly once", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once("tick", fn);
    bus.emit("tick", 1);
    bus.emit("tick", 2);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("emitting an event with no listeners is a no-op", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("tick", 1)).not.toThrow();
  });

  it("allows a listener to unsubscribe during dispatch without skipping others", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    const offA = bus.on("tick", () => {
      order.push("a");
      offA();
    });
    bus.on("tick", () => order.push("b"));
    bus.emit("tick", 1);
    bus.emit("tick", 2);
    expect(order).toEqual(["a", "b", "b"]);
  });

  it("clear() removes all listeners", () => {
    const bus = new EventBus<TestEvents>();
    bus.on("tick", vi.fn());
    bus.on("ping", vi.fn());
    bus.clear();
    expect(bus.listenerCount("tick")).toBe(0);
    expect(bus.listenerCount("ping")).toBe(0);
  });
});
