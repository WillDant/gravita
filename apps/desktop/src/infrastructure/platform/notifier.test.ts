import { describe, expect, it, vi } from "vitest";
import { browserNotifier, noopNotifier } from "./notifier";

describe("browser notifier", () => {
  it("maps the Web Notification API", async () => {
    const shown: { title: string; options?: NotificationOptions }[] = [];
    const N = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }) as unknown as typeof Notification;
    Object.assign(N, { permission: "default", requestPermission: vi.fn(async () => "granted") });

    const notifier = browserNotifier(N);
    expect(await notifier.permission()).toBe("default");
    expect(await notifier.requestPermission()).toBe("granted");
    await notifier.notify({ title: "Main agent finished", body: "app › Fix login" });
    expect(shown).toEqual([{ title: "Main agent finished", options: { body: "app › Fix login" } }]);
  });

  it("the no-op notifier never shows anything", async () => {
    expect(await noopNotifier.permission()).toBe("denied");
    await expect(noopNotifier.notify({ title: "x" })).resolves.toBeUndefined();
  });
});
