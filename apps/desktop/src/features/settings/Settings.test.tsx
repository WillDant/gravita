import type { EngineStatus, ProviderCredential } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorKeyBridge } from "@/infrastructure/platform/tauri";
import { setLocale } from "@/shared/i18n/i18n";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { Settings } from "./Settings";

afterEach(cleanup);
setLocale("en");

const KEY = "crsr_test_SENTINEL_0123456789abcdef";

function fakeBridge() {
  const keychain = { key: undefined as string | undefined };
  const bridge = {
    present: vi.fn(async () => keychain.key !== undefined),
    set: vi.fn(async (key: string) => {
      keychain.key = key;
    }),
    remove: vi.fn(async () => {
      keychain.key = undefined;
    }),
  } satisfies CursorKeyBridge;
  return { bridge };
}

const status = (credential?: ProviderCredential): EngineStatus => ({
  providers: {
    claude: { found: true },
    cursor: { found: true, ...(credential ? { credential } : {}) },
  },
  claude: { found: true },
  indexing: { done: 0, total: 0 },
  demo: false,
});

describe("Settings", () => {
  it("shows the Cursor key panel and saving does not leave settings", async () => {
    const { bridge } = fakeBridge();
    const gateway = new FakeGateway();
    const { store, navigate } = renderWithApp(<Settings />, { gateway, cursorKey: bridge });
    act(() => store.getState().setEngineStatus(status()));
    await act(flush);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cursor API key" })).toBeTruthy();

    const field = screen.getByLabelText("API key");
    fireEvent.change(field, { target: { value: KEY } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await flush();
    });
    expect(bridge.set).toHaveBeenCalledWith(KEY);
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().route).toEqual({ level: "home" });
  });
});
