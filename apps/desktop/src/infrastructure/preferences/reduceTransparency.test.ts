import { describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/render";
import { createReduceTransparency } from "./reduceTransparency";

describe("reduce transparency", () => {
  it("defaults to off, leaving the menu translucent", () => {
    const root = document.createElement("html");
    expect(createReduceTransparency(root, memoryStorage).get()).toBe(false);
    expect(root.hasAttribute("data-reduce-transparency")).toBe(false);
  });

  it("marks the root, persists across app starts and notifies subscribers", () => {
    const storage = memoryStorage();
    const root = document.createElement("html");
    const pref = createReduceTransparency(root, () => storage);
    const listener = vi.fn();
    pref.subscribe(listener);
    pref.set(true);
    expect(root.hasAttribute("data-reduce-transparency")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    const next = document.createElement("html");
    expect(createReduceTransparency(next, () => storage).get()).toBe(true);
    expect(next.hasAttribute("data-reduce-transparency")).toBe(true);

    pref.set(false);
    expect(root.hasAttribute("data-reduce-transparency")).toBe(false);
  });

  it("keeps working in memory when storage throws", () => {
    const throwing = () => {
      throw new Error("SecurityError");
    };
    const root = document.createElement("html");
    const pref = createReduceTransparency(root, throwing);
    expect(pref.get()).toBe(false);
    pref.set(true);
    expect(pref.get()).toBe(true);
    expect(root.hasAttribute("data-reduce-transparency")).toBe(true);
  });
});
