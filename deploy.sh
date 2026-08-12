#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ACK_CLUSTER_ID="c23ea84b986c446d5b3fa9227962e77f4"
PRODUCTION_ACK_CLUSTER_ID="c23ea84b986c446d5b3fa9227962e77f4"
EXPECTED_ACK_REGION="cn-shenzhen"
DEFAULT_TEST_CONTEXT="ack-c23ea84b-masterlion-test"
MASTERINO_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino"
BRIDGE_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-aihub-db-bridge"
MARKET_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-market"
IMAGE_TAG_MARKER="v1.1.0"
TLS_SECRET_NAME="20261122bielcrystal.com"
ACR_PULL_SECRET_NAME="acr-credential-secret-aggregation"

usage() {
  cat << 'EOF'
Masterino ACK deployment tool

Usage:
  ./deploy.sh --env <test|production> <command> [arguments]

Required for all cluster commands:
  KUBECONFIG       Explicit kubeconfig file outside the repository.
  ACK_CONTEXT      Kubeconfig context. Test defaults to ack-c23ea84b-masterlion-test.

Required for mutating commands:
  ACK_API_SERVER             Exact API server URL printed by the preflight command.
  MASTERINO_IMAGE_DIGEST     Immutable sha256: digest for the reviewed Masterino image.
  BRIDGE_IMAGE_DIGEST        Immutable sha256: digest for the reviewed Aihub DB Bridge image.
  MARKET_IMAGE_DIGEST        Immutable sha256: digest for the reviewed Market image (test only).

Commands:
  preflight                  Read-only ACK capability and identity checks.
  render                     Render manifests with immutable image digests.
  validate                   Client-side validation of rendered manifests.
  bootstrap                  Create the namespace and test StorageClass.
  create-secret [app-env] [bridge-env] [searxng-env] [market-env]
                              Create/update isolated app, bridge, SearXNG and Market Secrets.
  deploy                     Server dry-run and apply the selected overlay.
  start                      Scale Masterino to one replica for private validation.
  cutover                    Move the test Ingress from the old namespace to Masterino.
  rollback                   Restore the old test Ingress and stop Masterino.
  stop                       Scale Masterino to zero replicas.
  status                     Show workloads, ingress and persistent volumes.
  rollout                    Wait for all running workloads.
  logs [service]             Follow logs (masterino|postgres|redis|aihub-db-bridge).
  restart [service]          Restart a workload.
  port-forward [port]        Forward a local port to Masterino.
  update-image <service> <image@sha256:digest>
  info                       Show guarded cluster identity and namespace details.

The script deliberately has no namespace-delete command.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "${1:-}" == "--env" ]] || {
  usage
  fail "--env test or --env production is required"
}
ENVIRONMENT="${2:-}"
shift 2
COMMAND="${1:-}"
shift || true

case "$ENVIRONMENT" in
  test)
    NAMESPACE="masterino-test"
    SOURCE_NAMESPACE="masterlion-test"
    EXPECTED_ACK_CLUSTER_ID="$TEST_ACK_CLUSTER_ID"
    OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test"
    CUTOVER_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-cutover"
    MIGRATION_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-migration"
    MARKET_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-market"
    MARKET_SEED_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-market-seed"
    MARKET_CUTOVER_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-market-cutover"
    ROLLBACK_INGRESS="$SCRIPT_DIR/k8s/compat/masterlion-test-ingress.yaml"
    SOURCE_VERIFICATION_INGRESS="$SCRIPT_DIR/k8s/compat/masterlion-test-verification-ingress.yaml"
    SOURCE_INGRESS_NAME="masterlion-test-ingress"
    EXPECTED_CONTEXT="${ACK_CONTEXT:-$DEFAULT_TEST_CONTEXT}"
    ACR_PULL_SECRET_NAME="masterino-acr-fixed"
    STORAGE_CLASS_NAME="masterino-test-essd-retain"
    ;;
  production)
    NAMESPACE="masterino"
    EXPECTED_ACK_CLUSTER_ID="$PRODUCTION_ACK_CLUSTER_ID"
    OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/production"
    MIGRATION_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/production-migration"
    EXPECTED_CONTEXT="${ACK_CONTEXT:-}"
    [[ -n "$EXPECTED_CONTEXT" ]] || fail "ACK_CONTEXT is required for production"
    STORAGE_CLASS_NAME="masterino-production-essd-retain"
    ;;
  *)
    usage
    fail "unknown environment: $ENVIRONMENT"
    ;;
esac

KUBE=()

init_kube() {
  command -v kubectl > /dev/null 2>&1 || fail "kubectl is not installed"
  [[ -n "${KUBECONFIG:-}" ]] || fail "KUBECONFIG must point to the ACK kubeconfig"
  [[ -f "$KUBECONFIG" ]] || fail "KUBECONFIG file does not exist: $KUBECONFIG"
  KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$EXPECTED_CONTEXT")
}

