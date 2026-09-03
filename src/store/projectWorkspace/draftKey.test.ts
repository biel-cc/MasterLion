import { describe, expect, it } from 'vitest';

import { buildDraftConversationKey, buildTopicDeviceKey } from './draftKey';

describe('buildDraftConversationKey', () => {
  it('isolates drafts by agent', () => {
    expect(buildDraftConversationKey({ agentId: 'agent-a' })).not.toBe(
      buildDraftConversationKey({ agentId: 'agent-b' }),
    );
  });

  it('isolates the same agent inside a group from its standalone draft', () => {
    expect(buildDraftConversationKey({ agentId: 'agent-a', groupId: 'group-x' })).not.toBe(
      buildDraftConversationKey({ agentId: 'agent-a' }),
    );
  });

  it('isolates the same group across different agents', () => {
    expect(buildDraftConversationKey({ agentId: 'agent-a', groupId: 'group-x' })).not.toBe(
      buildDraftConversationKey({ agentId: 'agent-b', groupId: 'group-x' }),
    );
  });

  it('is stable for equal input and treats null/undefined group the same', () => {
    expect(buildDraftConversationKey({ agentId: 'agent-a', groupId: null })).toBe(
      buildDraftConversationKey({ agentId: 'agent-a' }),
    );
  });

  it('keys grants by topic and device', () => {
    expect(buildTopicDeviceKey('topic-1', 'device-1')).not.toBe(
      buildTopicDeviceKey('topic-1', 'device-2'),
    );
  });
});
