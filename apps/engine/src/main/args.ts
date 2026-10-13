import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";

export interface EngineArgs {
  port: number;
  demo: boolean;
  claudeHome: string;
  lookbackDays: number;
  dataDir: string;
  devOrigins: string[];
  tokenStdin: boolean;
}

const expandHome = (p: string) =>
  p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : resolve(p);

export function parseArgs(argv: string[]): EngineArgs {
  const { values } = parseNodeArgs({
    args: argv,
    strict: true,
    options: {
      port: { type: "string", default: "0" },
      demo: { type: "boolean", default: false },
      "claude-home": { type: "string", default: "~/.claude" },
      "lookback-days": { type: "string", default: "14" },
      "data-dir": { type: "string", default: "~/.gravita" },
      "dev-origin": { type: "string", multiple: true, default: [] },
      "token-stdin": { type: "boolean", default: false },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`Invalid --port: ${values.port}`);
  const lookbackDays = Number(values["lookback-days"]);
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error(`Invalid --lookback-days: ${values["lookback-days"]}`);
  }
  const devOrigins = values["dev-origin"].map((o) => {
    const url = new URL(o);
    if (url.origin === "null" || url.origin !== o.replace(/\/$/, ""))
      throw new Error(`Invalid --dev-origin: ${o}`);
    return url.origin;
  });
  return {
    port,
    demo: values.demo,
    claudeHome: expandHome(values["claude-home"]),
    lookbackDays,
    dataDir: expandHome(values["data-dir"]),
    devOrigins,
    tokenStdin: values["token-stdin"],
  };
}
