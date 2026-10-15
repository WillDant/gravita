import type { EngineStatus } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers";
import { GatewayError, LocalErrors } from "@/infrastructure/engine/GatewayError";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { createProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import { setLocale } from "@/shared/i18n/i18n";
import { createAppStore } from "@/state/store";
import { NOW } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { memoryStorage } from "@/test/render";
import { UpdateSettings } from "./UpdateSettings";

afterEach(cleanup);
beforeEach(() => localStorage.clear());
setLocale("en");

const PAGE = "https://github.com/WillDant/gravita/releases/tag/v0.8.0-beta";
const UPDATE: NonNullable<EngineStatus["update"]> = {
  version: "0.8.0-beta",
  url: PAGE,
  asset: { name: "Gravita_0.8.0-beta_aarch64.dmg", size: 10, sha256: "a".repeat(64) },
};

const status = (extra: Partial<EngineStatus> = {}): EngineStatus => ({
  providers: {},
  claude: { found: false },
  indexing: { done: 0, total: 0 },
  demo: false,
  version: "0.7.0-beta",
  ...extra,
});

function renderSection(openRelease: (url: string) => Promise<void> = async () => {}) {
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
      <UpdateSettings />
    </AppProviders>,
  );
  return { store, gateway };
}

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await flush();
  });
};

describe("UpdateSettings", () => {
  it("shows the current version and nothing else until you look", () => {
    const { store } = renderSection();
    act(() => store.getState().setEngineStatus(status()));
    expect(screen.getByText("0.7.0-beta")).toBeTruthy();
    expect(screen.queryByText(/latest version/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("says you're on the latest version when the check finds nothing", async () => {
    const { store, gateway } = renderSection();
    act(() => store.getState().setEngineStatus(status()));
    await click("Check for updates");
    expect(gateway.callsOf("checkForUpdate")).toEqual([{}]);
    expect(screen.getByText("You're on the latest version.")).toBeTruthy();
  });

  it("says so when the check fails", async () => {
    const { store, gateway } = renderSection();
    act(() => store.getState().setEngineStatus(status()));
    gateway.failures.checkForUpdate = new GatewayError(LocalErrors.offline, "offline");
    await click("Check for updates");
    expect(screen.getByText(/Couldn't check right now/)).toBeTruthy();
  });

  it("offers Install for a found update and tells you to drag the app once opened", async () => {
    const { store, gateway } = renderSection();
    act(() => store.getState().setEngineStatus(status({ update: UPDATE })));
    expect(screen.getByText("Version 0.8.0-beta is available.")).toBeTruthy();
    await click("Install");
    expect(gateway.callsOf("installUpdate")).toEqual([{}]);
    expect(screen.getByText(/Drag Gravita to Applications/)).toBeTruthy();
  });

  it("falls back to the release page when the download fails", async () => {
    const openRelease = vi.fn(async () => {});
    const { store, gateway } = renderSection(openRelease);
    act(() => store.getState().setEngineStatus(status({ update: UPDATE })));
    gateway.failures.installUpdate = new GatewayError(RpcErrors.badRequest.code, "nope");
    await click("Install");
    expect(screen.getByText("Couldn't download the installer.")).toBeTruthy();
    await click("Open the release page");
    expect(openRelease).toHaveBeenCalledWith(PAGE);
  });

  it("opens the page when the release has no installer", async () => {
    const openRelease = vi.fn(async () => {});
    const { store } = renderSection(openRelease);
    const { asset: _, ...bare } = UPDATE;
    act(() => store.getState().setEngineStatus(status({ update: bare })));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    await click("Open the release page");
    expect(openRelease).toHaveBeenCalledWith(PAGE);
  });
});
