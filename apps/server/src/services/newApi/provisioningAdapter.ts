import { NewApiBridgeClient, NewApiBridgeError, type OAuthBindingResult } from './bridgeClient';
import {
  NewApiClient,
  type NewApiCreateUserInput,
  NewApiError,
  type NewApiManagementAuth,
  type NewApiToken,
  type NewApiUpdateUserInput,
  type NewApiUser,
} from './client';

type LookupField = 'email' | 'employeeNumber' | 'name';

export type AihubProvisioningPolicy = {
  autoCreateUser?: boolean;
  enabled?: boolean;
  initialQuota?: number;
  lookupField?: string;
  managedTokenName?: string;
  managedTokenQuota?: number;
  managedTokenUnlimitedQuota?: boolean;
  userGroup?: string;
};

export type ProvisioningPolicy = {
  aihubProvisioning?: AihubProvisioningPolicy;
  defaultRole?: string;
  [key: string]: unknown;
};

export type ProvisionEnterpriseUserInput = {
  email?: string;
  employeeNumber?: string;
  masterinoUsername?: string;
  name?: string;
  policy: ProvisioningPolicy;
  preferredManagedTokenId?: number;
  userId: string;
};

export type ProvisionEnterpriseUserResult = {
  iamOAuthBinding?: ProvisionOAuthBindingResult;
  managedTokenId?: number;
  newApiUserId?: number;
  status?: unknown;
  [key: string]: unknown;
};

export type ProvisionOAuthBindingResult =
  | { outcome: OAuthBindingResult['status']; status: 'active' }
  | { errorCode: string; errorMessage: string; status: 'conflict' | 'error' };

type ProvisioningClient = Pick<
  NewApiClient,
  'createToken' | 'createUser' | 'listTokens' | 'searchUsers' | 'updateUser'
>;

type NewApiProvisioningAdapterOptions = {
  adminAuth?: NewApiManagementAuth;
  bridgeClient?: NewApiBridgeClient;
  client?: ProvisioningClient;
};

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();
  return trimmed || undefined;
};

const isValidId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

// Bug 4: NewAPI requires a password on user creation (max 20 chars). SSO
// users never use it to log in to Aihub directly (they use managed tokens),
// so a random password is generated and discarded. 20 chars of base36 = ~103
// bits of entropy, well beyond any brute-force threshold for a throwaway.
const generateRandomPassword = (): string => {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // base36 keeps it alphanumeric, guaranteed to fit within 20 chars
  return Array.from(bytes, (b) => b.toString(36))
    .join('')
    .slice(0, 20)
    .padEnd(20, '0');
};

const getAdminAuthFromEnv = (): NewApiManagementAuth => {
  const accessToken = asTrimmedString(process.env.AIHUB_ADMIN_ACCESS_TOKEN);
  const newApiUserId = Number(process.env.AIHUB_ADMIN_USER_ID);

  if (!accessToken) {
    throw new Error('AIHUB_ADMIN_ACCESS_TOKEN is required for Aihub provisioning');
  }

  if (!Number.isInteger(newApiUserId) || newApiUserId <= 0) {
    throw new Error('AIHUB_ADMIN_USER_ID must be a positive integer for Aihub provisioning');
  }

  return {
    accessToken,
    newApiUserId,
  };
};

const getLookupField = (policy: AihubProvisioningPolicy): LookupField => {
  const lookupField = asTrimmedString(policy.lookupField) ?? 'employeeNumber';

  if (lookupField === 'employeeNumber' || lookupField === 'email' || lookupField === 'name') {
    return lookupField;
  }

  throw new Error(
    `Unsupported Aihub provisioning lookupField "${lookupField}". Expected employeeNumber, email, or name.`,
  );
};

const getLookupKeyword = (input: ProvisionEnterpriseUserInput, lookupField: LookupField) => {
  const keyword = asTrimmedString(input[lookupField]);

  if (!keyword) {
    throw new Error(
      `Aihub provisioning lookupField "${lookupField}" requires a non-empty ${lookupField} for user ${input.userId}`,
    );
  }

  return keyword;
};

