import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
} from '../extract';

export interface MemoryPersonaQueuePayload {
  asyncTaskId?: string;
  queueRunId?: string;
  userIds: string[];
}

export type MemoryQueueJobData =
  | MemoryExtractionHourlyWorkflowPayload
  | MemoryExtractionPayloadInput
  | MemoryPersonaQueuePayload;
