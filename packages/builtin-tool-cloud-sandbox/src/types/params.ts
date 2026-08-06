// ==================== File Operations Params ====================

export interface ListLocalFilesParams {
  directoryPath: string;
}

export interface ReadLocalFileParams {
  endLine?: number;
  path: string;
  startLine?: number;
}

export interface WriteLocalFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
}

export interface EditLocalFileParams {
  all?: boolean;
  path: string;
  replace: string;
  search: string;
}

export interface SearchLocalFilesParams {
  directory: string;
  fileType?: string;
  keyword?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface MoveLocalFilesParams {
  operations: Array<{
    destination: string;
    source: string;
  }>;
}

export interface RenameLocalFileParams {
  newName: string;
  oldPath: string;
}

export interface GlobLocalFilesParams {
  directory?: string;
  pattern: string;
}

export interface ExportFileParams {
  path: string;
}

// ==================== Office Document Params ====================

export type OfficeDocumentFormat = 'docx' | 'pptx' | 'xlsx';

export type OfficeDocumentInspectMode = 'html' | 'issues' | 'outline' | 'screenshot';

export interface OfficeDocumentOperation {
  command: 'add' | 'move' | 'remove' | 'set' | 'swap';
  from?: string;
  index?: number;
  path: string;
  props?: Record<string, unknown>;
  to?: string;
  type?: string;
}

export interface CreateOfficeDocumentParams {
  format: OfficeDocumentFormat;
  locale?: string;
  path: string;
}

export interface BatchOfficeDocumentParams {
  operations: OfficeDocumentOperation[];
  path: string;
}

export interface MergeOfficeTemplateParams {
  data: Record<string, unknown>;
  outputPath: string;
  templatePath: string;
}

export interface InspectOfficeDocumentParams {
  mode: OfficeDocumentInspectMode;
  outputPath?: string;
  page?: string;
  path: string;
}

export interface ValidateOfficeDocumentParams {
  path: string;
}

// ==================== Code Execution Params ====================

export interface ExecuteCodeParams {
  code: string;
  language?: 'javascript' | 'python' | 'typescript';
}

// ==================== Shell Command Params ====================

export interface RunCommandParams {
  background?: boolean;
  command: string;
  timeout?: number;
}

export interface GetCommandOutputParams {
  commandId: string;
}

export interface KillCommandParams {
  commandId: string;
}

// ==================== Search & Find Params ====================

export interface GrepContentParams {
  directory: string;
  filePattern?: string;
  pattern: string;
  recursive?: boolean;
}
