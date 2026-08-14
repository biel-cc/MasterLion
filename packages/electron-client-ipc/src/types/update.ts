export type UpdateChannel = 'stable' | 'canary';

export interface ReleaseNoteInfo {
  /**
   * The note.
   */
  note: string | null;
  /**
   * The version.
   */
  version: string;
}

export interface ProgressInfo {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface UpdateInfo {
  releaseDate: string;
  releaseNotes?: string | ReleaseNoteInfo[];
  version: string;
}

export type UpdaterStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'latest'
  | 'error';

export type UpdaterInstallMode = 'open-dmg' | 'restart';

export type UpdaterErrorCode =
  | 'disk'
  | 'integrity'
  | 'install'
  | 'network'
  | 'signature'
  | 'unknown';

export interface UpdaterState {
  autoDownloadEnabled: boolean;
  errorCode?: UpdaterErrorCode;
  errorMessage?: string;
  installMode?: UpdaterInstallMode;
  progress?: ProgressInfo;
  stage: UpdaterStage;
  updateInfo?: UpdateInfo;
}
