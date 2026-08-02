# Production maintenance entrypoint

This overlay adds only `masterino.bielcrystal.com` to the current legacy production namespace.
It does not modify the existing `masterion` / `masterlion` Ingresses, application Deployment,
database, Redis, object storage, or Secrets.

The maintenance workload deliberately reuses an immutable digest from the existing ACR
`biel_client/masterino` repository. The guarded deployment helper replaces the
`maintenance-source` marker with that digest before applying the manifests.

Run all cluster operations through `scripts/operations/deployProductionMaintenance.sh`. The
helper requires an explicit kubeconfig, context, API server, namespace, and image digest. Start
with `preflight`, then `render` and `validate`; use `deploy` only after DNS and the wildcard TLS
certificate are ready.
