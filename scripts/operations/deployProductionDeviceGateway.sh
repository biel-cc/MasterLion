#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAMESPACE="masterlion"
EXPECTED_CONTEXT="ack-c23ea84b-masterino-production"
EXPECTED_REGION="cn-shenzhen"
WORKLOAD_OVERLAY="$SCRIPT_DIR/k8s/overlays/production-live-gateway"
CUTOVER_OVERLAY="$SCRIPT_DIR/k8s/overlays/production-live-gateway-cutover"
MASTERINO_ENV_PATCH="$WORKLOAD_OVERLAY/masterino-env-patch.yaml"
MASTERINO_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino"
BRIDGE_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-aihub-db-bridge"
GATEWAY_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-device-gateway"
GATEWAY_DIGEST="sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d"
PUBLIC_HEALTH_URL="https://masterino.bielcrystal.com/device-gateway/health"
KUBE=()

usage() {
  cat << 'EOF'
Usage: scripts/operations/deployProductionDeviceGateway.sh <command> [arguments]

Commands:
  preflight                  Read-only current-production identity and workload checks.
  render                     Render only the Gateway Deployment and Service.
  validate                   Validate workload, patch and gated Ingress invariants.
  create-secret [env-file]   Create the production-only Gateway Secret.
  deploy                     Deploy privately and patch the existing Masterino Deployment.
  cutover                    Add only the public /device-gateway Ingress after private health.
  rollback                   Remove only the public Device Gateway Ingress.
  status                     Show current Gateway resources and Masterino rollout state.

Required for cluster commands:
  KUBECONFIG, ACK_CONTEXT

Required for mutations:
  ACK_API_SERVER, MASTERINO_IMAGE_DIGEST, BRIDGE_IMAGE_DIGEST
  and the command-specific CONFIRM_GATEWAY_* variable.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_digest() {
  local name="$1" value="$2"
  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$name must be an immutable sha256 digest"
}

init_kube() {
  command -v kubectl > /dev/null 2>&1 || fail "kubectl is not installed"
  [[ -n "${KUBECONFIG:-}" && -f "$KUBECONFIG" ]] || fail "KUBECONFIG must be an existing file"
  [[ "${ACK_CONTEXT:-}" == "$EXPECTED_CONTEXT" ]] || fail "ACK_CONTEXT must equal $EXPECTED_CONTEXT"
  KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT")
}

verify_target() {
  local mode="${1:-read}" current_context api_server regions live_image bridge_image ingress_hosts
  init_kube
  current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
  [[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail "kubeconfig current context does not match $EXPECTED_CONTEXT"
  api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
  [[ -n "$api_server" ]] || fail "ACK kubeconfig has no API server"
  if [[ "$mode" == "mutation" ]]; then
    [[ -n "${ACK_API_SERVER:-}" && "$ACK_API_SERVER" == "$api_server" ]] || fail "ACK_API_SERVER mismatch"
  fi
  regions="$("${KUBE[@]}" get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/region}{"\n"}{end}' | sed '/^$/d' | sort -u)"
  [[ "$regions" == "$EXPECTED_REGION" ]] || fail "expected region $EXPECTED_REGION, found ${regions:-none}"
  "${KUBE[@]}" get namespace "$NAMESPACE" > /dev/null
  "${KUBE[@]}" get deployment masterino masterino-aihub-db-bridge -n "$NAMESPACE" > /dev/null
  "${KUBE[@]}" get secret masterino-secret 20261122bielcrystal.com acr-credential-secret-aggregation -n "$NAMESPACE" > /dev/null
  ingress_hosts="$("${KUBE[@]}" get ingress -n "$NAMESPACE" -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}')"
  grep -Fxq 'masterino.bielcrystal.com' <<< "$ingress_hosts" || fail "production hostname is not owned in $NAMESPACE"

  live_image="$("${KUBE[@]}" get deployment masterino -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[?(@.name=="masterino")].image}')"
  bridge_image="$("${KUBE[@]}" get deployment masterino-aihub-db-bridge -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[?(@.name=="aihub-db-bridge")].image}')"
  [[ "$live_image" == "$MASTERINO_IMAGE@sha256:"* ]] || fail "live Masterino image is not immutable"
  [[ "$bridge_image" == "$BRIDGE_IMAGE@sha256:"* ]] || fail "live Bridge image is not immutable"
  if [[ "$mode" == "mutation" ]]; then
    require_digest MASTERINO_IMAGE_DIGEST "${MASTERINO_IMAGE_DIGEST:-}"
    require_digest BRIDGE_IMAGE_DIGEST "${BRIDGE_IMAGE_DIGEST:-}"
    [[ "$live_image" == "$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST" ]] || fail "MASTERINO_IMAGE_DIGEST does not match the live Deployment"
    [[ "$bridge_image" == "$BRIDGE_IMAGE@$BRIDGE_IMAGE_DIGEST" ]] || fail "BRIDGE_IMAGE_DIGEST does not match the live Deployment"
  fi
  printf 'Namespace=%s\nAPI server=%s\nMasterino image=%s\nBridge image=%s\n' "$NAMESPACE" "$api_server" "$live_image" "$bridge_image"
}

render_workloads() {
  kubectl kustomize "$WORKLOAD_OVERLAY"
}

render_cutover() {
  kubectl kustomize "$CUTOVER_OVERLAY"
}

validate_rendered() {
  local rendered cutover
  rendered="$(render_workloads)"
  cutover="$(render_cutover)"
  [[ "$(grep -c '^kind:' <<< "$rendered")" -eq 2 ]] || fail "workload overlay must contain only Service and Deployment"
  grep -q "namespace: $NAMESPACE" <<< "$rendered"
  grep -q "image: $GATEWAY_IMAGE@$GATEWAY_DIGEST" <<< "$rendered"
  grep -q 'replicas: 1' <<< "$rendered"
  grep -q 'readOnlyRootFilesystem: true' <<< "$rendered"
  grep -q 'runAsUser: 10001' <<< "$rendered"
  grep -q 'name: acr-credential-secret-aggregation' <<< "$rendered"
  grep -q 'name: DEVICE_GATEWAY_URL' "$MASTERINO_ENV_PATCH"
  grep -q 'name: DEVICE_GATEWAY_SERVICE_TOKEN' "$MASTERINO_ENV_PATCH"
  grep -q 'namespace: masterlion' <<< "$cutover"
  grep -Fq 'path: /device-gateway(/|$)(.*)' <<< "$cutover"
  grep -q 'proxy-read-timeout: "3600"' <<< "$cutover"
  if grep -Fq 'path: /device-gateway(/|$)(.*)' <<< "$rendered"; then
    fail "public Gateway Ingress must remain gated until cutover"
  fi
}

check_gateway_secret() {
  local token jwks
  token="$("${KUBE[@]}" get secret masterino-device-gateway-secret -n "$NAMESPACE" -o jsonpath='{.data.SERVICE_TOKEN}' | base64 --decode)"
  jwks="$("${KUBE[@]}" get secret masterino-device-gateway-secret -n "$NAMESPACE" -o jsonpath='{.data.JWKS_PUBLIC_KEY}' | base64 --decode)"
  (( ${#token} >= 32 )) || fail "Gateway SERVICE_TOKEN is shorter than 32 characters"
  printf '%s' "$jwks" | node -e '
    const fs = require("node:fs");
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const privateFields = new Set(["d", "p", "q", "dp", "dq", "qi", "oth"]);
    if (!Array.isArray(input.keys) || input.keys.length === 0) process.exit(1);
    for (const key of input.keys) {
      if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" || !key.n || !key.e || !key.kid) process.exit(1);
      if (Object.keys(key).some((field) => privateFields.has(field))) process.exit(1);
    }
  ' || fail "Gateway JWKS must be public-only RS256"
}

private_health() {
  local health
  health="$("${KUBE[@]}" get --raw "/api/v1/namespaces/${NAMESPACE}/services/http:masterino-device-gateway:8788/proxy/health")"
  [[ "$health" == "OK" ]] || fail "private Device Gateway health check did not return OK"
}

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  preflight)
    verify_target read
    "${KUBE[@]}" get deployment,service,ingress -n "$NAMESPACE" -l app.kubernetes.io/name=masterino-device-gateway -o wide
    ;;
  render)
    render_workloads
    ;;
  validate)
    validate_rendered
    echo "Production live Gateway invariants passed."
    ;;
  create-secret)
    verify_target mutation
    [[ "${CONFIRM_GATEWAY_SECRET:-}" == "$NAMESPACE" ]] || fail "set CONFIRM_GATEWAY_SECRET=$NAMESPACE"
    secret_file="${1:-$WORKLOAD_OVERLAY/device-gateway-secret.env}"
    [[ -f "$secret_file" ]] || fail "Gateway secret env file does not exist: $secret_file"
    gateway_token="$(SECRET_FILE="$secret_file" node -e 'const fs=require("node:fs");const line=fs.readFileSync(process.env.SECRET_FILE,"utf8").split(/\r?\n/).find(x=>x.startsWith("SERVICE_TOKEN="));if(!line)process.exit(1);process.stdout.write(line.slice(14))')"
    gateway_jwks="$(SECRET_FILE="$secret_file" node -e 'const fs=require("node:fs");const line=fs.readFileSync(process.env.SECRET_FILE,"utf8").split(/\r?\n/).find(x=>x.startsWith("JWKS_PUBLIC_KEY="));if(!line)process.exit(1);process.stdout.write(line.slice(16))')"
    (( ${#gateway_token} >= 32 )) || fail "SERVICE_TOKEN must contain at least 32 characters"
    candidate_public="$(printf '%s' "$gateway_jwks" | node -e '
      const fs=require("node:fs");const input=JSON.parse(fs.readFileSync(0,"utf8"));
      const fields=["kty","n","e","kid","alg","use"];
      const privateFields=new Set(["d","p","q","dp","dq","qi","oth"]);
      if(!Array.isArray(input.keys)||input.keys.length===0)process.exit(1);
      for(const key of input.keys){if(key.kty!=="RSA"||key.alg!=="RS256"||key.use!=="sig"||!key.n||!key.e||!key.kid||Object.keys(key).some(f=>privateFields.has(f)))process.exit(1)}
      process.stdout.write(JSON.stringify({keys:input.keys.map(key=>Object.fromEntries(fields.filter(f=>key[f]!==undefined).map(f=>[f,key[f]])))}));
    ')" || fail "JWKS_PUBLIC_KEY must contain public-only RS256 keys"
    expected_public="$("${KUBE[@]}" get secret masterino-secret -n "$NAMESPACE" -o jsonpath='{.data.JWKS_KEY}' | base64 --decode | node -e '
      const fs=require("node:fs");const input=JSON.parse(fs.readFileSync(0,"utf8"));const fields=["kty","n","e","kid","alg","use"];
      const source=Array.isArray(input.keys)?input.keys:[input];process.stdout.write(JSON.stringify({keys:source.map(key=>Object.fromEntries(fields.filter(f=>key[f]!==undefined).map(f=>[f,key[f]])))}));
    ')"
    [[ "$candidate_public" == "$expected_public" ]] || fail "JWKS_PUBLIC_KEY must be derived from production masterino-secret/JWKS_KEY"
    if "${KUBE[@]}" get secret masterino-device-gateway-secret -n masterino-test > /dev/null 2>&1; then
      test_token="$("${KUBE[@]}" get secret masterino-device-gateway-secret -n masterino-test -o jsonpath='{.data.SERVICE_TOKEN}' | base64 --decode)"
      [[ "$gateway_token" != "$test_token" ]] || fail "production SERVICE_TOKEN must not reuse the test token"
    fi
    "${KUBE[@]}" create secret generic masterino-device-gateway-secret -n "$NAMESPACE" \
      --from-literal="SERVICE_TOKEN=$gateway_token" --from-literal="JWKS_PUBLIC_KEY=$gateway_jwks" \
      --dry-run=client -o yaml | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway-secret --dry-run=server -f - > /dev/null
    "${KUBE[@]}" create secret generic masterino-device-gateway-secret -n "$NAMESPACE" \
      --from-literal="SERVICE_TOKEN=$gateway_token" --from-literal="JWKS_PUBLIC_KEY=$gateway_jwks" \
      --dry-run=client -o yaml | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway-secret -f - > /dev/null
    check_gateway_secret
    echo "Production live Gateway Secret applied and validated."
    ;;
  deploy)
    verify_target mutation
    [[ "${CONFIRM_GATEWAY_DEPLOY:-}" == "$NAMESPACE" ]] || fail "set CONFIRM_GATEWAY_DEPLOY=$NAMESPACE"
    validate_rendered
    check_gateway_secret
    rendered="$(render_workloads)"
    printf '%s\n' "$rendered" | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway --dry-run=server -f - > /dev/null
    "${KUBE[@]}" patch deployment masterino -n "$NAMESPACE" --type=strategic --patch-file "$MASTERINO_ENV_PATCH" --dry-run=server > /dev/null
    printf '%s\n' "$rendered" | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway -f -
    "${KUBE[@]}" patch deployment masterino -n "$NAMESPACE" --type=strategic --patch-file "$MASTERINO_ENV_PATCH"
    "${KUBE[@]}" rollout status deployment/masterino-device-gateway -n "$NAMESPACE" --timeout=10m
    "${KUBE[@]}" rollout status deployment/masterino -n "$NAMESPACE" --timeout=10m
    private_health
    echo "Production live Gateway is privately healthy."
    ;;
  cutover)
    verify_target mutation
    [[ "${CONFIRM_GATEWAY_CUTOVER:-}" == "$NAMESPACE" ]] || fail "set CONFIRM_GATEWAY_CUTOVER=$NAMESPACE"
    check_gateway_secret
    private_health
    available="$("${KUBE[@]}" get deployment masterino-device-gateway -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}')"
    [[ "$available" == "1" ]] || fail "Device Gateway must have exactly one available replica"
    cutover="$(render_cutover)"
    printf '%s\n' "$cutover" | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway-cutover --dry-run=server -f - > /dev/null
    printf '%s\n' "$cutover" | "${KUBE[@]}" apply --server-side --field-manager=masterino-gateway-cutover -f -
    for attempt in {1..12}; do
      [[ "$(curl -fsS --max-time 10 "$PUBLIC_HEALTH_URL" 2>/dev/null || true)" == "OK" ]] && { echo "Production Device Gateway is publicly healthy."; exit 0; }
      sleep 5
    done
    fail "public Device Gateway health check did not return OK"
    ;;
  rollback)
    verify_target mutation
    [[ "${CONFIRM_GATEWAY_ROLLBACK:-}" == "$NAMESPACE" ]] || fail "set CONFIRM_GATEWAY_ROLLBACK=$NAMESPACE"
    "${KUBE[@]}" delete ingress masterino-device-gateway -n "$NAMESPACE" --ignore-not-found
    ;;
  status)
    verify_target read
    "${KUBE[@]}" get deployment,service,ingress -n "$NAMESPACE" -l app.kubernetes.io/name=masterino-device-gateway -o wide
    ;;
  *)
    usage
    exit 1
    ;;
esac
