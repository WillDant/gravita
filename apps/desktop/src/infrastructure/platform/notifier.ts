import { isTauri } from "./tauri";

export type NotifyPermission = "granted" | "denied" | "default";

export interface OsNotification {
  title: string;
  body?: string;
}

/**
 * The port to the OS notification center. Desktop notification clicks don't reach the
 * webview reliably, so a notification carries no action: the deep link is followed when
 * the window regains focus (see application/notifications/deepLink.ts).
 */
export interface Notifier {
  /** What the OS currently allows; never prompts. */
  permission(): Promise<NotifyPermission>;
  /** Prompts the user (where the OS asks at all) and resolves to the answer. */
  requestPermission(): Promise<NotifyPermission>;
  notify(notification: OsNotification): Promise<void>;
}

const asPermission = (p: string): NotifyPermission =>
  p === "granted" || p === "denied" ? p : "default";

/** Inside Tauri: tauri-plugin-notification, loaded on first use (the browser bundle never carries it). */
export function tauriNotifier(): Notifier {
  const plugin = () => import("@tauri-apps/plugin-notification");
  return {
    async permission() {
      const { isPermissionGranted } = await plugin();
      if (await isPermissionGranted()) return "granted";
      return asPermission(window.Notification?.permission ?? "default");
    },
    async requestPermission() {
      const { requestPermission } = await plugin();
      return asPermission(await requestPermission());
    },
    async notify({ title, body }) {
      const { sendNotification } = await plugin();
      sendNotification(body ? { title, body } : { title });
    },
  };
}

/** The browser dev and demo mode: the Web Notification API. */
export function browserNotifier(N: typeof Notification): Notifier {
  return {
    permission: async () => asPermission(N.permission),
    requestPermission: async () => asPermission(await N.requestPermission()),
    async notify({ title, body }) {
      new N(title, body ? { body } : {});
    },
  };
}

/** Tests, and browsers without notifications: nothing is ever shown. */
export const noopNotifier: Notifier = {
  permission: async () => "denied",
  requestPermission: async () => "denied",
  notify: async () => {},
};

export function createNotifier(): Notifier {
  if (isTauri()) return tauriNotifier();
  if (typeof window !== "undefined" && "Notification" in window) {
    return browserNotifier(window.Notification);
  }
  return noopNotifier;
}
