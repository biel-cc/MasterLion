#!/usr/bin/env bash
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACK_CLUSTER_ID="${ACK_CLUSTER_ID:-c23ea84b986c446d5b3fa9227962e77f4}"
ACK_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-production-admin}"
ACK_REGION="${ACK_REGION:-cn-shenzhen}"
ACK_PRIVATE_IP_ADDRESS="${ACK_PRIVATE_IP_ADDRESS:-false}"
ACK_KUBECONFIG_MINUTES="${ACK_KUBECONFIG_MINUTES:-120}"
ACK_PRODUCTION_ADMIN_ACTION="${ACK_PRODUCTION_ADMIN_ACTION:-validate}"

NAMESPACE="masterlion"
ADMIN_HOST="admin-masterino.bielcrystal.com"
PRIMARY_HOST="masterino.bielcrystal.com"
ADMIN_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-admin"
MASTERINO_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino"
MARKET_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-market"
ADMIN_IMAGE_PLACEHOLDER="${ADMIN_IMAGE}:unreleased"
ADMIN_OVERLAY="$ROOT_DIR/k8s/overlays/production-admin"
ADMIN_CUTOVER_OVERLAY="$ROOT_DIR/k8s/overlays/production-admin-cutover"
PRODUCTION_CONFIGMAP="$ROOT_DIR/k8s/overlays/production-bluegreen/configmap.yaml"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" > /dev/null 2>&1 || fail "required command is missing: $1"
}

require_digest() {
  local name="$1" value="$2"
  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "$name must be an immutable sha256 digest"
}

require_release_digests() {
  require_digest ADMIN_IMAGE_DIGEST "${ADMIN_IMAGE_DIGEST:-}"
  require_digest MASTERINO_IMAGE_DIGEST "${MASTERINO_IMAGE_DIGEST:-}"
  require_digest MARKET_IMAGE_DIGEST "${MARKET_IMAGE_DIGEST:-}"
}

require_rollback_digests() {
  require_digest ROLLBACK_MASTERINO_IMAGE_DIGEST "${ROLLBACK_MASTERINO_IMAGE_DIGEST:-}"
  require_digest ROLLBACK_MARKET_IMAGE_DIGEST "${ROLLBACK_MARKET_IMAGE_DIGEST:-}"
}

cleanup() {
  set +e
  [[ -n "${KUBECONFIG_FILE:-}" ]] && rm -f -- "$KUBECONFIG_FILE"
  [[ -n "${ACK_RESPONSE_FILE:-}" ]] && rm -f -- "$ACK_RESPONSE_FILE"
  [[ -n "${TEMP_DIR:-}" ]] && rmdir -- "$TEMP_DIR" 2> /dev/null
}

prepare_kubeconfig() {
  case "$ACK_PRIVATE_IP_ADDRESS" in
    true | false) ;;
    *) fail "ACK_PRIVATE_IP_ADDRESS must be true or false" ;;
  esac
  [[ "$ACK_KUBECONFIG_MINUTES" =~ ^[0-9]+$ ]] \
    || fail "ACK_KUBECONFIG_MINUTES must be an integer"
  ((ACK_KUBECONFIG_MINUTES >= 15 && ACK_KUBECONFIG_MINUTES <= 4320)) \
    || fail "ACK_KUBECONFIG_MINUTES must be between 15 and 4320"

  aliyun cs describe-cluster-user-kubeconfig \
    --cluster-id "$ACK_CLUSTER_ID" \
    --private-ip-address "$ACK_PRIVATE_IP_ADDRESS" \
    --region "$ACK_REGION" \
    --temporary-duration-minutes "$ACK_KUBECONFIG_MINUTES" \
    > "$ACK_RESPONSE_FILE"
  node -e '
    const fs = require("node:fs");
    const response = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof response.config !== "string" || response.config.length === 0) process.exit(1);
    process.stdout.write(response.config);
  ' "$ACK_RESPONSE_FILE" > "$KUBECONFIG_FILE"
  chmod 600 "$KUBECONFIG_FILE"

  local current_context
  current_context="$(kubectl --kubeconfig "$KUBECONFIG_FILE" config current-context)"
  [[ -n "$current_context" ]] || fail "ACK returned a kubeconfig without a current context"
  if [[ "$current_context" != "$ACK_CONTEXT" ]]; then
    kubectl --kubeconfig "$KUBECONFIG_FILE" config \
      rename-context "$current_context" "$ACK_CONTEXT" > /dev/null
  fi
  export KUBECONFIG="$KUBECONFIG_FILE"
}

