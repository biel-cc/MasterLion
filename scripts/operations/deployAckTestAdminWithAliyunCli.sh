#!/usr/bin/env bash
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACK_CLUSTER_ID="${ACK_CLUSTER_ID:-c23ea84b986c446d5b3fa9227962e77f4}"
ACK_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-test-admin}"
ACK_REGION="${ACK_REGION:-cn-shenzhen}"
ACK_PRIVATE_IP_ADDRESS="${ACK_PRIVATE_IP_ADDRESS:-false}"
ACK_KUBECONFIG_MINUTES="${ACK_KUBECONFIG_MINUTES:-120}"
ACK_TEST_ADMIN_ACTION="${ACK_TEST_ADMIN_ACTION:-validate}"

NAMESPACE="masterino-test"
ADMIN_HOST="admin-mlai-test.bielcrystal.com"
ADMIN_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-admin"
ADMIN_IMAGE_PLACEHOLDER="${ADMIN_IMAGE}:unreleased"
ADMIN_OVERLAY="$ROOT_DIR/k8s/overlays/test-admin"
ADMIN_CUTOVER_OVERLAY="$ROOT_DIR/k8s/overlays/test-admin-cutover"
TEST_CONFIGMAP="$ROOT_DIR/k8s/overlays/test/configmap.yaml"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" > /dev/null 2>&1 || fail "required command is missing: $1"
}

require_digest() {
  [[ -n "${ADMIN_IMAGE_DIGEST:-}" ]] || fail "required environment variable is missing: ADMIN_IMAGE_DIGEST"
  [[ "$ADMIN_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "ADMIN_IMAGE_DIGEST must be an immutable sha256 digest"
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
  kubectl -n "$NAMESPACE" get service masterino > /dev/null
  kubectl -n "$NAMESPACE" get secret 20261122bielcrystal.com > /dev/null
  [[ "$(kubectl auth can-i create deployments.apps -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot create deployments in $NAMESPACE"
  [[ "$(kubectl auth can-i create ingresses.networking.k8s.io -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot create ingresses in $NAMESPACE"
  [[ "$(kubectl auth can-i patch deployments.apps -n "$NAMESPACE")" == "yes" ]] \
    || fail "current identity cannot restart the Masterino deployment"
}

render_overlay() {
  local overlay="$1"
  require_digest
  local rendered
  rendered="$(kubectl kustomize "$overlay")"
  [[ "$(grep -Foc "$ADMIN_IMAGE_PLACEHOLDER" <<< "$rendered")" -eq 1 ]] \
    || fail "rendered overlay must contain exactly one Admin image placeholder"
  sed "s|$ADMIN_IMAGE_PLACEHOLDER|$ADMIN_IMAGE@$ADMIN_IMAGE_DIGEST|" <<< "$rendered"
}

validate() {
  preflight
  local rendered
  rendered="$(render_overlay "$ADMIN_CUTOVER_OVERLAY")"
  grep -Fq "namespace: $NAMESPACE" <<< "$rendered" \
    || fail "rendered Admin resources are missing the test namespace"
  grep -Fq "host: $ADMIN_HOST" <<< "$rendered" \
    || fail "rendered Admin Ingress does not use the approved test hostname"
  grep -Fq "image: $ADMIN_IMAGE@$ADMIN_IMAGE_DIGEST" <<< "$rendered" \
    || fail "rendered Admin workload does not use the immutable digest"
  printf '%s\n' "$rendered" | kubectl apply --dry-run=server -f - > /dev/null
  echo "Admin manifests passed server-side validation"
}

deploy_admin() {
  local rendered
  rendered="$(render_overlay "$ADMIN_OVERLAY")"
  printf '%s\n' "$rendered" | kubectl apply -f -
  kubectl -n "$NAMESPACE" rollout status deployment/masterino-admin --timeout=5m
}

cutover_admin() {
  deploy_admin
  kubectl -n "$NAMESPACE" apply -f "$TEST_CONFIGMAP"
  kubectl -n "$NAMESPACE" rollout restart deployment/masterino
  kubectl -n "$NAMESPACE" rollout status deployment/masterino --timeout=10m

  local rendered
  rendered="$(render_overlay "$ADMIN_CUTOVER_OVERLAY")"
  printf '%s\n' "$rendered" | kubectl apply -f -
  kubectl -n "$NAMESPACE" get ingress masterino-admin-ingress
}

status() {
  kubectl -n "$NAMESPACE" get deployment/masterino-admin service/masterino-admin -o wide
  kubectl -n "$NAMESPACE" get ingress/masterino-admin-ingress -o wide \
    || echo "Admin Ingress has not been created"
  kubectl -n "$NAMESPACE" get endpoints masterino-admin
  kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name=masterino-admin -o wide
  kubectl -n "$NAMESPACE" describe pods -l app.kubernetes.io/name=masterino-admin
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

case "$ACK_TEST_ADMIN_ACTION" in
  preflight)
    preflight
    ;;
  validate)
    require_digest
    validate
    ;;
  deploy)
    [[ "${CONFIRM_ACK_TEST_ADMIN_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_ADMIN_DEPLOY=$NAMESPACE to authorize a test Admin deployment"
    require_digest
    validate
    deploy_admin
    ;;
  cutover)
    [[ "${CONFIRM_ACK_TEST_ADMIN_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_ADMIN_DEPLOY=$NAMESPACE to authorize the test Admin cutover"
    require_digest
    validate
    cutover_admin
    status
    ;;
  status)
    preflight
    status
    ;;
  *)
    fail "ACK_TEST_ADMIN_ACTION must be preflight, validate, deploy, cutover, or status"
    ;;
esac
