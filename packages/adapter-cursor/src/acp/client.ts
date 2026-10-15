import {
  JsonRpcConnection,
  type JsonRpcConnectionOptions,
  JsonRpcError,
  type JsonRpcId,
  RpcCodes,
  type RpcTransport,
} from "@gravita/adapter-codex";
import {
  type ClientMethod,
  type ClientNotifications,
  type ClientRequests,
  isKnownNotification,
  isKnownServerRequest,
  type ServerNotification,
  type ServerRequest,
} from "./methods";
import { ACP_PROTOCOL_VERSION, type Implementation, type InitializeResponse } from "./types";

// A typed client of `cursor-agent acp`: requests by method, the handshake, and the agent's
// notifications and requests narrowed to the ones Gravita reads. Process-free like the
// connection under it (adapter-codex's JSON-RPC over newline-delimited stdio).

export interface CursorAcpClientOptions {
  /** A notification Gravita reads (others are dropped here). */
  onNotification?: (n: ServerNotification) => void;
  /**
   * A request Gravita answers; others (file system, terminal, Cursor's extensions) are
   * refused at once ("method not found"), so the agent never waits on Gravita.
   */
  onRequest?: (r: ServerRequest, id: JsonRpcId) => Promise<unknown>;
  onProtocolError?: (message: string) => void;
  onClose?: () => void;
  maxLineChars?: number;
}

/** How long the handshake and the small requests may take before Cursor counts as stuck. */
export const HANDSHAKE_TIMEOUT_MS = 20_000;

export class CursorAcpClient {
  readonly connection: JsonRpcConnection;

  constructor(transport: RpcTransport, o: CursorAcpClientOptions = {}) {
    const options: JsonRpcConnectionOptions = {
      envelope: { jsonrpc: "2.0" },
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

  notify<M extends keyof ClientNotifications>(method: M, params: ClientNotifications[M]) {
    this.connection.notify(method, params);
  }

  /**
   * `initialize`, declaring neither file system nor terminal access: the agent reads,
   * writes and runs commands itself, asking Gravita only for approvals.
   */
  initialize(clientInfo: Implementation): Promise<InitializeResponse> {
    return this.call(
      "initialize",
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo,
      },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
  }

  close() {
    this.connection.close();
  }
}
