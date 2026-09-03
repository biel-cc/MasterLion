export interface WorkspaceEnvEntrySummary {
  key: string;
  secret: boolean;
}

export interface SaveWorkspaceEnvEntryInput {
  key: string;
  secret: boolean;
  value: string;
}

/** Browser client: reads return names and secret flags only, never stored values. */
export interface WorkspaceEnvClient {
  list: (workspaceId: string) => Promise<WorkspaceEnvEntrySummary[]>;
  revoke: (workspaceId: string, key: string) => Promise<void>;
  save: (workspaceId: string, entry: SaveWorkspaceEnvEntryInput) => Promise<void>;
}
