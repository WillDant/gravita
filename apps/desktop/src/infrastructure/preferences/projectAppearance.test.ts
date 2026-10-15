import { describe, expect, it } from "vitest";
import { memoryStorage } from "@/test/render";
import { createProjectAppearance } from "./projectAppearance";

describe("project appearance", () => {
  it("remembers each project's icon and colour on its own", () => {
    const storage = memoryStorage();
    const store = createProjectAppearance(() => storage);
    store.set("p1", { icon: "rocket", tone: "blue" });
    store.set("p2", { tone: "green" });
    expect(store.get()).toEqual({
      p1: { icon: "rocket", tone: "blue" },
      p2: { tone: "green" },
    });
    // A new store over the same storage reads it back.
    expect(createProjectAppearance(() => storage).get()).toEqual(store.get());
  });

  it("changes one field and leaves the other; undefined and reset go back to the default", () => {
    const store = createProjectAppearance(() => memoryStorage());
    store.set("p1", { icon: "bug", tone: "red" });
    store.set("p1", { tone: "teal" });
    expect(store.get().p1).toEqual({ icon: "bug", tone: "teal" });
    store.set("p1", { icon: undefined });
    expect(store.get().p1).toEqual({ tone: "teal" });
    store.set("p1", { tone: undefined });
    expect(store.get().p1).toBeUndefined();
    store.set("p1", { icon: "star" });
    store.reset("p1");
    expect(store.get()).toEqual({});
  });

  it("ignores values it doesn't know, and unreadable storage", () => {
    const storage = memoryStorage();
    storage.setItem(
      "gravita.projectAppearance",
      JSON.stringify({ a: { icon: "nope", tone: "blue" }, b: { icon: "x" }, c: 4 }),
    );
    expect(createProjectAppearance(() => storage).get()).toEqual({ a: { tone: "blue" } });
    storage.setItem("gravita.projectAppearance", "{broken");
    expect(createProjectAppearance(() => storage).get()).toEqual({});
  });

  it("works for this window only when there is no storage", () => {
    const store = createProjectAppearance(() => {
      throw new Error("no storage");
    });
    store.set("p1", { tone: "pink" });
    expect(store.get().p1).toEqual({ tone: "pink" });
  });

  it("tells subscribers about every change", () => {
    const store = createProjectAppearance(() => memoryStorage());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set("p1", { tone: "blue" });
    store.reset("p1");
    off();
    store.set("p1", { tone: "red" });
    expect(calls).toBe(2);
  });
});
