import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { type ProjectWorkspaceService, projectWorkspaceService } from '@/services/projectWorkspace';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ProjectWorkspaceAction, projectWorkspaceSlice } from './action';
import { initialState, type ProjectWorkspaceState } from './initialState';

export interface ProjectWorkspaceStore extends ProjectWorkspaceState, ProjectWorkspaceAction {
  /* empty */
}

const createStore =
  (
    service: ProjectWorkspaceService,
  ): StateCreator<ProjectWorkspaceStore, [['zustand/devtools', never]]> =>
  (...parameters) => ({
    ...initialState,
    seamAvailable: service.isAvailable(),
    ...flattenActions<ProjectWorkspaceAction>([projectWorkspaceSlice(service)(...parameters)]),
  });

const devtools = createDevtools('projectWorkspace');

/** Factory used by tests to inject a fake router client. */
export const createProjectWorkspaceStore = (service: ProjectWorkspaceService) =>
  createWithEqualityFn<ProjectWorkspaceStore>()(devtools(createStore(service)), shallow);

export const useProjectWorkspaceStore = createProjectWorkspaceStore(projectWorkspaceService);

expose('projectWorkspace', useProjectWorkspaceStore);

export const getProjectWorkspaceStoreState = () => useProjectWorkspaceStore.getState();
