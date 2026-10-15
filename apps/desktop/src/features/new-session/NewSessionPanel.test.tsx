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

function renderPanel(
  props: { defaultFolder?: string } = {},
  gateway = new FakeGateway(),
  pickFolder?: () => Promise<string | null>,
) {
  const onClose = vi.fn();
  const view = renderWithApp(
    <NewSessionPanel
      id="ns"
      recent={[{ name: "app", root: "/work/app" }]}
      onClose={onClose}
      {...props}
    />,
    { state, gateway, ...(pickFolder ? { pickFolder } : {}) },
  );
  return { ...view, onClose };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const folderField = () => screen.getByLabelText("Folder");
const start = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await flush();
  });
};

const agentRadios = () => screen.getAllByRole("radio", { name: /Claude Code|Codex|Cursor/ });
const agentChoice = () => screen.getByRole("group", { name: "Agent" });
const offered = (label: string) =>
  [...(field(label) as unknown as HTMLSelectElement).options].map((o) => o.textContent);

describe("NewSessionPanel", () => {
  it("asks for the folder before starting, and only the folder", async () => {
    const { gateway, store } = renderPanel();
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: true } })),
    );
    await act(flush);
    await start();
    expect(screen.getByText("Choose the folder the agent will work in.")).toBeTruthy();
    expect(folderField().getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "app" }));
    expect(folderField().textContent).toContain("/work/app");
    expect(gateway.callsOf("startSession")).toEqual([]);
    await start();
    expect(gateway.callsOf("startSession")).toEqual([
      { cwd: "/work/app", permissionMode: "default" },
    ]);
  });

  it("starts with the chosen settings and opens the new session", async () => {
    const { gateway, navigate, store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: true } })),
    );
    gateway.startResult = { sessionId: "s-new", projectId: "p1" };
    expect(folderField().textContent).toContain("/work/p1");
    await act(flush);

    fireEvent.change(field("Model"), { target: { value: "opus" } });
    fireEvent.change(field("Permissions"), { target: { value: "bypassPermissions" } });
    expect(screen.getByRole("note").textContent).toContain("without asking");
    await start();

    expect(gateway.callsOf("startSession")).toEqual([
      {
        cwd: "/work/p1",
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
    const { navigate, store } = renderPanel({ defaultFolder: "/work/p1" }, gateway);
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: true } })),
    );
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
    const { store } = renderPanel({ defaultFolder: "/work/p1" }, gateway);
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: true } })),
    );
    await start();

    expect(screen.getByRole("heading", { name: "Log in to Claude Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy /login" })).toBeTruthy();
  });

  it("blocks start and shows login steps when Claude Code is logged out", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: false } })),
    );
    await act(flush);
    expect(screen.getByRole("heading", { name: "Log in to Claude Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("closes with Escape and Cancel", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(screen.getByRole("heading", { name: "New session" }), { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("sets the folder from the native picker", async () => {
    const pickFolder = vi.fn(async () => "/picked/proj");
    const { store } = renderPanel({}, new FakeGateway(), pickFolder);
    act(() =>
      store.getState().setEngineStatus(engine({ claude: { found: true, loggedIn: true } })),
    );
    await act(flush);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
      await flush();
    });
    expect(pickFolder).toHaveBeenCalled();
    expect(folderField().textContent).toContain("/picked/proj");
  });
});

type Providers = EngineStatus["providers"];
const engine = (providers: Providers, demo = false): EngineStatus => ({
  providers,
  claude: providers.claude ?? { found: false },
  indexing: { done: 0, total: 0 },
  demo,
});
const BOTH: Providers = {
  claude: { found: true, loggedIn: true },
  codex: { found: true, loggedIn: true },
};
const CODEX_MODELS = [
  { value: "gpt-5.5-codex", displayName: "GPT-5.5 Codex" },
  { value: "gpt-5.5-mini", displayName: "GPT-5.5 mini" },
];

