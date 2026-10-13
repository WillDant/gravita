import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ptBR } from "./pt-BR";

describe("locales", () => {
  it("translate every squad string into Brazilian Portuguese", () => {
    const keys = Object.keys(en).filter(
      (k) => k.startsWith("squad.") || k.startsWith("newSquad.") || k.startsWith("error."),
    );
    expect(keys.length).toBeGreaterThan(200);
    expect(keys.filter((k) => !(k in ptBR))).toEqual([]);
  });

  it("keep the same {params} in both languages", () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const drift = Object.entries(ptBR).filter(
      ([k, v]) =>
        JSON.stringify(params(v ?? "")) !== JSON.stringify(params(en[k as keyof typeof en])),
    );
    expect(drift).toEqual([]);
  });
});
