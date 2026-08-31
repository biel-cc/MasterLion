import { NewApiBindingModel } from '@/database/models/newApiBinding';
import type { LobeChatDatabase } from '@/database/type';
import type { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getWecomSsoConfig } from '@/server/services/enterprise/wecomSsoService';
import { NewApiService } from '@/server/services/newApi';
import {
  NewApiProvisioningAdapter,
  type ProvisionEnterpriseUserInput,
  type ProvisionEnterpriseUserResult,
  type ProvisioningPolicy,
} from '@/server/services/newApi/provisioningAdapter';

import { AihubReadiness, AihubReadinessError, type AihubReadinessWorkflow } from './index';
import {
  DatabaseAihubReadinessBindingStore,
  DatabaseAihubReadinessIdentitySource,
  DatabaseAihubReadinessLease,
  inspectAihubLocalRuntime,
} from './persistence';

type Provisioner = {
  provisionEnterpriseUser: (
    input: ProvisionEnterpriseUserInput,
  ) => Promise<ProvisionEnterpriseUserResult>;
};

type ProductionWorkflowOptions = {
  db: LobeChatDatabase;
  gateKeeper?: KeyVaultsGateKeeper;
  getPolicy?: () => Promise<ProvisioningPolicy>;
  inspectRuntime?: (userId: string) => Promise<{ hasApiKey: boolean; modelCount: number }>;
  provisionerFactory?: () => Provisioner;
  saveRemoteIdentifiers?: (
    userId: string,
    input: { managedTokenId: number; newApiUserId: number },
  ) => Promise<void>;
  syncModels?: (userId: string) => Promise<{ models: unknown[] }>;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const classifyProvisioningError = (error: unknown) => {
  if (error instanceof AihubReadinessError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('aihub_admin_') ||
    normalized.includes('aihub bridge is required') ||
    normalized.includes('aihub_bridge_') ||
    normalized.includes('is required for aihub provisioning')
  ) {
    return new AihubReadinessError(message, 'configuration', 'aihub_configuration_invalid');
  }
  if (
    normalized.includes('identity conflict') ||
    normalized.includes('username must match') ||
    normalized.includes('does not belong to user')
  ) {
    return new AihubReadinessError(message, 'identity_conflict', 'aihub_identity_conflict');
  }
  if (normalized.includes('accessible models') || normalized.includes('no aihub models')) {
    return new AihubReadinessError(message, 'entitlement', 'aihub_models_unavailable');
  }

  return new AihubReadinessError(message, 'transient', 'aihub_provisioning_failed');
};

export class ProductionAihubReadinessWorkflow implements AihubReadinessWorkflow {
  private readonly getPolicy: () => Promise<ProvisioningPolicy>;
  private readonly inspectRuntime: NonNullable<ProductionWorkflowOptions['inspectRuntime']>;
  private readonly provisionerFactory: () => Provisioner;
  private readonly saveRemoteIdentifiers: NonNullable<
    ProductionWorkflowOptions['saveRemoteIdentifiers']
  >;
  private readonly syncModels: NonNullable<ProductionWorkflowOptions['syncModels']>;

  constructor({
    db,
    gateKeeper,
    getPolicy,
    inspectRuntime = (userId) => inspectAihubLocalRuntime(db, userId, gateKeeper),
    provisionerFactory = () => new NewApiProvisioningAdapter(),
    saveRemoteIdentifiers = async (userId, identifiers) => {
      await new NewApiBindingModel(db, userId).upsertRemoteIdentifiers(identifiers);
    },
    syncModels = (userId) =>
      new NewApiService({ db, gateKeeper, userId }).syncModels() as Promise<{ models: unknown[] }>,
  }: ProductionWorkflowOptions) {
    this.getPolicy =
      getPolicy ??
      (async () => {
        const config = await getWecomSsoConfig(db);
        return { aihubProvisioning: config.config.aihubProvisioning };
      });
    this.inspectRuntime = inspectRuntime;
    this.provisionerFactory = provisionerFactory;
    this.saveRemoteIdentifiers = saveRemoteIdentifiers;
    this.syncModels = syncModels;
  }

  inspectLocalRuntime = async (userId: string) => this.inspectRuntime(userId);

  provision: AihubReadinessWorkflow['provision'] = async ({ binding, identity, userId }) => {
    try {
      const policy = await this.getPolicy();
      if (!policy.aihubProvisioning?.enabled) {
        throw new AihubReadinessError(
          'Aihub provisioning is disabled by enterprise policy',
          'entitlement',
          'aihub_provisioning_disabled',
        );
      }

      const provisioned = await this.provisionerFactory().provisionEnterpriseUser({
        email: identity.email,
        employeeNumber: identity.employeeNumber,
        masterinoUsername: identity.masterinoUsername,
        name: identity.name,
        policy,
        preferredManagedTokenId: binding?.managedTokenId ?? undefined,
        userId,
      });
      if (
        !isPositiveInteger(provisioned.newApiUserId) ||
        !isPositiveInteger(provisioned.managedTokenId)
      ) {
        throw new Error('Aihub provisioning did not return a valid user and managed token');
      }

      // Persist the remote identifiers before reading the token key. If this
      // process crashes here, the next ensure run resumes from these stable ids.
      await this.saveRemoteIdentifiers(userId, {
        managedTokenId: provisioned.managedTokenId,
        newApiUserId: provisioned.newApiUserId,
      });

      const synced = await this.syncModels(userId);
      const runtime = await this.inspectLocalRuntime(userId);
      const modelCount = Math.max(runtime.modelCount, synced.models.length);
      if (!runtime.hasApiKey || modelCount <= 0) {
        throw new AihubReadinessError(
          'No Aihub models or encrypted provider credential are available',
          'entitlement',
          'aihub_models_unavailable',
        );
      }

      const iam = provisioned.iamOAuthBinding;
      const iamOAuthBinding = iam
        ? iam.status === 'active'
          ? { status: 'active' as const }
          : {
              errorCode: iam.errorCode,
              errorMessage: iam.errorMessage,
              status: iam.status,
            }
        : undefined;

      return {
        iamOAuthBinding,
        managedTokenId: provisioned.managedTokenId,
        modelCount,
        models: synced.models,
        newApiUserId: provisioned.newApiUserId,
      };
    } catch (error) {
      throw classifyProvisioningError(error);
    }
  };
}

export const createAihubReadiness = (input: {
  db: LobeChatDatabase;
  gateKeeper?: KeyVaultsGateKeeper;
}) =>
  new AihubReadiness({
    bindingStore: new DatabaseAihubReadinessBindingStore(input.db),
    identitySource: new DatabaseAihubReadinessIdentitySource(input.db),
    lease: new DatabaseAihubReadinessLease(input.db),
    workflow: new ProductionAihubReadinessWorkflow(input),
  });
