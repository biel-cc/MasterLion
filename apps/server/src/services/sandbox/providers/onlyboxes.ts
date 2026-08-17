import { createHmac } from 'node:crypto';

import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import { metrics } from '@lobechat/observability-otel/api';
import { isRecord } from '@lobechat/utils';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { appEnv } from '@/envs/app';
import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxProviderFileInfoResult,
  SandboxProviderFileReadResult,
  SandboxServiceOptions,
} from '../types';

const log = debug('lobe-server:sandbox:onlyboxes');
const meter = metrics.getMeter('server-services-sandbox-onlyboxes');
const sandboxRequestCounter = meter.createCounter('sandbox_onlyboxes_tool_requests_total', {
  description: 'Count of Onlyboxes sandbox tool requests by tool, outcome, and error code.',
  unit: '{request}',
});
const sandboxRequestDuration = meter.createHistogram('sandbox_onlyboxes_tool_duration_ms', {
  description: 'Duration of Onlyboxes sandbox tool requests.',
  unit: 'ms',
});
const sandboxRetryCounter = meter.createCounter('sandbox_onlyboxes_worker_retries_total', {
  description: 'Count of retries caused by unavailable Onlyboxes worker capacity.',
  unit: '{retry}',
});
const sandboxCapacityErrorCounter = meter.createCounter(
  'sandbox_onlyboxes_capacity_exhausted_total',
  {
    description: 'Count of Onlyboxes requests that exhausted worker-capacity retries.',
    unit: '{error}',
  },
);
const sandboxFailureCounter = meter.createCounter('sandbox_onlyboxes_failures_total', {
  description: 'Count of Onlyboxes sandbox failures by failure kind and operation.',
  unit: '{error}',
});
const sandboxExportCounter = meter.createCounter('sandbox_onlyboxes_exports_total', {
  description: 'Count of Onlyboxes file exports by outcome and failure kind.',
  unit: '{export}',
});
const sandboxExportDuration = meter.createHistogram('sandbox_onlyboxes_export_duration_ms', {
  description: 'Duration of Onlyboxes file exports.',
  unit: 'ms',
});

const DEFAULT_TIMEOUT_MS = 120_000;
const OFFICE_TIMEOUT_MS = 180_000;
const EXPORT_TASK_WAIT_MS = 60_000;
const DEFAULT_LEASE_TTL_SEC = 900;
const DEFAULT_JIT_TTL_SEC = 1800;
const JIT_TOKEN_PREFIX = 'obx_jit_v1.';
const WRITE_FILE_CHUNK_BYTES = 48 * 1024;
const SKILL_ARCHIVE_CACHE_DIR = '/tmp/lobe-skills';
const WORKER_RETRY_DELAYS_MS = [2000, 5000, 10_000] as const;
const CAPACITY_ERROR_CODE = 'sandbox_capacity_exhausted';
const CAPACITY_ERROR_MESSAGE = '沙箱当前繁忙，暂时没有可用执行容量，请稍后再试。';

class OnlyboxesRequestError extends Error {
  code?: string;
  retryable: boolean;
  status?: number;

  constructor({
    code,
    message,
    retryable,
    status,
  }: {
    code?: string;
    message: string;
    retryable: boolean;
    status?: number;
  }) {
    super(message);
    this.name = 'OnlyboxesRequestError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const isRetryableWorkerError = (code: string | undefined, message: string) => {
  const value = `${code || ''} ${message}`.toLowerCase();

  return (
    value.includes('no online worker capacity') ||
    value.includes('no online worker supports') ||
    value.includes('no compatible worker') ||
    value.includes('no_worker') ||
    value.includes('worker_offline') ||
    value.includes('session_capacity_exceeded') ||
    value.includes('capacity_exhausted')
  );
};

const classifyFailure = (code: string | undefined, message: string) => {
  const value = `${code || ''} ${message}`.toLowerCase();

  if (code === CAPACITY_ERROR_CODE || isRetryableWorkerError(code, message)) return 'capacity';
  if (value.includes('out of memory') || value.includes('oom') || value.includes('memory limit')) {
    return 'oom';
  }
  if (value.includes('timeout') || value.includes('timed out') || value.includes('deadline')) {
    return 'timeout';
  }

  return 'other';
};

interface OnlyboxesTaskResponse {
  error?: { code?: string; message?: string };
  result?: Record<string, unknown>;
  status?: string;
  task_id?: string;
}

interface TerminalExecResult {
  created?: boolean;
  exit_code?: number;
  lease_expires_unix_ms?: number;
  session_id?: string;
  stderr?: string;
  stderr_truncated?: boolean;
  stdout?: string;
  stdout_truncated?: boolean;
}

export class OnlyboxesSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: true,
    shell: true,
    skillScripts: true,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'onlyboxes';

  private readonly baseUrl: string;
  private readonly jitIssuer: string;
  private readonly jitSigningKey: string;
  private readonly jitTTLSec: number;
  private readonly leaseTTLSec: number;
  private readonly options: SandboxServiceOptions;

