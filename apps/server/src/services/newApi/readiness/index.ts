export type AihubReadinessTrigger =
  | 'admin_reconcile'
  | 'better_auth_account'
  | 'better_auth_session'
  | 'manual_model_sync'
  | 'manual_retry'
  | 'model_runtime'
  | 'oidc_authorized';

export type AihubReadinessErrorKind =
  | 'configuration'
  | 'entitlement'
  | 'identity_conflict'
  | 'permanent'
  | 'transient';

export class AihubReadinessError extends Error {
  readonly code: string;
  readonly kind: AihubReadinessErrorKind;

  constructor(message: string, kind: AihubReadinessErrorKind, code: string) {
    super(message);
    this.name = 'AihubReadinessError';
    this.code = code;
    this.kind = kind;
  }
}

export type AihubIamBindingState = {
  errorCode?: string | null;
  errorMessage?: string | null;
  status: 'active' | 'conflict' | 'error' | 'pending' | 'unknown';
};

export type AihubReadinessState = {
  errorCode?: string | null;
  errorKind?: AihubReadinessErrorKind | null;
  errorMessage?: string | null;
  iamOAuthBinding?: AihubIamBindingState;
  isBound: boolean;
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  managedTokens?: Array<{ id: number; name: string }>;
  modelCount?: number;
  models?: unknown[];
  newApiUserId?: number;
  oauthBinding?: AihubIamBindingState;
  readinessVersion?: number;
  retryAfterMs?: number;
  retryable?: boolean;
  status: 'active' | 'error' | 'missing' | 'pending';
};

export type EnterpriseIdentity = {
  email?: string;
  employeeNumber?: string;
  employmentStatus?: string;
  masterinoUsername?: string;
  name?: string;
};

export type AihubReadinessBindingRecord = {
  attemptCount?: number | null;
  errorCode?: string | null;
  errorKind?: AihubReadinessErrorKind | null;
  errorMessage?: string | null;
  iamOAuthBindingError?: string | null;
  iamOAuthBindingErrorCode?: string | null;
  iamOAuthBindingStatus?: AihubIamBindingState['status'];
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  newApiUserId?: number | null;
  nextRetryAt?: Date | null;
  readinessVersion?: number | null;
  status: 'active' | 'error' | 'pending';
};

const RETRY_DELAYS_MS = [3000, 10_000, 30_000, 120_000, 300_000] as const;

const getRetryDelay = (attemptCount: number | null | undefined) =>
  RETRY_DELAYS_MS[Math.min(Math.max((attemptCount ?? 1) - 1, 0), RETRY_DELAYS_MS.length - 1)];

export type AihubReadinessBindingStore = {
  get: (userId: string) => Promise<AihubReadinessBindingRecord | undefined>;
  markActive: (
    userId: string,
    input: {
      managedTokenId: number;
      modelCount: number;
      newApiUserId: number;
      readinessVersion: 2;
    },
  ) => Promise<void>;
  markError: (
    userId: string,
    input: {
      errorCode: string;
      errorKind: AihubReadinessErrorKind;
      errorMessage: string;
      nextRetryAt?: Date | null;
    },
  ) => Promise<void>;
  markPending: (userId: string, input: { trigger: AihubReadinessTrigger }) => Promise<void>;
  updateIamBinding: (userId: string, state: AihubIamBindingState) => Promise<void>;
};

export type AihubReadinessIdentitySource = {
  getEnterpriseIdentity: (userId: string) => Promise<EnterpriseIdentity | undefined>;
};

export type AihubReadinessLease = {
  acquire: (
    userId: string,
    requestedOwnerId: string,
  ) => Promise<{ expiresAt: Date; ownerId: string } | undefined>;
  release: (userId: string, ownerId: string) => Promise<void>;
};

