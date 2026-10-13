import { RpcErrors } from "@gravita/protocol/constants";
import { describe, expect, it } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { describeError } from "./errors";

setLocale("en");

const failure = (error: { code: number; message: string }, data?: unknown) =>
  new GatewayError(error.code, error.message, data);

describe("provider errors", () => {
  it("name the provider the engine reports", () => {
    expect(describeError(failure(RpcErrors.providerUnavailable, { provider: "codex" }))).toEqual({
      text: "Codex isn't available on this Mac.",
      connect: { provider: "codex", problem: "missing" },
    });
    expect(describeError(failure(RpcErrors.notLoggedIn, { provider: "codex" }))).toEqual({
      text: "Codex isn't logged in.",
      connect: { provider: "codex", problem: "loggedOut" },
    });
  });

  it("are Claude Code's when the engine names no provider (older engines)", () => {
    expect(describeError(failure(RpcErrors.claudeUnavailable))).toEqual({
      text: "Claude Code isn't available on this Mac.",
      connect: { provider: "claude", problem: "missing" },
    });
    expect(describeError(failure(RpcErrors.notLoggedIn, { provider: "other" }))).toEqual({
      text: "Claude Code isn't logged in.",
      connect: { provider: "claude", problem: "loggedOut" },
    });
  });
});
