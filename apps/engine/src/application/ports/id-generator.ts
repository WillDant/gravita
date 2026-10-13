/** Random ids (sessions, user messages), injectable for deterministic tests. */
export interface IdGenerator {
  uuid(): string;
}
