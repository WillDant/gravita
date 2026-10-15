import type { GravitaState } from "@gravita/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders } from "@/app/providers";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { createProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import { setLocale } from "@/shared/i18n/i18n";
import { createAppStore } from "@/state/store";
import { ago, ev, NOW, started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { memoryStorage } from "@/test/render";
import { PermissionActions } from "./PermissionActions";

afterEach(cleanup);
setLocale("en");

const at = { ts: ago(1), projectId: "p1", sessionId: "s" };

function waitingState(controllable: boolean): GravitaState {
  return stateOf(started("s", 5), [
    ev("session.control", { controllable }, at),
    ev(
      "agent.spawned",
      { parentAgentId: "main", agentType: "Explore", depth: 1, background: false },
      { ...at, agentId: "a" },
    ),
    ev(
      "permission.requested",
      { requestId: "r1", toolName: "Bash", inputPreview: "pnpm add jose" },
      { ...at, agentId: "a" },
    ),
  ]);
}

function renderActions(state: GravitaState) {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  const session = state.sessions.s!;
  render(
    <AppProviders
      services={{
        store,
        gateway,
        navigate: () => {},
        toggleTheme: () => {},
        notificationPrefs: createNotificationPrefs(memoryStorage),
        projectAppearance: createProjectAppearance(memoryStorage),
      }}
    >
      <PermissionActions session={session} agent={session.agents.a!} />
    </AppProviders>,
  );
  return gateway;
}

describe("PermissionActions", () => {
  it("offers Allow and Deny on a session Gravita controls, answering through the engine", async () => {
    const gateway = renderActions(waitingState(true));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      await flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
      await flush();
    });

    expect(gateway.responded).toEqual([
      { sessionId: "s", agentId: "a", requestId: "r1", decision: "allow" },
      { sessionId: "s", agentId: "a", requestId: "r1", decision: "deny" },
    ]);
    expect(screen.queryByText(/terminal/i)).toBeNull();
  });

  it("points to the terminal when Gravita doesn't control the session", () => {
    const gateway = renderActions(waitingState(false));

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/terminal/i)).toBeTruthy();
    expect(gateway.responded).toEqual([]);
  });

  it("shows the failure when the engine refuses", async () => {
    const gateway = renderActions(waitingState(true));
    gateway.respondPermission = async () => {
      throw new Error("This session is not controlled by Gravita");
    };

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      await flush();
    });

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
