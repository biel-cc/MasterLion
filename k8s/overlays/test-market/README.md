# Masterino Market test core

This overlay deploys one internal Market API replica plus its migration and database bootstrap
jobs in `masterino-test`. It deliberately removes the public ingress, HPA, PDB, and Connector
Runner from the shared base. Apply `../test-market-cutover` only after the API `/ready` probe has
passed.

The guarded test deployment requires an immutable `MARKET_IMAGE_DIGEST` and a protected
`masterino-market-secret`. The application and Market secrets must contain the same generated
`MARKET_TRUSTED_CLIENT_SECRET`. Never commit real database, Redis, OSS, signing, encryption, or
trusted-client credentials.

The test API uses the dedicated `masterino_market` PostgreSQL role/database, the existing Redis
service (the Market runtime applies the `masterino:market:` key prefix), and the private
`masterino-market-test-bielcrystal` OSS bucket. The NetworkPolicy permits only the Masterino app
and ingress controller to call the API, and limits egress to PostgreSQL, Redis, DNS, and HTTPS for
the configured OSS endpoint.
