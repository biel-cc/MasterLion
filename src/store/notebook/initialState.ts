import { type NotebookDocumentSummary } from '@lobechat/types';

export interface NotebookState {
  /**
   * Map of topicId -> notebook documents list
   */
  notebookMap: Record<string, NotebookDocumentSummary[]>;
}

export const initialNotebookState: NotebookState = {
  notebookMap: {},
};
