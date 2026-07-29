# ACK test deployment through Alibaba Cloud CLI

Run the helper from an operations host inside the Shenzhen VPC. It obtains a temporary ACK
kubeconfig through Alibaba Cloud CLI and delegates all Kubernetes validation and mutation to the
guarded repository `deploy.sh`. It never deploys production or performs the public Ingress
cutover.

## Tools and identity

Install Alibaba Cloud CLI 3.3 or later, `kubectl`, `node`, `bash`, and GNU `base64` on the
operations host. Configure Alibaba Cloud CLI through a RAM role or a dedicated RAM user. The
identity needs:

- permission to call `cs:DescribeClusterUserKubeconfig` for ACK cluster
  `c23ea84b986c446d5b3fa9227962e77f4`;
- Kubernetes RBAC permissions for the guarded `masterino-test` namespace and the cluster-scoped
  StorageClass used by `deploy.sh`;
- ACR pull/push permission only for the two `biel_client/masterino*` repositories when the same
  host also builds images.

Prefer a temporary internal-network kubeconfig. The helper defaults to a 120-minute credential and
deletes the kubeconfig and temporary env files when the command exits.

## Secret environment

Load the values from an encrypted secret store into the current shell environment. Do not put them
in shell history, tracked repository files, or command-line arguments.

Alternatively, point the helper at existing ignored env files. The helper copies them into its
private temporary directory and never modifies the source files:

```bash
export ACK_TEST_APP_SECRET_FILE=D:/MasterLion/k8s/overlays/test/secret.env
export ACK_TEST_BRIDGE_SECRET_FILE=D:/MasterLion/k8s/overlays/test/bridge-secret.env
```

Generate once and retain across deployments:

- `KEY_VAULTS_SECRET`: base64 encoding of 32 random bytes.
- `AUTH_SECRET`: 64 hexadecimal characters.
- `JWKS_KEY`: an RSA private JWKS JSON string.
- `POSTGRES_PASSWORD`: URL-safe random password.
- `REDIS_PASSWORD`: URL-safe random password.
- `AIHUB_BRIDGE_TOKEN`: random internal service token.

Platform-issued values:

- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: dedicated test OSS RAM credential.
- `AIHUB_READONLY_DATABASE_URL`: read-only Aihub database account, available only to the bridge.

Personal-memory background work uses the in-cluster Redis and
`masterino-memory-worker`; it does not require QStash or another external workflow secret.

Non-secret deployment inputs:

- `MASTERLION_IMAGE_DIGEST`: digest of the application image built from the reviewed commit.
- `BRIDGE_IMAGE_DIGEST`: digest of the reviewed bridge image. The memory branch does not change
  `apps/aihub-db-bridge`, so the currently approved bridge digest may be reused.

The Aihub `masterlion-managed` token is not a CI variable. The target Aihub user group and each
test user's managed token must both authorize `glm-5.2` and `text-embedding-3-large`.

## Command steps

Read-only identity and cluster capability check:

```bash
ACK_TEST_ACTION=preflight bash scripts/operations/deployAckTestWithAliyunCli.sh
```

Read-only Aihub authorization check for a designated test user:

```bash
export ACK_TEST_ACTION=aihub-check
export ACK_TEST_AIHUB_USERNAME='<Aihub username>'
bash scripts/operations/deployAckTestWithAliyunCli.sh
```

This check requires an exact `masterlion-managed` token. It fails if the Bridge would otherwise
fall back to a differently named token, if the token is disabled, expired, or out of quota, or if
the user-group/token intersection does not contain both required models.

Render and validate manifests with immutable image digests:

```bash
ACK_TEST_ACTION=validate bash scripts/operations/deployAckTestWithAliyunCli.sh
```

Deploy the private test staging state:

```bash
export ACK_TEST_ACTION=deploy
export CONFIRM_ACK_TEST_DEPLOY=masterino-test
export ACK_TEST_AIHUB_USERNAME='<Aihub username>'
bash scripts/operations/deployAckTestWithAliyunCli.sh
```

The deploy action creates or updates Kubernetes Secrets, applies the migration overlay, and waits
for PostgreSQL, Redis, and Aihub DB Bridge. It then runs the same exact-token authorization gate.
Masterino remains at zero replicas with no public Ingress until database readiness is separately
confirmed. Starting Masterino and its memory worker, private acceptance, cutover, and enabling the
internal hourly BullMQ scheduler remain explicit follow-up operations. The scheduler flag stays
off for the first manual extraction acceptance.

Do not echo the secret environment or enable shell tracing while running the command.
