import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { NewSessionPanel } from "./NewSessionPanel";

afterEach(cleanup);
setLocale("en");

const state = stateOf(started("s1", 5, "p1"));

function renderPanel(props: { defaultFolder?: string } = {}, gateway = new FakeGateway()) {
  const onClose = vi.fn();
  const view = renderWithApp(
    <NewSessionPanel
      id="ns"
      recent={[{ name: "app", root: "/work/app" }]}
      onClose={onClose}
      {...props}
    />,
    { state, gateway },
  );
  return { ...view, onClose };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const start = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await flush();
  });
};

describe("NewSessionPanel", () => {
  it("asks for the folder, then the message, before starting", async () => {
    const { gateway } = renderPanel();
    await start();
    expect(screen.getByText("Choose the folder the agent will work in.")).toBeTruthy();
    expect(field("Folder").getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "app" }));
    expect(field("Folder").value).toBe("/work/app");
    await start();
    expect(screen.getByText("Write the first message.")).toBeTruthy();
    expect(gateway.callsOf("startSession")).toEqual([]);
  });

  it("starts with the chosen settings and opens the new session", async () => {
    const { gateway, navigate } = renderPanel({ defaultFolder: "/work/p1" });
    gateway.startResult = { sessionId: "s-new", projectId: "p1" };
    expect(field("Folder").value).toBe("/work/p1");
    await act(flush);

    fireEvent.change(field("First message"), { target: { value: " Fix the login " } });
    fireEvent.change(field("Model"), { target: { value: "opus" } });
    fireEvent.change(field("Permissions"), { target: { value: "bypassPermissions" } });
    expect(screen.getByRole("note").textContent).toContain("without asking");
    await act(async () => {
      fireEvent.keyDown(field("First message"), { key: "Enter", metaKey: true });
      await flush();
    });

    expect(gateway.callsOf("startSession")).toEqual([
      {
        cwd: "/work/p1",
        prompt: "Fix the login",
        model: "opus",
        permissionMode: "bypassPermissions",
      },
    ]);
    expect(navigate).toHaveBeenCalledWith({
      level: "session",
      projectId: "p1",
      sessionId: "s-new",
    });
  });

  it.each([
    [RpcErrors.invalidCwd, "That folder doesn't exist. Check the path."],
    [RpcErrors.tooManySessions, "Too many sessions are running."],
    [RpcErrors.claudeUnavailable, "Claude Code isn't available on this Mac."],
    [RpcErrors.notLoggedIn, "Claude Code isn't logged in."],
  ])("explains engine error %o", async (error, text) => {
    const gateway = new FakeGateway();
    gateway.failures.startSession = new GatewayError(error.code, error.message);
    const { navigate } = renderPanel({ defaultFolder: "/work/p1" }, gateway);
    fireEvent.change(field("First message"), { target: { value: "go" } });
    await start();

    expect(screen.getByRole("alert").textContent).toContain(text);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the connect steps when Claude Code isn't logged in", async () => {
    const gateway = new FakeGateway();
    gateway.failures.startSession = new GatewayError(
      RpcErrors.notLoggedIn.code,
      RpcErrors.notLoggedIn.message,
    );
    renderPanel({ defaultFolder: "/work/p1" }, gateway);
    fireEvent.change(field("First message"), { target: { value: "go" } });
    await start();

    expect(screen.getByRole("heading", { name: "Log in to Claude Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy /login" })).toBeTruthy();
  });

  it("closes with Escape and Cancel", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(field("Folder"), { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