const findExactUser = (users: NewApiUser[], keyword: string) =>
  users.find((user) => asTrimmedString(user.username) === keyword) ??
  users.find((user) => asTrimmedString(user.email) === keyword) ??
  users.find((user) => asTrimmedString(user.display_name) === keyword);

const isSameUserIdentity = (user: NewApiUser, input: ProvisionEnterpriseUserInput) => {
  const expectedUsername = getCreateUsername(input);
  return asTrimmedString(user.username) === expectedUsername;
};

const assertSameUserIdentity = (
  user: NewApiUser,
  input: ProvisionEnterpriseUserInput,
): NewApiUser => {
  if (isSameUserIdentity(user, input)) return user;

  const actualUsername = asTrimmedString(user.username) ?? '<missing>';
  const expectedUsername = getCreateUsername(input);
  throw new Error(
    `Aihub user identity conflict: username "${actualUsername}" does not match employee number "${expectedUsername}"`,
  );
};

// Bug 1b: detect Aihub "username already exists" conflicts so createUser can
// fall back to reusing the existing user instead of failing permanently.
const isDuplicateUserError = (error: unknown): boolean => {
  if (!(error instanceof NewApiError)) return false;
  if (error.status !== 400 && error.status !== 409) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('already used') ||
    message.includes('duplicate') ||
    message.includes('已存在') ||
    message.includes('已被使用') ||
    message.includes('username')
  );
};

const getUserQuota = (user: NewApiUser | undefined): number => {
  if (!user) return 0;
  const quota = user.quota;
  return typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? quota : 0;
};

const getRequiredManagedTokenName = (policy: AihubProvisioningPolicy) => {
  const managedTokenName = asTrimmedString(policy.managedTokenName);

  if (!managedTokenName) {
    throw new Error('Aihub managed token name is required for provisioning');
  }

  return managedTokenName;
};

const getCreateUsername = (input: ProvisionEnterpriseUserInput) => {
  const username =
    asTrimmedString(input.employeeNumber) ??
    asTrimmedString(input.email) ??
    asTrimmedString(input.name);

  if (!username) {
    throw new Error(
      `Aihub user creation requires employeeNumber, email, or name for ${input.userId}`,
    );
  }

  return username;
};

export class NewApiProvisioningAdapter {
  private adminAuth: NewApiManagementAuth;
  private bridgeClient: NewApiBridgeClient | undefined;
  private client: ProvisioningClient;

  constructor(options: NewApiProvisioningAdapterOptions = {}) {
    this.client =
      options.client ??
      new NewApiClient({
        baseUrl: process.env.AIHUB_PROXY_URL ?? '',
      });
    this.adminAuth = options.adminAuth ?? getAdminAuthFromEnv();
    this.bridgeClient = options.bridgeClient ?? new NewApiBridgeClient();
  }

  async provisionEnterpriseUser(
    input: ProvisionEnterpriseUserInput,
  ): Promise<ProvisionEnterpriseUserResult> {
    const policy = input.policy.aihubProvisioning ?? {};
    const lookupField = getLookupField(policy);
    const keyword = getLookupKeyword(input, lookupField);
    const legacyManagedTokenName = getRequiredManagedTokenName(policy);
    const expectedUsername = getCreateUsername(input);
    const masterinoUsername = asTrimmedString(input.masterinoUsername);
    if (masterinoUsername && masterinoUsername !== expectedUsername) {
      throw new Error('Masterino username must match the enterprise employee number');
    }
    const managedTokenName = `Masterino_${expectedUsername}`;

    let targetUser = await this.findUser(keyword);
    let identityMismatch = false;
    if (targetUser && !isSameUserIdentity(targetUser, input)) {
      identityMismatch = true;
      targetUser = undefined;
    }

    // Email fallback: only accept the match when the found user's username
    // equals the expected Masterino username (employeeNumber). This prevents
    // binding to a user that self-registered in Aihub with a different
    // username (e.g. newapi_320) but happens to share the same email.
    if (!targetUser && lookupField !== 'email' && asTrimmedString(input.email)) {
      const emailMatch = await this.findUser(input.email!);
      if (emailMatch && asTrimmedString(emailMatch.username) === expectedUsername) {
        targetUser = emailMatch;
      } else if (emailMatch) {
        identityMismatch = true;
      }
    }

    if (!targetUser && lookupField === 'email' && identityMismatch) {
      throw new Error('Aihub username must match the enterprise employee number');
    }

    if (!targetUser) {
      if (!policy.autoCreateUser) {
        throw new Error(
          `Aihub user matching "${keyword}"${lookupField !== 'email' ? ` or "${input.email}"` : ''} was not found and autoCreateUser is disabled`,
        );
      }

      targetUser = await this.createUser(input, policy);
    }

    // Bug 2: an existing Aihub user created without the default initial quota
    // (e.g. pre-provisioned manually or via a prior partial failure) would have
    // no balance. Top up the configured initial quota when the user has none.
    targetUser = await this.ensureInitialQuota(targetUser, policy);

    const token = await this.ensureManagedToken(
      targetUser.id,
      managedTokenName,
      legacyManagedTokenName,
      policy,
      input.preferredManagedTokenId,
    );

    // Link the Aihub user to the OAuth provider (e.g. BIEL IAM) so that when
    // the user later logs in to Aihub directly via IAM SSO, they are matched
    // to this same account instead of creating a new one. Uses the employee
    // number (工号) as provider_user_id — the same value IAM returns.
    const iamOAuthBinding = await this.ensureOAuthBinding(targetUser.id, input);

    return {
      managedTokenId: token.id,
      newApiUserId: targetUser.id,
      iamOAuthBinding,
      status: 'active',
    };
  }

