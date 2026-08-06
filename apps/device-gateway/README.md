# Masterino Device Gateway image

This image packages the self-hosted Go device gateway from
`lobehub/lobehub-gateway` release `0.3.1`.

The build is pinned to commit `1abeb8a551fbb5d017ae2031ded775a129555834` and verifies the
source archive SHA256 before compiling. Build it in Alibaba Cloud ACR; do not build or publish a
local Docker image for production.

Runtime configuration is supplied by Kubernetes:

- `SERVICE_TOKEN`: shared only with the Masterino server.
- `JWKS_PUBLIC_KEY`: public-only RS256 JWKS derived from the production `JWKS_KEY`.
- `PORT`: `8788`.

Never pass the private `JWKS_KEY` to this workload.