  constructor(options: SandboxServiceOptions) {
    this.options = options;
    this.baseUrl = (sandboxEnv.ONLYBOXES_BASE_URL || '').replace(/\/+$/, '');
    this.jitIssuer = sandboxEnv.ONLYBOXES_JIT_ISSUER || appEnv.APP_URL || 'lobehub';
    this.jitSigningKey = sandboxEnv.ONLYBOXES_JIT_SIGNING_KEY || '';
    this.jitTTLSec = sandboxEnv.ONLYBOXES_JIT_TTL_SEC || DEFAULT_JIT_TTL_SEC;
    this.leaseTTLSec = sandboxEnv.ONLYBOXES_LEASE_TTL_SEC || DEFAULT_LEASE_TTL_SEC;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const startedAt = performance.now();
    const result = await this.callToolWithErrorHandling(toolName, params);
    const errorCode = result.error?.code || result.error?.name || 'none';
    const attributes = {
      'sandbox.error_code': errorCode,
      'sandbox.outcome': result.success ? 'success' : 'error',
      'sandbox.tool': toolName,
    };

    sandboxRequestCounter.add(1, attributes);
    sandboxRequestDuration.record(performance.now() - startedAt, attributes);
    if (errorCode === CAPACITY_ERROR_CODE) {
      sandboxCapacityErrorCounter.add(1, { 'sandbox.tool': toolName });
    }
    if (!result.success) {
      sandboxFailureCounter.add(1, {
        'sandbox.failure_kind': classifyFailure(result.error?.code, result.error?.message || ''),
        'sandbox.operation': toolName,
      });
    }

    return result;
  }

  private async callToolWithErrorHandling(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    if (!this.baseUrl || !this.jitSigningKey) {
      return this.errorResult('ONLYBOXES_BASE_URL and ONLYBOXES_JIT_SIGNING_KEY are required');
    }

    try {
      switch (toolName) {
        case 'createOfficeDocument':
        case 'batchOfficeDocument':
        case 'mergeOfficeTemplate':
        case 'inspectOfficeDocument':
        case 'validateOfficeDocument': {
          if (!sandboxEnv.OFFICECLI_ENABLED) {
            return this.errorResult('OfficeCLI document tools are disabled');
          }

          return await this.runJsonScript(
            officeCliScript,
            { ...params, action: toolName },
            Math.min(Math.max(this.timeout(params), OFFICE_TIMEOUT_MS), 300_000),
          );
        }

        case 'runCommand': {
          return this.runCommand(params);
        }

        case 'getCommandOutput': {
          return this.getCommandOutput(params);
        }

        case 'killCommand': {
          return this.killCommand(params);
        }

        case 'executeCode': {
          return this.executeCode(params);
        }

        case 'execScript': {
          return this.execScript(params);
        }

        case 'listLocalFiles': {
          return this.runJsonScript(listFilesScript, params);
        }

        case 'listFiles': {
          return this.runJsonScript(listFilesScript, params);
        }

        case 'readLocalFile': {
          return this.runJsonScript(readFileScript, params);
        }

        case 'readFile': {
          return this.runJsonScript(readFileScript, params);
        }

        case 'writeLocalFile': {
          return this.writeLocalFile(params);
        }

        case 'writeFile': {
          return this.writeLocalFile(params);
        }

        case 'editLocalFile': {
          return this.runJsonScript(editFileScript, params);
        }

        case 'editFile': {
          return this.runJsonScript(editFileScript, params);
        }

        case 'searchLocalFiles': {
          return this.runJsonScript(searchFilesScript, params);
        }

        case 'searchFiles': {
          return this.runJsonScript(searchFilesScript, params);
        }

        case 'moveLocalFiles': {
          return this.runJsonScript(moveFilesScript, params);
        }

        case 'moveFiles': {
          return this.runJsonScript(moveFilesScript, params);
        }

        case 'grepContent': {
          return this.runJsonScript(grepContentScript, params);
        }

        case 'globLocalFiles': {
          return this.runJsonScript(globFilesScript, params);
        }

        case 'globFiles': {
          return this.runJsonScript(globFilesScript, params);
        }

        default: {
          return this.errorResult(`Unsupported Onlyboxes sandbox tool: ${toolName}`);
        }
      }
    } catch (error) {
      log('Onlyboxes tool %s failed: %O', toolName, error);
      if (error instanceof OnlyboxesRequestError) {
        if (error.retryable) return this.capacityErrorResult();

        return this.errorResult(error.message, error.name, error.code, error.retryable);
      }

      return this.errorResult((error as Error).message, (error as Error).name);
    }
  }

