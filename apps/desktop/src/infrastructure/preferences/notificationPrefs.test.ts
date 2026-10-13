import { describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/render";
import { createNotificationPrefs, DEFAULT_NOTIFICATION_PREFS } from "./notificationPrefs";

describe("notification preferences", () => {
  it("default to everything on", () => {
    expect(createNotificationPrefs(memoryStorage).get()).toEqual({
      waiting: true,
      finished: true,
      failures: true,
    });
  });

  it("persist across app starts and notify subscribers", () => {
    const storage = memoryStorage();
    const prefs = createNotificationPrefs(() => storage);
    const listener = vi.fn();
    prefs.subscribe(listener);
    prefs.set({ finished: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createNotificationPrefs(() => storage).get()).toEqual({
      waiting: true,
      finished: false,
      failures: true,
    });
  });

  it("keep working in memory when storage throws", () => {
    const throwing = () => {
      throw new Error("SecurityError");
    };
    const prefs = createNotificationPrefs(throwing);
    expect(prefs.get()).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(() => prefs.set({ waiting: false })).not.toThrow();
    expect(prefs.get().waiting).toBe(false);

    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const quota = createNotificationPrefs(() => storage);
    quota.set({ failures: false });
    expect(quota.get().failures).toBe(false);
  });

  it("ignore garbage in storage, field by field", () => {
    const storage = memoryStorage();
    storage.setItem("gravita.notifications", '{"waiting":"yes","finished":false}');
    expect(createNotificationPrefs(() => storage).get()).toEqual({
      waiting: true,
      finished: false,
      failures: true,
    });
    storage.setItem("gravita.notifications", "{not json");
    expect(createNotificationPrefs(() => storage).get()).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});
