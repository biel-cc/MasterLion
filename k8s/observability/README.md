# Masterino observability on ACK

This overlay deploys Langfuse v3 web/worker and a one-shard, one-replica ClickHouse 25.8 LTS instance in `masterino-observability`. Production PostgreSQL is reached through the existing private `DATABASE_URL`; Redis remains in the historical `masterlion` namespace. Masterino does not depend on this stack for chat availability.

The UI is available at `https://langfuse-internal.bielcrystal.com`. Configure a CNAME for that host to `nlb-pkheesf2fnmqr7yil7.cn-shenzhen.nlb.aliyuncsslb.com`; do not pin the NLB's current A records because their addresses can change. The Langfuse Ingress allows only source addresses in `10.0.0.0/8`; the shared NLB must retain the original client address.

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

6. Apply the versioned SLS collector configuration and product dashboard with the local `aliyun` CLI. This deliberately avoids the cluster's unhealthy telemetry-operator webhook:

   ```powershell
   .\scripts\operations\applySlsTelemetryDefinitions.ps1 `
     -Project k8s-log-c23ea84b986c446d5b3fa9227962e77f4 `
     -MachineGroup k8s-group-c23ea84b986c446d5b3fa9227962e77f4
   ```

   The definitions are `sls-product-events-config.json` and `sls-dashboard.json`. The script creates or updates them and binds the collector configuration to the machine group.

7. If the ACK enterprise DNS resolver cannot reach the SLS project endpoints, configure only the managed LoongCollector pods (not cluster-wide DNS) and mount the custom machine-group identifier required by LoongCollector 3.x:

   ```powershell
   .\scripts\operations\configureAckLoongCollector.ps1 `
     -ClusterId c23ea84b986c446d5b3fa9227962e77f4 `
     -Project k8s-log-c23ea84b986c446d5b3fa9227962e77f4
   ```

   The SLS machine group must use `machineIdentifyType=userdefined`, an empty `groupType`, and `k8s-group-<clusterId>` as its sole machine identifier.

## Secrets and rendering

Create the secret without committing its source file:

```powershell
Copy-Item k8s/observability/secret.env.example .tmp/langfuse-secret.env
# Replace every placeholder, then:
kubectl -n masterino-observability create secret generic langfuse-secret --from-env-file=.tmp/langfuse-secret.env
```

Use `scripts/operations/renderAckObservability.ps1` with four verified ACR image digests. The script only renders; review the output before applying through the existing guarded ACK workflow.

The Redis connection string ends in `/1`, isolating Langfuse from Masterino DB 0. `REDIS_KEY_PREFIX=langfuse:` adds a second collision boundary supported by current Langfuse releases.

## Existing PostgreSQL capacity

The live production PostgreSQL endpoint is external to ACK. Its CPU, memory, and disk expansion must be performed on the owning Alibaba Cloud database resource; the ACK manifests intentionally do not try to resize it. Verify a database backup before any external capacity change.

## Retention and operations

- Langfuse headless initialization creates one organization/project and configures project retention to 90 days.
- The ClickHouse backup sidecar shares `/var/lib/clickhouse` with the server and uses `server --watch` to create daily incremental backups with a weekly full baseline. The OSS lifecycle removes backup objects after 30 days. Run a quarterly restore into an isolated namespace and record row counts/checksums.
- Configure ARMS/CloudMonitor alarms for PostgreSQL connections/disk, Redis memory/rejected writes/AOF/queue length, ClickHouse disk/merge backlog, Langfuse worker backlog, backup API failures, and SLS ingestion/storage cost.
- At 70 GiB ClickHouse disk use, sustained insert latency, or stronger availability requirements, stop expanding this topology and plan the three-replica migration.

## Release checks

- Connect as `langfuse_app` and `langfuse_migrator`; both must fail to read Masterino's `lobechat` database. Migration must succeed only on `langfuse`/`langfuse_shadow`.
- Confirm all Langfuse keys are in Redis DB 1 and flushing DB 1 leaves DB 0 unchanged.
- Exercise chat, streaming, tools, retry, errors, cancellation, and multi-agent flows. Search the same `traceId` in SLS, Langfuse, and ARMS.
- Inject recognizable test credentials and verify PostgreSQL, Redis, ClickHouse, OSS, SLS, pod logs, and Langfuse UI contain no secret value.
- Stop ClickHouse and verify chat still succeeds. On recovery, verify no duplicate trace IDs.
- Validate 90-day detailed retention, 365-day aggregate retention, daily/weekly backups, and an OSS restore.
