import { LocalSystemRenders } from '@lobechat/builtin-tool-local-system/client';
import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';

import { CloudSandboxApiName } from '../../types';
import ExecuteCode from './ExecuteCode';
import ExportFile from './ExportFile';
import OfficeDocument from './OfficeDocument';

/**
 * Cloud Sandbox Render Components Registry
 *
 * Reuses local-system renders for shared file/shell operations.
 * Only cloud-specific tools (executeCode, exportFile) have their own renders.
 *
 * Each component is also registered under the legacy long API name so old DB
 * messages with apiName like 'readLocalFile' still render after the rename.
 */
export const CloudSandboxRenders = {
  [CloudSandboxApiName.batchOfficeDocument]: OfficeDocument,
  [CloudSandboxApiName.createOfficeDocument]: OfficeDocument,
  [CloudSandboxApiName.editFile]: LocalSystemRenders.editFile,
  [CloudSandboxApiName.executeCode]: ExecuteCode,
  [CloudSandboxApiName.exportFile]: ExportFile,
  [CloudSandboxApiName.listFiles]: LocalSystemRenders.listFiles,
  [CloudSandboxApiName.moveFiles]: LocalSystemRenders.moveFiles,
  [CloudSandboxApiName.inspectOfficeDocument]: OfficeDocument,
  [CloudSandboxApiName.readFile]: LocalSystemRenders.readFile,
  [CloudSandboxApiName.runCommand]: RunCommandRender,
  [CloudSandboxApiName.searchFiles]: LocalSystemRenders.searchFiles,
  [CloudSandboxApiName.mergeOfficeTemplate]: OfficeDocument,
  [CloudSandboxApiName.validateOfficeDocument]: OfficeDocument,
  [CloudSandboxApiName.writeFile]: LocalSystemRenders.writeFile,
  // Legacy aliases — keep these so historical messages keep rendering
  editLocalFile: LocalSystemRenders.editFile,
  listLocalFiles: LocalSystemRenders.listFiles,
  moveLocalFiles: LocalSystemRenders.moveFiles,
  readLocalFile: LocalSystemRenders.readFile,
  searchLocalFiles: LocalSystemRenders.searchFiles,
  writeLocalFile: LocalSystemRenders.writeFile,
};

// Export API names for use in other modules

export { CloudSandboxApiName } from '../../types';
