import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ptBR } from "./pt-BR";

describe("locales", () => {
  it("translate every string into Brazilian Portuguese, the product name aside", () => {
    const keys = Object.keys(en).filter((k) => k !== "app.name");
    expect(keys.length).toBeGreaterThan(500);
    expect(keys.filter((k) => !(k in ptBR))).toEqual([]);
    // Nothing translated that English doesn't have: a typo'd key would never show.
    expect(Object.keys(ptBR).filter((k) => !(k in en))).toEqual([]);
  });

  it("keep the same {params} in both languages", () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const drift = Object.entries(ptBR).filter(
      ([k, v]) =>
        JSON.stringify(params(v ?? "")) !== JSON.stringify(params(en[k as keyof typeof en])),
    );
    expect(drift).toEqual([]);
  });

  it("say that Gravita observes Claude Code or Codex, in both languages", () => {
    for (const key of ["home.empty", "project.empty"] as const) {
      expect(en[key]).toContain("Claude Code or Codex");
      expect(ptBR[key]).toContain("Claude Code ou o Codex");
    }
  });
});
