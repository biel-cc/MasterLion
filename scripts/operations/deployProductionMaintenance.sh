#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/production-maintenance"
NAMESPACE="masterlion"
EXPECTED_REGION="cn-shenzhen"
IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino"
IMAGE_MARKER="maintenance-source"
TLS_SECRET_NAME="20261122bielcrystal.com"
PULL_SECRET_NAME="acr-credential-secret-aggregation"
MAINTENANCE_HOST="masterino.bielcrystal.com"

usage() {
  cat << 'EOF'
Masterino production maintenance entrypoint

Usage:
  scripts/operations/deployProductionMaintenance.sh <command>

Required for cluster commands:
  KUBECONFIG                         Explicit production ACK kubeconfig outside the repository
  ACK_CONTEXT                       Exact kubeconfig context

Required for mutating commands:
  ACK_API_SERVER                    Exact API server printed by preflight
  MAINTENANCE_IMAGE_DIGEST          Existing masterino image digest (sha256:...)

Commands:
  preflight   Read-only cluster, namespace, TLS and old-Ingress checks
  render      Render the standalone overlay with an immutable image digest
  validate    Verify that only the new hostname and maintenance resources are rendered
  deploy      Server dry-run, apply, and wait for the maintenance rollout
  status      Show maintenance workloads, Service and Ingress
  rollback    Delete only the standalone maintenance Ingress/workload resources
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || {
  usage
  exit 1
}

KUBE=()

init_kube() {
  command -v kubectl > /dev/null 2>&1 || fail "kubectl is not installed"
  [[ -n "${KUBECONFIG:-}" ]] || fail "KUBECONFIG is required"
  [[ -f "$KUBECONFIG" ]] || fail "KUBECONFIG does not exist: $KUBECONFIG"
  [[ -n "${ACK_CONTEXT:-}" ]] || fail "ACK_CONTEXT is required"
  KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT")
}

verify_target() {
  local mutation="${1:-read}" current_context api_server regions ingress_inventory certificate_sans

  init_kube
  command -v base64 > /dev/null 2>&1 || fail "base64 is not installed"
  command -v openssl > /dev/null 2>&1 || fail "openssl is not installed"
  current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
  [[ "$current_context" == "$ACK_CONTEXT" ]] || fail \
    "current context '$current_context' does not match ACK_CONTEXT '$ACK_CONTEXT'"

  api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
  [[ -n "$api_server" ]] || fail "could not determine ACK API server"
  if [[ "$mutation" == "mutation" ]]; then
    [[ -n "${ACK_API_SERVER:-}" ]] || fail "ACK_API_SERVER is required for mutations"
    [[ "$api_server" == "$ACK_API_SERVER" ]] || fail "ACK API server mismatch"
  fi

  regions="$("${KUBE[@]}" get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/region}{"\n"}{end}' | sed '/^$/d' | sort -u)"
  [[ "$regions" == "$EXPECTED_REGION" ]] || fail \
    "expected ACK region '$EXPECTED_REGION', found '${regions:-none}'"

  "${KUBE[@]}" get namespace "$NAMESPACE" > /dev/null
  "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" > /dev/null
  "${KUBE[@]}" get secret "$PULL_SECRET_NAME" -n "$NAMESPACE" > /dev/null
  "${KUBE[@]}" get ingressclass nginx > /dev/null
  "${KUBE[@]}" get ingress -n "$NAMESPACE" -o yaml | grep -q 'masterion.bielcrystal.com' || fail \
    "legacy production Ingress for masterion.bielcrystal.com was not found in '$NAMESPACE'"

  "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.tls\.crt}' \
    | base64 --decode | openssl x509 -checkend 604800 -noout \
    || fail "TLS certificate expires within seven days or cannot be parsed"
  certificate_sans="$(
    "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.tls\.crt}' \
      | base64 --decode | openssl x509 -noout -ext subjectAltName
  )"
  printf '%s\n' "$certificate_sans" \
    | grep -Eq 'DNS:\*\.bielcrystal\.com|DNS:masterino\.bielcrystal\.com' \
    || fail "TLS certificate does not cover $MAINTENANCE_HOST"

  ingress_inventory="$(
    "${KUBE[@]}" get ingress -A \
      -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{range .spec.rules[*]}{.host}{" "}{end}{"\n"}{end}'
  )"
  while IFS=$'\t' read -r ingress_namespace ingress_name ingress_hosts; do
    [[ " $ingress_hosts " == *" $MAINTENANCE_HOST "* ]] || continue
    [[ "$ingress_namespace" == "$NAMESPACE" && "$ingress_name" == "masterino-maintenance" ]] || fail \
      "$MAINTENANCE_HOST is already owned by ingress $ingress_namespace/$ingress_name"
  done <<< "$ingress_inventory"

  echo "ACK context: $ACK_CONTEXT"
  echo "ACK API server: $api_server"
  echo "Namespace: $NAMESPACE"
  echo "Set before mutations: export ACK_API_SERVER='$api_server'"
}

