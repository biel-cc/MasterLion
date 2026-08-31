// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enterpriseAuditLogs,
  enterpriseDepartmentMembers,
  enterpriseDepartments,
  enterpriseUserProfiles,
  externalIdentities,
  newApiBindings,
} from '@/database/schemas';

import {
  IdentityProvisioningService,
  provisionFromSsoProfile,
} from './identityProvisioningService';

const defaultPolicy = {
  aihubProvisioning: {
    autoCreateUser: true,
    enabled: true,
    initialQuota: 1000,
    lookupField: 'employeeNumber',
    managedTokenName: 'masterlion-managed',
    managedTokenQuota: 200,
    managedTokenUnlimitedQuota: false,
    userGroup: 'staff',
  },
  defaultRole: 'member',
  defaultWorkspaceId: 'workspace_001',
};

const defaultProfile = {
  departmentExternalIds: ['dept-ext-primary', 'dept-ext-secondary'],
  email: 'ada@example.com',
  employeeNumber: 'E-1001',
  externalUserId: 'wecom-ada',
  name: 'Ada Lovelace',
  policy: defaultPolicy,
  position: 'Principal Engineer',
  provider: 'wecom',
  rawProfile: {
    department: ['dept-ext-primary', 'dept-ext-secondary'],
    userid: 'wecom-ada',
  },
  unionId: 'union-ada',
  userId: 'user-ada',
};

const newApiProvisioningAdapterMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  provisionEnterpriseUser: vi.fn(),
}));

vi.mock('../newApi/provisioningAdapter', () => ({
  NewApiProvisioningAdapter: vi.fn().mockImplementation((options) => {
    newApiProvisioningAdapterMock.constructor(options);

    return {
      provisionEnterpriseUser: newApiProvisioningAdapterMock.provisionEnterpriseUser,
    };
  }),
}));

type DbWriteOperation = {
  conflict?: {
    set?: Record<string, unknown>;
    target?: unknown;
  };
  table: unknown;
  type: 'insert' | 'update';
  values?: unknown;
};

const createInsertReturnRows = (table: unknown, values: unknown) => {
  const firstValue = Array.isArray(values) ? values[0] : values;

  if (table === externalIdentities) {
    return [{ id: 'xid-1', ...(firstValue as Record<string, unknown>) }];
  }

  if (table === enterpriseUserProfiles) {
    return [{ ...(firstValue as Record<string, unknown>) }];
  }

  if (table === enterpriseDepartments) {
    const rows = Array.isArray(values) ? values : [firstValue];

    return rows.map((value) => {
      const row = value as Record<string, unknown>;
      const externalDepartmentId = String(row.externalDepartmentId);

      return {
        id: `dept-created-${externalDepartmentId}`,
        ...row,
      };
    });
  }

  if (table === enterpriseDepartmentMembers) {
    return Array.isArray(values) ? values : [firstValue];
  }

  if (table === newApiBindings) {
    return [{ ...(firstValue as Record<string, unknown>) }];
  }

  if (table === enterpriseAuditLogs) {
    return [{ id: 'audit-1', ...(firstValue as Record<string, unknown>) }];
  }

  return Array.isArray(values) ? values : [firstValue];
};

