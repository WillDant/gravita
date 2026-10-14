import {
  JsonRpcConnection,
  type JsonRpcConnectionOptions,
  JsonRpcError,
  type JsonRpcId,
  RpcCodes,
  type RpcTransport,
} from "./json-rpc";
import {
  type ClientMethod,
  type ClientRequests,
  isKnownNotification,
  isKnownServerRequest,
  type ServerNotification,
  type ServerRequest,
} from "./methods";
import type { InitializeResponse } from "./protocol";

// A typed client of `codex app-server`: requests by method with their vendored types, the
// handshake, and the server's notifications and requests narrowed to the ones Gravita
// reads. Process-free like the connection under it.

export interface CodexClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface CodexAppServerClientOptions {
  /** A notification Gravita reads (others are dropped here). */
  onNotification?: (n: ServerNotification) => void;
  /**
   * A server request Gravita answers; others are refused at once ("method not found"),
   * so Codex never waits on a prompt nobody will see.
   */
  onRequest?: (r: ServerRequest, id: JsonRpcId) => Promise<unknown>;
  onProtocolError?: (message: string) => void;
  onClose?: () => void;
  maxLineChars?: number;
}

/** How long the handshake and the small reads may take before Codex counts as stuck. */
export const HANDSHAKE_TIMEOUT_MS = 20_000;

export class CodexAppServerClient {
  readonly connection: JsonRpcConnection;

  constructor(transport: RpcTransport, o: CodexAppServerClientOptions = {}) {
    const options: JsonRpcConnectionOptions = {
      onNotification: (method, params) => {
        if (isKnownNotification(method))
          o.onNotification?.({ method, params } as ServerNotification);
      },
      onRequest: (method, params, id) => {
        if (!o.onRequest || !isKnownServerRequest(method))
          return Promise.reject(
            new JsonRpcError(RpcCodes.methodNotFound, `${method} is not supported by Gravita`),
          );
        return o.onRequest({ method, params } as ServerRequest, id);
      },
      ...(o.onProtocolError ? { onProtocolError: o.onProtocolError } : {}),
      ...(o.onClose ? { onClose: o.onClose } : {}),
      ...(o.maxLineChars ? { maxLineChars: o.maxLineChars } : {}),
    };
    this.connection = new JsonRpcConnection(transport, options);
  }

  get isOpen(): boolean {
    return this.connection.isOpen;
  }

  get closed(): Promise<void> {
    return this.connection.closed;
  }

  call<M extends ClientMethod>(
    method: M,
    params: ClientRequests[M][0],
    opts: { timeoutMs?: number } = {},
  ): Promise<ClientRequests[M][1]> {
    return this.connection.request(method, params, opts) as Promise<ClientRequests[M][1]>;
  }

  /**
   * `initialize` then `initialized`. Gravita opts into the experimental API: it needs the
   * raw response items (the same records Codex writes to its rollout, so the live stream
   * and the file share their keys) and request_user_input (questions to the user).
   */
  async handshake(clientInfo: CodexClientInfo): Promise<InitializeResponse> {
    const res = await this.call(
      "initialize",
      { clientInfo, capabilities: { experimentalApi: true, requestAttestation: false } },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
    this.connection.notify("initialized");
    return res;
  }

  close() {
    this.connection.close();
  }
}