  async exportFileToUploadUrl({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    const startedAt = performance.now();
    const result = await this.exportFileToUploadUrlWithErrorHandling({
      path,
      uploadHeaders,
      uploadUrl,
    });
    const failureKind = result.success
      ? 'none'
      : classifyFailure(result.error?.code, result.error?.message || '');
    const attributes = {
      'sandbox.failure_kind': failureKind,
      'sandbox.outcome': result.success ? 'success' : 'error',
    };

    sandboxExportCounter.add(1, attributes);
    sandboxExportDuration.record(performance.now() - startedAt, attributes);
    if (!result.success) {
      sandboxFailureCounter.add(1, {
        'sandbox.failure_kind': failureKind,
        'sandbox.operation': 'exportFile',
      });
    }

    return result;
  }

  private async exportFileToUploadUrlWithErrorHandling({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    if (!this.baseUrl || !this.jitSigningKey) {
      return {
        error: { message: 'ONLYBOXES_BASE_URL and ONLYBOXES_JIT_SIGNING_KEY are required' },
        success: false,
      };
    }

    try {
      await this.ensureSession();

      const task = await this.submitTask('terminalResource', {
        action: 'export',
        file_path: path,
        headers: uploadHeaders,
        session_id: this.sessionId,
        signed_url: uploadUrl,
      });

      if (task.status !== 'succeeded') {
        if (isRetryableWorkerError(task.error?.code, task.error?.message || '')) {
          return {
            error: {
              code: CAPACITY_ERROR_CODE,
              message: CAPACITY_ERROR_MESSAGE,
              retryable: true,
            },
            success: false,
          };
        }

        return {
          error: { message: task.error?.message || 'Failed to export file from Onlyboxes sandbox' },
          success: false,
        };
      }

      return {
        mimeType: String(task.result?.mime_type || ''),
        result: task.result,
        size: typeof task.result?.size_bytes === 'number' ? task.result.size_bytes : undefined,
        success: true,
      };
    } catch (error) {
      log('Onlyboxes export failed: %O', error);
      if (error instanceof OnlyboxesRequestError && error.retryable) {
        return {
          error: {
            code: CAPACITY_ERROR_CODE,
            message: CAPACITY_ERROR_MESSAGE,
            retryable: true,
          },
          success: false,
        };
      }

      return {
        error: { message: (error as Error).message },
        success: false,
      };
    }
  }

  async inspectFileForExport(path: string): Promise<SandboxProviderFileInfoResult> {
    const inspected = await this.runJsonScript(inspectExportFileScript, { path });

    if (!inspected.success) {
      return {
        error: inspected.error,
        success: false,
      };
    }

    return {
      mimeType: String(inspected.result?.mimeType || 'application/octet-stream'),
      size: Number(inspected.result?.size || 0),
      success: true,
    };
  }

  async readFileForExport(path: string, maxBytes: number): Promise<SandboxProviderFileReadResult> {
    const read = await this.runJsonScript(readExportFileScript, { maxBytes, path });

    if (!read.success) {
      return {
        error: read.error,
        success: false,
      };
    }

    return {
      contentBase64: String(read.result?.contentBase64 || ''),
      mimeType: String(read.result?.mimeType || 'application/octet-stream'),
      size: Number(read.result?.size || 0),
      success: true,
    };
  }

  private get sessionId() {
    const scope = `${this.options.userId}-${this.options.topicId}`;
    return `lobe-${scope.replaceAll(/[^\w.-]/g, '-')}`;
  }

  private async executeCode(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const code = String(params.code || '');
    const language = String(params.language || 'python');

    const runners: Record<string, string> = {
      javascript: 'node',
      python: 'python3',
      typescript: 'npx --yes tsx',
    };
    const extensions: Record<string, string> = {
      javascript: 'js',
      python: 'py',
      typescript: 'ts',
    };
    const runner = runners[language];

    if (!runner) {
      return this.errorResult(`Unsupported code language for Onlyboxes sandbox: ${language}`);
    }

    const filePath = `/tmp/lobe-code-${Date.now()}.${extensions[language]}`;
    const writeResult = await this.writeTextFile({
      content: code,
      createDirectories: true,
      path: filePath,
      timeoutMs: this.timeout(params),
    });

    if (!writeResult.success) {
      return writeResult;
    }

    const command = `${runner} '${filePath}'`;
    const terminal = await this.execTerminal(command, this.timeout(params));

    return {
      result: {
        error: terminal.exit_code === 0 ? undefined : terminal.stderr,
        exitCode: terminal.exit_code,
        output: terminal.stdout,
        stderr: terminal.stderr,
      },
      success: true,
    };
  }

  private async execScript(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    const skillZipUrls = this.resolveExecScriptZipUrls(params);
    const timeoutMs = this.timeout(params);

    if (Object.keys(skillZipUrls).length === 0) {
      return this.runCommand({ command, timeout: timeoutMs });
    }

    const defaultSkillName = this.resolveExecScriptSkillName(params, skillZipUrls);
    const workspaceDir = this.skillWorkspaceDir(skillZipUrls);
    const setupCommand = this.buildSkillSetupCommand({ skillZipUrls, workspaceDir });
    const setup = await this.execTerminal(setupCommand, timeoutMs);

    if (setup.exit_code !== 0) {
      return {
        error: { message: setup.stderr || setup.stdout || 'Failed to prepare skill resources' },
        result: {
          exitCode: setup.exit_code,
          output: setup.stdout,
          stderr: setup.stderr,
        },
        success: false,
      };
    }

    const runDir = defaultSkillName
      ? `${workspaceDir}/${this.safeSkillDirName(defaultSkillName)}`
      : workspaceDir;
    const result = await this.execTerminal(
      `cd ${this.shellQuote(runDir)} && ${command}`,
      timeoutMs,
    );

    return {
      result: {
        commandId: result.session_id,
        exitCode: result.exit_code,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exit_code === 0,
      },
      success: true,
    };
  }

  private async runCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    if (params.background === true) {
      const task = await this.submitTask(
        'terminalExec',
        {
          command,
          create_if_missing: true,
          lease_ttl_sec: this.leaseTTLSec,
          session_id: this.sessionId,
        },
        { mode: 'async', timeoutMs: this.timeout(params) },
      );

      if (task.error || !task.task_id) {
        if (isRetryableWorkerError(task.error?.code, task.error?.message || '')) {
          return this.capacityErrorResult();
        }

        return this.errorResult(
          task.error?.message || task.error?.code || 'Failed to start Onlyboxes background command',
        );
      }

      return {
        result: {
          commandId: task.task_id,
          shell_id: task.task_id,
        },
        success: true,
      };
    }

    const terminal = await this.execTerminal(command, this.timeout(params));

    return {
      result: {
        commandId: terminal.session_id,
        exitCode: terminal.exit_code,
        output: terminal.stdout,
        stderr: terminal.stderr,
        stdout: terminal.stdout,
        success: terminal.exit_code === 0,
      },
      success: true,
    };
  }

  private resolveExecScriptZipUrls(params: Record<string, unknown>) {
    const zipUrl = typeof params.zipUrl === 'string' ? params.zipUrl : undefined;
    if (zipUrl) return { [this.resolveLegacyExecScriptSkillName(params)]: zipUrl };

    if (!isRecord(params.skillZipUrls)) return {};

    const result: Record<string, string> = {};

    for (const [name, value] of Object.entries(params.skillZipUrls)) {
      if (typeof value === 'string' && value) {
        result[name] = value;
      }
    }

    return result;
  }

  private resolveLegacyExecScriptSkillName(params: Record<string, unknown>) {
    const configName = isRecord(params.config) ? params.config.name : undefined;
    if (typeof configName === 'string' && configName) return configName;

    if (Array.isArray(params.activatedSkills)) {
      for (const skill of [...params.activatedSkills].reverse()) {
        if (!isRecord(skill)) continue;

        const name = typeof skill.name === 'string' ? skill.name : undefined;
        if (name) return name;
      }
    }

    return 'default';
  }

  private resolveExecScriptSkillName(
    params: Record<string, unknown>,
    skillZipUrls: Record<string, string>,
  ) {
    const configName = isRecord(params.config) ? params.config.name : undefined;
    if (typeof configName === 'string' && skillZipUrls[configName]) return configName;

    if (Array.isArray(params.activatedSkills)) {
      for (const skill of [...params.activatedSkills].reverse()) {
        if (!isRecord(skill)) continue;

        const name = typeof skill.name === 'string' ? skill.name : undefined;
        if (name && skillZipUrls[name]) return name;
      }
    }

    const [firstName] = Object.keys(skillZipUrls);
    return firstName;
  }

  private skillWorkspaceDir(skillZipUrls: Record<string, string>) {
    const entries = Object.entries(skillZipUrls).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const cacheKey = sha256(JSON.stringify(entries)).slice(0, 32);
    return `${SKILL_ARCHIVE_CACHE_DIR}/${cacheKey || 'default'}`;
  }

  private buildSkillSetupCommand({
    skillZipUrls,
    workspaceDir,
  }: {
    skillZipUrls: Record<string, string>;
    workspaceDir: string;
  }) {
    const quotedWorkspaceDir = this.shellQuote(workspaceDir);
    const setupCommands = Object.entries(skillZipUrls).map(([name, zipUrl]) => {
      const skillDir = `${workspaceDir}/${this.safeSkillDirName(name)}`;
      const markerPath = `${skillDir}/.prepared`;
      const archivePath = `${skillDir}/skill.zip`;
      const quotedArchivePath = this.shellQuote(archivePath);
      const quotedDir = this.shellQuote(skillDir);
      const quotedMarkerPath = this.shellQuote(markerPath);
      const quotedUrl = this.shellQuote(zipUrl);

      return `if [ ! -f ${quotedMarkerPath} ]; then rm -rf ${quotedDir} && mkdir -p ${quotedDir} && curl -fsSL ${quotedUrl} -o ${quotedArchivePath} && unzip -q ${quotedArchivePath} -d ${quotedDir} && printf prepared > ${quotedMarkerPath}; fi`;
    });

    return [
      `mkdir -p ${this.shellQuote(SKILL_ARCHIVE_CACHE_DIR)}`,
      `mkdir -p ${quotedWorkspaceDir}`,
      ...setupCommands,
    ].join(' && ');
  }

  private safeSkillDirName(name: string) {
    return name.replaceAll(/[^\w.-]/g, '-');
  }

  private shellQuote(value: string) {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  private async writeLocalFile(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const path = String(params.path || '');

    if (!path) {
      return this.errorResult('path is required');
    }

    return this.writeTextFile({
      content: String(params.content || ''),
      createDirectories: params.createDirectories === true,
      path,
      timeoutMs: this.timeout(params),
    });
  }

  private async writeTextFile({
    content,
    createDirectories,
    path,
    timeoutMs,
  }: {
    content: string;
    createDirectories: boolean;
    path: string;
    timeoutMs: number;
  }): Promise<SandboxCallToolResult> {
    const init = await this.runJsonScript(
      prepareWriteFileScript,
      { createDirectories, path },
      timeoutMs,
    );

    if (!init.success) {
      return init;
    }

    const bytes = Buffer.from(content);
    let bytesWritten = 0;

    for (let offset = 0; offset < bytes.length; offset += WRITE_FILE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + WRITE_FILE_CHUNK_BYTES).toString('base64');
      const append = await this.runJsonScript(
        appendWriteFileChunkScript,
        { chunk, path },
        timeoutMs,
      );

      if (!append.success) {
        return append;
      }

      bytesWritten += Number(append.result?.bytesWritten || 0);
    }

    return {
      result: {
        bytesWritten,
        success: true,
      },
      success: true,
    };
  }

  private async getCommandOutput(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = String(params.commandId || '');
    if (!commandId) return this.errorResult('commandId is required');

    const task = await this.request<OnlyboxesTaskResponse>(`/api/v1/tasks/${commandId}`, {
      method: 'GET',
    });

    const running =
      task.status === 'running' || task.status === 'pending' || task.status === 'dispatched';
    const success = running || task.status === 'succeeded';
    const result = task.result || {};

    return {
      error: task.error
        ? { message: task.error.message || task.error.code || 'Task failed' }
        : undefined,
      result: {
        error: task.error?.message,
        newOutput: String(result.stdout || result.output || ''),
        output: String(result.stdout || result.output || ''),
        running,
        stderr: String(result.stderr || ''),
        success,
      },
      success: !task.error,
    };
  }

  private async killCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = String(params.commandId || '');
    if (!commandId) return this.errorResult('commandId is required');

    const task = await this.request<OnlyboxesTaskResponse>(`/api/v1/tasks/${commandId}/cancel`, {
      method: 'POST',
    });

    return {
      error: task.error
        ? { message: task.error.message || task.error.code || 'Failed to cancel task' }
        : undefined,
      result: {
        success: !task.error,
      },
      success: !task.error,
    };
  }

