import { createContext, useContext } from 'react';
import type { DataMode, WorkspaceLoadScope, WorkspaceRepository } from './workspace-repository';
import type { WorkspaceData } from './workspace-schema';

export interface WorkspaceContextValue {
  data: WorkspaceData;
  repository: WorkspaceRepository;
  mode: DataMode;
  source: string;
  receivedAt: string;
  loadScope: WorkspaceLoadScope;
  deferredLoading: boolean;
  deferredError: string;
  loadDeferred: () => Promise<void>;
  switchMode: (mode: DataMode) => void;
  reload: () => void;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace provider is missing');
  return value;
}