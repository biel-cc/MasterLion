import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';

export interface WorkspaceExtensionRenderProps {
  deviceId: string;
  workspace: ProjectWorkspaceItem;
}

/**
 * Mount seam for per-workspace settings panels (environment variables, skill
 * policy, …). Owning lanes register a renderer at integrate time; this module
 * never imports them and makes no assumption about their APIs.
 */
export interface WorkspaceExtension {
  key: string;
  /** Lower renders first. Defaults to 0. */
  order?: number;
  render: (props: WorkspaceExtensionRenderProps) => ReactNode;
}

const registry = new Map<string, WorkspaceExtension>();
const listeners = new Set<() => void>();
let snapshot: WorkspaceExtension[] = [];

const rebuildSnapshot = () => {
  snapshot = [...registry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const listener of listeners) listener();
};

export const registerWorkspaceExtension = (extension: WorkspaceExtension): (() => void) => {
  registry.set(extension.key, extension);
  rebuildSnapshot();
  return () => {
    if (registry.get(extension.key) !== extension) return;
    registry.delete(extension.key);
    rebuildSnapshot();
  };
};

export const listWorkspaceExtensions = (): WorkspaceExtension[] => snapshot;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useWorkspaceExtensions = (): WorkspaceExtension[] =>
  useSyncExternalStore(subscribe, listWorkspaceExtensions, listWorkspaceExtensions);

/** Test-only reset. */
export const resetWorkspaceExtensions = () => {
  registry.clear();
  rebuildSnapshot();
};