describe("NewSessionPanel with Claude Code and Codex", () => {
  it.each<[string, EngineStatus]>([
    ["only Claude Code is installed", engine({ claude: { found: true, loggedIn: true } })],
    [
      "Codex isn't installed",
      engine({ claude: { found: true, loggedIn: true }, codex: { found: false } }),
    ],
    [
      "Codex is older than Gravita supports",
      engine({ claude: { found: true, loggedIn: true }, codex: { found: true, outdated: true } }),
    ],
    ["it is the demo", engine(BOTH, true)],
  ])("always offers Claude Code, Codex and Cursor when %s", (_, status) => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(status));
    expect(agentChoice()).toBeTruthy();
    expect(agentRadios().map((r) => r.getAttribute("value"))).toEqual(
      expect.arrayContaining(["claude", "codex", "cursor"]),
    );
  });

  it("disables Codex and Cursor in demo mode", () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(engine(BOTH, true)));
    expect(screen.getByRole("radio", { name: "Codex" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("radio", { name: "Cursor" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("radio", { name: "Claude Code" }).hasAttribute("disabled")).toBe(false);
  });

  it("starts Codex when it is the only agent that can run", async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect(offered("Permissions")).toEqual([
      "Ask before acting",
      "Edit in this folder",
      "Full access",
    ]);
    await start();
    expect(gateway.callsOf("startSession")).toEqual([
      expect.objectContaining({ provider: "codex", permissionMode: "ask" }),
    ]);
  });

  it("shows Codex install steps when Codex is chosen but not installed", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store
        .getState()
        .setEngineStatus(
          engine({ claude: { found: true, loggedIn: true }, codex: { found: false } }),
        ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Connect Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
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
    await start();

    expect(gateway.callsOf("startSession")).toEqual([
      {
        cwd: "/work/p1",
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
    await start();
    // Claude Code is the engine's default, so the request names no provider.
    expect(gateway.callsOf("startSession")).toEqual([
      { cwd: "/work/p1", permissionMode: "default" },
    ]);
  });

  it("shows Codex's sign-in steps when Codex is chosen but logged out", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(
        engine({
          claude: { found: true, loggedIn: true },
          codex: { found: true, loggedIn: false },
        }),
      ),
    );
    expect(screen.queryByRole("heading", { name: "Sign in to Codex" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Sign in to Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
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
    await start();

    expect(screen.getByRole("alert").textContent).toContain("Codex isn't logged in.");
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeTruthy();
  });
});

describe("NewSessionPanel with Cursor", () => {
  const VALID = { source: "app", state: "valid" } as const;
  const ALL: Providers = { ...BOTH, cursor: { found: true, credential: VALID } };
  const CURSOR_MODELS = [
    { value: "default", displayName: "Auto" },
    { value: "gpt-5.5", displayName: "GPT-5.5" },
  ];

  it("offers Cursor next to the other agents, with its own models and modes", async () => {
    const { store, gateway } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus(engine(ALL)));
    await act(flush);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(
      expect.arrayContaining(["claude", "codex", "cursor"]),
    );

    gateway.modelsResult = { models: CURSOR_MODELS };
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(gateway.callsOf("models")).toContainEqual({ provider: "cursor" });
    expect(offered("Model")[0]).toBe("Auto");
    expect(offered("Permissions")).toEqual(["Agent", "Plan first", "Ask (read only)"]);
    expect(field("Permissions").value).toBe("agent");
    // Cursor has no mode that acts without asking.
    expect(screen.queryByRole("note")).toBeNull();
    // This engine opens no terminals, so the session runs as a chat.
    expect(screen.queryByRole("group", { name: "Run in" })).toBeNull();

    fireEvent.change(field("Permissions"), { target: { value: "ask" } });
    await start();
    expect(gateway.callsOf("startSession")).toEqual([
      { cwd: "/work/p1", provider: "cursor", permissionMode: "ask" },
    ]);
    expect(gateway.callsOf("spawnTerminal")).toEqual([]);
  });

  it("opens Cursor's CLI in a terminal when the engine can", async () => {
    const { store, gateway } = renderPanel({ defaultFolder: "/work/p1" });
    act(() => store.getState().setEngineStatus({ ...engine(ALL), terminal: true }));
    await act(flush);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(screen.getByRole("group", { name: "Run in" })).toBeTruthy();

    fireEvent.change(field("Permissions"), { target: { value: "plan" } });
    await start();
    expect(gateway.callsOf("startSession")).toEqual([]);
    expect(gateway.callsOf("spawnTerminal")).toEqual([
      expect.objectContaining({ cwd: "/work/p1", command: "cursor", permissionMode: "plan" }),
    ]);
  });

  it("shows install steps when Cursor is chosen but its CLI is missing", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store
        .getState()
        .setEngineStatus(
          engine({ claude: { found: true, loggedIn: true }, cursor: { found: false } }),
        ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Connect Cursor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("shows update steps when Cursor CLI is outdated", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(
        engine({
          claude: { found: true, loggedIn: true },
          cursor: { found: true, outdated: true },
        }),
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Update Cursor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("points to Settings, not a login, when Cursor is chosen without a key", async () => {
    const { store, navigate } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(
        engine({
          claude: { found: true, loggedIn: true },
          cursor: { found: true, credential: { source: "none", state: "missing" } },
        }),
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Cursor API key not set" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(navigate).toHaveBeenCalledWith({ level: "settings" });
    expect(screen.queryByRole("button", { name: /Copy .*(login|CURSOR_API_KEY)/ })).toBeNull();
  });

  it("blocks start when the engine says Cursor's key was turned down", async () => {
    const { store } = renderPanel({ defaultFolder: "/work/p1" });
    act(() =>
      store.getState().setEngineStatus(
        engine({
          claude: { found: true, loggedIn: true },
          cursor: { found: true, credential: { source: "app", state: "invalid" } },
        }),
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "Cursor API key not working" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
