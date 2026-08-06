import { ComputerRuntime } from '@lobechat/tool-runtime';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  BatchOfficeDocumentParams,
  CreateOfficeDocumentParams,
  ExecuteCodeParams,
  ExecuteCodeState,
  ExportFileParams,
  ExportFileState,
  InspectOfficeDocumentParams,
  ISandboxService,
  MergeOfficeTemplateParams,
  OfficeToolState,
  SandboxCallToolResult,
  ValidateOfficeDocumentParams,
} from '../types';

/**
 * Cloud Sandbox Execution Runtime
 *
 * Extends ComputerRuntime for standard computer operations (files, shell, search).
 * Adds cloud-specific capabilities: code execution and file export.
 *
 * Dependency Injection:
 * - Client: Inject codeInterpreterService (uses tRPC client)
 * - Server: Inject configured sandbox provider (Market, Onlyboxes, etc.)
 */
export class CloudSandboxExecutionRuntime extends ComputerRuntime {
  private sandboxService: ISandboxService;

  constructor(sandboxService: ISandboxService) {
    super();
    this.sandboxService = sandboxService;
  }

  protected async callService(
    toolName: string,
    params: Record<string, any>,
  ): Promise<SandboxCallToolResult> {
    return this.sandboxService.callTool(toolName, params);
  }

  // ==================== Cloud-Specific: Code Execution ====================

  async executeCode(args: ExecuteCodeParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const language = args.language || 'python';
      const result = await this.callService('executeCode', {
        code: args.code,
        language,
      });

      const state: ExecuteCodeState = {
        error: result.result?.error,
        exitCode: result.result?.exitCode,
        language,
        output: result.result?.output,
        stderr: result.result?.stderr,
        success: result.success || false,
      };

      if (!result.success) {
        return {
          content: result.error?.message || JSON.stringify(result.error),
          state,
          success: true,
        };
      }

      return {
        content: JSON.stringify(result.result),
        state,
        success: true,
      };
    } catch (error) {
      console.error('executeCode error', error);
      return this.handleError(error);
    }
  }

  // ==================== Cloud-Specific: Office Documents ====================

  private async callOfficeTool(
    toolName: string,
    args:
      | BatchOfficeDocumentParams
      | CreateOfficeDocumentParams
      | InspectOfficeDocumentParams
      | MergeOfficeTemplateParams
      | ValidateOfficeDocumentParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.callService(toolName, args as unknown as Record<string, unknown>);
      const payload = (result.result || {}) as Record<string, any>;
      const state: OfficeToolState = {
        error: result.error?.message
          ? { message: result.error.message }
          : payload.error
            ? { code: String(payload.code || ''), message: String(payload.error) }
            : undefined,
        format: payload.format,
        issues: Array.isArray(payload.issues) ? payload.issues : undefined,
        output: payload.output,
        path: payload.path,
        previews: Array.isArray(payload.previews) ? payload.previews : undefined,
        success: result.success && payload.success !== false,
      };

      return {
        content: JSON.stringify(result.success ? payload : { error: result.error?.message }),
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  createOfficeDocument(args: CreateOfficeDocumentParams) {
    return this.callOfficeTool('createOfficeDocument', args);
  }

  batchOfficeDocument(args: BatchOfficeDocumentParams) {
    return this.callOfficeTool('batchOfficeDocument', args);
  }

  mergeOfficeTemplate(args: MergeOfficeTemplateParams) {
    return this.callOfficeTool('mergeOfficeTemplate', args);
  }

  inspectOfficeDocument(args: InspectOfficeDocumentParams) {
    return this.callOfficeTool('inspectOfficeDocument', args);
  }

  validateOfficeDocument(args: ValidateOfficeDocumentParams) {
    return this.callOfficeTool('validateOfficeDocument', args);
  }

  // ==================== Cloud-Specific: File Export ====================

  /**
   * Export a file from the sandbox to cloud storage
   */
  async exportFile(args: ExportFileParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const filename = args.path.split('/').pop() || 'exported_file';

      const result = await this.sandboxService.exportAndUploadFile(args.path, filename);

      const state: ExportFileState = {
        downloadUrl: result.success && result.url ? result.url : '',
        error: result.error,
        fileId: result.fileId,
        filename: result.filename,
        mimeType: result.mimeType,
        path: args.path,
        size: result.size,
        success: result.success,
      };

      if (!result.success) {
        return {
          content: JSON.stringify({
            error: result.error?.message || 'Failed to export file from sandbox',
            filename,
            success: false,
          }),
          state,
          success: true,
        };
      }

      return {
        content: `File exported successfully.\n\nFilename: ${filename}\nDownload URL: ${result.url}`,
        state,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
}
