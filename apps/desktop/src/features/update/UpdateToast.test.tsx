import type { EngineStatus } from "@gravita/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { createProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import { setLocale } from "@/shared/i18n/i18n";
import { createAppStore } from "@/state/store";
import { NOW } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { memoryStorage } from "@/test/render";
import { UpdateToast } from "./UpdateToast";

afterEach(cleanup);
beforeEach(() => localStorage.clear());
setLocale("en");

const RELEASE = "https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta";

const status = (update?: EngineStatus["update"]): EngineStatus => ({
  providers: {},
  claude: { found: false },
  indexing: { done: 0, total: 0 },
  demo: false,
  ...(update ? { update } : {}),
});

function renderToast(openRelease: (url: string) => Promise<void> = async () => {}) {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  const storage = memoryStorage();
  render(
    <AppProviders
      services={{
        store,
        gateway,
        navigate: () => {},
        toggleTheme: () => {},
        openRelease,
        notificationPrefs: createNotificationPrefs(() => storage),
        projectAppearance: createProjectAppearance(() => storage),
      }}
    >
      <UpdateToast />
    </AppProviders>,
  );
  return { store };
}

describe("UpdateToast", () => {
  it("says nothing while no newer release is known", async () => {
    const { store } = renderToast();
    act(() => store.getState().setEngineStatus(status()));
    await act(flush);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces a newer release, and Download opens its page and sends the notice away", async () => {
    const open = vi.fn(async () => {});
    const { store } = renderToast(open);
    act(() => store.getState().setEngineStatus(status({ version: "0.5.0-beta", url: RELEASE })));
    await act(flush);
    expect(screen.getByRole("status", { name: "A new version is out" })).toBeTruthy();
    expect(screen.getByText("Gravita 0.5.0-beta is available to download.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
      await flush();
    });
    expect(open).toHaveBeenCalledWith(RELEASE);
    expect(screen.queryByRole("status")).toBeNull();
    expect(localStorage.getItem("gravita.update.dismissed")).toBe("0.5.0-beta");
  });

  it("Later sends this version away for good, and a newer one shows again", async () => {
    const { store } = renderToast();
    act(() => store.getState().setEngineStatus(status({ version: "0.5.0-beta", url: RELEASE })));
    await act(flush);
    fireEvent.click(screen.getAllByRole("button", { name: "Later" })[0] as HTMLElement);
    expect(screen.queryByRole("status")).toBeNull();

    // The engine reports the same release again (its next look): still quiet.
    act(() => store.getState().setEngineStatus(status({ version: "0.5.0-beta", url: RELEASE })));
    expect(screen.queryByRole("status")).toBeNull();
    act(() =>
      store.getState().setEngineStatus(
        status({
          version: "0.6.0-beta",
          url: "https://github.com/WillDant/gravita/releases/tag/v0.6.0-beta",
        }),
      ),
    );
    expect(screen.getByText("Gravita 0.6.0-beta is available to download.")).toBeTruthy();
  });

  it("stays and explains when the browser can't be opened", async () => {
    const { store } = renderToast(async () => {
      throw new Error("no browser");
    });
    act(() => store.getState().setEngineStatus(status({ version: "0.5.0-beta", url: RELEASE })));
    await act(flush);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
      await flush();
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't open the browser");
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