  private async findUser(keyword: string) {
    const page = await this.client.searchUsers(this.adminAuth, {
      keyword,
      pageSize: 20,
    });

    const exact = findExactUser(page.items ?? [], keyword);
    if (exact) return exact;

    // Bug 1c: the admin API search can miss existing users (pagination cap of
    // 20, permission scope, or keyword semantics). Fall back to the bridge's
    // authoritative DB read so a user that exists in Aihub is not treated as
    // "not found" — which would otherwise trigger a duplicate create attempt.
    if (this.bridgeClient?.isEnabled()) {
      try {
        const bridged = await this.bridgeClient.findUserByIdentity({
          email: keyword,
          username: keyword,
        });
        if (bridged && isValidId(bridged.id)) return bridged;
      } catch {
        // bridge lookup failed — treat as not found and let the caller decide
      }
    }

    return undefined;
  }

  private async refetchUser(userId: number, username: string) {
    // Bug 1a: some NewAPI versions return only {id} on create without echoing
    // back the identity fields. Re-fetch the authoritative record by id via
    // the bridge (direct DB read), then fall back to an admin search.
    if (this.bridgeClient?.isEnabled()) {
      try {
        const bridged = await this.bridgeClient.findUserById(userId);
        if (bridged && isValidId(bridged.id)) return bridged;
      } catch {
        // fall through to admin search
      }
    }

    return this.findUser(username);
  }

  private async createUser(input: ProvisionEnterpriseUserInput, policy: AihubProvisioningPolicy) {
    const username = getCreateUsername(input);
    // Bug 4: NewAPI's POST /api/user/ rejects creation without a password
    // ("无效的参数"). SSO users never log in to Aihub directly, so generate a
    // long random password they will never use.
    const password = generateRandomPassword();
    const createInput: NewApiCreateUserInput = {
      display_name: asTrimmedString(input.name),
      email: asTrimmedString(input.email),
      group: asTrimmedString(policy.userGroup),
      password,
      quota: policy.initialQuota,
      username,
    };

    let createdUser: NewApiUser | undefined;

    try {
      createdUser = await this.client.createUser(this.adminAuth, createInput);
    } catch (error) {
      // Bug 1b: a prior partial provisioning failure may have already created
      // the Aihub user. On a duplicate-username conflict, reuse the existing
      // user instead of aborting — otherwise every subsequent login retries
      // create and fails permanently.
      if (isDuplicateUserError(error)) {
        const existing = await this.findUser(username);
        if (existing && isValidId(existing.id)) {
          return assertSameUserIdentity(existing, input);
        }
      }
      throw error;
    }

    if (createdUser && isValidId(createdUser.id)) {
      // Bug 1a: trust the valid id returned by Aihub. Only re-fetch the
      // authoritative record when the response did not echo back a matching
      // identity (some NewAPI versions omit username/email/display_name on the
      // create response). Never abort a successful create over a mismatch.
      if (isSameUserIdentity(createdUser, input)) {
        return createdUser;
      }

      const reconfirmed = await this.refetchUser(createdUser.id, username);
      if (reconfirmed && isValidId(reconfirmed.id)) {
        return assertSameUserIdentity(reconfirmed, input);
      }

      return assertSameUserIdentity(createdUser, input);
    }

    // No valid id returned — try to locate the user we just created.
    const targetUser = await this.findUser(username);
    if (targetUser && isValidId(targetUser.id)) {
      return assertSameUserIdentity(targetUser, input);
    }

    throw new Error(`Aihub user "${username}" was created but no NewAPI user id was returned`);
  }

