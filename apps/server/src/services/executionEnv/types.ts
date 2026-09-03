import type {
  ExecutionEnvLayer,
  ResolveExecutionEnvRequest,
} from '@lobechat/types/src/executionContext';
import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';

export type ExecutionEnvLayerRecord = ProjectWorkspaceEnvRecord;

export interface DecryptExecutionEnvSecretInput {
  /** Encrypted storage payload. Callers must never log or serialize this field. */
  encryptedValue: string;
  key: string;
  layer: ExecutionEnvLayer;
  request: ResolveExecutionEnvRequest;
}

export interface ExecutionEnvAdapterDependencies {
  decryptSecret: (input: DecryptExecutionEnvSecretInput) => Promise<string>;
  loadLayer: (
    layer: ExecutionEnvLayer,
    request: ResolveExecutionEnvRequest,
  ) => Promise<ExecutionEnvLayerRecord | undefined>;
}

export interface BrowserExecutionEnvEntry {
  key: string;
  secret: boolean;
}
