import type {
  DeviceSystemInfo,
  GatewayDevice,
  GatewayMcpStdioParams,
  GatewayToolCallExecutionContext,
  GatewayToolCallType,
} from './types';

const DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS = 30_000;
const HTTP_CALL_TIMEOUT_PADDING_MS = 30_000;

export interface DeviceStatusResult {
  deviceCount: number;
  online: boolean;
}

export interface DeviceToolCallResult {
  content: string;
  error?: string;
  executionContextValidation?: 'hard' | 'legacy';
  state?: unknown;
  success: boolean;
  warning?: {
    code: 'DEVICE_UPGRADE_RECOMMENDED';
    message: string;
  };
}

/** Missing/unknown rolling-upgrade metadata must never be treated as hard validation. */
export const parseExecutionContextValidation = (value: unknown): 'hard' | 'legacy' =>
  value === 'hard' ? 'hard' : 'legacy';

const getExecutionContextValidationResult = (
  requested: boolean,
  toolCallType: GatewayToolCallType | undefined,
  responseValue: unknown,
): Pick<DeviceToolCallResult, 'executionContextValidation' | 'warning'> => {
  if (!requested) return {};

  // Protocol v2 does not define hard execution-context validation for the
  // device MCP path. Keep this client-side check even when a buggy or newer
  // gateway sends "hard", so an unknown combination always fails legacy.
  const executionContextValidation =
    toolCallType === 'mcp' ? 'legacy' : parseExecutionContextValidation(responseValue);
  return {
    executionContextValidation,
    warning:
      executionContextValidation === 'legacy'
        ? {
            code: 'DEVICE_UPGRADE_RECOMMENDED',
            message:
              'The gateway path did not confirm hard execution-context validation. Upgrade the Masterino server and Desktop or CLI before relying on workspace enforcement.',
          }
        : undefined,
  };
};

export interface DeviceMessageApiResult {
  content: string;
  error?: string;
  success: boolean;
}

export interface DeviceRpcResult<T = unknown> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface GatewayHttpClientOptions {
  gatewayUrl: string;
  serviceToken: string;
}

export class GatewayHttpClient {
  private gatewayUrl: string;
  private serviceToken: string;

  constructor(options: GatewayHttpClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.serviceToken = options.serviceToken;
  }

  async queryDeviceStatus(userId: string): Promise<DeviceStatusResult> {
    const res = await this.post('/api/device/status', { userId });
    if (!res.ok) return { deviceCount: 0, online: false };

    const data = await res.json();
    return {
      deviceCount: data.deviceCount ?? 0,
      online: data.online ?? false,
    };
  }

  async queryDeviceList(userId: string): Promise<GatewayDevice[]> {
    const res = await this.post('/api/device/devices', { userId });
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  }

  async executeToolCall(
    params: {
      deviceId?: string;
      executionContext?: GatewayToolCallExecutionContext;
      operationId?: string;
      timeout?: number;
      toolCallId?: string;
      topicId?: string;
      userId: string;
    },
    toolCall: { apiName: string; arguments: string; identifier: string },
  ): Promise<DeviceToolCallResult> {
    return this.postToolCall(params, { ...toolCall, type: 'tool' });
  }

  /**
   * Tunnel a stdio MCP tool call to the device. Rides the same
   * `/api/device/tool-call` relay as {@link executeToolCall} — the gateway
   * forwards `toolCall` opaquely — but carries `params` (the stdio connection
   * params) so the device routes it to its local MCP client (spawning the
   * stdio server) rather than the builtin local-system tool switch. The cloud
   * server can't spawn the user's binary, so execution must happen on the
   * device.
   */
  async executeMcpCall(mcpCall: {
    apiName: string;
    arguments: string;
    deviceId?: string;
    executionContext?: GatewayToolCallExecutionContext;
    identifier: string;
    operationId?: string;
    params: GatewayMcpStdioParams;
    timeout?: number;
    toolCallId?: string;
    topicId?: string;
    userId: string;
  }): Promise<DeviceToolCallResult> {
    const {
      deviceId,
      executionContext,
      operationId,
      timeout,
      toolCallId,
      topicId,
      userId,
      ...toolCall
    } = mcpCall;
    return this.postToolCall(
      { deviceId, executionContext, operationId, timeout, toolCallId, topicId, userId },
      { ...toolCall, type: 'mcp' },
    );
  }

  private async postToolCall(
    params: {
      deviceId?: string;
      executionContext?: GatewayToolCallExecutionContext;
      operationId?: string;
      timeout?: number;
      toolCallId?: string;
      topicId?: string;
      userId: string;
    },
    toolCall: {
      apiName: string;
      arguments: string;
      identifier: string;
      params?: GatewayMcpStdioParams;
      type?: GatewayToolCallType;
    },
  ): Promise<DeviceToolCallResult> {
    const timeout =
      typeof params.timeout === 'number' && Number.isFinite(params.timeout)
        ? Math.max(Math.trunc(params.timeout), 0)
        : DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS;
    const res = await this.post(
      '/api/device/tool-call',
      {
        deviceId: params.deviceId,
        executionContext: params.executionContext,
        operationId: params.operationId,
        timeout: params.timeout,
        toolCall,
        toolCallId: params.toolCallId,
        topicId: params.topicId,
        userId: params.userId,
      },
      { timeout: timeout + HTTP_CALL_TIMEOUT_PADDING_MS },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        content: `Device tool call failed (HTTP ${res.status})`,
        error: text || `HTTP ${res.status}`,
        ...getExecutionContextValidationResult(
          Boolean(params.executionContext),
          toolCall.type,
          undefined,
        ),
        success: false,
      };
    }