  private async ensureInitialQuota(
    user: NewApiUser,
    policy: AihubProvisioningPolicy,
  ): Promise<NewApiUser> {
    const initialQuota = typeof policy.initialQuota === 'number' ? policy.initialQuota : 0;
    if (initialQuota <= 0) return user;
    // Only top up when the user has no balance; never reduce an existing quota.
    if (getUserQuota(user) > 0) return user;

    try {
      const updateInput: NewApiUpdateUserInput = {
        id: user.id,
        quota: initialQuota,
      };
      const updated = await this.client.updateUser(this.adminAuth, updateInput);
      if (updated && isValidId(updated.id)) {
        return { ...user, quota: initialQuota };
      }
    } catch (error) {
      console.warn(
        `[Aihub Provisioning] Failed to top up initial quota for user ${user.id}: ${(error as Error).message}`,
      );
    }

    return user;
  }

  /**
   * Independently ensure an existing Aihub user has the default initial quota.
   *
   * This is called outside {@link provisionEnterpriseUser} so that even when
   * full provisioning fails (e.g. a duplicate-username conflict that could not
   * be resolved, or a managed-token error), an *existing* Aihub user whose
   * binding already records a `newApiUserId` still gets its balance topped up
   * on every login. This covers the "old user with no balance" scenario.
   */
  async ensureUserQuota(newApiUserId: number, policy: ProvisioningPolicy): Promise<void> {
    if (!isValidId(newApiUserId)) return;
    const aihubPolicy = policy.aihubProvisioning ?? {};
    const initialQuota =
      typeof aihubPolicy.initialQuota === 'number' ? aihubPolicy.initialQuota : 0;
    if (initialQuota <= 0) return;

    // Fetch the current user record to check the existing quota.
    let user: NewApiUser | undefined;
    if (this.bridgeClient?.isEnabled()) {
      try {
        user = await this.bridgeClient.findUserById(newApiUserId);
      } catch {
        // fall through to admin search
      }
    }
    if (!user) {
      // Admin API has no "get user by id"; search by id as keyword.
      const page = await this.client.searchUsers(this.adminAuth, {
        keyword: String(newApiUserId),
        pageSize: 20,
      });
      user = (page.items ?? []).find((u) => Number(u.id) === Number(newApiUserId));
    }
    if (!user || !isValidId(user.id)) return;
    if (getUserQuota(user) > 0) return;

    try {
      await this.client.updateUser(this.adminAuth, {
        id: user.id,
        quota: initialQuota,
      });
    } catch (error) {
      console.warn(
        `[Aihub Provisioning] Failed to top up initial quota for user ${user.id}: ${(error as Error).message}`,
      );
    }
  }