export type AihubReadinessWorkflow = {
  inspectLocalRuntime: (userId: string) => Promise<{ hasApiKey: boolean; modelCount: number }>;
  provision: (input: {
    binding?: AihubReadinessBindingRecord;
    identity: EnterpriseIdentity;
    repairIamBinding?: boolean;
    trigger: AihubReadinessTrigger;
    userId: string;
  }) => Promise<{
    iamOAuthBinding?: AihubIamBindingState;
    managedTokenId: number;
    modelCount: number;
    models?: unknown[];
    newApiUserId: number;
  }>;
};

export type AihubReadinessOptions = {
  bindingStore: AihubReadinessBindingStore;
  identitySource: AihubReadinessIdentitySource;
  lease: AihubReadinessLease;
  now?: () => Date;
  randomId?: () => string;
  workflow: AihubReadinessWorkflow;
};

export type EnsureAihubReadinessOptions = {
  force?: boolean;
  repairIamBinding?: boolean;
  trigger: AihubReadinessTrigger;
};

const toState = (
  binding: AihubReadinessBindingRecord | undefined,
  runtime?: { hasApiKey: boolean; modelCount: number },
): AihubReadinessState => {
  if (!binding) return { isBound: false, status: 'missing' };

  const newApiUserId =
    typeof binding.newApiUserId === 'number' && binding.newApiUserId > 0
      ? binding.newApiUserId
      : undefined;
  const active =
    binding.status === 'active' &&
    Boolean(newApiUserId) &&
    Boolean(binding.managedTokenId) &&
    Boolean(runtime?.hasApiKey) &&
    (runtime?.modelCount ?? 0) > 0;

  return {
    errorCode: binding.errorCode,
    errorKind: binding.errorKind,
    errorMessage: binding.errorMessage,
    iamOAuthBinding: {
      errorCode: binding.iamOAuthBindingErrorCode,
      errorMessage: binding.iamOAuthBindingError,
      status: binding.iamOAuthBindingStatus ?? 'unknown',
    },
    isBound: active,
    lastSyncedAt: binding.lastSyncedAt,
    managedTokenId: binding.managedTokenId,
    managedTokens: binding.managedTokenId
      ? [{ id: binding.managedTokenId, name: `Token #${binding.managedTokenId}` }]
      : [],
    modelCount: runtime?.modelCount ?? 0,
    newApiUserId,
    readinessVersion: binding.readinessVersion ?? 1,
    retryable: binding.errorKind === 'transient',
    status: active ? 'active' : binding.status === 'error' ? 'error' : 'pending',
    oauthBinding: {
      errorCode: binding.iamOAuthBindingErrorCode,
      errorMessage: binding.iamOAuthBindingError,
      status: binding.iamOAuthBindingStatus ?? 'unknown',
    },
  };
};

export class AihubReadiness {
  private bindingStore: AihubReadinessBindingStore;
  private identitySource: AihubReadinessIdentitySource;
  private lease: AihubReadinessLease;
  private now: () => Date;
  private randomId: () => string;
  private workflow: AihubReadinessWorkflow;

  constructor({
    bindingStore,
    identitySource,
    lease,
    now = () => new Date(),
    randomId = () => crypto.randomUUID(),
    workflow,
  }: AihubReadinessOptions) {
    this.bindingStore = bindingStore;
    this.identitySource = identitySource;
    this.lease = lease;
    this.now = now;
    this.randomId = randomId;
    this.workflow = workflow;
  }

  async get(userId: string): Promise<AihubReadinessState> {
    const [binding, runtime] = await Promise.all([
      this.bindingStore.get(userId),
      this.workflow.inspectLocalRuntime(userId),
    ]);

    return toState(binding, runtime);
  }