  private async runJsonScript(
    script: string,
    params: Record<string, unknown>,
    timeoutMs = this.timeout(params),
  ): Promise<SandboxCallToolResult> {
    const encoded = Buffer.from(JSON.stringify(params)).toString('base64');
    const command = `python3 - <<'PY'\n${script}\nmain('${encoded}')\nPY`;
    const terminal = await this.execTerminal(command, timeoutMs);

    if (terminal.exit_code !== 0) {
      return {
        error: { message: terminal.stderr || terminal.stdout || 'Onlyboxes script failed' },
        result: null,
        success: false,
      };
    }

    try {
      const result = JSON.parse(terminal.stdout || '{}') as Record<string, unknown>;

      if (result.success === false) {
        return {
          error: { message: String(result.error || 'Onlyboxes script failed') },
          result,
          success: false,
        };
      }

      return {
        result,
        success: true,
      };
    } catch (error) {
      return {
        error: { message: `Failed to parse Onlyboxes script output: ${(error as Error).message}` },
        result: { output: terminal.stdout, stderr: terminal.stderr },
        success: false,
      };
    }
  }

  private async withWorkerRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable = error instanceof OnlyboxesRequestError && error.retryable;
        const baseDelay = WORKER_RETRY_DELAYS_MS[attempt];

