import type { EngineStatus, ProviderCredential } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorKeyBridge } from "@/infrastructure/platform/tauri";
import { setLocale } from "@/shared/i18n/i18n";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { CursorKey } from "./CursorKey";
import { CursorKeyLine } from "./CursorKeyLine";

afterEach(cleanup);
setLocale("en");

const KEY = "crsr_test_SENTINEL_0123456789abcdef";

/** The shell's key commands, over an in-memory Keychain. */
function fakeBridge(stored = false) {
  const keychain = { key: stored ? "stored-key" : (undefined as string | undefined) };
  const bridge = {
    present: vi.fn(async () => keychain.key !== undefined),
    set: vi.fn(async (key: string) => {
      keychain.key = key;
    }),
    remove: vi.fn(async () => {
      keychain.key = undefined;
    }),
  } satisfies CursorKeyBridge;
  return { bridge, keychain };
}

const status = (credential?: ProviderCredential, found = true): EngineStatus => ({
  providers: {
    claude: { found: true },
    cursor: { found, ...(credential ? { credential } : {}) },
  },
  claude: { found: true },
  indexing: { done: 0, total: 0 },
  demo: false,
});
const NONE: ProviderCredential = { source: "none", state: "missing" };

async function renderKey(bridge?: CursorKeyBridge, credential: ProviderCredential = NONE) {
  const gateway = new FakeGateway();
  const view = renderWithApp(<CursorKey />, { gateway, ...(bridge ? { cursorKey: bridge } : {}) });
  act(() => view.store.getState().setEngineStatus(status(credential)));
  await act(flush);
  return view;
}

const keyField = () => screen.queryByLabelText("API key") as HTMLInputElement | null;

describe("the Cursor key panel", () => {
  it("can't set a key in a plain browser: the key is set in the desktop app only", async () => {
    await renderKey(undefined);
    expect(screen.getByText("No key is set.")).toBeTruthy();
    expect(screen.getByText("The key can only be set in the Gravita desktop app.")).toBeTruthy();
    expect(keyField()).toBeNull();
  });

  it("hands the typed key to the shell, then never shows it again", async () => {
    const { bridge } = fakeBridge();
    const { store } = await renderKey(bridge);
    const field = keyField();
    expect(field?.type).toBe("password");
    expect(field?.getAttribute("autocomplete")).toBe("off");

    fireEvent.change(field as HTMLInputElement, { target: { value: `  ${KEY}  ` } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });

    expect(bridge.set).toHaveBeenCalledWith(KEY);
    expect(keyField()).toBeNull();
    expect(screen.getByText("Key set, not checked yet.")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(JSON.stringify(store.getState())).not.toContain(KEY);

    act(() => store.getState().setEngineStatus(status({ source: "app", state: "valid" })));
    expect(screen.getByText("Key set and working.")).toBeTruthy();
  });

  it("refuses something that isn't one word, without storing it", async () => {
    const { bridge } = fakeBridge();
    await renderKey(bridge);
    fireEvent.change(keyField() as HTMLInputElement, { target: { value: "two words" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });
    expect(bridge.set).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("doesn't look like an API key");
  });

  it("says a rejected key plainly and lets it be replaced", async () => {
    const { bridge } = fakeBridge(true);
    await renderKey(bridge, { source: "app", state: "invalid" });
    expect(screen.getByText(/Cursor turned this key down/)).toBeTruthy();
    expect(keyField()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.change(keyField() as HTMLInputElement, { target: { value: KEY } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });
    expect(bridge.set).toHaveBeenCalledWith(KEY);
    expect(keyField()).toBeNull();
  });

  it("checks the key through the engine, which answers with its state only", async () => {
    const { bridge } = fakeBridge(true);
    const { gateway } = await renderKey(bridge, { source: "app", state: "unchecked" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check the key" }));
      await flush();
    });
    expect(gateway.callsOf("validateCursorKey")).toEqual([{}]);
  });

  it("removes the key only after a confirmation", async () => {
    const { bridge } = fakeBridge(true);
    await renderKey(bridge, { source: "app", state: "valid" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(bridge.remove).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove the key" }));
      await flush();
    });
    expect(bridge.remove).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No key is set.")).toBeTruthy();
    expect(keyField()).toBeTruthy();
  });

  it("says so when the Keychain refuses", async () => {
    const { bridge } = fakeBridge();
    bridge.set.mockRejectedValueOnce(new Error("denied"));
    await renderKey(bridge);
    fireEvent.change(keyField() as HTMLInputElement, { target: { value: KEY } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't store the key");
    expect(screen.getByText("No key is set.")).toBeTruthy();
  });
});

describe("Home's line about the Cursor key", () => {
  it("is quiet until the engine found Cursor, then links to Settings", async () => {
    const { store, navigate } = renderWithApp(<CursorKeyLine />);
    act(() => store.getState().setEngineStatus(status(NONE, false)));
    expect(screen.queryByText(/API key/)).toBeNull();

    act(() => store.getState().setEngineStatus(status(NONE)));
    expect(screen.getByText(/its API key isn't set in Gravita/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(navigate).toHaveBeenCalledWith({ level: "settings" });
  });
});

describe("CursorKey form isolation", () => {
  it("does not submit a parent form when saving the key", async () => {
    const { bridge } = fakeBridge();
    const parentSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    renderWithApp(
      <form onSubmit={parentSubmit}>
        <CursorKey />
      </form>,
      { cursorKey: bridge },
    );
    const field = screen.getByLabelText("API key");
    fireEvent.change(field, { target: { value: KEY } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });
    expect(parentSubmit).not.toHaveBeenCalled();
    expect(bridge.set).toHaveBeenCalledWith(KEY);
  });
});
