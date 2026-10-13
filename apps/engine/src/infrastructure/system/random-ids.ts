import { randomUUID } from "node:crypto";
import type { IdGenerator } from "../../application/ports/id-generator";

export class RandomIds implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}
