import type { SessionContextResult } from "@gravita/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@/app/providers";
import { toGatewayError } from "@/infrastructure/engine/GatewayError";
import { describeError } from "@/shared/presenters/errors";

export interface SessionContextView {
  result?: SessionContextResult;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

/**
 * The session's context breakdown, read through the engine while `enabled`, and again each
 * time `turn` changes (a turn ended: the window moved). A reply after closing is dropped.
 */
export function useSessionContext(
  sessionId: string,
  o: { enabled: boolean; turn: string | undefined },
): SessionContextView {
  const gateway = useGateway();
  const [result, setResult] = useState<SessionContextResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++request.current;
    setLoading(true);
    gateway.sessionContext({ sessionId }).then(
      (next) => {
        if (mine !== request.current) return;
        setResult(next);
        setError(undefined);
        setLoading(false);
      },
      (err: unknown) => {
        if (mine !== request.current) return;
        setError(describeError(toGatewayError(err)).text);
        setLoading(false);
      },
    );
  }, [gateway, sessionId]);

  const { enabled, turn } = o;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turn` only says when to read again
  useEffect(() => {
    if (!enabled) return;
    refresh();
    return () => {
      request.current++;
    };
  }, [enabled, turn, refresh]);

  return { result, loading, error, refresh };
}
