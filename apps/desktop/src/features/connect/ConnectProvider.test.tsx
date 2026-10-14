import type { EngineStatus } from "@gravita/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { codexNoteOf, problemOf } from "@/state/hooks";
import { ConnectProvider } from "./ConnectProvider";

afterEach(cleanup);
setLocale("en");

const status = (over: Partial<EngineStatus> = {}): EngineStatus => ({
  providers: { claude: { found: true, path: "/bin/claude" } },
  claude: { found: true, path: "/bin/claude" },
  indexing: { done: 0, total: 0 },
  demo: false,
  ...over,
});

describe("connect guidance per provider", () => {
  it("shows Claude Code's steps, as before", () => {
    render(<ConnectProvider provider="claude" problem="loggedOut" />);
    expect(screen.getByRole("heading", { name: "Log in to Claude Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy /login" })).toBeTruthy();
  });

  it("shows Codex's install steps: Homebrew, or npm, then open it", () => {
    render(<ConnectProvider provider="codex" problem="missing" />);
    expect(screen.getByRole("heading", { name: "Connect Codex" })).toBeTruthy();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      expect.stringContaining("1. Install it with Homebrew"),
      expect.stringContaining("Or with npm"),
      expect.stringContaining("2. Open Codex in your Terminal and sign in"),
    ]);
    expect(screen.getByRole("button", { name: "Copy brew install --cask codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy npm install -g @openai/codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy codex" })).toBeTruthy();
  });

  it("tells how to update an outdated Codex", () => {
    render(<ConnectProvider provider="codex" problem="outdated" />);
    expect(screen.getByRole("heading", { name: "Update Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy brew upgrade --cask codex" })).toBeTruthy();
  });
});

describe("what Gravita says about Codex", () => {
  const codex = (over: Partial<NonNullable<EngineStatus["providers"]["codex"]>>) =>
    status({ providers: { claude: { found: true }, codex: { found: true, ...over } } });

  it("is quiet unless the engine looked and found no Codex, or an old one", () => {
    expect(codexNoteOf(status())).toBeUndefined();
    expect(codexNoteOf(codex({}))).toBeUndefined();
    expect(codexNoteOf(codex({ found: false }))).toBe("missing");
    expect(codexNoteOf(codex({ version: "0.150.0", outdated: true }))).toBe("outdated");
    expect(codexNoteOf({ ...codex({ found: false }), demo: true })).toBeUndefined();
    expect(codexNoteOf(undefined)).toBeUndefined();
  });
});

describe("a provider's problem from the engine status", () => {
  it("reads providers, never in demo mode", () => {
    expect(problemOf(status(), "claude")).toBeUndefined();
    const loggedOut = { found: true, loggedIn: false };
    expect(problemOf(status({ providers: { claude: loggedOut } }), "claude")).toBe("loggedOut");
    expect(
      problemOf(status({ providers: { claude: { found: true, outdated: true } } }), "claude"),
    ).toBe("outdated");
    expect(problemOf(status(), "codex")).toBe("missing");
    expect(problemOf(status({ demo: true }), "codex")).toBeUndefined();
    expect(problemOf(undefined, "claude")).toBeUndefined();
  });

  it("falls back to the claude field of an engine from before providers", () => {
    const old = {
      claude: { found: true, loggedIn: false },
      indexing: { done: 0, total: 0 },
      demo: false,
    };
    expect(problemOf(old as unknown as EngineStatus, "claude")).toBe("loggedOut");
    expect(problemOf(old as unknown as EngineStatus, "codex")).toBe("missing");
  });
});