preflight() {
  [[ "$(kubectl config current-context)" == "$ACK_CONTEXT" ]] \
    || fail "unexpected Kubernetes context"
  kubectl get namespace "$NAMESPACE" > /dev/null
  kubectl get ingressclass nginx > /dev/null
  kubectl -n "$NAMESPACE" get deployment masterino masterino-memory-worker masterino-market \
    > /dev/null
  kubectl -n "$NAMESPACE" get service masterino > /dev/null
  kubectl -n "$NAMESPACE" get configmap masterino-config > /dev/null
  kubectl -n "$NAMESPACE" get secret 20261122bielcrystal.com \
    acr-credential-secret-aggregation > /dev/null
  [[ "$(kubectl auth can-i patch deployments.apps -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot patch production deployments"
  [[ "$(kubectl auth can-i patch configmaps -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot patch the production ConfigMap"
  [[ "$(kubectl auth can-i create deployments.apps -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot create the Admin deployment"
  [[ "$(kubectl auth can-i create ingresses.networking.k8s.io -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot create the Admin Ingress"
}

render_admin_overlay() {
  local overlay="$1"
  require_digest ADMIN_IMAGE_DIGEST "${ADMIN_IMAGE_DIGEST:-}"
  local rendered
  rendered="$(kubectl kustomize "$overlay")"
  [[ "$(grep -Foc "$ADMIN_IMAGE_PLACEHOLDER" <<< "$rendered")" -eq 1 ]] \
    || fail "rendered overlay must contain exactly one Admin image placeholder"
  sed "s|$ADMIN_IMAGE_PLACEHOLDER|$ADMIN_IMAGE@$ADMIN_IMAGE_DIGEST|" <<< "$rendered"
}

validate() {
  preflight
  require_release_digests
  local rendered
  rendered="$(render_admin_overlay "$ADMIN_CUTOVER_OVERLAY")"
  grep -Fq "namespace: $NAMESPACE" <<< "$rendered" \
    || fail "rendered Admin resources are missing the production namespace"
  grep -Fq "host: $ADMIN_HOST" <<< "$rendered" \
    || fail "rendered Admin Ingress does not use the production hostname"
  grep -Fq "image: $ADMIN_IMAGE@$ADMIN_IMAGE_DIGEST" <<< "$rendered" \
    || fail "rendered Admin workload does not use the immutable digest"
  grep -Fq "APP_URL_ALLOWED_HOSTS: '$PRIMARY_HOST,$ADMIN_HOST'" "$PRODUCTION_CONFIGMAP" \
    || fail "production ConfigMap does not allow the Admin hostname"
  printf '%s\n' "$rendered" | kubectl apply --dry-run=server -f - > /dev/null
  echo "Production Admin manifests passed server-side validation"
}

assert_private_admin() {
  if kubectl -n "$NAMESPACE" get ingress masterino-admin-ingress > /dev/null 2>&1; then
    fail "Admin Ingress already exists; run rollback before a new private deployment"
  fi
}

patch_allowed_hosts() {
  kubectl -n "$NAMESPACE" patch configmap masterino-config --type merge --patch \
    "{\"data\":{\"APP_URL_ALLOWED_HOSTS\":\"$PRIMARY_HOST,$ADMIN_HOST\"}}" > /dev/null
}

deploy_private() {
  assert_private_admin
  patch_allowed_hosts

  kubectl -n "$NAMESPACE" set image deployment/masterino-market \
    "masterino-market=$MARKET_IMAGE@$MARKET_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-market --timeout=10m

  kubectl -n "$NAMESPACE" set image deployment/masterino \
    "masterino=$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" set image deployment/masterino-memory-worker \
    "masterino-memory-worker=$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" rollout status deployment/masterino --timeout=10m
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-memory-worker --timeout=10m

  local rendered
  rendered="$(render_admin_overlay "$ADMIN_OVERLAY")"
  printf '%s\n' "$rendered" | kubectl apply -f -
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-admin --timeout=5m
  kubectl -n "$NAMESPACE" get endpoints masterino-admin
}

assert_release_images() {
  local actual
  actual="$(kubectl -n "$NAMESPACE" get deployment masterino \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino")].image}')"
  [[ "$actual" == "$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST" ]] \
    || fail "Masterino deployment is not using the approved release digest"
  actual="$(kubectl -n "$NAMESPACE" get deployment masterino-memory-worker \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino-memory-worker")].image}')"
  [[ "$actual" == "$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST" ]] \
    || fail "Memory Worker is not using the approved release digest"
  actual="$(kubectl -n "$NAMESPACE" get deployment masterino-market \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino-market")].image}')"
  [[ "$actual" == "$MARKET_IMAGE@$MARKET_IMAGE_DIGEST" ]] \
    || fail "Market deployment is not using the approved release digest"
  actual="$(kubectl -n "$NAMESPACE" get deployment masterino-admin \
    -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino-admin")].image}')"
  [[ "$actual" == "$ADMIN_IMAGE@$ADMIN_IMAGE_DIGEST" ]] \
    || fail "Admin deployment is not using the approved release digest"
}

