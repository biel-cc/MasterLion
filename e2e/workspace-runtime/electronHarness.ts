import type { AcceptanceResultMap } from '../../test/workspace-runtime/contracts';

export type ElectronAcceptanceId =
  | 'AC-C04'
  | 'AC-C08'
  | 'AC-M03'
  | 'AC-P08'
  | 'AC-W04'
  | 'AC-W05'
  | 'AC-W06'
  | 'AC-W07'
  | 'AC-W08'
  | 'AC-W09'
  | 'AC-W10'
  | 'AC-X02';

export interface ElectronWorkspaceRuntimeSession {
  close: () => Promise<void>;
  observe: <Id extends ElectronAcceptanceId>(id: Id) => Promise<AcceptanceResultMap[Id]>;
}

/**
 * Integration wiring point. Bind this to the production Electron app, test database, and an
 * isolated temporary workspace root. The accepted ref has no Workspace Runtime renderer/IPC seam,
 * so invocation intentionally fails with a behavioral wiring error instead of an import error.
 */
export const launchElectronWorkspaceRuntimeSession =
  async (): Promise<ElectronWorkspaceRuntimeSession> => {
    throw new Error(
      'MISSING_ELECTRON_ACCEPTANCE_SEAM: bind the production renderer/IPC, isolated DB, and temp filesystem fixture',
    );
  };
