import type { EngineStatus } from "@gravita/protocol";
import type { StatusReporter } from "../ports/event-publisher";

export class GetEngineStatus {
  constructor(private readonly status: StatusReporter) {}

  execute(): EngineStatus {
    return this.status.status();
  }
}
