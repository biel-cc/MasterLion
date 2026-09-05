# Masterino Device Gateway image

This image packages the self-hosted Go device gateway from
`lobehub/lobehub-gateway` release `0.3.1`.

The build is pinned to commit `1abeb8a551fbb5d017ae2031ded775a129555834`. The minimal Go source
needed for the standalone server is vendored under `upstream/` because the ACR build sandbox cannot
download arbitrary HTTPS resources. `SOURCE_SHA256SUMS` is verified before compilation. Build it in
Alibaba Cloud ACR; do not build or publish a local Docker image for production.

Masterino carries authentication-order and protocol-v2 execution-context patches on top of the pinned source: JWT/API-key
connections are attached to a user hub only after credential verification, while service-token
connections retain the explicit user-id requirement. The ACR build runs the vendored protocol
tests before producing the binary. The checksum manifest covers the current patched source; the
upstream commit and blob map continue to identify the unmodified upstream baseline.

`BASE_REGISTRY` defaults to `docker.io/library` and can be overridden by ACR when the cloud builder
uses a mainland mirror. It changes only the Go and Alpine base-image registry; the upstream source
commit and checksum remain pinned.

`upstream/UPSTREAM.md` records the original Git blob SHA for every vendored file. Update the source,
blob map, SHA256 manifest, and `GATEWAY_COMMIT` together when upgrading upstream.

Runtime configuration is supplied by Kubernetes:

- `SERVICE_TOKEN`: shared only with the Masterino server.
- `JWKS_PUBLIC_KEY`: public-only RS256 JWKS derived from the production `JWKS_KEY`.
- `PORT`: `8788`.

Never pass the private `JWKS_KEY` to this workload.