        if (!retryable || baseDelay === undefined) throw error;

        const retryDelay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
        sandboxRetryCounter.add(1, {
          'sandbox.capability': label,
          'sandbox.retry_attempt': attempt + 1,
        });

        log(
          'Onlyboxes worker unavailable for %s; retrying attempt %d in %dms',
          label,
          attempt + 2,
          retryDelay,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  private async execTerminal(command: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.withWorkerRetry('terminalExec', () =>
      this.request<TerminalExecResult>('/api/v1/commands/terminal', {
        body: JSON.stringify({
          command,
          create_if_missing: true,
          lease_ttl_sec: this.leaseTTLSec,
          session_id: this.sessionId,
          timeout_ms: timeoutMs,
        }),
        method: 'POST',
      }),
    );
  }

  private async ensureSession() {
    await this.execTerminal(':', DEFAULT_TIMEOUT_MS);
  }

  private async submitTask(
    capability: string,
    input: Record<string, unknown>,
    options?: { mode?: 'async' | 'auto' | 'sync'; timeoutMs?: number },
  ) {
    const operation = () =>
      this.request<OnlyboxesTaskResponse>('/api/v1/tasks', {
        body: JSON.stringify({
          capability,
          input,
          mode: options?.mode || 'sync',
          timeout_ms: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
          wait_ms: options?.mode === 'async' ? 1 : EXPORT_TASK_WAIT_MS,
        }),
        method: 'POST',
      });

    // Retrying an acknowledged asynchronous submission could duplicate a
    // background command. Synchronous resource tasks are safe to resubmit only
    // when Console explicitly rejected them for lack of worker capacity.
    return options?.mode === 'async' ? operation() : this.withWorkerRetry(capability, operation);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.createJITToken()}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const body = await response.text();
    let json: any;
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      const message =
        typeof json?.error === 'string'
          ? json.error
          : typeof json?.error?.message === 'string'
            ? json.error.message
            : `Onlyboxes request failed with HTTP ${response.status}`;
      const code = typeof json?.error?.code === 'string' ? json.error.code : undefined;
      throw new OnlyboxesRequestError({
        code,
        message,
        retryable: isRetryableWorkerError(code, message),
        status: response.status,
      });
    }

