'use client';

/**
 * Legacy entry kept for callers that still route the `byProject` group mode.
 * The raw-path (`project:<path>`) grouping is gone: project mode now renders
 * the fixed Workspace / Recent navigation keyed by `project_workspaces` ids.
 */
export { WorkspaceMode as default } from '@/features/AgentTopicSidebar';
