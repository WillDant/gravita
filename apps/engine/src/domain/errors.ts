/** The session runs outside Gravita (e.g. a terminal), or its request can't be answered here. */
export class NotControllableError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} is not controlled by Gravita`);
    this.name = "NotControllableError";
  }
}
