import type { GitInfo } from "@gravita/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@/app/providers";
import type { GatewayError } from "@/infrastructure/engine/GatewayError";
import { describeError } from "@/shared/presenters/errors";

export interface GitInfoView {
  info?: GitInfo;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

/**
 * A folder's repository, read through the engine while `enabled`, again every `pollMs` while
 * the window is visible. `summary` asks for the branch and files only (no diff, no PR).
 */
export function useGitInfo(
  cwd: string | undefined,
  o: { enabled: boolean; summary?: boolean; pollMs: number },
): GitInfoView {
  const gateway = useGateway();
  const [info, setInfo] = useState<GitInfo>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const { enabled, summary, pollMs } = o;

  const refresh = useCallback(() => {
    if (!cwd) return;
    const mine = ++request.current;
    setLoading(true);
    gateway.gitInfo({ cwd, ...(summary ? { summary } : {}) }).then(
      (next) => {
        if (mine !== request.current) return;
        setInfo(next);
        setError(undefined);
        setLoading(false);
      },
      (err: GatewayError) => {
        if (mine !== request.current) return;
        setError(describeError(err).text);
        setLoading(false);
      },
    );
  }, [gateway, cwd, summary]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);
    return () => {
      clearInterval(timer);
      // A reply after closing (or a folder change) is dropped.
      request.current++;
    };
  }, [enabled, pollMs, refresh]);

  return { info, loading, error, refresh };
}