    return json as T;
  }

  private createJITToken(now = Date.now()) {
    const claims = {
      exp: now + this.jitTTLSec * 1000,
      iss: this.jitIssuer,
      sub: this.options.userId,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signed = `${JIT_TOKEN_PREFIX}${payload}`;
    const signature = createHmac('sha256', this.jitSigningKey).update(signed).digest('base64url');

    return `${signed}.${signature}`;
  }

  private timeout(params: Record<string, unknown>) {
    const value = params.timeout ?? params.timeout_ms;
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIMEOUT_MS;
  }

  private errorResult(
    message: string,
    name?: string,
    code?: string,
    retryable?: boolean,
  ): SandboxCallToolResult {
    return {
      error: { code, message, name, retryable },
      result: null,
      success: false,
    };
  }

  private capacityErrorResult(): SandboxCallToolResult {
    return this.errorResult(
      CAPACITY_ERROR_MESSAGE,
      'OnlyboxesRequestError',
      CAPACITY_ERROR_CODE,
      true,
    );
  }
}

const scriptPrelude = `
import base64, json, os, re, shutil, glob, fnmatch
from pathlib import Path

def load_args(encoded):
    return json.loads(base64.b64decode(encoded).decode())

def emit(value):
    print(json.dumps(value, ensure_ascii=False))
`;

const listFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directoryPath') or '.'
    entries = []
    for entry in os.scandir(directory):
        stat = entry.stat()
        entries.append({
            'name': entry.name,
            'path': entry.path,
            'isDirectory': entry.is_dir(),
            'size': stat.st_size,
            'mtime': stat.st_mtime,
        })
    emit({'files': entries, 'totalCount': len(entries)})
`;

const readFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = args.get('path')
    start = args.get('startLine')
    end = args.get('endLine')
    text = Path(path).read_text(errors='replace')
    lines = text.splitlines(True)
    selected = lines
    if start is not None or end is not None:
        start_idx = max((start or 1) - 1, 0)
        end_idx = end if end is not None else len(lines)
        selected = lines[start_idx:end_idx]
    content = ''.join(selected)
    emit({
        'content': content,
        'filename': os.path.basename(path),
        'charCount': len(content),
        'totalCharCount': len(text),
        'totalLineCount': len(lines),
    })
`;

const inspectExportFileScript = `${scriptPrelude}
import mimetypes

def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path') or '')
    if not path.exists():
        emit({'success': False, 'error': 'File not found in sandbox'})
        return
    if not path.is_file():
        emit({'success': False, 'error': 'Sandbox export path is not a file'})
        return
    mime_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    emit({'success': True, 'size': path.stat().st_size, 'mimeType': mime_type})
`;

const readExportFileScript = `${scriptPrelude}
import mimetypes

def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path') or '')
    max_bytes = int(args.get('maxBytes') or 0)
    if not path.exists():
        emit({'success': False, 'error': 'File not found in sandbox'})
        return
    if not path.is_file():
        emit({'success': False, 'error': 'Sandbox export path is not a file'})
        return
    size = path.stat().st_size
    if max_bytes <= 0 or size > max_bytes:
        emit({'success': False, 'error': 'Sandbox file exceeds server fallback size limit', 'size': size})
        return
    content = base64.b64encode(path.read_bytes()).decode('ascii')
    mime_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    emit({'success': True, 'contentBase64': content, 'size': size, 'mimeType': mime_type})
`;

const prepareWriteFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    if args.get('createDirectories'):
        path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'')
    emit({'success': True})
`;

const appendWriteFileChunkScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    chunk = base64.b64decode(args.get('chunk') or '')
    with path.open('ab') as file:
        file.write(chunk)
    emit({'bytesWritten': len(chunk), 'success': True})
`;

const editFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    search = args.get('search') or ''
    replace = args.get('replace') or ''
    text = path.read_text(errors='replace')
    count = text.count(search)
    if count == 0:
        emit({'success': False, 'error': 'search text not found', 'replacements': 0})
        return
    new_text = text.replace(search, replace) if args.get('all') else text.replace(search, replace, 1)
    replacements = count if args.get('all') else 1
    path.write_text(new_text)
    emit({'success': True, 'replacements': replacements, 'linesAdded': replace.count('\\n'), 'linesDeleted': search.count('\\n')})
`;

const searchFilesScript = `${scriptPrelude}
from datetime import datetime

def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except Exception:
        return None

