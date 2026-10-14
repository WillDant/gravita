import type { EngineStatus } from "@gravita/protocol";
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

type Providers = EngineStatus["providers"];
const engine = (providers: Providers, demo = false): EngineStatus => ({
  providers,
  claude: providers.claude ?? { found: false },
  indexing: { done: 0, total: 0 },
  demo,
});
const BOTH: Providers = { claude: { found: true }, codex: { found: true, loggedIn: true } };
const CODEX_MODELS = [
  { value: "gpt-5.5-codex", displayName: "GPT-5.5 Codex" },
  { value: "gpt-5.5-mini", displayName: "GPT-5.5 mini" },
];

const agentChoice = () => screen.queryByRole("group", { name: "Agent" });
const offered = (label: string) =>
  [...(field(label) as unknown as HTMLSelectElement).options].map((o) => o.textContent);

describe("NewSessionPanel with Claude Code and Codex", () => {
  it.each<[string, EngineStatus]>([
    ["only Claude Code is installed", engine({ claude: { found: true } })],
    ["Codex isn't installed", engine({ claude: { found: true }, codex: { found: false } })],
    [
      "Codex is older than Gravita supports",
      engine({ claude: { found: true }, codex: { found: true, outdated: true } }),
    ],
    ["it is the demo", engine(BOTH, true)],
  ])("offers no choice of agent when %s", (_, status) => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(status));
    expect(agentChoice()).toBeNull();
  });

  it("starts Codex, with no choice offered, when Codex is the only agent that can run", async () => {
    const { store, gateway } = renderPanel({ defaultFolder: "/work/p1" });
    gateway.modelsResult = { models: CODEX_MODELS };
    act(() =>
      store
        .getState()
        .setEngineStatus(
          engine({ claude: { found: false }, codex: { found: true, loggedIn: true } }),
        ),
    );
    await act(flush);
    expect(agentChoice()).toBeNull();
    expect(offered("Permissions")).toEqual([
      "Ask before acting",
      "Edit in this folder",
      "Full access",
    ]);
    fireEvent.change(field("First message"), { target: { value: "Fix the login" } });
    await start();
    expect(gateway.callsOf("startSession")).toEqual([
      expect.objectContaining({ provider: "codex", permissionMode: "ask" }),
    ]);
  });

  it("starts a Codex session with Codex's models and modes", async () => {
    const { store, gateway } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(engine(BOTH)));
    await act(flush);

    const claude = screen.getByRole("radio", { name: "Claude Code" }) as HTMLInputElement;
    expect(agentChoice()).toBeTruthy();
    expect(claude.checked).toBe(true);
    expect(offered("Model")[0]).toBe("Claude Code default");
    fireEvent.change(field("Model"), { target: { value: "opus" } });

    gateway.modelsResult = { models: CODEX_MODELS };
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect(gateway.callsOf("models")).toContainEqual({ provider: "codex" });
    expect(field("Model").value).toBe("");
    expect(offered("Model")).toEqual(["Codex default", "GPT-5.5 Codex", "GPT-5.5 mini"]);
    expect(offered("Permissions")).toEqual([
      "Ask before acting",
      "Edit in this folder",
      "Full access",
    ]);
    expect(field("Permissions").value).toBe("ask");
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.change(field("Permissions"), { target: { value: "fullAccess" } });
    expect(screen.getByRole("note").textContent).toContain("anywhere on this Mac");
    fireEvent.change(field("Permissions"), { target: { value: "workspace" } });
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.change(field("Model"), { target: { value: "gpt-5.5-codex" } });
    fireEvent.change(field("First message"), { target: { value: "Fix the login" } });
    await start();

    expect(gateway.callsOf("startSession")).toEqual([
      {
        cwd: "/work/p1",
        prompt: "Fix the login",
        provider: "codex",
        model: "gpt-5.5-codex",
        permissionMode: "workspace",
      },
    ]);
  });

  it("goes back to Claude Code's default model and mode when switching back", async () => {
    const { store, gateway } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(engine(BOTH)));
    await act(flush);
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    fireEvent.change(field("Permissions"), { target: { value: "fullAccess" } });
    fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));

    expect(field("Permissions").value).toBe("default");
    expect(offered("Permissions")).toContain("Don't ask");
    fireEvent.change(field("First message"), { target: { value: "go" } });
    await start();
    // Claude Code is the engine's default, so the request names no provider.
    expect(gateway.callsOf("startSession")).toEqual([
      { cwd: "/work/p1", prompt: "go", permissionMode: "default" },
    ]);
  });

  it("shows Codex's sign-in steps when Codex is chosen but logged out", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store
        .getState()
        .setEngineStatus(
          engine({ claude: { found: true }, codex: { found: true, loggedIn: false } }),
        ),
    );
    expect(screen.queryByRole("heading", { name: "Sign in to Codex" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Sign in to Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeTruthy();
  });

  it("shows Codex's sign-in steps when the engine says Codex isn't logged in", async () => {
    const gateway = new FakeGateway();
    gateway.failures.startSession = new GatewayError(
      RpcErrors.notLoggedIn.code,
      RpcErrors.notLoggedIn.message,
      { provider: "codex" },
    );
    const { store } = renderPanel({ defaultFolder: "/work/p1" }, gateway);
    act(() => store.getState().setEngineStatus(engine(BOTH)));
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    fireEvent.change(field("First message"), { target: { value: "go" } });
    await start();

    expect(screen.getByRole("alert").textContent).toContain("Codex isn't logged in.");
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeTruthy();
  });
});
