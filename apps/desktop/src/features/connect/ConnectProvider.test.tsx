import type { EngineStatus } from "@gravita/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { renderWithApp } from "@/test/render";
import { canStartWith, codexNoteOf, optionalNoteOf, problemOf } from "@/state/hooks";
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

  it("sends a logged-out Codex user to sign in from the Terminal", () => {
    render(<ConnectProvider provider="codex" problem="loggedOut" />);
    expect(screen.getByRole("heading", { name: "Sign in to Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeTruthy();
  });

  it("tells how to update an outdated Codex", () => {
    render(<ConnectProvider provider="codex" problem="outdated" />);
    expect(screen.getByRole("heading", { name: "Update Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy brew upgrade --cask codex" })).toBeTruthy();
  });

  it("shows how to install or update Cursor's CLI, never how to log in", () => {
    render(<ConnectProvider provider="cursor" problem="missing" />);
    expect(screen.getByRole("heading", { name: "Connect Cursor" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy curl https://cursor.com/install -fsS | bash" }),
    ).toBeTruthy();
    cleanup();
    render(<ConnectProvider provider="cursor" problem="outdated" />);
    expect(screen.getByRole("heading", { name: "Update Cursor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy cursor-agent update" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/login|CURSOR_API_KEY/);
  });

  it("sends missing or invalid keys to Settings, not a login", () => {
    const { navigate } = renderWithApp(<ConnectProvider provider="cursor" problem="keyMissing" />);
    expect(screen.getByRole("heading", { name: "Cursor API key not set" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(navigate).toHaveBeenCalledWith({ level: "settings" });
    cleanup();
    const invalid = renderWithApp(
      <ConnectProvider provider="cursor" problem="keyInvalid" />,
    );
    expect(screen.getByRole("heading", { name: "Cursor API key not working" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(invalid.navigate).toHaveBeenCalledWith({ level: "settings" });
  });
});

describe("what Gravita says about Cursor", () => {
  it("is optional like Codex: a note when missing or old, never in demo mode", () => {
    const cursor = (over: Partial<NonNullable<EngineStatus["providers"]["cursor"]>>) =>
      status({ providers: { claude: { found: true }, cursor: { found: true, ...over } } });
    expect(optionalNoteOf(status(), "cursor")).toBeUndefined();
    expect(optionalNoteOf(cursor({}), "cursor")).toBeUndefined();
    expect(optionalNoteOf(cursor({ found: false }), "cursor")).toBe("missing");
    expect(optionalNoteOf(cursor({ outdated: true }), "cursor")).toBe("outdated");
    expect(optionalNoteOf({ ...cursor({ found: false }), demo: true }, "cursor")).toBeUndefined();
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

  it("tells a missing Cursor CLI from a missing or rejected key", () => {
    const cursor = (over: Partial<NonNullable<EngineStatus["providers"]["cursor"]>>) =>
      status({ providers: { claude: { found: true }, cursor: { found: true, ...over } } });
    expect(problemOf(status(), "cursor")).toBe("missing");
    expect(problemOf(cursor({ outdated: true }), "cursor")).toBe("outdated");
    expect(problemOf(cursor({}), "cursor")).toBe("keyMissing");
    expect(problemOf(cursor({ credential: { source: "none", state: "missing" } }), "cursor")).toBe(
      "keyMissing",
    );
    const app = (state: "unchecked" | "valid" | "invalid") =>
      cursor({ credential: { source: "app", state } });
    expect(problemOf(app("invalid"), "cursor")).toBe("keyInvalid");
    expect(problemOf(app("unchecked"), "cursor")).toBeUndefined();
    expect(problemOf(app("valid"), "cursor")).toBeUndefined();
    // Cursor never logs in: a stale `loggedIn: false` isn't a login problem.
    const stale = cursor({ loggedIn: false, credential: { source: "app", state: "valid" } });
    expect(problemOf(stale, "cursor")).toBeUndefined();
    expect(problemOf({ ...cursor({}), demo: true }, "cursor")).toBeUndefined();
  });

  it("can start Cursor once its CLI is usable; the key panel covers the rest", () => {
    const cursor = (over: Partial<NonNullable<EngineStatus["providers"]["cursor"]>>) =>
      status({ providers: { claude: { found: true }, cursor: { found: true, ...over } } });
    expect(canStartWith(cursor({}), "cursor")).toBe(true);
    expect(canStartWith(cursor({ outdated: true }), "cursor")).toBe(false);
    expect(canStartWith(status(), "cursor")).toBe(false);
    expect(canStartWith({ ...cursor({}), demo: true }, "cursor")).toBe(false);
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