def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    raw_keywords = args.get('keywords') or args.get('keyword') or ''
    keywords = [item.strip() for item in str(raw_keywords).split() if item.strip()]
    raw_file_types = args.get('fileTypes') or args.get('fileType') or []
    if isinstance(raw_file_types, str):
        raw_file_types = [raw_file_types]
    file_types = [item if str(item).startswith('.') else f'.{item}' for item in raw_file_types if str(item).strip()]
    modified_after = parse_time(args.get('modifiedAfter'))
    modified_before = parse_time(args.get('modifiedBefore'))
    content_contains = args.get('contentContains')
    limit = args.get('limit')
    results = []
    for root, _, files in os.walk(directory):
        for name in files:
            if keywords and not all(keyword in name for keyword in keywords):
                continue
            if file_types and not any(name.endswith(file_type) for file_type in file_types):
                continue
            path = os.path.join(root, name)
            try:
                stat = os.stat(path)
            except Exception:
                continue
            if modified_after is not None and stat.st_mtime < modified_after:
                continue
            if modified_before is not None and stat.st_mtime > modified_before:
                continue
            if content_contains:
                try:
                    if str(content_contains) not in Path(path).read_text(errors='replace'):
                        continue
                except Exception:
                    continue
            results.append({'name': name, 'path': path, 'size': stat.st_size, 'mtime': stat.st_mtime})
    sort_by = args.get('sortBy')
    reverse = args.get('sortDirection') == 'desc'
    if sort_by == 'size':
        results.sort(key=lambda item: item.get('size') or 0, reverse=reverse)
    elif sort_by == 'date':
        results.sort(key=lambda item: item.get('mtime') or 0, reverse=reverse)
    else:
        results.sort(key=lambda item: item.get('name') or '', reverse=reverse)
    total = len(results)
    if isinstance(limit, int) and limit > 0:
        results = results[:limit]
    emit({'results': results, 'totalCount': total})
`;

const moveFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    results = []
    for op in args.get('operations') or []:
        try:
            shutil.move(op.get('source'), op.get('destination'))
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': True})
        except Exception as error:
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': False, 'error': str(error)})
    emit({'results': results, 'successCount': len([r for r in results if r.get('success')])})
`;

const grepContentScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or ''
    file_pattern = args.get('filePattern') or '*'
    recursive = args.get('recursive', True)
    regex = re.compile(pattern)
    matches = []
    walker = os.walk(directory) if recursive else [(directory, [], os.listdir(directory))]
    for root, _, files in walker:
        for name in files:
            if not fnmatch.fnmatch(name, file_pattern):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, 'r', errors='replace') as file:
                    for index, line in enumerate(file, 1):
                        if regex.search(line):
                            matches.append({'path': path, 'lineNumber': index, 'line': line.rstrip('\\n')})
            except Exception:
                pass
    emit({'matches': matches, 'totalMatches': len(matches)})
`;

const globFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or '*'
    files = glob.glob(os.path.join(directory, pattern), recursive=True)
    emit({'files': files, 'totalCount': len(files)})
`;