verify_target() {
  local mutation="${1:-read}"
  local current_context api_server namespace_cluster regions

  init_kube
  current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
  [[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail \
    "current context '$current_context' is not the guarded context '$EXPECTED_CONTEXT'"

  api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
  [[ -n "$api_server" ]] || fail "could not read the ACK API server from kubeconfig"

  if [[ "$mutation" == "mutation" ]]; then
    [[ -n "${ACK_API_SERVER:-}" ]] || fail \
      "ACK_API_SERVER is required for mutations; preflight reports the expected value"
    [[ "$api_server" == "$ACK_API_SERVER" ]] || fail \
      "API server mismatch: kubeconfig does not match ACK_API_SERVER"
  elif [[ -n "${ACK_API_SERVER:-}" && "$api_server" != "$ACK_API_SERVER" ]]; then
    fail "API server mismatch: kubeconfig does not match ACK_API_SERVER"
  fi

  regions="$("${KUBE[@]}" get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/region}{"\n"}{end}' | sed '/^$/d' | sort -u)"
  [[ "$regions" == "$EXPECTED_ACK_REGION" ]] || fail \
    "node region mismatch: expected '$EXPECTED_ACK_REGION', found '${regions:-none}'"

  if "${KUBE[@]}" get namespace "$NAMESPACE" > /dev/null 2>&1; then
    namespace_cluster="$("${KUBE[@]}" get namespace "$NAMESPACE" -o jsonpath='{.metadata.annotations.masterino\.io/ack-cluster-id}')"
    [[ "$namespace_cluster" == "$EXPECTED_ACK_CLUSTER_ID" ]] || fail \
      "namespace '$NAMESPACE' is not labelled for ACK cluster '$EXPECTED_ACK_CLUSTER_ID'"
  fi
}

require_digest() {
  local name="$1" value="$2"
  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$name must be an immutable sha256: digest"
}

render_manifests() {
  local render_dir="${1:-$OVERLAY_DIR}"
  require_digest MASTERINO_IMAGE_DIGEST "${MASTERINO_IMAGE_DIGEST:-}"
  require_digest BRIDGE_IMAGE_DIGEST "${BRIDGE_IMAGE_DIGEST:-}"

  kubectl kustomize "$render_dir" | sed \
    -e "s|${MASTERINO_IMAGE}:${IMAGE_TAG_MARKER}|${MASTERINO_IMAGE}@${MASTERINO_IMAGE_DIGEST}|g" \
    -e "s|${BRIDGE_IMAGE}:${IMAGE_TAG_MARKER}|${BRIDGE_IMAGE}@${BRIDGE_IMAGE_DIGEST}|g"
}

render_market_manifests() {
  local render_dir="${1:-$MARKET_OVERLAY_DIR}"
  require_digest MARKET_IMAGE_DIGEST "${MARKET_IMAGE_DIGEST:-}"

  kubectl kustomize "$render_dir" | sed \
    -e "s|${MARKET_IMAGE}:${IMAGE_TAG_MARKER}|${MARKET_IMAGE}@${MARKET_IMAGE_DIGEST}|g"
}

required_secret_keys=(
  KEY_VAULTS_SECRET AUTH_SECRET JWKS_KEY POSTGRES_PASSWORD DATABASE_URL
  REDIS_PASSWORD REDIS_URL S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
  AIHUB_BRIDGE_TOKEN
)

if [[ "$ENVIRONMENT" == "test" ]]; then
  required_secret_keys+=(
    AUTH_SSO_PROVIDERS
    AUTH_WECOM_AGENT_ID
    AUTH_WECOM_CORP_ID
    AUTH_WECOM_CORP_SECRET
    MARKET_GITHUB_TOKEN
    MARKET_TRUSTED_CLIENT_SECRET
  )
fi

if [[ "$ENVIRONMENT" == "production" ]]; then
  required_secret_keys+=(ONLYBOXES_JIT_SIGNING_KEY)
fi

required_bridge_secret_keys=(AIHUB_BRIDGE_TOKEN AIHUB_READONLY_DATABASE_URL)
required_searxng_secret_keys=(SEARXNG_SECRET)
required_market_secret_keys=(
  MARKET_DATABASE_PASSWORD MARKET_DATABASE_URL MARKET_REDIS_URL
  MARKET_TRUSTED_CLIENT_SECRET MARKET_CREDENTIAL_ENCRYPTION_KEY
  MARKET_IMPORT_SIGNING_KEY MARKET_RUNNER_INTERNAL_TOKEN
  MARKET_OBJECT_STORAGE_ACCESS_KEY_ID MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY
  MARKET_OAUTH_CLIENTS_JSON MARKET_ADMIN_USER_IDS
)

searxng_enabled() {
  [[ "$ENVIRONMENT" == "test" ]] || return 1
  kubectl kustomize "$OVERLAY_DIR" | grep -Eq 'SEARCH_PROVIDERS:.*searxng'
}

normalize_workload_schema_transitions() {
  local legacy_probe postgres_db_value

  if "${KUBE[@]}" get deployment masterino -n "$NAMESPACE" > /dev/null 2>&1; then
    legacy_probe="$(
      "${KUBE[@]}" get deployment masterino -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino")].readinessProbe.httpGet.path}{.spec.template.spec.containers[?(@.name=="masterino")].livenessProbe.httpGet.path}{.spec.template.spec.containers[?(@.name=="masterino")].startupProbe.httpGet.path}'
    )"
    if [[ -n "$legacy_probe" ]]; then
      # Probe handlers are mutually exclusive. Server-side apply merges object
      # fields, so explicitly remove the legacy HTTP handlers while installing
      # the desired TCP handlers in the same valid strategic-merge patch.
      "${KUBE[@]}" patch deployment masterino -n "$NAMESPACE" --type=strategic --patch \
        '{"spec":{"template":{"spec":{"containers":[{"name":"masterino","readinessProbe":{"httpGet":null,"exec":null,"grpc":null,"tcpSocket":{"port":"http"}},"livenessProbe":{"httpGet":null,"exec":null,"grpc":null,"tcpSocket":{"port":"http"}},"startupProbe":{"httpGet":null,"exec":null,"grpc":null,"tcpSocket":{"port":"http"}}}]}}}}'
    fi
  fi

  if "${KUBE[@]}" get statefulset masterino-postgres -n "$NAMESPACE" > /dev/null 2>&1; then
    postgres_db_value="$(
      "${KUBE[@]}" get statefulset masterino-postgres -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.containers[?(@.name=="postgres")].env[?(@.name=="POSTGRES_DB")].value}'
    )"
    if [[ -n "$postgres_db_value" ]]; then
      # EnvVar.value and EnvVar.valueFrom are mutually exclusive. Replace the
      # legacy literal with the reviewed ConfigMap reference atomically.
      "${KUBE[@]}" patch statefulset masterino-postgres -n "$NAMESPACE" --type=strategic --patch \
        '{"spec":{"template":{"spec":{"containers":[{"name":"postgres","env":[{"name":"POSTGRES_DB","value":null,"valueFrom":{"configMapKeyRef":{"name":"masterino-config","key":"LOBE_DB_NAME"}}}]}]}}}}'
    fi
  fi
}

