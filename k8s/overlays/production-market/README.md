# Masterino Market production core

This overlay deploys the Masterino Market API, migration Job, Service, HPA, PDB, and a scoped
NetworkPolicy without a public Ingress. It reuses the existing production PostgreSQL database,
Redis Pod, OSS bucket, TLS infrastructure, and ACR pull credentials.

The Connector Runner is intentionally excluded because the production namespace does not yet have
the required independent `connector-egress-proxy`. Core catalog, review, installation, credential
vault, and artifact operations remain available. Enable the Runner only after its proxy and target
allowlist have been provisioned and verified.

Create `masterino-market-secret` through a protected in-memory pipeline before applying. Never
commit its values. Wait for `job/masterino-market-migrate` and `/ready` before applying the cutover
overlay.
