import type { PermissionMode } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { Composer } from "./Composer";

afterEach(cleanup);
setLocale("en");

const at = { ts: ago(1), projectId: "p1", sessionId: "s" };
const state = stateOf(started("s", 5, "p1", "chat"), [
  ev("session.control", { controllable: true }, at),
  ev("session.settings", { model: "opus", permissionMode: "default" }, at),
]);

function renderComposer() {
  const view = renderWithApp(<Composer session={state.sessions.s!} />, { state });
  const box = screen.getByLabelText("Message the main agent") as HTMLTextAreaElement;
  return { ...view, box };
}

const settle = () => act(flush);

describe("Composer", () => {
  it("sends with ⌘↩ or Ctrl↩, not with a plain return, and clears the box", async () => {
    const { gateway, box } = renderComposer();

    fireEvent.change(box, { target: { value: "Add tests" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(gateway.callsOf("sendMessage")).toEqual([]);

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await settle();
    expect(box.value).toBe("");

    fireEvent.change(box, { target: { value: "  Then lint  " } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await settle();

    expect(gateway.callsOf("sendMessage")).toEqual([
      { sessionId: "s", text: "Add tests" },
      { sessionId: "s", text: "Then lint" },
    ]);
  });

  it("shows 'sending…' while the engine works, then the mapped error, keeping the text", async () => {
    const { gateway, box } = renderComposer();
    gateway.held.add("sendMessage");
    gateway.failures.sendMessage = new GatewayError(
      RpcErrors.notLoggedIn.code,
      RpcErrors.notLoggedIn.message,
    );

    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(screen.getByText("Sending…")).toBeTruthy();

    gateway.release();
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("Claude Code isn't logged in.");
    expect(box.value).toBe("hello");
  });

  it("interrupts from its own button", async () => {
    const { gateway } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await settle();
    expect(gateway.callsOf("interruptSession")).toEqual([{ sessionId: "s" }]);
    expect(gateway.callsOf("sendMessage")).toEqual([]);
  });

  it("changes model and permissions, but never offers bypass mid-session", async () => {
    const { gateway } = renderComposer();
    await settle();

    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(model.value).toBe("opus");
    fireEvent.change(model, { target: { value: "default" } });
    const mode = screen.getByLabelText("Permissions") as HTMLSelectElement;
    const offered = [...mode.options].map((o) => o.value);
    expect(offered).not.toContain("bypassPermissions");
    fireEvent.change(mode, { target: { value: "acceptEdits" } });
    await settle();

    expect(gateway.callsOf("setModel")).toEqual([{ sessionId: "s", model: "default" }]);
    expect(gateway.callsOf("setPermissionMode")).toEqual([{ sessionId: "s", mode: "acceptEdits" }]);
  });
});

/** A Codex chat Gravita runs; settings report its mode in Claude Code's terms. */
function codexState(permissionMode: PermissionMode) {
  return stateOf(
    started("s", 5, "p1", "chat").map((e) => ({ ...e, provider: "codex" })),
    [
      ev("session.control", { controllable: true }, at),
      ev("session.settings", { model: "gpt-5.5-codex", permissionMode }, at),
    ],
  );
}

describe("Composer of a Codex session", () => {
  const renderCodex = (permissionMode: PermissionMode) => {
    const codex = codexState(permissionMode);
    return renderWithApp(<Composer session={codex.sessions.s!} />, { state: codex });
  };

  it("offers Codex's models and modes, and changes the mode in Codex's terms", async () => {
    const { gateway } = renderCodex("acceptEdits");
    gateway.modelsResult = { models: [{ value: "gpt-5.5-codex", displayName: "GPT-5.5 Codex" }] };
    await settle();

    expect(gateway.callsOf("models")).toEqual([{ provider: "codex" }]);
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(model.value).toBe("gpt-5.5-codex");
    const mode = screen.getByLabelText("Permissions") as HTMLSelectElement;
    expect(mode.value).toBe("workspace");
    // Full access, like Claude Code's bypass, can only be chosen when a session starts.
    expect([...mode.options].map((o) => o.textContent)).toEqual([
      "Ask before acting",
      "Edit in this folder",
    ]);
    fireEvent.change(mode, { target: { value: "ask" } });
    await settle();

    expect(gateway.callsOf("setPermissionMode")).toEqual([{ sessionId: "s", mode: "ask" }]);
  });

  it("keeps full access on offer, with its warning, while the session runs in it", async () => {
    renderCodex("bypassPermissions");
    await settle();

    const mode = screen.getByLabelText("Permissions") as HTMLSelectElement;
    expect(mode.value).toBe("fullAccess");
    expect([...mode.options].map((o) => o.value)).toEqual(["ask", "workspace", "fullAccess"]);
    expect(screen.getByRole("note").textContent).toContain("Codex will run commands");
  });
});
