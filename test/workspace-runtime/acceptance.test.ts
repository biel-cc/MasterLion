import { registerWorkspaceRuntimeAcceptance } from './acceptanceAssertions';
import { acceptedRefWorkspaceRuntimeAdapter } from './acceptedRefAdapter';
import { referenceWorkspaceRuntimeAdapter } from './referenceAdapter';

registerWorkspaceRuntimeAcceptance(
  'workspace runtime reference contract',
  referenceWorkspaceRuntimeAdapter,
);
registerWorkspaceRuntimeAcceptance(
  'workspace runtime accepted-ref production seams',
  acceptedRefWorkspaceRuntimeAdapter,
);
