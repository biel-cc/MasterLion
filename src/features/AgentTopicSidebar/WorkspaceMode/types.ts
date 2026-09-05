import type { ChatTopicMetadata, ChatTopicStatus } from '@lobechat/types';
import type { ComponentType } from 'react';

/** Route-owned topic row contract injected into the feature to keep the dependency one-way. */
export interface WorkspaceTopicItemProps {
  active?: boolean;
  fav?: boolean;
  id?: string;
  metadata?: ChatTopicMetadata;
  scratchWorkspace?: { rootPath: string };
  status?: ChatTopicStatus | null;
  threadId?: string;
  title: string;
}

export type WorkspaceTopicItemComponent = ComponentType<WorkspaceTopicItemProps>;
