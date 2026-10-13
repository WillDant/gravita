import type { EngineStatus } from "@gravita/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { problemOf } from "@/state/hooks";
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

  it("shows nothing for a provider without guidance yet", () => {
    const { container } = render(<ConnectProvider provider="codex" problem="missing" />);
    expect(container.innerHTML).toBe("");
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