  async ensure(userId: string, options: EnsureAihubReadinessOptions): Promise<AihubReadinessState> {
    const current = await this.get(userId);
    if (current.status === 'active' && (current.readinessVersion ?? 1) >= 2 && !options.force)
      return current;

    const binding = await this.bindingStore.get(userId);
    if (
      !options.force &&
      binding?.nextRetryAt &&
      binding.nextRetryAt > this.now() &&
      binding.errorKind === 'transient'
    ) {
      return {
        ...current,
        retryAfterMs: binding.nextRetryAt.getTime() - this.now().getTime(),
        retryable: true,
      };
    }

    const requestedOwnerId = this.randomId();
    const acquired = await this.lease.acquire(userId, requestedOwnerId);
    if (!acquired) return { ...current, isBound: false, status: 'pending' };

    try {
      await this.bindingStore.markPending(userId, { trigger: options.trigger });
      const identity = await this.identitySource.getEnterpriseIdentity(userId);
      const identityError = this.validateIdentity(identity);
      if (identityError) {
        await this.bindingStore.markError(userId, identityError);
        return {
          ...identityError,
          isBound: false,
          retryable: identityError.errorKind === 'transient',
          status: 'error',
        };
      }

      const resources = await this.workflow.provision({
        binding,
        identity: identity!,
        repairIamBinding: options.repairIamBinding,
        trigger: options.trigger,
        userId,
      });

      await this.bindingStore.markActive(userId, {
        managedTokenId: resources.managedTokenId,
        modelCount: resources.modelCount,
        newApiUserId: resources.newApiUserId,
        readinessVersion: 2,
      });
      if (resources.iamOAuthBinding) {
        try {
          await this.bindingStore.updateIamBinding(userId, resources.iamOAuthBinding);
        } catch (error) {
          console.warn('[Aihub Readiness] Failed to persist secondary IAM state:', error);
        }
      }

      return {
        iamOAuthBinding: resources.iamOAuthBinding ?? { status: 'unknown' },
        isBound: true,
        managedTokenId: resources.managedTokenId,
        managedTokens: [
          { id: resources.managedTokenId, name: `Token #${resources.managedTokenId}` },
        ],
        modelCount: resources.modelCount,
        models: resources.models,
        newApiUserId: resources.newApiUserId,
        oauthBinding: resources.iamOAuthBinding ?? { status: 'unknown' },
        readinessVersion: 2,
        retryable: false,
        status: 'active',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const classified =
        error instanceof AihubReadinessError
          ? error
          : new AihubReadinessError(errorMessage, 'transient', 'aihub_provisioning_failed');
      const retryDelay =
        classified.kind === 'transient'
          ? getRetryDelay((binding?.attemptCount ?? 0) + 1)
          : undefined;
      const failure = {
        errorCode: classified.code,
        errorKind: classified.kind,
        errorMessage,
        nextRetryAt: retryDelay ? new Date(this.now().getTime() + retryDelay) : null,
      };
      await this.bindingStore.markError(userId, failure);

      return {
        ...failure,
        isBound: false,
        retryAfterMs: retryDelay,
        retryable: classified.kind === 'transient',
        status: 'error',
      };
    } finally {
      try {
        await this.lease.release(userId, acquired.ownerId);
      } catch (error) {
        console.warn('[Aihub Readiness] Failed to release readiness lease:', error);
      }
    }
  }

  private validateIdentity(identity: EnterpriseIdentity | undefined) {
    if (!identity?.employeeNumber) {
      return {
        errorCode: 'enterprise_identity_not_ready',
        errorKind: 'transient' as const,
        errorMessage: 'Enterprise employee number is not ready',
        nextRetryAt: new Date(this.now().getTime() + 3000),
      };
    }
    if (identity.employmentStatus !== 'active') {
      return {
        errorCode: 'employment_inactive',
        errorKind: 'permanent' as const,
        errorMessage: 'Enterprise employment status is not active',
        nextRetryAt: null,
      };
    }
    if (identity.masterinoUsername !== identity.employeeNumber) {
      return {
        errorCode: 'masterino_username_mismatch',
        errorKind: 'identity_conflict' as const,
        errorMessage: 'Masterino username does not match enterprise employee number',
        nextRetryAt: null,
      };
    }
  }
}
