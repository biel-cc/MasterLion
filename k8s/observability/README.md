# Masterino observability on ACK

This overlay deploys Langfuse v3 web/worker and a one-shard, one-replica ClickHouse 25.8 LTS instance in `masterino-observability`. Production PostgreSQL is reached through the existing private `DATABASE_URL`; Redis remains in the historical `masterlion` namespace. Masterino does not depend on this stack for chat availability.

## Prerequisites

1. Install the ClickHouse operator CRDs/controller used by `ClickHouseInstallation`. This overlay deliberately uses the mature Altinity operator: unlike the new `clickhouse.com/v1alpha1` operator, it supports the approved single-node/no-Keeper topology. The installer verifies the official `release-0.27.0` bundle checksum and rewrites both controller images to immutable ACR digests:

   ```powershell
   .\scripts\operations\installClickHouseOperator.ps1 `
     -OperatorDigest sha256:<digest> `
     -MetricsExporterDigest sha256:<digest>
   ```

2. Confirm the live `masterlion-ssd-c-retain` storage class exists and allows expansion. Mirror all images into ACR and resolve immutable digests. Do not build images locally.

3. Create `masterino-langfuse-1574541762075655` and `masterino-langfuse-backups-1574541762075655` OSS buckets. Enable SSE, block public access, and configure a 90-day lifecycle for `events/` and `media/`; retain backups for 30 days.

4. Validate OSS Put/Get/List/DeleteObjects, presigned URLs, and lifecycle deletion with the same RAM user used by Langfuse.

5. Create the shared PostgreSQL roles/databases by deploying the production overlay's `langfuse-db-bootstrap` Job after adding its two passwords to `masterino-secret`.

## Secrets and rendering

Create the secret without committing its source file:

```powershell
Copy-Item k8s/observability/secret.env.example .tmp/langfuse-secret.env
# Replace every placeholder, then:
kubectl -n masterino-observability create secret generic langfuse-secret --from-env-file=.tmp/langfuse-secret.env
```

Use `scripts/operations/renderAckObservability.ps1` with four verified ACR image digests. The script only renders; review the output before applying through the existing guarded ACK workflow.

The Redis connection string ends in `/1`, isolating Langfuse from Masterino DB 0. Do not set `REDIS_KEY_PREFIX`: current Langfuse BullMQ/ioredis queues do not safely support the generic ioredis key-prefix option. DB 1 is the enforced isolation boundary.

## Existing PostgreSQL capacity

The live production PostgreSQL endpoint is external to ACK. Its CPU, memory, and disk expansion must be performed on the owning Alibaba Cloud database resource; the ACK manifests intentionally do not try to resize it. Verify a database backup before any external capacity change.

## Retention and operations

- Langfuse headless initialization creates one organization/project and configures project retention to 90 days.
- The daily and weekly ClickHouse backup CronJobs upload to separate OSS prefixes. Run a quarterly restore into an isolated namespace and record row counts/checksums.
- Configure ARMS/CloudMonitor alarms for PostgreSQL connections/disk, Redis memory/rejected writes/AOF/queue length, ClickHouse disk/merge backlog, Langfuse worker backlog, failed backup Jobs, and SLS ingestion/storage cost.
- At 70 GiB ClickHouse disk use, sustained insert latency, or stronger availability requirements, stop expanding this topology and plan the three-replica migration.

## Release checks

- Connect as `langfuse_app` and `langfuse_migrator`; both must fail to read Masterino's `lobechat` database. Migration must succeed only on `langfuse`/`langfuse_shadow`.
- Confirm all Langfuse keys are in Redis DB 1 and flushing DB 1 leaves DB 0 unchanged.
- Exercise chat, streaming, tools, retry, errors, cancellation, and multi-agent flows. Search the same `traceId` in SLS, Langfuse, and ARMS.
- Inject recognizable test credentials and verify PostgreSQL, Redis, ClickHouse, OSS, SLS, pod logs, and Langfuse UI contain no secret value.
- Stop ClickHouse and verify chat still succeeds. On recovery, verify no duplicate trace IDs.
- Validate 90-day detailed retention, 365-day aggregate retention, daily/weekly backups, and an OSS restore.
