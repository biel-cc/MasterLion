export type GatewayConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting'
  | 'authenticating';

export type GatewayConnectionErrorCode =
  | 'AUTH_FAILED'
  | 'AUTH_REQUIRED'
  | 'CONFIG_MISSING'
  | 'HANDSHAKE_REJECTED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface GatewayConnectionError {
  code: GatewayConnectionErrorCode;
  message: string;
  retriable: boolean;
}

export interface GatewayConnectionState {
  enabled: boolean;
  error?: GatewayConnectionError;
  retryAt?: number;
  status: GatewayConnectionStatus;
}

export interface GatewayConnectionBroadcastEvents {
  gatewayConnectionStatusChanged: (state: GatewayConnectionState) => void;
}
