# Masterino production blue-green overlay

This overlay deploys the v1.1.0 Masterino application and Aihub bridge beside the current
`masterlion` workloads in the live `masterlion` namespace. It intentionally does not create or
migrate PostgreSQL, Redis, SearxNG, TLS, or registry credentials.

- PostgreSQL remains the existing external production database.
- `masterino-redis` and `masterino-searxng` are compatibility Service aliases for the retained
  stateful dependencies.
- The validation overlay contains no Ingress and starts one Masterino replica.
- The sibling `production-bluegreen-cutover` overlay scales Masterino to two replicas and
  atomically updates the existing `masterino-maintenance` Ingress backend after private validation
  succeeds.
- Reapplying `../production-maintenance` restores the maintenance backend without changing the
  legacy hostnames or workloads.

Before applying, create `masterino-secret`, `masterino-bridge-secret`, and
`masterino-onlyboxes-ca` from the live production resources through a protected in-memory
pipeline. Never commit their values.