const createRecordingDb = (
  options: {
    departments?: Array<{
      externalDepartmentId: string;
      id: string;
      provider: string;
      status?: string;
    }>;
    failAuditActions?: string[];
    existingNewApiUserId?: number;
    userRow?: { email?: string | null; username?: string | null };
  } = {},
) => {
  const operations: DbWriteOperation[] = [];
  const departments = options.departments ?? [
    {
      externalDepartmentId: 'dept-ext-secondary',
      id: 'dept-secondary',
      provider: 'wecom',
      status: 'active',
    },
    {
      externalDepartmentId: 'dept-ext-primary',
      id: 'dept-primary',
      provider: 'wecom',
      status: 'active',
    },
  ];

  const insert = vi.fn((table: unknown) => {
    const operation: DbWriteOperation = { table, type: 'insert' };
    operations.push(operation);

    const chain = {
      onConflictDoUpdate: vi.fn((conflict: DbWriteOperation['conflict']) => {
        operation.conflict = conflict;
        return chain;
      }),
      returning: vi.fn(async () => {
        const values = Array.isArray(operation.values) ? operation.values : [operation.values];
        const shouldFailAudit =
          table === enterpriseAuditLogs &&
          values.some((value) =>
            options.failAuditActions?.includes(
              (value as Record<string, unknown>)?.action as string,
            ),
          );
        if (shouldFailAudit) {
          throw new Error('Audit log write failed');
        }

        return createInsertReturnRows(table, operation.values);
      }),
      values: vi.fn((values: unknown) => {
        operation.values = values;
        return chain;
      }),
    };

    return chain;
  });

  const update = vi.fn((table: unknown) => {
    const operation: DbWriteOperation = { table, type: 'update' };
    operations.push(operation);

    const chain = {
      returning: vi.fn(async () => createInsertReturnRows(table, operation.values)),
      set: vi.fn((values: unknown) => {
        operation.values = values;
        return chain;
      }),
      where: vi.fn(() => chain),
    };

    return chain;
  });

  const query: Record<string, any> = {
    enterpriseDepartments: {
      findMany: vi.fn(async () => departments),
    },
  };

  if (options.existingNewApiUserId !== undefined) {
    query.newApiBindings = {
      findFirst: vi.fn(async () => ({ newApiUserId: options.existingNewApiUserId })),
    };
  }

  if (options.userRow !== undefined) {
    query.users = {
      findFirst: vi.fn(async () => options.userRow ?? undefined),
    };
  }

  return {
    db: {
      insert,
      query,
      update,
    },
    departments,
    operations,
  };
};

const findInsert = (operations: DbWriteOperation[], table: unknown) => {
  const operation = operations.find((item) => item.type === 'insert' && item.table === table);

  expect(operation).toBeDefined();

  return operation as DbWriteOperation;
};

const findWrites = (operations: DbWriteOperation[], table: unknown) =>
  operations.filter((item) => item.table === table);

const flattenValues = (operations: DbWriteOperation[]) =>
  operations.flatMap((operation) => {
    if (Array.isArray(operation.values)) return operation.values;
    if (operation.values) return [operation.values];

    return [];
  });

const createAihubAdapter = (result?: Record<string, unknown>) => ({
  ensureUserQuota: vi.fn(async () => undefined),
  provisionEnterpriseUser: vi.fn(async () => ({
    managedTokenId: 8001,
    newApiUserId: 9001,
    status: 'active',
    ...result,
  })),
});

const createRoleAssigner = () => ({
  assignDefaultRole: vi.fn(async () => undefined),
});

const createWorkspaceAssigner = () => ({
  assignDefaultWorkspace: vi.fn(async () => undefined),
});

