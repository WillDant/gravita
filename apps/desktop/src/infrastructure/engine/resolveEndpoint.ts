import { isTauri } from "@/infrastructure/platform/tauri";

export interface EngineEndpoint {
  url: string;
  token: string;
}

/** Tauri hands us the sidecar's port and token; the browser dev mode uses env or the URL. */
export async function resolveEndpoint(): Promise<EngineEndpoint> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ port: number; token: string }>("engine_info");
    return { url: `ws://127.0.0.1:${info.port}/ws`, token: info.token };
  }
  const q = new URLSearchParams(location.search);
  const port = q.get("port") ?? import.meta.env.VITE_ENGINE_PORT ?? "4319";
  const token = q.get("token") ?? import.meta.env.VITE_ENGINE_TOKEN ?? "dev-token";
  return { url: `ws://127.0.0.1:${port}/ws`, token };
}