  private async ensureManagedToken(
    newApiUserId: number,
    managedTokenName: string,
    legacyManagedTokenName: string,
    policy: AihubProvisioningPolicy,
    preferredManagedTokenId?: number,
  ) {
    // 1. The locally recorded token id is authoritative when it still belongs
    //    to this Aihub user. This keeps historical/custom token names compatible.
    if (this.bridgeClient?.isEnabled()) {
      try {
        if (preferredManagedTokenId) {
          const recorded = await this.bridgeClient.findManagedTokenById(
            newApiUserId,
            preferredManagedTokenId,
          );
          if (recorded && isValidId(recorded.id)) return recorded;
        }

        // 2. Prefer the stable canonical name, then accept the legacy name.
        for (const name of new Set([managedTokenName, legacyManagedTokenName])) {
          const bridgedToken = await this.bridgeClient.findManagedToken(newApiUserId, name);
          if (bridgedToken && isValidId(bridgedToken.id)) return bridgedToken;
        }
      } catch {
        // Bridge lookup failed — fall through to admin API approach
      }
    }

    // 3. Recover a token left under the admin user by a crash between remote
    //    creation and bridge reassignment. Search both canonical and legacy
    //    names because older releases created `masterlion-managed` first.
    const findAdminVisibleToken = async () => {
      for (const name of new Set([managedTokenName, legacyManagedTokenName])) {
        const page = await this.client.listTokens(this.adminAuth, {
          keyword: name,
          pageSize: 100,
        });
        const exact = (page.items ?? [])
          .filter((token) => asTrimmedString(token.name) === name)
          .sort((a, b) => Number(b.id) - Number(a.id))[0];
        if (exact) return exact;
      }

      return undefined;
    };

    let token = await findAdminVisibleToken();
    if (token && isValidId(token.id)) {
      if (Number(token.user_id) === newApiUserId) return token;
      if (token.user_id !== undefined && Number(token.user_id) !== this.adminAuth.newApiUserId) {
        throw new Error(
          `Aihub managed token identity conflict: token ${token.id} belongs to user ${token.user_id}`,
        );
      }
      return this.reassignManagedToken(token, newApiUserId);
    }

    // 4. Create the canonical name from the start. Do not trust createToken's
    //    response id: some Aihub versions omit it. Re-list by the stable name.
    await this.client.createToken(this.adminAuth, {
      expired_time: -1,
      name: managedTokenName,
      remain_quota: policy.managedTokenQuota,
      unlimited_quota: policy.managedTokenUnlimitedQuota,
    });

    token = await findAdminVisibleToken();
    if (token && isValidId(token.id)) {
      if (Number(token.user_id) === newApiUserId) return token;
      if (token.user_id !== undefined && Number(token.user_id) !== this.adminAuth.newApiUserId) {
        throw new Error(
          `Aihub managed token identity conflict: token ${token.id} belongs to user ${token.user_id}`,
        );
      }
      return this.reassignManagedToken(token, newApiUserId);
    }

    throw new Error(
      `Aihub managed token "${managedTokenName}" was not found after creation for user ${newApiUserId}`,
    );
  }

  private async reassignManagedToken(token: NewApiToken, newApiUserId: number) {
    if (!this.bridgeClient?.isEnabled()) {
      throw new Error('Aihub bridge is required to assign the managed token to the target user');
    }

    const reassigned = await this.bridgeClient.reassignToken(token.id, newApiUserId);
    if (!reassigned) {
      throw new Error(`Failed to reassign Aihub token ${token.id} to target Aihub user`);
    }

    return { ...token, user_id: newApiUserId };
  }

  private async ensureOAuthBinding(
    newApiUserId: number,
    input: ProvisionEnterpriseUserInput,
  ): Promise<ProvisionOAuthBindingResult> {
    // The OAuth provider_user_id is the employee number (工号) — the same
    // value BIEL IAM returns as account_no. This lets IAM login match the
    // existing Aihub account instead of creating a new one.
    const providerUserId = asTrimmedString(input.employeeNumber);
    if (!providerUserId) {
      return {
        errorCode: 'employee_number_missing',
        errorMessage: 'Enterprise employee number is required for Aihub OAuth binding',
        status: 'error',
      };
    }

    if (!this.bridgeClient?.isEnabled()) {
      return {
        errorCode: 'bridge_unavailable',
        errorMessage: 'Aihub bridge is not configured',
        status: 'error',
      };
    }

    const providerId = Number(process.env.AIHUB_IAM_PROVIDER_ID) || 1;

    try {
      const result = await this.bridgeClient.linkOAuthBinding(
        newApiUserId,
        providerUserId,
        providerId,
      );
      return { outcome: result.status, status: 'active' };
    } catch (error) {
      const errorCode = error instanceof NewApiBridgeError ? error.code : 'binding_failed';
      return {
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
        status: errorCode === 'binding_conflict' ? 'conflict' : 'error',
      };
    }
  }
}
