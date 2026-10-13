import { useMemo, useState } from "react";
import { AppProviders, useToggleTheme } from "@/app/providers";
import SquadScreen from "@/features/squad/SquadScreen";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import type { Route } from "@/state/slices/route";
import { createAppStore } from "@/state/store";
import { NOW } from "@/test/events";
import { FakeGateway } from "@/test/FakeGateway";
import { PROJECT, SQ, type SquadFixture, squadFixture } from "@/test/squadFixtures";

// Dev builds only (#/gallery/squad/<fixture>): a squad in each phase, on a fake engine,
// so every screen can be looked at without waiting for a run to get there.

const FIXTURES: SquadFixture[] = [
  "brief",
  "planning",
  "review",
  "run",
  "budget",
  "deliver",
  "dense",
];

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
}

export function SquadGallery({ fixture }: { fixture: string }) {
  const kind = (FIXTURES as string[]).includes(fixture) ? (fixture as SquadFixture) : "run";
  const toggleTheme = useToggleTheme();
  const [taskId, setTaskId] = useState<string>();
  const services = useMemo(() => {
    const data = squadFixture(kind);
    const gateway = new FakeGateway();
    gateway.conversationResult = { messages: data.conversation };
    const store = createAppStore(gateway, { now: NOW });
    store.getState().loadSnapshot({ seq: 1, state: data.state });
    const navigate = (r: Route) => setTaskId(r.level === "squad" ? r.taskId : undefined);
    const storage = memory();
    return {
      store,
      gateway,
      navigate,
      toggleTheme,
      notificationPrefs: createNotificationPrefs(() => storage),
    };
  }, [kind, toggleTheme]);

  return (
    <AppProviders services={services}>
      <div className="flex h-full flex-col">
        <nav
          aria-label="Squad fixtures"
          className="flex flex-none gap-1 border-b border-hairline bg-panel px-6 py-1.5 text-xs"
        >
          {FIXTURES.map((f) => (
            <a
              key={f}
              href={`#/gallery/squad/${f}`}
              aria-current={f === kind ? "page" : undefined}
              className={
                f === kind
                  ? "rounded-md bg-ground px-2 py-1 font-semibold shadow-panel"
                  : "rounded-md px-2 py-1 text-ink-2"
              }
            >
              {f}
            </a>
          ))}
        </nav>
        <div className="min-h-0 flex-1">
          <SquadScreen
            key={kind}
            projectId={PROJECT}
            squadId={SQ}
            {...(taskId ? { taskId } : {})}
          />
        </div>
      </div>
    </AppProviders>
  );
}
