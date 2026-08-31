# Notebook list OOM phase-1 stopgap

## Boundary

This phase only reduces the database and retry pressure created when a user opens a Topic:

- human-facing Notebook lists use an explicit summary projection;
- Plan context uses a dedicated, single-row full-content projection;
- pre-summary Electron clients keep their legacy contract through a narrow Plan `id + metadata`
  compatibility read;
- Notebook SWR retries only transient failures, at most twice, with 5s/15s backoff and jitter;
- stale list data remains visible and the terminal error state exposes a manual Retry action.

It does not change the database schema, BM25 index, PostgreSQL configuration, global SWR defaults,
document detail/read-tool semantics, or Agent Plan context quality.

## Test environment deployment

- Environment: `masterino-test`
- Commit: `86f481ea`
- ACR tag: `test-86f481ea`
- Immutable image: `sha256:33f573487dfb734233b5ddb8713be0974d95157bb1597a6e980794bd2424fa02`
- Workloads updated: `masterino`, `masterino-memory-worker`
- Previous/rollback digest: `sha256:dae1e7949ed0f61d82b1de78e296e6098fb39b16a06a6b1b4ad7506d39506814`

No database, Secret, Ingress, Redis, bridge, or production-environment mutation was performed.

## Acceptance results

Validated on 2026-08-27 against the largest Topic currently present in the test database:
`tpc_XXPkinzdDCMp` (6 documents, 2,188,593 content bytes).

| Check                         | Required                                                               | Result                                                    |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Summary SQL result projection | no `content`, `pages`, `editor_data`, or `metadata`                    | pass                                                      |
| Summary payload               | no more than 20 KiB                                                    | 2,626 bytes                                               |
| Payload reduction             | at least 95%                                                           | 2,877,141 → 2,626 bytes (99.91%)                          |
| Logical concurrency           | 150 clients through the application-equivalent 10-connection `pg.Pool` | pass                                                      |
| Sustained run                 | 30 seconds, zero query failures                                        | 147,445 reads, 0 failures                                 |
| Query latency under load      | p95 below 500 ms                                                       | p50 25.87 ms; p95 47.83 ms; p99 52.00 ms; max 111.62 ms   |
| Database connections          | remain bounded by the pool                                             | 11 total; 3–6 active during samples; 1 after              |
| PostgreSQL memory             | no growth across the run                                               | 138 MiB before/during/after cooldown                      |
| Workload health               | no OOM/restart                                                         | app, memory worker, and PostgreSQL Ready; restart count 0 |
| Public landing                | reachable after rollout                                                | final HTTP 200 after the expected auth redirect           |

Post-test cooldown: app 397 MiB, memory worker 404 MiB, PostgreSQL 138 MiB; all three remained
Ready with zero restarts.

### Connection-limit diagnostic

A deliberately invalid 150-_physical-connection_ `pgbench` attempt was also made. PostgreSQL is
configured with `max_connections = 100`, so it correctly rejected excess clients and emitted
`too many clients` entries at `2026-08-27 02:58:51 UTC`. This is not the service traffic model:
Masterino uses `pg.Pool` (default max 10 per process), so the acceptance run above used 150 logical
clients queued through that real pool bound. After the rejected diagnostic, connections returned to
baseline and PostgreSQL remained at zero restarts.

## Automated regression coverage

- Database/model: bounded summary fields, Plan full-content projection, Plan metadata compatibility.
- Router: canonical summary, legacy Electron compatibility, Plan path, transient DB error mapping.
- Client: retry classification, retry budget/jitter, SWR overrides, stale/error/manual recovery UI.
- CLI: table uses summaries; JSON explicitly reads detail and preserves the old field set.
- Electron Playwright: mounts the production
  `NotebookBody → useFetchNotebookDocuments → Zustand → SWR → NotebookService` chain; verifies
  third-attempt recovery and terminal error followed by a real Retry button click.

Manual authenticated Topic/Plan/read-document validation remains the final product smoke check for
the reviewer before merge.
