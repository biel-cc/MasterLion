# Masterino v1.1.0 production cutover

This runbook introduces `masterino.bielcrystal.com` without changing either existing production
hostname, then performs a guarded application and data cutover. It treats the current
`masterlion` namespace as the rollback source until acceptance is complete.

## Confirmed baseline

- Source repository: `https://github.com/chaaak6/Masterino`
- Synced source commit: `18277c3698d991f653e2de421cf9a8a7f4aa3671` (`v1.0.16`)
- Release target: `v1.1.0`
- Production ACK cluster ID: `c5c81a41c33164f578f4e43a77fda5fc3`, region `cn-shenzhen`
- Current namespace: `masterlion`; target namespace: `masterino`
- Existing hostnames: `masterion.bielcrystal.com` and `masterlion.bielcrystal.com`
- Existing NLB CNAME target:
  `nlb-pkheesf2fnmqr7yil7.cn-shenzhen.nlb.aliyuncsslb.com`
- ACR repositories: `biel_client/masterino` and `biel_client/masterino-aihub-db-bridge`
- TLS Secret name: `20261122bielcrystal.com`

Do not apply `k8s/overlays/production` directly to the current namespace. It creates the target
data stack and must only be used after the migration inputs and rollback point are verified.

## Phase 1: publish only the maintenance hostname

1. Obtain a temporary production kubeconfig outside the repository and set `KUBECONFIG` and
   `ACK_CONTEXT`.

2. Run the read-only preflight:

   ```bash
   scripts/operations/deployProductionMaintenance.sh preflight
   ```

3. Set the API server printed by preflight and an existing, verified
   `biel_client/masterino@sha256:...` digest. Run `validate`, then `deploy`.

4. Before adding DNS, verify the Ingress through the NLB using an explicit Host header and verify:
   `/healthz` returns 200, the enterprise verification path returns its token, and `/` returns 503.

5. Add a CNAME for `masterino` to the existing NLB with the smallest permitted TTL (prefer 60–300
   seconds during the migration).

6. Verify DNS from at least two resolvers, TLS hostname validation, 503, `Retry-After: 300`, and the
   maintenance page from an external network.

Rollback removes only the new DNS record and the standalone maintenance overlay. It must not
modify either legacy Ingress.

## Phase 2: production readiness gates

All gates below are mandatory before the old application is quiesced:

- Build the application and bridge from the reviewed v1.1.0 commit and record both immutable ACR
  digests. Never deploy a mutable tag.
- Run `node scripts/operations/auditProductionConfig.mjs`. Resolve every missing or mismatched
  key without printing values to logs.
- Compare hashes of `JWKS_KEY`, `AUTH_SECRET`, `KEY_VAULTS_SECRET`, database credentials, Redis
  credentials, S3 credentials, and `AIHUB_BRIDGE_TOKEN` against the live `masterlion` Secrets.
  The live value is authoritative unless a documented rotation is part of this release.
- If the deprecated `S3_ACCESS_KEY` compatibility alias is present, ensure it matches
  `S3_ACCESS_KEY_ID`. New production Secrets only require `S3_ACCESS_KEY_ID`.
- Set `ONLYBOXES_JIT_SIGNING_KEY` to the exact value configured as
  `CONSOLE_JIT_SIGNING_KEY` in OnlyBoxes. Never rotate only one side.
- Keep the existing `masterlion-prd` OSS bucket, `lobechat` database name, `lobechat` Redis prefix,
  and `masterlion-managed` Aihub token name for the first cutover. These are external identities,
  not user-facing branding.
- Verify the wildcard certificate covers `masterino.bielcrystal.com` and has more than seven days
  remaining.
- Copy or let the ACK ACR credential controller aggregate
  `acr-credential-secret-aggregation` into the target namespace, then verify every target Pod
  references it before pulling the renamed Masterino images.
- Export the current Deployment specs, Ingress specs, Secret key names and hashes, database
  schema/table counts, PVC bindings, and application image digests as the rollback record.
- Take and verify a PostgreSQL backup. Confirm an OSS rollback/versioning policy separately; do
  not copy or rename the production bucket during the application cutover.

## Phase 3: controlled data cutover

The bundled production overlay creates a new PostgreSQL and Redis stack. A literal zero-downtime
switch is not safe without logical replication. The default procedure is therefore a short,
explicit maintenance window with deterministic rollback:

1. Deploy the target namespace with application replicas at zero and wait for PostgreSQL, Redis,
   and the Aihub bridge dependencies to become ready.
2. Route write-capable legacy hostnames to maintenance, then scale the old application to zero.
   Record the old replica count and Deployment revision first.
3. Stream a consistent PostgreSQL custom-format dump to the target and compare schema, table, and
   critical row counts. Redis is cache/session state and is intentionally not migrated.
4. Start one target application replica without public Ingress. Validate login, WeCom SSO, Aihub
   model filtering and quota, file upload/download through `/api/upload/s3-proxy`, knowledge base,
   sandbox/OnlyBoxes, and background jobs.
5. Scale the target to at least two replicas, wait for readiness, and replace only the
   `masterino.bielcrystal.com` maintenance Ingress with the reviewed application Ingress.
6. Keep both old namespace data and legacy routing available for the rollback window. Do not
   delete PVCs, Secrets, the old namespace, DNS records, or ACR images.

## Acceptance and rollback

Acceptance requires HTTP/TLS checks, browser login, WeCom callback, API streaming, uploads,
database writes, Aihub quota/model visibility, pod restarts, and error-rate/log review. Verify both
desktop and mobile routes.

Rollback is triggered by authentication failures, data-count mismatch, elevated 5xx/latency,
upload failure, Aihub authorization regression, or non-ready replicas. Route the new hostname back
to maintenance, stop the target application, restore the old database only if it received no new
writes, scale the old Deployment to its recorded revision/count, and restore legacy application
Ingresses. Preserve all evidence and do not delete the failed target namespace until the incident
is understood.

Create and push tag `v1.1.0` only after the reviewed commit, immutable image digests, migration
record, and acceptance results all refer to the same source revision.
