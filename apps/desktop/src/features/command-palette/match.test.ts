import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./match";

describe("fuzzyMatch", () => {
  it("ignores case and accents, and points at the original letters", () => {
    const m = fuzzyMatch("sessao", "Nova Sessão");
    expect(m).not.toBeNull();
    expect(m?.indices).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("needs the letters in order", () => {
    expect(fuzzyMatch("ba", "ab")).toBeNull();
    expect(fuzzyMatch("xyz", "New session")).toBeNull();
  });

  it("ranks word starts and runs above scattered letters", () => {
    const starts = fuzzyMatch("ns", "New session")?.score ?? 0;
    const scattered = fuzzyMatch("ns", "Unsorted")?.score ?? 0;
    expect(starts).toBeGreaterThan(scattered);
    const prefix = fuzzyMatch("set", "Settings")?.score ?? 0;
    const inside = fuzzyMatch("set", "Reset")?.score ?? 0;
    expect(prefix).toBeGreaterThan(inside);
  });

  it("still finds letters a word-start jump would strand", () => {
    // Jumping to the "a" of "api" would leave no "p" after it.
    expect(fuzzyMatch("ap", "map api")).not.toBeNull();
  });

  it("skips spaces in the query and matches everything when it's empty", () => {
    expect(fuzzyMatch("new s", "New session")).not.toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });
});
