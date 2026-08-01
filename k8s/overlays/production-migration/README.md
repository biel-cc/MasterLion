# Production migration overlay

This overlay renders the production target namespace with the Masterino application at zero
replicas and removes every public Ingress. PostgreSQL, Redis, and the Aihub DB bridge can be
prepared and validated before any public routing changes.

The guarded `deploy.sh --env production deploy` command selects this overlay until the namespace
is explicitly annotated `masterino.io/cutover-complete=true` after private acceptance and the
controlled data cutover.
