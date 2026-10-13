import { useCallback, useState } from "react";
import { describeError } from "@/shared/presenters/errors";
import type { CommandResult } from "@/state/hooks";

export interface SquadAction<A extends unknown[]> {
  run: (...args: A) => Promise<boolean>;
  busy: boolean;
  /** The last failure, in the user's words. */
  error?: string;
  /** The engine's error code of the last failure. */
  code?: number;
  clear: () => void;
}

/** One squad command with its own busy flag and plain-language error. */
export function useSquadAction<A extends unknown[], T>(
  command: (...args: A) => Promise<CommandResult<T>>,
  onDone?: (value: T) => void,
): SquadAction<A> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code: number }>();
  const run = useCallback(
    async (...args: A) => {
      setBusy(true);
      setError(undefined);
      const r = await command(...args);
      setBusy(false);
      if (r.ok) {
        onDone?.(r.value);
        return true;
      }
      setError({ text: describeError(r.error).text, code: r.error.code });
      return false;
    },
    [command, onDone],
  );
  return {
    run,
    busy,
    ...(error ? { error: error.text, code: error.code } : {}),
    clear: () => setError(undefined),
  };
}