    const data = await res.json();
    return {
      // Device sends a typed envelope ({ content, state, success }). The legacy
      // fallback used to JSON.stringify `data.content ?? data` — when content
      // was missing it would stringify the *entire response body* including
      // `success` and any other top-level fields, which leaked the structured
      // payload into the LLM-facing content string. Only stringify the
      // `content` field itself; never fall back to the whole body.
      content:
        typeof data.content === 'string'
          ? data.content
          : data.content !== undefined && data.content !== null
            ? JSON.stringify(data.content)
            : typeof data.error === 'string'
              ? data.error
              : '',
      error: data.error,
      ...getExecutionContextValidationResult(
        Boolean(params.executionContext),
        toolCall.type,
        data.executionContextValidation,
      ),
      state: data.state,
      success: data.success ?? true,
    };
  }

  async executeMessageApi(
    params: { deviceId?: string; timeout?: number; userId: string },
    api: { apiName: string; payload: Record<string, unknown>; platform: string },
  ): Promise<DeviceMessageApiResult> {
    const res = await this.post('/api/device/message-api', {
      api,
      deviceId: params.deviceId,
      timeout: params.timeout,
      userId: params.userId,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        content: `Device message API call failed (HTTP ${res.status})`,
        error: text || `HTTP ${res.status}`,
        success: false,
      };
    }

    const data = await res.json();
    return {
      content:
        typeof data.content === 'string' ? data.content : JSON.stringify(data.content ?? data),
      error: data.error,
      success: data.success ?? true,
    };
  }

  async dispatchAgentRun(params: {
    agentType: string;
    cwd?: string;
    deviceId?: string;
    env?: Record<string, string>;
    executionContext?: GatewayToolCallExecutionContext;
    /** Image attachments forwarded into the `agent_run_request` message. */
    imageList?: Array<{ id?: string; url: string }>;
    modelRef?: {
      capturedAt: string;
      kind: string;
      modelId: string;
      operationId: string;
      providerId: string;
    };
    skills?: Array<{
      content?: string;
      description: string;
      identifier: string;
      key: string;
      name: string;
      source: string;
    }>;
    skillPolicy?: 'off' | 'project' | 'user';
    jwt: string;
    operationId: string;
    prompt: string;
    resumeSessionId?: string;
    systemContext?: string;
    timeout?: number;
    topicId: string;
    userId: string;
  }): Promise<{ success: boolean; error?: string }> {
    const res = await this.post('/api/device/agent/run', params);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: text || `HTTP ${res.status}`, success: false };
    }
    return { success: true };
  }

  /**
   * Invoke a named device-side method over the generic RPC relay. Server-only —
   * the gateway forwards `{ method, params }` opaquely to the device's RPC
   * dispatcher and correlates the response by `requestId`, so new methods need
   * no per-method gateway route. Distinct from {@link executeToolCall}, which is
   * the LLM-facing tool channel.
   */
  async invokeRpc<T = unknown>(
    params: { deviceId?: string; timeout?: number; userId: string },
    rpc: { method: string; params?: unknown },
  ): Promise<DeviceRpcResult<T>> {
    const timeout =
      typeof params.timeout === 'number' && Number.isFinite(params.timeout)
        ? Math.max(Math.trunc(params.timeout), 0)
        : DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS;
    const res = await this.post(
      '/api/device/rpc',
      {
        deviceId: params.deviceId,
        method: rpc.method,
        params: rpc.params,
        timeout: params.timeout,
        userId: params.userId,
      },
      { timeout: timeout + HTTP_CALL_TIMEOUT_PADDING_MS },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: text || `HTTP ${res.status}`, success: false };
    }

    const data = await res.json();
    return { data: data.data, error: data.error, success: data.success ?? false };
  }

  async getDeviceSystemInfo(
    userId: string,
    deviceId: string,
  ): Promise<{ success: boolean; systemInfo?: DeviceSystemInfo }> {
    const res = await this.post('/api/device/system-info', { deviceId, userId });
    if (!res.ok) {
      return { success: false };
    }

    const data = await res.json();
    return {
      success: data.success ?? false,
      systemInfo: data.systemInfo,
    };
  }

  private post(path: string, body: unknown, options?: { timeout?: number }): Promise<Response> {
    return fetch(`${this.gatewayUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      ...(options?.timeout ? { signal: AbortSignal.timeout(options.timeout) } : {}),
    });
  }
}
