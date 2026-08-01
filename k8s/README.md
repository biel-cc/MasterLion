# Masterino Kubernetes layouts

The manifests are split into a shared workload base and environment-specific overlays:

- `overlays/production`: `masterino` namespace and production domain/configuration.
- `overlays/production-maintenance`: standalone maintenance page for introducing
  `masterino.bielcrystal.com` in the current legacy production namespace without changing the
  existing application or data stack.
- `overlays/production-migration`: production target data stack with the application at zero
  replicas and no public Ingress, used before the controlled data cutover.
- `overlays/test`: `masterino-test` namespace for ACK cluster
  `c23ea84b986c446d5b3fa9227962e77f4` in `cn-shenzhen`; it deliberately has no
  public Ingress so it can be validated beside the old namespace.
- `overlays/test-cutover`: adds the `mlai-test.bielcrystal.com` Ingress only
  during the guarded cutover.
- `overlays/test-migration`: temporary zero-replica application state used while the fresh database
  is initialized or before an optional data restore.

Never run `kubectl apply -f k8s/`. Render or apply an explicit overlay through `deploy.sh`.
For the production hostname and data migration sequence, follow
`docs/operations/masterino-v1.1.0-production-cutover.md`.
The guarded deploy script selects `test-migration` until the database is restored. `start` brings the
application up without taking public traffic. `cutover` is a separate, explicit action that installs
the public Ingress after the old Ingress has been removed.

## Test memory rollout

Personal memory is opt-in at two levels: the test overlay enables the runtime `+memory` flag, and
each user must then enable Memory in personal settings. Production intentionally has no `+memory`
flag and remains disabled until a separate production rollout is approved. Workspace memory stays
hidden.

`overlays/test/memory.properties` is the canonical non-secret memory configuration for the test
application and memory worker. Kustomize generates `masterino-memory-config-<content-hash>` from
this file, so a memory configuration change updates only those two Pod templates and rolls both
workloads automatically without restarting PostgreSQL or the Aihub Bridge. Do not maintain these
values with ad hoc `kubectl set env` commands: the next declarative deploy would replace them.
`deploy.sh --env test validate` fails if the memory flag, model selection, concurrency, worker
enablement, or the content-hashed memory ConfigMap is removed.

Before deploying the test rollout:

1. Copy `overlays/test/secret.env.example` to the ignored `secret.env`. No QStash or other
   external workflow credential is required. To obtain a temporary ACK kubeconfig through Alibaba Cloud CLI, use
   `scripts/operations/deployAckTestWithAliyunCli.sh`; see
   `docs/operations/ack-test-aliyun-cli.md`. Never commit populated secrets.

2. Confirm the application database migrations have completed, including
   `0117_use_halfvec_for_user_memory_embeddings`, and the user-memory tables, 2048-dimension
   `halfvec` columns, pgvector, and ParadeDB indexes exist.

3. Confirm both the target Aihub user group and its `masterlion-managed` token allow `glm-5.2` and
   `text-embedding-3-large`. Do not enable the rollout if either model is unavailable. Memory
   runtimes fail closed on an unauthorized provider/model/type or a missing user-managed token;
   they never borrow server or another provider's credentials. Run the guarded read-only check
   before deployment:

   ```bash
   ACK_TEST_ACTION=aihub-check \
     ACK_TEST_AIHUB_USERNAME='<Aihub username>' \
     bash scripts/operations/deployAckTestWithAliyunCli.sh
   ```

   The check rejects Bridge fallback to a differently named token.

4. Verify a manual historical extraction end to end while
   `MEMORY_QUEUE_SCHEDULER_ENABLED=0`.

Memory extraction runs through the in-cluster `masterino-memory-worker` Deployment using BullMQ
and the persistent `masterino-redis` StatefulSet. Redis uses AOF and `noeviction`; BullMQ keys are
isolated under the `${REDIS_PREFIX}:memory-queue` prefix.

After manual extraction succeeds, change `MEMORY_QUEUE_SCHEDULER_ENABLED` to `1` in
`overlays/test/memory-worker.yaml`, redeploy the same immutable application image, and verify that
the worker registers the `memory-user-memory-hourly` scheduler. No public webhook or external
schedule is involved.

Monitor queue retries, failed jobs, worker restarts, application errors, Aihub requests, and quota
usage. Disabling Memory
stops recall and new extraction but does not delete saved data; users can delete individual items
or clear all memory. A future production rollout must add its own worker Deployment and an explicit
production `+memory` flag; production remains disabled in this change.

Application image tags in the base are render-time markers. `deploy.sh` requires immutable
`sha256:` digests and replaces the markers in memory before applying resources.
