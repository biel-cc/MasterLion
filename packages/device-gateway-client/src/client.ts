import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';

import WebSocket from 'ws';

import {
  type AgentRunAckMessage,
  type AgentRunRequestMessage,
  type ClientMessage,
  type ConnectionStatus,
  CURRENT_DEVICE_GATEWAY_PROTOCOL_VERSION,
  type DeviceGatewayCapabilities,
  type GatewayClientEvents,
  type GatewayConnectResult,
  type MessageApiRequestMessage,
  type MessageApiResponseMessage,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type ServerMessage,
  type SystemInfoRequestMessage,
  type SystemInfoResponseMessage,
  type ToolCallRequestMessage,
  type ToolCallResponseMessage,
} from './types';

// ─── Constants ───

const DEFAULT_GATEWAY_URL = 'https://masterino.bielcrystal.com/device-gateway';
const HEARTBEAT_INTERVAL = 30_000; // 30s
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000; // 30s
const MAX_MISSED_HEARTBEATS = 3; // Force reconnect after 3 missed acks
const CONNECT_TIMEOUT = 15_000;

// ─── Logger Interface ───

export interface GatewayClientLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
}

const noopLogger: GatewayClientLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

export interface GatewayClientOptions {
  /** Auto-reconnect on disconnection (default: true) */
  autoReconnect?: boolean;
  /** Explicit wire capabilities. Pass an empty object to emulate a legacy device. */
  capabilities?: DeviceGatewayCapabilities;
  /**
   * Freeform routing label for this connection, e.g. `desktop` / `desktop-dev`
   * / `cli` / `cli-dev`. Used by the gateway for dispatch priority + UI; it does
   * NOT participate in stale-connection dedupe (that's `connectionId`).
   */
  channel?: string;
  /**
   * Stable per-install random UUID identifying this connection. The gateway uses
   * it as the stale-connection dedupe key, so multiple channels on the same
   * physical device (same `deviceId`) coexist. Defaults to a fresh UUID, which
   * means a fresh dedupe identity per process — callers that want a reconnect to
   * replace its own previous socket should pass a persisted value.
   */
  connectionId?: string;
  deviceId?: string;
  gatewayUrl?: string;
  logger?: GatewayClientLogger;
  /** Defaults to the current protocol. Set to 1 for rolling-upgrade compatibility tests. */
  protocolVersion?: number;
  serverUrl?: string;
  token: string;
  tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  userId?: string;
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private missedHeartbeats = 0;
  private status: ConnectionStatus = 'disconnected';
  private intentionalDisconnect = false;
  private deviceId: string;
  private connectionId: string;
  private channel?: string;
  private gatewayUrl: string;
  private token: string;
  private tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  private userId?: string;
  private serverUrl?: string;
  private logger: GatewayClientLogger;
  private autoReconnect: boolean;
  private connectPromise: Promise<GatewayConnectResult> | null = null;
  private connectResolver: ((result: GatewayConnectResult) => void) | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private authenticatedUserId?: string;
  private capabilities: DeviceGatewayCapabilities;
  private protocolVersion: number;

  constructor(options: GatewayClientOptions) {
    super();
    this.token = options.token;
    this.tokenType = options.tokenType;
    this.gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;
    this.deviceId = options.deviceId || randomUUID();
    this.connectionId = options.connectionId || randomUUID();
    this.channel = options.channel;
    this.serverUrl = options.serverUrl;
    this.userId = options.userId;
    this.logger = options.logger || noopLogger;
    this.autoReconnect = options.autoReconnect ?? true;
    this.capabilities = options.capabilities ?? { executionContextValidation: true };
    this.protocolVersion = options.protocolVersion ?? CURRENT_DEVICE_GATEWAY_PROTOCOL_VERSION;
  }

  // ─── Public API ───

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  get currentDeviceId(): string {
    return this.deviceId;
  }

  get currentConnectionId(): string {
    return this.connectionId;
  }