const officeCliScript = `${scriptPrelude}
import subprocess, tempfile

OFFICE_ROOT = Path('/tmp/masterino-office').resolve()
UPLOAD_ROOT = Path('/mnt/data').resolve()
OFFICE_EXTENSIONS = {'.docx', '.xlsx', '.pptx'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.svg'}
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_OPERATIONS = 500
ALLOWED_COMMANDS = {'add', 'set', 'remove', 'move', 'swap'}
BLOCKED_FORMULA = re.compile(r'^\\s*=\\s*(WEBSERVICE|HYPERLINK|RTD|DDE)\\b', re.IGNORECASE)

def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False

def resolve_path(value, *, output=False, extensions=None):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('A sandbox path is required')
    raw = Path(value)
    path = (OFFICE_ROOT / raw if not raw.is_absolute() else raw).resolve()
    allowed = inside(path, OFFICE_ROOT) or (not output and inside(path, UPLOAD_ROOT))
    if not allowed:
        raise ValueError('Office paths must stay inside /tmp/masterino-office or /mnt/data')
    if output and not inside(path, OFFICE_ROOT):
        raise ValueError('Office output paths must stay inside /tmp/masterino-office')
    if extensions and path.suffix.lower() not in extensions:
        raise ValueError(f'Unsupported file extension: {path.suffix}')
    return path

def validate_value(value, key=''):
    if isinstance(value, dict):
        for child_key, child in value.items():
            validate_value(child, str(child_key))
    elif isinstance(value, list):
        for child in value:
            validate_value(child, key)
    elif isinstance(value, str):
        if BLOCKED_FORMULA.search(value):
            raise ValueError('External or executable Excel formulas are not allowed')
        if key.lower() in {'src', 'source', 'image', 'imagepath', 'file', 'filepath'}:
            if re.match(r'^[a-z][a-z0-9+.-]*://', value, re.IGNORECASE):
                raise ValueError('External document resources are not allowed')
            if '/' in value or '\\\\' in value:
                resolve_path(value, extensions=IMAGE_EXTENSIONS | OFFICE_EXTENSIONS)

def run_office(command):
    env = os.environ.copy()
    env['OFFICECLI_SKIP_UPDATE'] = '1'
    result = subprocess.run(
        command,
        capture_output=True,
        cwd=str(OFFICE_ROOT),
        env=env,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'OfficeCLI failed')
    output = result.stdout.strip()
    if not output:
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return output

def format_of(path):
    return path.suffix.lower().lstrip('.')

def ensure_size(path):
    if path.exists() and path.stat().st_size > MAX_FILE_BYTES:
        path.unlink(missing_ok=True)
        raise ValueError('Generated Office file exceeds the 50 MiB limit')

def main(encoded):
    args = load_args(encoded)
    action = args.get('action')
    OFFICE_ROOT.mkdir(parents=True, exist_ok=True)

    try:
        if action == 'createOfficeDocument':
            path = resolve_path(args.get('path'), output=True, extensions=OFFICE_EXTENSIONS)
            path.parent.mkdir(parents=True, exist_ok=True)
            expected = str(args.get('format') or '').lower()
            if expected not in {'docx', 'xlsx', 'pptx'} or path.suffix.lower() != f'.{expected}':
                raise ValueError('format must match the output file extension')
            command = ['officecli', 'create', str(path)]
            locale = args.get('locale')
            if locale:
                command.extend(['--locale', str(locale)])
            output = run_office(command)
            ensure_size(path)
            emit({'success': True, 'path': str(path), 'format': expected, 'output': output})
            return

        if action == 'batchOfficeDocument':
            path = resolve_path(args.get('path'), output=True, extensions=OFFICE_EXTENSIONS)
            operations = args.get('operations')
            if not isinstance(operations, list) or not 1 <= len(operations) <= MAX_OPERATIONS:
                raise ValueError('operations must contain between 1 and 500 items')
            for operation in operations:
                if not isinstance(operation, dict) or operation.get('command') not in ALLOWED_COMMANDS:
                    raise ValueError('Unsupported Office batch operation')
                if not isinstance(operation.get('path'), str):
                    raise ValueError('Every Office operation requires a path')
                validate_value(operation)
            with tempfile.NamedTemporaryFile('w', suffix='.json', dir=OFFICE_ROOT, delete=False, encoding='utf-8') as file:
                json.dump(operations, file, ensure_ascii=False)
                batch_path = Path(file.name)
            try:
                output = run_office(['officecli', 'batch', str(path), '--input', str(batch_path), '--json'])
            finally:
                batch_path.unlink(missing_ok=True)
            ensure_size(path)
            emit({'success': True, 'path': str(path), 'format': format_of(path), 'output': output})
            return

        if action == 'mergeOfficeTemplate':
            template = resolve_path(args.get('templatePath'), extensions=OFFICE_EXTENSIONS)
            output_path = resolve_path(args.get('outputPath'), output=True, extensions=OFFICE_EXTENSIONS)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if template.suffix.lower() != output_path.suffix.lower():
                raise ValueError('Template and output formats must match')
            data = args.get('data')
            if not isinstance(data, dict):
                raise ValueError('Template data must be an object')
            validate_value(data)
            with tempfile.NamedTemporaryFile('w', suffix='.json', dir=OFFICE_ROOT, delete=False, encoding='utf-8') as file:
                json.dump(data, file, ensure_ascii=False)
                data_path = Path(file.name)
            try:
                output = run_office(['officecli', 'merge', str(template), str(output_path), '--data', str(data_path)])
            finally:
                data_path.unlink(missing_ok=True)
            ensure_size(output_path)
            emit({'success': True, 'path': str(output_path), 'format': format_of(output_path), 'output': output})
            return

        if action == 'inspectOfficeDocument':
            path = resolve_path(args.get('path'), extensions=OFFICE_EXTENSIONS)
            mode = args.get('mode')
            if mode not in {'outline', 'issues', 'html', 'screenshot'}:
                raise ValueError('Unsupported Office inspection mode')
            command = ['officecli', 'view', str(path), str(mode)]
            previews = []
            if mode in {'html', 'screenshot'}:
                default_suffix = '.html' if mode == 'html' else '.png'
                output_path = resolve_path(
                    args.get('outputPath') or f'{path.stem}-preview{default_suffix}',
                    output=True,
                    extensions={default_suffix},
                )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                command.extend(['-o', str(output_path)])
                previews.append(str(output_path))
            else:
                command.append('--json')
            if args.get('page'):
                command.extend(['--page', str(args.get('page'))])
            output = run_office(command)
            issues = output if mode == 'issues' and isinstance(output, list) else []
            emit({'success': True, 'path': str(path), 'format': format_of(path), 'issues': issues, 'previews': previews, 'output': output})
            return

        if action == 'validateOfficeDocument':
            path = resolve_path(args.get('path'), extensions=OFFICE_EXTENSIONS)
            output = run_office(['officecli', 'validate', str(path), '--json'])
            ensure_size(path)
            emit({'success': True, 'path': str(path), 'format': format_of(path), 'issues': [], 'output': output})
            return

        raise ValueError('Unsupported OfficeCLI action')
    except subprocess.TimeoutExpired:
        emit({'success': False, 'code': 'office_timeout', 'error': 'OfficeCLI exceeded the 180 second timeout'})
    except Exception as error:
        emit({'success': False, 'code': 'office_error', 'error': str(error)})
`;
