# Vendored Device Gateway source

Source: `lobehub/lobehub-gateway`

Commit: `1abeb8a551fbb5d017ae2031ded775a129555834`

Only files required to compile `device-gateway-go` are included. Original Git blob SHAs:

| File                             | Git blob SHA                               |
| -------------------------------- | ------------------------------------------ |
| `cmd/device-gateway-go/main.go`  | `a791394df1aa53dccd6eb6107627a7acd622b259` |
| `gateway.go`                     | `d72aa0b91ce1edb71f08959d6044b86fb2502985` |
| `go.mod`                         | `55a9732caf9b64a680efbc758dd6706718596e89` |
| `internal/gateway/auth.go`       | `daf6acf7417e9386c09c9606ec971be821540761` |
| `internal/gateway/config.go`     | `340a1a648839d942d123b59db09ec6f864a2a56e` |
| `internal/gateway/connection.go` | `c82f6c17d4feb818f17267582f40dd9c82b80292` |
| `internal/gateway/hub.go`        | `8ec1ba8b46a88fd6a8a55488edaec9d9a23c6f1a` |
| `internal/gateway/server.go`     | `3112f2cc6021d262572afc5001b7b08771a15bb0` |
| `internal/gateway/types.go`      | `db71dc6739efa5c354d80491eb081184643790c3` |
| `internal/gateway/ws.go`         | `3b21ca34a019083a730236b3a7b02198216bf006` |

## Masterino patches

The vendored server intentionally differs from the upstream blobs above:

- WebSocket connections remain unauthenticated and outside all user hubs until the first `auth`
  message is verified.
- JWT and API-key clients no longer need to put `userId` in the WebSocket URL. A legacy value is
  treated only as a consistency assertion; service-token clients still require it.
- `auth_success` returns the verified `userId`, and structured logs contain connection metadata but
  never credentials or the user id.
- Authentication records optional protocol capabilities for rolling upgrades. Tool-call responses
  only report `executionContextValidation: hard` when the selected device explicitly advertised
  protocol v2 validation; missing/legacy capability metadata remains `legacy`.
- `internal/gateway/server_test.go` is a Masterino-owned protocol regression suite and has no
  upstream blob SHA.