  override on<K extends keyof GatewayClientEvents>(
    event: K,
    listener: GatewayClientEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof GatewayClientEvents>(
    event: K,
    ...args: Parameters<GatewayClientEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Update the auth token used for (re)connections.
   * Call this after refreshing an expired JWT, then call `reconnect()`.
   */
  updateToken(token: string): void {
    this.token = token;
  }

  /**
   * Force a reconnect cycle: close the current WebSocket and establish a new connection.
   * Useful after calling `updateToken()` with a fresh JWT.
   */
  async reconnect(): Promise<GatewayConnectResult> {
    this.cleanup();
    this.setStatus('disconnected');
    this.intentionalDisconnect = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    return this.connect();
  }

  async connect(): Promise<GatewayConnectResult> {
    if (this.status === 'connected') {
      return { success: true, userId: this.authenticatedUserId };
    }
    if (this.connectPromise) return this.connectPromise;

    this.intentionalDisconnect = false;
    this.connectPromise = new Promise<GatewayConnectResult>((resolve) => {
      this.connectResolver = resolve;
      this.connectTimeout = setTimeout(() => {
        this.settleConnect({
          code: 'TIMEOUT',
          error: `Gateway connection timed out after ${CONNECT_TIMEOUT / 1000} seconds`,
          success: false,
        });
        this.closeWebSocket();
        if (!this.intentionalDisconnect && this.autoReconnect) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
          this.emit('disconnected');
        }
      }, CONNECT_TIMEOUT);
    });
    const pending = this.connectPromise;
    this.doConnect();
    return pending;
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.settleConnect({ code: 'UNKNOWN', error: 'Connection cancelled', success: false });
    this.setStatus('disconnected');
  }

  sendToolCallResponse(response: Omit<ToolCallResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'tool_call_response',
    });
  }

  sendMessageApiResponse(response: Omit<MessageApiResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'message_api_response',
    });
  }

  sendSystemInfoResponse(response: Omit<SystemInfoResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'system_info_response',
    });
  }

  sendRpcResponse(response: Omit<RpcResponseMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'rpc_response',
    });
  }

  sendAgentRunAck(response: Omit<AgentRunAckMessage, 'type'>): void {
    this.sendMessage({
      ...response,
      type: 'agent_run_ack',
    });
  }

  // ─── Connection Logic ───

  private doConnect() {
    this.clearReconnectTimer();

    this.setStatus('connecting');

    try {
      const wsUrl = this.buildWsUrl();
      this.logger.debug(`Connecting to: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);

      ws.on('open', this.handleOpen);
      ws.on('message', this.handleMessage);
      ws.on('close', this.handleClose);
      ws.on('error', this.handleError);

      this.ws = ws;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create WebSocket:', msg);
      this.settleConnect({ code: 'NETWORK', error: msg, success: false });
      this.setStatus('disconnected');
      if (this.autoReconnect) {
        this.scheduleReconnect();
      } else {
        this.emit('disconnected');
      }
    }
  }

  private buildWsUrl(): string {
    const wsProtocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.gatewayUrl.replace(/^https?:\/\//, '');
    const params = new URLSearchParams({
      connectionId: this.connectionId,
      deviceId: this.deviceId,
      hostname: os.hostname(),
      platform: process.platform,
    });

    if (this.channel) {
      params.set('channel', this.channel);
    }

    // Service token mode: pass userId in query
    if (this.userId) {
      params.set('userId', this.userId);
    }

    return `${wsProtocol}://${host}/ws?${params.toString()}`;
  }

  // ─── WebSocket Event Handlers ───

  private handleOpen = () => {
    this.logger.info('WebSocket connected, sending auth...');
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.setStatus('authenticating');

    // Send token as first message instead of in URL
    this.sendMessage({
      capabilities: this.capabilities,
      protocolVersion: this.protocolVersion,
      serverUrl: this.serverUrl,
      token: this.token,
      tokenType: this.tokenType,
      type: 'auth',
    });
  };

  private handleMessage = (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(String(data)) as ServerMessage;

      switch (message.type) {
        case 'auth_success': {
          this.logger.info('Authentication successful');
          this.authenticatedUserId = message.userId;
          this.setStatus('connected');
          this.startHeartbeat();
          this.settleConnect({ success: true, userId: message.userId });
          this.emit('connected', message.userId);
          break;
        }

        case 'auth_failed': {
          const reason = (message as any).reason || 'Unknown reason';
          this.logger.error(`Authentication failed: ${reason}`);
          this.settleConnect({ code: 'AUTH_FAILED', error: reason, success: false });
          this.emit('auth_failed', reason);
          this.disconnect();
          break;
        }

        case 'heartbeat_ack': {
          this.missedHeartbeats = 0;
          this.emit('heartbeat_ack');
          break;
        }

        case 'tool_call_request': {
          this.emit('tool_call_request', message as ToolCallRequestMessage);
          break;
        }

        case 'message_api_request': {
          this.emit('message_api_request', message as MessageApiRequestMessage);
          break;
        }

        case 'system_info_request': {
          this.emit('system_info_request', message as SystemInfoRequestMessage);
          break;
        }

        case 'rpc_request': {
          this.emit('rpc_request', message as RpcRequestMessage);
          break;
        }

        case 'agent_run_request': {
          this.emit('agent_run_request', message as AgentRunRequestMessage);
          break;
        }

        case 'auth_expired': {
          this.logger.warn('Received auth_expired from gateway');
          this.emit('auth_expired');
          break;
        }

        default: {
          this.logger.warn('Unknown message type:', (message as any).type);
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message:', error as string);
    }
  };

  private handleClose = (code: number, reason: Buffer) => {
    const closeReason = reason.toString();
    this.logger.info(`WebSocket closed: code=${code} reason=${closeReason}`);
    this.stopHeartbeat();
    this.ws = null;

    this.settleConnect({
      code: code === 1008 ? 'HANDSHAKE_REJECTED' : 'NETWORK',
      error: closeReason || `WebSocket closed with code ${code}`,
      success: false,
    });

    if (!this.intentionalDisconnect && this.autoReconnect) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
      this.emit('disconnected');
    }
  };

  private handleError = (error: Error) => {
    this.logger.error('WebSocket error:', error.message);
    this.settleConnect({
      code: /unexpected server response|status code|handshake/i.test(error.message)
        ? 'HANDSHAKE_REJECTED'
        : 'NETWORK',
      error: error.message,
      success: false,
    });
    this.emit('error', error);
  };

  // ─── Heartbeat ───

  private startHeartbeat() {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      this.missedHeartbeats++;
      if (this.missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        this.logger.warn(`Missed ${this.missedHeartbeats} heartbeat acks, forcing reconnect`);
        this.closeWebSocket();
        // Listeners are detached in closeWebSocket; handleClose won't run — drive reconnect here
        this.stopHeartbeat();
        if (this.autoReconnect) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
          this.emit('disconnected');
        }
        return;
      }
      this.sendMessage({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnection (exponential backoff) ───

  private scheduleReconnect() {
    this.clearReconnectTimer();

    const delay = this.reconnectDelay;
    this.logger.info(`Scheduling reconnect in ${delay}ms`);
    this.emit('reconnecting', delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.logger.info('Attempting reconnect');
      this.doConnect();
    }, delay);

    // Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Status ───

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;

    this.status = status;
    this.emit('status_changed', status);
  }

  // ─── Helpers ───

  private sendMessage(data: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private closeWebSocket() {
    if (!this.ws) {
      return;
    }
    const ws = this.ws;
    const suppressCloseError = (error: Error) => {
      this.logger.debug(`Ignoring WebSocket error during close: ${error.message}`);
    };
    const cleanupCloseErrorSuppression = () => {
      ws.off('close', cleanupCloseErrorSuppression);
      ws.off('error', suppressCloseError);
    };

    // Remove only listeners registered by this client.
    // Keep a temporary error handler while closing to avoid unhandled
    // "WebSocket was closed before the connection was established" errors.
    ws.off('open', this.handleOpen);
    ws.off('message', this.handleMessage);
    ws.off('close', this.handleClose);
    ws.off('error', this.handleError);
    ws.on('error', suppressCloseError);
    ws.once('close', cleanupCloseErrorSuppression);

    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client disconnect');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to close WebSocket gracefully: ${errorMsg}`);
    }

    this.ws = null;
  }

  private cleanup() {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.closeWebSocket();
  }

  private settleConnect(result: GatewayConnectResult) {
    if (!this.connectResolver) return;
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    const resolve = this.connectResolver;
    this.connectResolver = null;
    this.connectPromise = null;
    resolve(result);
  }
}
