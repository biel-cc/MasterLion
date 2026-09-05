export interface DraftConversationKeyInput {
  agentId?: string | null;
  groupId?: string | null;
}

/**
 * Draft intents are scoped per conversation container so a workspace picked
 * while drafting for one agent (or one group/agent pair) never leaks into
 * another chat. Both segments are always present, even when empty, so
 * `agent-a` alone and `agent-a` inside `group-x` produce different keys.
 */
export const buildDraftConversationKey = ({
  agentId,
  groupId,
}: DraftConversationKeyInput): string => `draft:${groupId ?? ''}:${agentId ?? ''}`;

export const buildTopicDeviceKey = (topicId: string, deviceId: string): string =>
  `${topicId}::${deviceId}`;