describe('identityProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AIHUB_ADMIN_ACCESS_TOKEN = 'test-admin-token';
    process.env.AIHUB_ADMIN_USER_ID = '1';
    newApiProvisioningAdapterMock.provisionEnterpriseUser.mockResolvedValue({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
  });

  afterEach(() => {
    delete process.env.AIHUB_ADMIN_ACCESS_TOKEN;
    delete process.env.AIHUB_ADMIN_USER_ID;
  });

  it('exports the service class and top-level provisioning function', () => {
    const { db } = createRecordingDb();
    const adapter = createAihubAdapter();
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    expect(IdentityProvisioningService).toBeTypeOf('function');
    expect(service.provisionFromSsoProfile).toBeTypeOf('function');
    expect(provisionFromSsoProfile).toBeTypeOf('function');
  });

  it('keeps top-level identity provisioning independent from Aihub readiness', async () => {
    const { db, operations } = createRecordingDb();

    await expect(provisionFromSsoProfile({ ...defaultProfile, db })).resolves.toMatchObject({
      userId: 'user-ada',
    });

    expect(newApiProvisioningAdapterMock.constructor).not.toHaveBeenCalled();
    expect(findWrites(operations, newApiBindings)).toHaveLength(0);
  });

  it('does not perform Aihub lookup while syncing an identity with no email', async () => {
    const { db } = createRecordingDb({
      userRow: { username: '10003923', email: 'you.yan@example.com' },
    });
    const adapter = createAihubAdapter();
    const service = new IdentityProvisioningService({ aihubProvisioningAdapter: adapter, db });

    await service.provisionFromSsoProfile({
      ...defaultProfile,
      email: undefined, // WeCom profile has no email
    });

    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
  });

  it('does not require Aihub administrator configuration to write enterprise identity', async () => {
    const { db, operations } = createRecordingDb();
    newApiProvisioningAdapterMock.constructor.mockImplementationOnce(() => {
      throw new Error('AIHUB_ADMIN_ACCESS_TOKEN is required for Aihub provisioning');
    });

    await expect(provisionFromSsoProfile({ ...defaultProfile, db })).resolves.toMatchObject({
      enterpriseProfile: expect.objectContaining({
        userId: 'user-ada',
      }),
      externalIdentity: expect.objectContaining({
        provider: 'wecom',
        userId: 'user-ada',
      }),
      userId: 'user-ada',
    });

    expect(db.insert).toHaveBeenCalledWith(externalIdentities);
    expect(db.insert).toHaveBeenCalledWith(enterpriseUserProfiles);
    expect(findWrites(operations, newApiBindings)).toHaveLength(0);
  });

  it('leaves balance repair to AihubReadiness even when an old binding exists', async () => {
    const { db } = createRecordingDb({ existingNewApiUserId: 9001 });
    const adapter = createAihubAdapter();
    adapter.provisionEnterpriseUser.mockRejectedValue(new Error('duplicate username'));
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    const result = await service.provisionFromSsoProfile(defaultProfile);

    expect(result).not.toHaveProperty('aihub');
    expect(adapter.ensureUserQuota).not.toHaveBeenCalled();
  });

  it('does not call ensureUserQuota when there is no prior newApiUserId', async () => {
    const { db } = createRecordingDb();
    const adapter = createAihubAdapter();
    adapter.provisionEnterpriseUser.mockRejectedValue(new Error('create failed'));
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    await service.provisionFromSsoProfile(defaultProfile);

    expect(adapter.ensureUserQuota).not.toHaveBeenCalled();
  });

  it('upserts normalized SSO identity and memberships without touching Aihub state', async () => {
    const { db, operations } = createRecordingDb();
    const adapter = createAihubAdapter();
    const roleAssigner = createRoleAssigner();
    const workspaceAssigner = createWorkspaceAssigner();
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
      roleAssigner,
      workspaceAssigner,
    });

    const result = await service.provisionFromSsoProfile(defaultProfile);

    expect(db.insert).toHaveBeenCalledWith(externalIdentities);
    const externalIdentityInsert = findInsert(operations, externalIdentities);
    expect(externalIdentityInsert.values).toMatchObject({
      email: 'ada@example.com',
      externalUserId: 'wecom-ada',
      provider: 'wecom',
      rawProfile: defaultProfile.rawProfile,
      unionId: 'union-ada',
      userId: 'user-ada',
    });
    expect(externalIdentityInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        email: 'ada@example.com',
        rawProfile: defaultProfile.rawProfile,
        unionId: 'union-ada',
        userId: 'user-ada',
      }),
      target: [externalIdentities.provider, externalIdentities.externalUserId],
    });

    const profileWrites = findWrites(operations, enterpriseUserProfiles);
    const profileValues = flattenValues(profileWrites);
    expect(db.insert).toHaveBeenCalledWith(enterpriseUserProfiles);
    expect(profileValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeNumber: 'E-1001',
          externalUserId: 'wecom-ada',
          position: 'Principal Engineer',
          primaryDepartmentId: 'dept-primary',
          provider: 'wecom',
          rawProfile: defaultProfile.rawProfile,
          userId: 'user-ada',
        }),
      ]),
    );
    expect(profileValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lastSyncedAt: expect.any(Date),
        }),
      ]),
    );

    expect(db.query.enterpriseDepartments.findMany).toHaveBeenCalledWith(expect.any(Object));
    expect(db.insert).toHaveBeenCalledWith(enterpriseDepartmentMembers);
    const membershipRows = flattenValues(findWrites(operations, enterpriseDepartmentMembers));
    expect(membershipRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: 'dept-primary',
          isPrimary: true,
          status: 'active',
          userId: 'user-ada',
        }),
        expect.objectContaining({
          departmentId: 'dept-secondary',
          isPrimary: false,
          status: 'active',
          userId: 'user-ada',
        }),
      ]),
    );
    const membershipInsert = findInsert(operations, enterpriseDepartmentMembers);
    expect(membershipInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        isPrimary: expect.any(Boolean),
        status: 'active',
      }),
      target: [enterpriseDepartmentMembers.departmentId, enterpriseDepartmentMembers.userId],
    });

    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
    expect(roleAssigner.assignDefaultRole).toHaveBeenCalledWith({
      roleName: 'member',
      userId: 'user-ada',
    });
    expect(workspaceAssigner.assignDefaultWorkspace).toHaveBeenCalledWith({
      role: 'member',
      userId: 'user-ada',
      workspaceId: 'workspace_001',
    });
    expect(findWrites(operations, newApiBindings)).toHaveLength(0);

    const auditInsert = findInsert(operations, enterpriseAuditLogs);
    expect(auditInsert.values).toMatchObject({
      action: 'identity.provision.success',
      result: 'success',
      targetId: 'user-ada',
      targetType: 'user',
    });

    expect(result).toMatchObject({
      departmentIds: ['dept-primary', 'dept-secondary'],
      enterpriseProfile: expect.objectContaining({
        employeeNumber: 'E-1001',
        primaryDepartmentId: 'dept-primary',
        userId: 'user-ada',
      }),
      externalIdentity: expect.objectContaining({
        externalUserId: 'wecom-ada',
        provider: 'wecom',
        userId: 'user-ada',
      }),
      userId: 'user-ada',
      workspace: {
        status: 'active',
        workspaceId: 'workspace_001',
      },
    });
  });

  it('ignores legacy Aihub adapters while preserving profile sync', async () => {
    const { db, operations } = createRecordingDb();
    const adapter = {
      provisionEnterpriseUser: vi.fn(async () => {
        throw new Error('NewAPI quota service timed out');
      }),
    };
    const roleAssigner = createRoleAssigner();
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
      roleAssigner,
    });

    await expect(service.provisionFromSsoProfile(defaultProfile)).resolves.toMatchObject({
      departmentIds: ['dept-primary', 'dept-secondary'],
      enterpriseProfile: expect.objectContaining({
        primaryDepartmentId: 'dept-primary',
        userId: 'user-ada',
      }),
      externalIdentity: expect.objectContaining({
        provider: 'wecom',
        userId: 'user-ada',
      }),
      userId: 'user-ada',
    });

    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
    expect(roleAssigner.assignDefaultRole).toHaveBeenCalledWith({
      roleName: 'member',
      userId: 'user-ada',
    });
    expect(db.insert).toHaveBeenCalledWith(externalIdentities);
    expect(db.insert).toHaveBeenCalledWith(enterpriseUserProfiles);
    expect(db.insert).toHaveBeenCalledWith(enterpriseDepartmentMembers);

    expect(findWrites(operations, newApiBindings)).toHaveLength(0);

    const auditInsert = findInsert(operations, enterpriseAuditLogs);
    expect(auditInsert.values).toMatchObject({
      action: 'identity.provision.success',
      result: 'success',
      targetId: 'user-ada',
      targetType: 'user',
    });
    expect(auditInsert.values).toMatchObject({
      metadata: expect.objectContaining({ provider: 'wecom' }),
    });
  });

  it('does not assign a default workspace when the policy does not include one', async () => {
    const { db } = createRecordingDb();
    const workspaceAssigner = createWorkspaceAssigner();
    const service = new IdentityProvisioningService({
      db,
      workspaceAssigner,
    });
    const { defaultWorkspaceId: _, ...policyWithoutWorkspace } = defaultPolicy;

    await service.provisionFromSsoProfile({
      ...defaultProfile,
      policy: policyWithoutWorkspace,
    });

    expect(workspaceAssigner.assignDefaultWorkspace).not.toHaveBeenCalled();
  });

  it('auto-creates missing departments during login department sync before assigning memberships', async () => {
    const { db, operations } = createRecordingDb({
      departments: [
        {
          externalDepartmentId: 'dept-ext-primary',
          id: 'dept-primary',
          provider: 'wecom',
          status: 'active',
        },
      ],
    });
    const service = new IdentityProvisioningService({
      db,
    });

    await expect(
      service.provisionFromSsoProfile({
        ...defaultProfile,
        departmentExternalIds: ['dept-ext-primary', 'dept-ext-missing'],
        policy: {
          ...defaultPolicy,
          departmentSync: {
            enabled: true,
            mode: 'login',
          },
        },
      }),
    ).resolves.toMatchObject({
      departmentIds: ['dept-primary', 'dept-created-dept-ext-missing'],
      enterpriseProfile: expect.objectContaining({
        primaryDepartmentId: 'dept-primary',
      }),
    });

    const departmentValues = flattenValues(findWrites(operations, enterpriseDepartments));
    expect(departmentValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalDepartmentId: 'dept-ext-missing',
          name: 'dept-ext-missing',
          provider: 'wecom',
          status: 'active',
        }),
      ]),
    );
    const departmentInsert = findInsert(operations, enterpriseDepartments);
    expect(departmentInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        status: 'active',
      }),
      target: [enterpriseDepartments.provider, enterpriseDepartments.externalDepartmentId],
    });

    const membershipRows = flattenValues(findWrites(operations, enterpriseDepartmentMembers));
    expect(membershipRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: 'dept-primary',
          isPrimary: true,
          userId: 'user-ada',
        }),
        expect.objectContaining({
          departmentId: 'dept-created-dept-ext-missing',
          isPrimary: false,
          userId: 'user-ada',
        }),
      ]),
    );
  });

  it.each([
    {
      departmentSync: {
        enabled: true,
      },
      expectedDepartmentIds: ['dept-primary', 'dept-created-dept-ext-missing'],
      expectedMissingMembership: true,
      label: 'enabled without an explicit mode',
    },
    {
      departmentSync: {
        enabled: false,
        mode: 'login',
      },
      expectedDepartmentIds: ['dept-primary'],
      expectedMissingMembership: false,
      label: 'disabled',
    },
    {
      departmentSync: {
        enabled: true,
        mode: 'manual',
      },
      expectedDepartmentIds: ['dept-primary'],
      expectedMissingMembership: false,
      label: 'manual',
    },
    {
      departmentSync: {
        enabled: true,
        mode: 'scheduled',
      },
      expectedDepartmentIds: ['dept-primary'],
      expectedMissingMembership: false,
      label: 'not in login mode',
    },
  ])(
    'handles missing departments when department sync is $label',
    async ({ departmentSync, expectedDepartmentIds, expectedMissingMembership }) => {
      const { db, operations } = createRecordingDb({
        departments: [
          {
            externalDepartmentId: 'dept-ext-primary',
            id: 'dept-primary',
            provider: 'wecom',
            status: 'active',
          },
        ],
      });
      const service = new IdentityProvisioningService({
        db,
      });

      await expect(
        service.provisionFromSsoProfile({
          ...defaultProfile,
          departmentExternalIds: ['dept-ext-primary', 'dept-ext-missing'],
          policy: {
            ...defaultPolicy,
            departmentSync,
          },
        }),
      ).resolves.toMatchObject({
        departmentIds: expectedDepartmentIds,
        enterpriseProfile: expect.objectContaining({
          primaryDepartmentId: 'dept-primary',
        }),
      });

      if (expectedMissingMembership) {
        expect(flattenValues(findWrites(operations, enterpriseDepartments))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              externalDepartmentId: 'dept-ext-missing',
              provider: 'wecom',
            }),
          ]),
        );
      } else {
        expect(findWrites(operations, enterpriseDepartments)).toHaveLength(0);
      }

      const membershipRows = flattenValues(findWrites(operations, enterpriseDepartmentMembers));
      expect(membershipRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            departmentId: 'dept-primary',
            isPrimary: true,
            userId: 'user-ada',
          }),
        ]),
      );
      if (expectedMissingMembership) {
        expect(membershipRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              departmentId: 'dept-created-dept-ext-missing',
              userId: 'user-ada',
            }),
          ]),
        );
      } else {
        expect(membershipRows).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              departmentId: 'dept-created-dept-ext-missing',
            }),
          ]),
        );
      }
    },
  );

  it('records a workspace provisioning audit failure without invoking Aihub provisioning', async () => {
    const { db, operations } = createRecordingDb();
    const adapter = createAihubAdapter();
    const workspaceAssigner = {
      assignDefaultWorkspace: vi.fn(async () => {
        throw new Error('Default workspace was not found');
      }),
    };
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
      workspaceAssigner,
    });

    await expect(service.provisionFromSsoProfile(defaultProfile)).resolves.toMatchObject({
      userId: 'user-ada',
      workspace: {
        error: 'Default workspace was not found',
        status: 'error',
      },
    });

    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
    expect(workspaceAssigner.assignDefaultWorkspace).toHaveBeenCalledWith({
      role: 'member',
      userId: 'user-ada',
      workspaceId: 'workspace_001',
    });
    const auditValues = flattenValues(findWrites(operations, enterpriseAuditLogs));
    expect(auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'identity.provision.workspace_error',
          result: 'failed',
          targetId: 'user-ada',
          targetType: 'user',
        }),
      ]),
    );
  });

  it('does not interpret legacy adapter output inside identity provisioning', async () => {
    const { db, operations } = createRecordingDb();
    const adapter = {
      provisionEnterpriseUser: vi.fn(async () => ({
        managedTokenId: 8001,
        status: 'active',
      })),
    };
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    await expect(service.provisionFromSsoProfile(defaultProfile)).resolves.toMatchObject({
      userId: 'user-ada',
    });

    const bindingValues = flattenValues(findWrites(operations, newApiBindings));
    expect(bindingValues).toHaveLength(0);
    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
  });

  it('never normalizes adapter statuses in the identity-only service', async () => {
    const { db, operations } = createRecordingDb();
    const adapter = createAihubAdapter({
      status: 'failed',
    });
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    const result = await service.provisionFromSsoProfile(defaultProfile);

    expect(result).not.toHaveProperty('aihub');
    expect(findWrites(operations, newApiBindings)).toHaveLength(0);
    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
  });

  it('does not touch an active NewAPI binding when identity audit logging fails', async () => {
    const { db, operations } = createRecordingDb({
      failAuditActions: ['identity.provision.success'],
    });
    const adapter = createAihubAdapter();
    const service = new IdentityProvisioningService({
      aihubProvisioningAdapter: adapter,
      db,
    });

    await expect(service.provisionFromSsoProfile(defaultProfile)).resolves.toMatchObject({
      userId: 'user-ada',
    });

    const bindingValues = flattenValues(findWrites(operations, newApiBindings));
    expect(bindingValues).toHaveLength(0);
    expect(adapter.provisionEnterpriseUser).not.toHaveBeenCalled();
  });
});
