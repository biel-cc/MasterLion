import { useEffectiveWorkspace } from './useEffectiveWorkspace';

/**
 * Legacy name kept for existing consumers. It is a thin wrapper over
 * `useEffectiveWorkspace` and therefore returns only a contract-resolved cwd:
 * `undefined` for unbound or unrouted topics, with no device-default,
 * home, Desktop or process.cwd fallback. Consumers that need state or
 * recommendations should call `useEffectiveWorkspace` directly.
 */
export const useEffectiveWorkingDirectory = (agentId?: string): string | undefined =>
  useEffectiveWorkspace(agentId).cwd;