check_secret() {
  local key value
  "${KUBE[@]}" get secret masterino-secret -n "$NAMESPACE" > /dev/null 2>&1 || fail \
    "masterino-secret is missing in namespace '$NAMESPACE'"
  for key in "${required_secret_keys[@]}"; do
    value="$("${KUBE[@]}" get secret masterino-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
    [[ -n "$value" ]] || fail "masterino-secret is missing key: $key"
  done
  "${KUBE[@]}" get secret masterino-bridge-secret -n "$NAMESPACE" > /dev/null 2>&1 || fail \
    "masterino-bridge-secret is missing in namespace '$NAMESPACE'"
  for key in "${required_bridge_secret_keys[@]}"; do
    value="$("${KUBE[@]}" get secret masterino-bridge-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
    [[ -n "$value" ]] || fail "masterino-bridge-secret is missing key: $key"
  done
  app_token="$("${KUBE[@]}" get secret masterino-secret -n "$NAMESPACE" -o jsonpath='{.data.AIHUB_BRIDGE_TOKEN}')"
  bridge_token="$("${KUBE[@]}" get secret masterino-bridge-secret -n "$NAMESPACE" -o jsonpath='{.data.AIHUB_BRIDGE_TOKEN}')"
  [[ "$app_token" == "$bridge_token" ]] || fail \
    "AIHUB_BRIDGE_TOKEN differs between application and bridge Secrets"
  if [[ "$ENVIRONMENT" == "test" ]]; then
    "${KUBE[@]}" get secret masterino-onlyboxes-secret -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "masterino-onlyboxes-secret is missing in namespace '$NAMESPACE'"
    value="$("${KUBE[@]}" get secret masterino-onlyboxes-secret -n "$NAMESPACE" \
      -o jsonpath='{.data.ONLYBOXES_JIT_SIGNING_KEY}')"
    [[ -n "$value" ]] || fail \
      "masterino-onlyboxes-secret is missing key: ONLYBOXES_JIT_SIGNING_KEY"
    "${KUBE[@]}" get configmap masterino-onlyboxes-ca -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "masterino-onlyboxes-ca is missing in namespace '$NAMESPACE'"
    "${KUBE[@]}" get secret masterino-market-secret -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "masterino-market-secret is missing in namespace '$NAMESPACE'"
    for key in "${required_market_secret_keys[@]}"; do
      value="$("${KUBE[@]}" get secret masterino-market-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
      [[ -n "$value" ]] || fail "masterino-market-secret is missing key: $key"
    done
    app_market_secret="$("${KUBE[@]}" get secret masterino-secret -n "$NAMESPACE" \
      -o jsonpath='{.data.MARKET_TRUSTED_CLIENT_SECRET}')"
    market_market_secret="$("${KUBE[@]}" get secret masterino-market-secret -n "$NAMESPACE" \
      -o jsonpath='{.data.MARKET_TRUSTED_CLIENT_SECRET}')"
    [[ "$app_market_secret" == "$market_market_secret" ]] || fail \
      "MARKET_TRUSTED_CLIENT_SECRET differs between application and Market Secrets"
  fi
  if searxng_enabled; then
    "${KUBE[@]}" get secret masterlion-searxng-secret -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "masterlion-searxng-secret is missing in namespace '$NAMESPACE'"
    for key in "${required_searxng_secret_keys[@]}"; do
      value="$("${KUBE[@]}" get secret masterlion-searxng-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
      [[ -n "$value" ]] || fail "masterlion-searxng-secret is missing key: $key"
    done
  fi
}

service_resource() {
  case "$1" in
    masterino) echo "deployment/masterino" ;;
    memory-worker) echo "deployment/masterino-memory-worker" ;;
    aihub-db-bridge) echo "deployment/masterino-aihub-db-bridge" ;;
    postgres) echo "statefulset/masterino-postgres" ;;
    redis) echo "statefulset/masterino-redis" ;;
    *) fail "unknown service: $1" ;;
  esac
}

