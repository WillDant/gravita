import type { EngineStatus, ProviderCredential } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorKeyBridge } from "@/infrastructure/platform/tauri";
import { getLocale, setLocale } from "@/shared/i18n/i18n";
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

  describe("preferences", () => {
    const flipTheme = () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    };

    it("sets the theme: the other option flips it, the active one changes nothing", async () => {
      document.documentElement.dataset.theme = "light";
      const toggle = vi.fn(flipTheme);
      renderWithApp(<Settings />, { toggleTheme: toggle });
      await act(flush);
      const group = screen.getByRole("group", { name: "Theme" });
      expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
      expect(group.querySelectorAll("svg").length).toBe(2);

      fireEvent.click(screen.getByRole("radio", { name: "Light" }));
      expect(toggle).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
        await flush();
      });
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe("dark");
      // It follows a change made elsewhere (the menu's button) too.
      await act(async () => {
        flipTheme();
        await flush();
      });
      expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
    });

    it("sets the language at once", async () => {
      renderWithApp(<Settings />);
      await act(flush);
      expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: "Português" }));
        await flush();
      });
      expect(getLocale()).toBe("pt-BR");
      expect(screen.getByRole("heading", { name: "Configurações" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Preferências" })).toBeTruthy();
      setLocale("en");
    });

    it("sets which notifications to send, one switch each", async () => {
      renderWithApp(<Settings />);
      await act(flush);
      const waiting = screen.getByRole("checkbox", { name: "An agent is waiting for you" });
      const finished = screen.getByRole("checkbox", {
        name: "A chat Gravita runs finishes its turn",
      });
      expect((waiting as HTMLInputElement).checked).toBe(true);
      fireEvent.click(waiting);
      expect((waiting as HTMLInputElement).checked).toBe(false);
      expect((finished as HTMLInputElement).checked).toBe(true);
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    });
  });
});
