import { vi } from 'vitest';

import type * as AgentDocumentsModule from '@/server/services/agentDocuments';

// These orchestration suites have no database-backed user or agent skills.
// Declare that fixture explicitly: registry failures now propagate instead of
// silently hiding missing database methods in tiny test doubles.
vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn().mockImplementation(() => ({
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  })),
}));

vi.mock('@/server/services/agentDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentDocumentsModule>();
  return {
    ...actual,
    AgentDocumentsService: class extends actual.AgentDocumentsService {
      async getAgentSkills() {
        return [];
      }
    },
  };
});