require_digest() {
  [[ "${MAINTENANCE_IMAGE_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail \
    "MAINTENANCE_IMAGE_DIGEST must be an immutable sha256 digest"
}

render() {
  require_digest
  kubectl kustomize "$OVERLAY_DIR" | sed \
    -e "s|${IMAGE}:${IMAGE_MARKER}|${IMAGE}@${MAINTENANCE_IMAGE_DIGEST}|g"
}

validate_rendered() {
  local rendered="$1"
  printf '%s\n' "$rendered" | grep -q "image: ${IMAGE}@${MAINTENANCE_IMAGE_DIGEST}"
  [[ "$(printf '%s\n' "$rendered" | grep -c 'masterino.bielcrystal.com')" -eq 2 ]] || fail \
    "rendered manifests must contain only the TLS host and rule for $MAINTENANCE_HOST"
  if printf '%s\n' "$rendered" | grep -Eq 'host: masterion\.bielcrystal\.com|host: masterlion\.bielcrystal\.com'; then
    fail "maintenance overlay must not modify a legacy hostname"
  fi
  if printf '%s\n' "$rendered" | grep -Eq '^kind: (StatefulSet|Secret)$'; then
    fail "maintenance overlay must not contain stateful workloads or Secrets"
  fi
  printf '%s\n' "$rendered" | grep -q 'name: masterino-maintenance'
  printf '%s\n' "$rendered" | grep -q 'namespace: masterlion'
}

case "$COMMAND" in
  preflight)
    verify_target read
    "${KUBE[@]}" get ingress,service,deployment -n "$NAMESPACE" -l app.kubernetes.io/name=masterino-maintenance
    ;;
  render)
    render
    ;;
  validate)
    rendered="$(render)"
    validate_rendered "$rendered"
    echo "Maintenance overlay invariants passed."
    ;;
  deploy)
    verify_target mutation
    rendered="$(render)"
    validate_rendered "$rendered"
    printf '%s\n' "$rendered" | "${KUBE[@]}" apply --dry-run=server -f -
    printf '%s\n' "$rendered" | "${KUBE[@]}" apply -f -
    "${KUBE[@]}" rollout status deployment/masterino-maintenance -n "$NAMESPACE" --timeout=180s
    "${KUBE[@]}" get ingress masterino-maintenance -n "$NAMESPACE" -o wide
    ;;
  status)
    verify_target read
    "${KUBE[@]}" get deployment,pod,service,ingress,pdb -n "$NAMESPACE" \
      -l app.kubernetes.io/name=masterino-maintenance -o wide
    ;;
  rollback)
    verify_target mutation
    rendered="$(render)"
    validate_rendered "$rendered"
    printf '%s\n' "$rendered" | "${KUBE[@]}" delete -f - --ignore-not-found
    ;;
  *)
    usage
    fail "unknown command: $COMMAND"
    ;;
esac