case "$COMMAND" in
  preflight)
    verify_target read
    api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
    echo "ACK cluster ID: $EXPECTED_ACK_CLUSTER_ID"
    echo "Context: $EXPECTED_CONTEXT"
    echo "API server: $api_server"
    echo "Set before mutations: export ACK_API_SERVER='$api_server'"
    echo
    "${KUBE[@]}" get nodes -o wide
    echo
    "${KUBE[@]}" get storageclass
    echo
    "${KUBE[@]}" get csidriver diskplugin.csi.alibabacloud.com
    echo
    "${KUBE[@]}" get ingressclass nginx
    echo
    "${KUBE[@]}" get pods -n kube-system -o name | grep -E 'ingress|csi|acr-credential' || true
    if "${KUBE[@]}" get namespace "$NAMESPACE" > /dev/null 2>&1; then
      "${KUBE[@]}" get serviceaccount default -n "$NAMESPACE" -o jsonpath='Default service account pull secrets: {.imagePullSecrets}{"\n"}'
      "${KUBE[@]}" get secret "$ACR_PULL_SECRET_NAME" -n "$NAMESPACE" || true
      "${KUBE[@]}" get secret "$ACR_PULL_SECRET_NAME" -n "$NAMESPACE" || true
      "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" || true
    else
      echo "Namespace '$NAMESPACE' does not exist yet; run bootstrap after reviewing preflight."
    fi
    ;;
  render)
    render_manifests
    if [[ "$ENVIRONMENT" == "test" ]]; then
      render_market_manifests
    fi
    ;;
  validate)
    rendered="$(render_manifests)"
    printf '%s\n' "$rendered" | grep -q "image: ${MASTERINO_IMAGE}@${MASTERINO_IMAGE_DIGEST}"
    printf '%s\n' "$rendered" | grep -q "image: ${BRIDGE_IMAGE}@${BRIDGE_IMAGE_DIGEST}"
    if [[ "$ENVIRONMENT" == "test" ]]; then
      market_rendered="$(render_market_manifests)"
      printf '%s\n' "$market_rendered" | grep -q "image: ${MARKET_IMAGE}@${MARKET_IMAGE_DIGEST}"
      printf '%s\n' "$market_rendered" | grep -q 'name: masterino-market-db-bootstrap'
      printf '%s\n' "$market_rendered" | grep -q 'name: masterino-market-migrate'
      printf '%s\n' "$market_rendered" | grep -q 'replicas: 1'
      if printf '%s\n' "$market_rendered" | grep -q 'name: masterino-market-runner'; then
        fail "test Market must not deploy Connector Runner"
      fi
      if printf '%s\n' "$market_rendered" | grep -q '^kind: Ingress$'; then
        fail "test Market staging manifests unexpectedly contain an Ingress"
      fi
      market_seed_rendered="$(render_market_manifests "$MARKET_SEED_OVERLAY_DIR")"
      printf '%s\n' "$market_seed_rendered" | grep -q "image: ${MARKET_IMAGE}@${MARKET_IMAGE_DIGEST}"
      printf '%s\n' "$market_seed_rendered" | grep -q 'name: masterino-market-seed'
      printf '%s\n' "$market_seed_rendered" | grep -q '/api/internal/curated-seed'
      market_cutover_rendered="$(render_market_manifests "$MARKET_CUTOVER_OVERLAY_DIR")"
      printf '%s\n' "$market_cutover_rendered" | grep -q 'host: mlai-test.bielcrystal.com'
      printf '%s\n' "$market_cutover_rendered" | grep -Fq 'path: /market(/|$)(.*)'
      market_config_invariants=(
        'MARKET_BASE_URL: http://masterino-market:3220'
        'NEXT_PUBLIC_MARKET_BASE_URL: https://mlai-test.bielcrystal.com/market'
        'MARKET_TRUSTED_CLIENT_ID: masterino'
        'AGENTS_INDEX_URL: http://masterino-market:3220/indexes/agents'
        'PLUGINS_INDEX_URL: http://masterino-market:3220/indexes/plugins'
      )
      for invariant in "${market_config_invariants[@]}"; do
        printf '%s\n' "$rendered" | grep -Fq "$invariant" \
          || fail "test Market configuration is missing required value: $invariant"
      done
      if printf '%s\n' "$rendered" | grep -q 'MARKET_ALLOW_EXTERNAL_FALLBACK'; then
        fail "test application must not enable external Market fallback"
      fi
      printf '%s\n' "$rendered" | grep -q 'storageClassName: masterino-test-essd-retain'
      printf '%s\n' "$rendered" | grep -q 'memory: 4Gi' \
        || fail "test PostgreSQL memory limit must be 4Gi"
      printf '%s\n' "$market_rendered" | grep -Fq 'paradedb.enable_join_custom_scan = off' \
        || fail "test database bootstrap must disable ParadeDB join custom scans"
      printf '%s\n' "$market_rendered" | grep -Fq 'paradedb.enable_aggregate_custom_scan = off' \
        || fail "test database bootstrap must disable ParadeDB aggregate custom scans"
      if printf '%s\n' "$rendered" | grep -q '^kind: Namespace$'; then
        fail "test runtime manifests must not reapply the bootstrap Namespace"
      fi
      if printf '%s\n' "$rendered" | grep -q '^kind: StorageClass$'; then
        fail "test runtime manifests must not reapply the immutable bootstrap StorageClass"
      fi
      printf '%s\n' "$rendered" | grep -q 'name: masterino-memory-worker'
      printf '%s\n' "$rendered" | grep -Eq 'name: masterino-memory-config-[a-z0-9]{10}$' \
        || fail "test memory ConfigMap must use a content hash so configuration changes roll Pods"
      memory_config_invariants=(
        'FEATURE_FLAGS: +memory'
        'MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER: newapi'
        'MEMORY_USER_MEMORY_GATEKEEPER_MODEL: glm-5.2'
        'MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER: newapi'
        'MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL: glm-5.2'
        'MEMORY_USER_MEMORY_PERSONA_WRITER_PROVIDER: newapi'
        'MEMORY_USER_MEMORY_PERSONA_WRITER_MODEL: glm-5.2'
        'MEMORY_USER_MEMORY_EMBEDDING_PROVIDER: newapi'
        'MEMORY_USER_MEMORY_EMBEDDING_MODEL: text-embedding-3-large'
        'MEMORY_USER_MEMORY_CONCURRENCY: "1"'
      )
      for invariant in "${memory_config_invariants[@]}"; do
        printf '%s\n' "$rendered" | grep -Fq "$invariant" \
          || fail "test memory configuration is missing required value: $invariant"
      done
      office_invariants=(
        'OFFICECLI_ENABLED: "true"'
        'ONLYBOXES_BASE_URL: https://onlyboxes.internal.bielcrystal.com'
        'name: masterino-onlyboxes-secret'
        'name: masterino-onlyboxes-ca'
        'mountPath: /etc/ssl/certs/masterino-onlyboxes-ca.crt'
      )
      for invariant in "${office_invariants[@]}"; do
        printf '%s\n' "$rendered" | grep -Fq "$invariant" \
          || fail "test OfficeCLI configuration is missing required value: $invariant"
      done
      pinned_sandbox_env=(
        'SANDBOX_PROVIDER|value: onlyboxes'
        'ONLYBOXES_BASE_URL|value: https://onlyboxes.internal.bielcrystal.com'
        'ONLYBOXES_JIT_ISSUER|value: https://mlai-test.bielcrystal.com'
        'OFFICECLI_ENABLED|value: "true"'
      )
      for invariant in "${pinned_sandbox_env[@]}"; do
        name="${invariant%%|*}"
        value="${invariant#*|}"
        printf '%s\n' "$rendered" \
          | grep -A1 -F "name: $name" \
          | grep -Fq "$value" \
          || fail "test Deployment must pin $name directly to $value"
      done
      printf '%s\n' "$rendered" \
        | grep -A1 -F 'name: MEMORY_QUEUE_WORKER_ENABLED' \
        | grep -Fq 'value: "1"' \
        || fail "test memory worker must remain enabled"
      printf '%s\n' "$rendered" \
        | grep -A1 -F 'name: MEMORY_QUEUE_SCHEDULER_ENABLED' \
        | grep -Fq 'value: "0"' \
        || fail "test memory scheduler must remain paused until acceptance completes"
      printf '%s\n' "$rendered" | grep -q 'replicas: 1'
      if printf '%s\n' "$rendered" | grep -q 'kind: Ingress'; then
        fail "test staging manifests unexpectedly contain an Ingress"
      fi
      if printf '%s\n' "$rendered" | grep -q 'host: masterlion.bielcrystal.com'; then
        fail "test manifests contain the production hostname"
      fi
      cutover_rendered="$(render_manifests "$CUTOVER_OVERLAY_DIR")"
      printf '%s\n' "$cutover_rendered" | grep -q 'host: mlai-test.bielcrystal.com'
      printf '%s\n' "$cutover_rendered" | grep -q 'name: masterino-ingress'
      migration_rendered="$(render_manifests "$MIGRATION_OVERLAY_DIR")"
      printf '%s\n' "$migration_rendered" | grep -q 'replicas: 0'
      if printf '%s\n' "$migration_rendered" | grep -q 'kind: Ingress'; then
        fail "test migration manifests unexpectedly contain an Ingress"
      fi
      if printf '%s\n' "$migration_rendered" | grep -q 'host: masterlion.bielcrystal.com'; then
        fail "test migration manifests contain the production hostname"
      fi
    else
      printf '%s\n' "$rendered" | grep -q 'host: masterino.bielcrystal.com'
      printf '%s\n' "$rendered" | grep -q 'name: masterino-production-essd-retain'
      printf '%s\n' "$rendered" | grep -q 'reclaimPolicy: Retain'
      printf '%s\n' "$rendered" | grep -q 'replicas: 2'
      migration_rendered="$(render_manifests "$MIGRATION_OVERLAY_DIR")"
      printf '%s\n' "$migration_rendered" | grep -q 'replicas: 0'
      if printf '%s\n' "$migration_rendered" | grep -q '^kind: Ingress$'; then
        fail "production migration manifests unexpectedly contain an Ingress"
      fi
    fi
    echo "Kustomize rendering and environment invariants passed."
    ;;
  bootstrap)
    verify_target mutation
    if [[ "$ENVIRONMENT" == "production" ]]; then
      [[ "${CONFIRM_BOOTSTRAP:-}" == "$NAMESPACE" ]] || fail \
        "set CONFIRM_BOOTSTRAP=$NAMESPACE to create the guarded production target"
    fi
    "${KUBE[@]}" apply -f "$OVERLAY_DIR/namespace.yaml"
    if "${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" > /dev/null 2>&1; then
      storage_provisioner="$("${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" -o jsonpath='{.provisioner}')"
      storage_type="$("${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" -o jsonpath='{.parameters.type}')"
      storage_reclaim_policy="$("${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" -o jsonpath='{.reclaimPolicy}')"
      storage_binding_mode="$("${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" -o jsonpath='{.volumeBindingMode}')"
      storage_expansion="$("${KUBE[@]}" get storageclass "$STORAGE_CLASS_NAME" -o jsonpath='{.allowVolumeExpansion}')"
      [[ "$storage_provisioner" == "diskplugin.csi.alibabacloud.com" ]] || fail \
        "existing StorageClass '$STORAGE_CLASS_NAME' uses an unexpected provisioner"
      case "$storage_type" in
        cloud_essd | cloud_essd,cloud_ssd,cloud_efficiency) ;;
        *) fail "existing StorageClass '$STORAGE_CLASS_NAME' uses an unexpected disk type: $storage_type" ;;
      esac
      [[ "$storage_reclaim_policy" == "Retain" ]] || fail \
        "existing StorageClass '$STORAGE_CLASS_NAME' must retain volumes"
      [[ "$storage_binding_mode" == "WaitForFirstConsumer" ]] || fail \
        "existing StorageClass '$STORAGE_CLASS_NAME' has an unexpected binding mode"
      [[ "$storage_expansion" == "true" ]] || fail \
        "existing StorageClass '$STORAGE_CLASS_NAME' must allow volume expansion"
      echo "Existing StorageClass '$STORAGE_CLASS_NAME' passed immutable-field checks."
    else
      "${KUBE[@]}" apply -f "$OVERLAY_DIR/storageclass.yaml"
    fi
    verify_target mutation
    ;;
  create-secret)
    verify_target mutation
    secret_file="${1:-$OVERLAY_DIR/secret.env}"
    bridge_secret_file="${2:-$OVERLAY_DIR/bridge-secret.env}"
    searxng_secret_file="${3:-$OVERLAY_DIR/searxng-secret.env}"
    market_secret_file="${4:-$OVERLAY_DIR/market-secret.env}"
    [[ -f "$secret_file" ]] || fail "secret env file does not exist: $secret_file"
    [[ -f "$bridge_secret_file" ]] || fail "bridge secret env file does not exist: $bridge_secret_file"
    if [[ "$ENVIRONMENT" == "test" ]]; then
      if searxng_enabled; then
        [[ -f "$searxng_secret_file" ]] || fail "SearXNG secret env file does not exist: $searxng_secret_file"
      fi
      [[ -f "$market_secret_file" ]] || fail "Market secret env file does not exist: $market_secret_file"
    fi
    if grep -q 'CHANGE_ME' "$secret_file" || grep -q 'CHANGE_ME' "$bridge_secret_file" \
      || { [[ "$ENVIRONMENT" == "test" ]] && { { searxng_enabled && grep -q 'CHANGE_ME' "$searxng_secret_file"; } \
        || grep -q 'CHANGE_ME' "$market_secret_file"; }; }; then
      fail "a secret env file still contains CHANGE_ME placeholders"
    fi
    for key in "${required_secret_keys[@]}"; do
      grep -Eq "^${key}=.+" "$secret_file" || fail "secret env file is missing key: $key"
    done
    for key in "${required_bridge_secret_keys[@]}"; do
      grep -Eq "^${key}=.+" "$bridge_secret_file" || fail "bridge secret env file is missing key: $key"
    done
    if [[ "$ENVIRONMENT" == "test" ]]; then
      if searxng_enabled; then
        for key in "${required_searxng_secret_keys[@]}"; do
          grep -Eq "^${key}=.+" "$searxng_secret_file" || fail "SearXNG secret env file is missing key: $key"
        done
      fi
      for key in "${required_market_secret_keys[@]}"; do
        grep -Eq "^${key}=.+" "$market_secret_file" || fail "Market secret env file is missing key: $key"
      done
      app_market_secret="$(sed -n 's/^MARKET_TRUSTED_CLIENT_SECRET=//p' "$secret_file")"
      market_market_secret="$(sed -n 's/^MARKET_TRUSTED_CLIENT_SECRET=//p' "$market_secret_file")"
      [[ "$app_market_secret" == "$market_market_secret" ]] || fail \
        "MARKET_TRUSTED_CLIENT_SECRET must match in application and Market env files"
      [[ "$app_market_secret" =~ ^lobehub-market_tcs_[0-9a-fA-F]{64}$ ]] || fail \
        "MARKET_TRUSTED_CLIENT_SECRET must be lobehub-market_tcs_ followed by 64 hex characters"
      market_database_password="$(sed -n 's/^MARKET_DATABASE_PASSWORD=//p' "$market_secret_file")"
      [[ "$market_database_password" =~ ^[A-Za-z0-9_-]+$ ]] || fail \
        "MARKET_DATABASE_PASSWORD must be URL-safe"
      market_database_url="$(sed -n 's/^MARKET_DATABASE_URL=//p' "$market_secret_file")"
      [[ "$market_database_url" == "postgresql://masterino_market:${market_database_password}@masterino-postgres:5432/masterino_market" ]] || fail \
        "MARKET_DATABASE_URL must use the dedicated masterino_market role and database"
    fi
    s3_key="$(sed -n 's/^S3_ACCESS_KEY=//p' "$secret_file")"
    s3_key_id="$(sed -n 's/^S3_ACCESS_KEY_ID=//p' "$secret_file")"
    [[ -z "$s3_key" || "$s3_key" == "$s3_key_id" ]] || fail \
      "optional S3_ACCESS_KEY alias must match S3_ACCESS_KEY_ID"
    app_bridge_token="$(sed -n 's/^AIHUB_BRIDGE_TOKEN=//p' "$secret_file")"
    bridge_token="$(sed -n 's/^AIHUB_BRIDGE_TOKEN=//p' "$bridge_secret_file")"
    [[ "$app_bridge_token" == "$bridge_token" ]] || fail \
      "AIHUB_BRIDGE_TOKEN must match in the application and bridge env files"
    "${KUBE[@]}" create secret generic masterino-secret -n "$NAMESPACE" \
      --from-env-file="$secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
    "${KUBE[@]}" create secret generic masterino-bridge-secret -n "$NAMESPACE" \
      --from-env-file="$bridge_secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
    if [[ "$ENVIRONMENT" == "test" ]]; then
      if searxng_enabled; then
        "${KUBE[@]}" create secret generic masterlion-searxng-secret -n "$NAMESPACE" \
          --from-env-file="$searxng_secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
      fi
      "${KUBE[@]}" create secret generic masterino-market-secret -n "$NAMESPACE" \
        --from-env-file="$market_secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
    fi
    check_secret
    ;;
  deploy)
    verify_target mutation
    check_secret
    "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "TLS secret '$TLS_SECRET_NAME' is missing in namespace '$NAMESPACE'"
    "${KUBE[@]}" get secret "$ACR_PULL_SECRET_NAME" -n "$NAMESPACE" > /dev/null 2>&1 || fail \
      "ACR pull secret '$ACR_PULL_SECRET_NAME' is missing in namespace '$NAMESPACE'"
    deploy_overlay="$OVERLAY_DIR"
    cutover_complete="$("${KUBE[@]}" get namespace "$NAMESPACE" -o jsonpath='{.metadata.annotations.masterino\.io/cutover-complete}')"
    if [[ "$ENVIRONMENT" == "test" ]]; then
      # Apply and wait for PostgreSQL independently before database jobs or app traffic.
      render_manifests "$OVERLAY_DIR" \
        | "${KUBE[@]}" apply --server-side --field-manager=masterino-postgres-deploy \
          --force-conflicts --selector app.kubernetes.io/name=postgres -f -
      "${KUBE[@]}" rollout status statefulset/masterino-postgres -n "$NAMESPACE" --timeout=10m

      # Jobs have immutable Pod templates. Recreate only these exact, retained-data
      # jobs so each reviewed Market image runs its bootstrap and migrations.
      "${KUBE[@]}" delete job masterino-market-db-bootstrap masterino-market-migrate masterino-market-seed \
        -n "$NAMESPACE" --ignore-not-found --wait=true
      "${KUBE[@]}" apply -n "$NAMESPACE" -f "$MARKET_OVERLAY_DIR/database-bootstrap.yaml"
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-db-bootstrap --timeout=5m

      render_market_manifests "$MARKET_OVERLAY_DIR" \
        | "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts --dry-run=server -f - > /dev/null
      render_market_manifests "$MARKET_OVERLAY_DIR" \
        | "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts -f -
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-migrate --timeout=10m
      "${KUBE[@]}" rollout status deployment/masterino-market -n "$NAMESPACE" --timeout=10m

      render_market_manifests "$MARKET_SEED_OVERLAY_DIR" \
        | "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts --dry-run=server -f - > /dev/null
      render_market_manifests "$MARKET_SEED_OVERLAY_DIR" \
        | "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts -f -
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-seed --timeout=10m

      # Expose the TLS route only after /ready has made the API rollout healthy.
      if [[ "$cutover_complete" == "true" ]]; then
        "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts --dry-run=server \
          -f "$MARKET_CUTOVER_OVERLAY_DIR/ingress.yaml" > /dev/null
        "${KUBE[@]}" apply --server-side --field-manager=masterino-market-deploy \
          --force-conflicts -f "$MARKET_CUTOVER_OVERLAY_DIR/ingress.yaml"
      fi
    fi
    if [[ "$cutover_complete" == "true" ]]; then
      if [[ "$ENVIRONMENT" == "test" ]]; then
        deploy_overlay="$CUTOVER_OVERLAY_DIR"
      fi
    else
      deploy_overlay="$MIGRATION_OVERLAY_DIR"
      echo "Migration mode: Masterino will remain at zero replicas with no public Ingress."
    fi
    normalize_workload_schema_transitions
    render_manifests "$deploy_overlay" \
      | "${KUBE[@]}" apply --server-side --field-manager=masterino-deploy \
        --force-conflicts --dry-run=server -f - > /dev/null
    render_manifests "$deploy_overlay" \
      | "${KUBE[@]}" apply --server-side --field-manager=masterino-deploy \
        --force-conflicts -f -
    ;;
  start)
    verify_target mutation
    check_secret
    database_confirmation="${CONFIRM_DATABASE_READY:-${CONFIRM_DATA_RESTORED:-}}"
    [[ "$database_confirmation" == "$NAMESPACE" ]] || fail \
      "set CONFIRM_DATABASE_READY=$NAMESPACE after the fresh database is ready or a restore is validated"
    "${KUBE[@]}" scale deployment/masterino -n "$NAMESPACE" --replicas=1
    "${KUBE[@]}" rollout status deployment/masterino -n "$NAMESPACE" --timeout=10m
    if [[ "$ENVIRONMENT" == "test" ]]; then
      "${KUBE[@]}" scale deployment/masterino-memory-worker -n "$NAMESPACE" --replicas=1
      "${KUBE[@]}" rollout status deployment/masterino-memory-worker -n "$NAMESPACE" --timeout=10m
    fi
    ;;
  cutover)
    [[ "$ENVIRONMENT" == "test" ]] || fail "cutover is only used for the test environment"
    verify_target mutation
    [[ "${CONFIRM_CUTOVER:-}" == "$NAMESPACE" ]] || fail \
      "set CONFIRM_CUTOVER=$NAMESPACE after private validation succeeds"
    available="$("${KUBE[@]}" get deployment masterino -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}')"
    [[ "$available" == "1" ]] || fail "Masterino must have one available replica before cutover"
    worker_available="$("${KUBE[@]}" get deployment masterino-memory-worker -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}')"
    [[ "$worker_available" == "1" ]] || fail "Memory worker must have one available replica before cutover"
    source_replicas="$("${KUBE[@]}" get deployment masterlion -n "$SOURCE_NAMESPACE" -o jsonpath='{.spec.replicas}')"
    [[ "$source_replicas" == "0" ]] || fail \
      "the old Masterino deployment must be scaled to zero before final data sync and cutover"
    "${KUBE[@]}" get ingress "$SOURCE_INGRESS_NAME" -n "$SOURCE_NAMESPACE" > /dev/null
    render_manifests "$CUTOVER_OVERLAY_DIR" \
      | "${KUBE[@]}" apply --dry-run=client -f - > /dev/null
    "${KUBE[@]}" apply -f "$SOURCE_VERIFICATION_INGRESS"
    if ! render_manifests "$CUTOVER_OVERLAY_DIR" \
      | "${KUBE[@]}" apply --server-side --dry-run=server -f - > /dev/null; then
      "${KUBE[@]}" apply -f "$ROLLBACK_INGRESS"
      fail "cutover preflight failed; the old test Ingress was restored"
    fi
    if ! render_manifests "$CUTOVER_OVERLAY_DIR" | "${KUBE[@]}" apply --server-side -f -; then
      "${KUBE[@]}" apply -f "$ROLLBACK_INGRESS"
      fail "cutover failed; the old test Ingress was restored"
    fi
    "${KUBE[@]}" annotate namespace "$NAMESPACE" masterino.io/cutover-complete=true --overwrite
    ;;
  rollback)
    [[ "$ENVIRONMENT" == "test" ]] || fail "rollback is only used for the test environment"
    verify_target mutation
    [[ "${CONFIRM_ROLLBACK:-}" == "$SOURCE_NAMESPACE" ]] || fail \
      "set CONFIRM_ROLLBACK=$SOURCE_NAMESPACE to restore the old test Ingress"
    "${KUBE[@]}" delete ingress masterino-ingress -n "$NAMESPACE" --ignore-not-found
    "${KUBE[@]}" scale deployment/masterlion -n "$SOURCE_NAMESPACE" --replicas=1
    "${KUBE[@]}" rollout status deployment/masterlion -n "$SOURCE_NAMESPACE" --timeout=10m
    "${KUBE[@]}" apply -f "$ROLLBACK_INGRESS"
    "${KUBE[@]}" scale deployment/masterino -n "$NAMESPACE" --replicas=0
    "${KUBE[@]}" scale deployment/masterino-memory-worker -n "$NAMESPACE" --replicas=0
    "${KUBE[@]}" annotate namespace "$NAMESPACE" masterino.io/cutover-complete=false --overwrite
    ;;
  stop)
    verify_target mutation
    "${KUBE[@]}" scale deployment/masterino -n "$NAMESPACE" --replicas=0
    if [[ "$ENVIRONMENT" == "test" ]]; then
      "${KUBE[@]}" scale deployment/masterino-memory-worker -n "$NAMESPACE" --replicas=0
    fi
    ;;
  status)
    verify_target read
    "${KUBE[@]}" get pods,services,ingress,statefulsets,deployments,pvc -n "$NAMESPACE" -o wide
    ;;
  rollout)
    verify_target read
    "${KUBE[@]}" rollout status statefulset/masterino-postgres -n "$NAMESPACE" --timeout=10m
    "${KUBE[@]}" rollout status statefulset/masterino-redis -n "$NAMESPACE" --timeout=10m
    "${KUBE[@]}" rollout status deployment/masterino-aihub-db-bridge -n "$NAMESPACE" --timeout=10m
    replicas="$("${KUBE[@]}" get deployment masterino -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
    if [[ "$replicas" != "0" ]]; then
      "${KUBE[@]}" rollout status deployment/masterino -n "$NAMESPACE" --timeout=10m
    fi
    if [[ "$ENVIRONMENT" == "test" ]]; then
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-db-bootstrap --timeout=5m
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-migrate --timeout=10m
      "${KUBE[@]}" wait -n "$NAMESPACE" --for=condition=complete \
        job/masterino-market-seed --timeout=10m
      "${KUBE[@]}" rollout status deployment/masterino-market -n "$NAMESPACE" --timeout=10m
      worker_replicas="$("${KUBE[@]}" get deployment masterino-memory-worker -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
      if [[ "$worker_replicas" != "0" ]]; then
        "${KUBE[@]}" rollout status deployment/masterino-memory-worker -n "$NAMESPACE" --timeout=10m
      fi
    fi
    ;;
  logs)
    verify_target read
    service="${1:-masterino}"
    case "$service" in
      masterino | aihub-db-bridge)
        "${KUBE[@]}" logs -n "$NAMESPACE" -l "app.kubernetes.io/name=$service" --tail=100 -f
        ;;
      memory-worker)
        "${KUBE[@]}" logs -n "$NAMESPACE" -l "app.kubernetes.io/name=masterino-memory-worker" --tail=100 -f
        ;;
      postgres)
        "${KUBE[@]}" logs -n "$NAMESPACE" masterino-postgres-0 --tail=100 -f
        ;;
      redis)
        "${KUBE[@]}" logs -n "$NAMESPACE" masterino-redis-0 --tail=100 -f
        ;;
      *) fail "unknown service: $service" ;;
    esac
    ;;
  restart)
    verify_target mutation
    service="${1:-masterino}"
    resource="$(service_resource "$service")"
    "${KUBE[@]}" rollout restart -n "$NAMESPACE" "$resource"
    "${KUBE[@]}" rollout status -n "$NAMESPACE" "$resource" --timeout=10m
    ;;
  port-forward)
    verify_target read
    port="${1:-3210}"
    "${KUBE[@]}" port-forward -n "$NAMESPACE" service/masterino "${port}:3210"
    ;;
  update-image)
    verify_target mutation
    service="${1:-}"
    image="${2:-}"
    [[ "$service" == "masterino" || "$service" == "memory-worker" || "$service" == "aihub-db-bridge" ]] || fail \
      "update-image supports masterino, memory-worker, or aihub-db-bridge"
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "image must be pinned as image@sha256:digest"
    deployment="$service"
    [[ "$service" == "aihub-db-bridge" ]] && deployment="masterino-aihub-db-bridge"
    [[ "$service" == "memory-worker" ]] && deployment="masterino-memory-worker"
    container="$service"
    [[ "$service" == "memory-worker" ]] && container="masterino-memory-worker"
    "${KUBE[@]}" set image --field-manager=kubectl -n "$NAMESPACE" \
      "deployment/$deployment" "$container=$image"
    "${KUBE[@]}" rollout status -n "$NAMESPACE" "deployment/$deployment" --timeout=10m
    ;;
  info)
    verify_target read
    echo "ACK cluster ID: $EXPECTED_ACK_CLUSTER_ID"
    echo "ACK region: $EXPECTED_ACK_REGION"
    echo "Environment: $ENVIRONMENT"
    echo "Namespace: $NAMESPACE"
    "${KUBE[@]}" cluster-info | head -1
    "${KUBE[@]}" get namespace "$NAMESPACE" -o yaml
    ;;
  "" | -h | --help | help)
    usage
    ;;
  *)
    usage
    fail "unknown command: $COMMAND"
    ;;
esac