cutover() {
  assert_release_images
  [[ "$(kubectl -n "$NAMESPACE" get deployment masterino-admin \
    -o jsonpath='{.status.readyReplicas}')" == "2" ]] \
    || fail "Admin deployment does not have two ready replicas"
  [[ -n "$(kubectl -n "$NAMESPACE" get endpoints masterino-admin \
    -o jsonpath='{.subsets[*].addresses[*].ip}')" ]] \
    || fail "Admin service has no ready endpoints"
  [[ "$(kubectl -n "$NAMESPACE" get configmap masterino-config \
    -o jsonpath='{.data.APP_URL_ALLOWED_HOSTS}')" == "$PRIMARY_HOST,$ADMIN_HOST" ]] \
    || fail "production ConfigMap does not allow the Admin hostname"
  kubectl -n "$NAMESPACE" apply --dry-run=server \
    -f "$ADMIN_CUTOVER_OVERLAY/ingress.yaml" > /dev/null
  kubectl -n "$NAMESPACE" apply -f "$ADMIN_CUTOVER_OVERLAY/ingress.yaml"
  kubectl -n "$NAMESPACE" get ingress masterino-admin-ingress -o wide
}

rollback() {
  kubectl -n "$NAMESPACE" delete ingress masterino-admin-ingress --ignore-not-found
  kubectl -n "$NAMESPACE" patch configmap masterino-config --type merge --patch \
    "{\"data\":{\"APP_URL_ALLOWED_HOSTS\":\"$PRIMARY_HOST\"}}" > /dev/null
  kubectl -n "$NAMESPACE" set image deployment/masterino-market \
    "masterino-market=$MARKET_IMAGE@$ROLLBACK_MARKET_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" set image deployment/masterino \
    "masterino=$MASTERINO_IMAGE@$ROLLBACK_MASTERINO_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" set image deployment/masterino-memory-worker \
    "masterino-memory-worker=$MASTERINO_IMAGE@$ROLLBACK_MASTERINO_IMAGE_DIGEST"
  kubectl -n "$NAMESPACE" scale deployment/masterino-admin --replicas=0
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-market --timeout=10m
  kubectl -n "$NAMESPACE" rollout status deployment/masterino --timeout=10m
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-memory-worker --timeout=10m
}

status() {
  kubectl -n "$NAMESPACE" get deployment/masterino deployment/masterino-memory-worker \
    deployment/masterino-market deployment/masterino-admin -o wide \
    || true
  kubectl -n "$NAMESPACE" get service/masterino-admin ingress/masterino-admin-ingress \
    endpoints/masterino-admin -o wide || true
  kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name=masterino-admin -o wide
  kubectl -n "$NAMESPACE" logs -l app.kubernetes.io/name=masterino-admin \
    --all-containers --prefix --tail=100 || true
}

require_command aliyun
require_command chmod
require_command grep
require_command kubectl
require_command mktemp
require_command node
require_command sed

TEMP_DIR="$(mktemp -d)"
KUBECONFIG_FILE="$TEMP_DIR/kubeconfig"
ACK_RESPONSE_FILE="$TEMP_DIR/ack-response.json"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT_DIR"
prepare_kubeconfig

case "$ACK_PRODUCTION_ADMIN_ACTION" in
  preflight)
    preflight
    ;;
  validate)
    validate
    ;;
  deploy-private)
    [[ "${CONFIRM_ACK_PRODUCTION_ADMIN_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_PRODUCTION_ADMIN_DEPLOY=$NAMESPACE to authorize production deployment"
    validate
    deploy_private
    status
    ;;
  cutover)
    [[ "${CONFIRM_ACK_PRODUCTION_ADMIN_CUTOVER:-}" == "$ADMIN_HOST" ]] \
      || fail "set CONFIRM_ACK_PRODUCTION_ADMIN_CUTOVER=$ADMIN_HOST to authorize public cutover"
    validate
    cutover
    status
    ;;
  rollback)
    [[ "${CONFIRM_ACK_PRODUCTION_ADMIN_ROLLBACK:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_PRODUCTION_ADMIN_ROLLBACK=$NAMESPACE to authorize rollback"
    preflight
    require_rollback_digests
    rollback
    status
    ;;
  status)
    preflight
    status
    ;;
  *)
    fail "ACK_PRODUCTION_ADMIN_ACTION must be preflight, validate, deploy-private, cutover, rollback, or status"
    ;;
esac
