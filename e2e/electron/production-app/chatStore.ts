import { create } from 'zustand';

interface ChatHarnessState {
  activeTopicId?: string;
  closeDocument: () => void;
  openDocument: (id: string) => void;
  portalDocumentId?: string;
  setActiveTopicId: (id?: string) => void;
}

export const useChatStore = create<ChatHarnessState>((set) => ({
  activeTopicId: undefined,
  closeDocument: () => set({ portalDocumentId: undefined }),
  openDocument: (portalDocumentId) => set({ portalDocumentId }),
  portalDocumentId: undefined,
  setActiveTopicId: (activeTopicId) => set({ activeTopicId }),
}));
