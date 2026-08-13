/**
 * API names for Cloud Sandbox tool
 */
export const CloudSandboxApiName = {
  batchOfficeDocument: 'batchOfficeDocument',
  createOfficeDocument: 'createOfficeDocument',
  editFile: 'editFile',
  executeCode: 'executeCode',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  globFiles: 'globFiles',
  grepContent: 'grepContent',
  inspectOfficeDocument: 'inspectOfficeDocument',
  killCommand: 'killCommand',
  listFiles: 'listFiles',
  mergeOfficeTemplate: 'mergeOfficeTemplate',
  moveFiles: 'moveFiles',
  readFile: 'readFile',
  runCommand: 'runCommand',
  searchFiles: 'searchFiles',
  validateOfficeDocument: 'validateOfficeDocument',
  writeFile: 'writeFile',
} as const;

export type CloudSandboxApiNameType =
  (typeof CloudSandboxApiName)[keyof typeof CloudSandboxApiName];
