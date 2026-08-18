#!/usr/bin/env bash
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACK_CLUSTER_ID="${ACK_CLUSTER_ID:-c23ea84b986c446d5b3fa9227962e77f4}"
ACK_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-test}"
ACK_REGION="${ACK_REGION:-cn-shenzhen}"
ACK_PRIVATE_IP_ADDRESS="${ACK_PRIVATE_IP_ADDRESS:-true}"
ACK_KUBECONFIG_MINUTES="${ACK_KUBECONFIG_MINUTES:-120}"
ACK_TEST_ACTION="${ACK_TEST_ACTION:-validate}"
AIHUB_MANAGED_TOKEN_NAME="${AIHUB_MANAGED_TOKEN_NAME:-masterlion-managed}"
AIHUB_REQUIRED_CHAT_MODEL="${AIHUB_REQUIRED_CHAT_MODEL:-deepseek-v4-flash}"
AIHUB_REQUIRED_EMBEDDING_MODEL="${AIHUB_REQUIRED_EMBEDDING_MODEL:-text-embedding-3-large}"
NAMESPACE="masterino-test"
MASTERINO_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino"
DEVICE_GATEWAY_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-device-gateway"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" > /dev/null 2>&1 || fail "required command is missing: $1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable is missing: $name"
  [[ "${!name}" != *$'\n'* && "${!name}" != *$'\r'* ]] \
    || fail "$name must not contain a line break"
}

require_digest() {
  local name="$1"
  require_env "$name"
  [[ "${!name}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "$name must be an immutable sha256 digest"
}

cleanup() {
  set +e
  [[ -n "${KUBECONFIG_FILE:-}" ]] && rm -f -- "$KUBECONFIG_FILE"
  [[ -n "${ACK_RESPONSE_FILE:-}" ]] && rm -f -- "$ACK_RESPONSE_FILE"
  [[ -n "${APP_SECRET_FILE:-}" ]] && rm -f -- "$APP_SECRET_FILE"
  [[ -n "${BRIDGE_SECRET_FILE:-}" ]] && rm -f -- "$BRIDGE_SECRET_FILE"
  [[ -n "${SEARXNG_SECRET_FILE:-}" ]] && rm -f -- "$SEARXNG_SECRET_FILE"
  [[ -n "${MARKET_SECRET_FILE:-}" ]] && rm -f -- "$MARKET_SECRET_FILE"
  [[ -n "${TEMP_DIR:-}" ]] && rmdir -- "$TEMP_DIR" 2> /dev/null
}

write_env() {
  local file="$1" name="$2" value="$3"
  printf '%s=%s\n' "$name" "$value" >> "$file"
}

prepare_kubeconfig() {
  require_command aliyun
  require_command kubectl
  require_command node

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
  export ACK_CONTEXT
  export ACK_API_SERVER
  ACK_API_SERVER="$(
    kubectl --kubeconfig "$KUBECONFIG_FILE" config view --minify --raw \
      -o jsonpath='{.clusters[0].cluster.server}'
  )"
  [[ -n "$ACK_API_SERVER" ]] || fail "ACK kubeconfig does not contain an API server"
}

prepare_secret_files() {
  if [[ -n "${ACK_TEST_APP_SECRET_FILE:-}" || -n "${ACK_TEST_BRIDGE_SECRET_FILE:-}" || -n "${ACK_TEST_SEARXNG_SECRET_FILE:-}" || -n "${ACK_TEST_MARKET_SECRET_FILE:-}" ]]; then
    require_env ACK_TEST_APP_SECRET_FILE
    require_env ACK_TEST_BRIDGE_SECRET_FILE
    require_env ACK_TEST_SEARXNG_SECRET_FILE
    require_env ACK_TEST_MARKET_SECRET_FILE
    [[ -f "$ACK_TEST_APP_SECRET_FILE" ]] \
      || fail "application secret file does not exist: $ACK_TEST_APP_SECRET_FILE"
    [[ -f "$ACK_TEST_BRIDGE_SECRET_FILE" ]] \
      || fail "bridge secret file does not exist: $ACK_TEST_BRIDGE_SECRET_FILE"
    [[ -f "$ACK_TEST_SEARXNG_SECRET_FILE" ]] \
      || fail "SearXNG secret file does not exist: $ACK_TEST_SEARXNG_SECRET_FILE"
    [[ -f "$ACK_TEST_MARKET_SECRET_FILE" ]] \
      || fail "Market secret file does not exist: $ACK_TEST_MARKET_SECRET_FILE"
    cp -- "$ACK_TEST_APP_SECRET_FILE" "$APP_SECRET_FILE"
    cp -- "$ACK_TEST_BRIDGE_SECRET_FILE" "$BRIDGE_SECRET_FILE"
    cp -- "$ACK_TEST_SEARXNG_SECRET_FILE" "$SEARXNG_SECRET_FILE"
    cp -- "$ACK_TEST_MARKET_SECRET_FILE" "$MARKET_SECRET_FILE"
    chmod 600 "$APP_SECRET_FILE" "$BRIDGE_SECRET_FILE" "$SEARXNG_SECRET_FILE" "$MARKET_SECRET_FILE"
    return
  fi

  local required=(
    KEY_VAULTS_SECRET
    AUTH_SECRET
    JWKS_KEY
    POSTGRES_PASSWORD
    REDIS_PASSWORD
    S3_ACCESS_KEY_ID
    S3_SECRET_ACCESS_KEY
    SEARXNG_SECRET
    AIHUB_BRIDGE_TOKEN
    AIHUB_READONLY_DATABASE_URL
    AUTH_WECOM_AGENT_ID
    AUTH_WECOM_CORP_ID
    AUTH_WECOM_CORP_SECRET
    MARKET_GITHUB_TOKEN
    MARKET_DATABASE_PASSWORD
    MARKET_TRUSTED_CLIENT_SECRET
    MARKET_CREDENTIAL_ENCRYPTION_KEY
    MARKET_IMPORT_SIGNING_KEY
    MARKET_RUNNER_INTERNAL_TOKEN
    MARKET_OBJECT_STORAGE_ACCESS_KEY_ID
    MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY
    MARKET_ADMIN_USER_IDS
  )
  local name
  for name in "${required[@]}"; do
    require_env "$name"
  done

  [[ "$AUTH_SECRET" =~ ^[0-9a-fA-F]{64}$ ]] \
    || fail "AUTH_SECRET must be 64 hexadecimal characters"
  [[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "POSTGRES_PASSWORD must be URL-safe"
  [[ "$REDIS_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "REDIS_PASSWORD must be URL-safe"
  [[ "$MARKET_DATABASE_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "MARKET_DATABASE_PASSWORD must be URL-safe"
  [[ "$MARKET_TRUSTED_CLIENT_SECRET" =~ ^lobehub-market_tcs_[0-9a-fA-F]{64}$ ]] \
    || fail "MARKET_TRUSTED_CLIENT_SECRET must use the trusted-client key format"
  [[ ${#MARKET_CREDENTIAL_ENCRYPTION_KEY} -ge 32 ]] \
    || fail "MARKET_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters"
  [[ ${#MARKET_IMPORT_SIGNING_KEY} -ge 32 ]] \
    || fail "MARKET_IMPORT_SIGNING_KEY must be at least 32 characters"
  [[ ${#MARKET_RUNNER_INTERNAL_TOKEN} -ge 32 ]] \
    || fail "MARKET_RUNNER_INTERNAL_TOKEN must be at least 32 characters"
  local key_vault_bytes
  key_vault_bytes="$(
    printf '%s' "$KEY_VAULTS_SECRET" | base64 --decode 2> /dev/null | wc -c
  )" || fail "KEY_VAULTS_SECRET must be valid base64"
  [[ "$key_vault_bytes" -eq 32 ]] \
    || fail "KEY_VAULTS_SECRET must decode to exactly 32 bytes"
  printf '%s' "$JWKS_KEY" | node -e '
    const fs = require("node:fs");
    const jwks = JSON.parse(fs.readFileSync(0, "utf8"));
    const key = jwks?.keys?.[0];
    if (!key || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" || !key.d) {
      process.exit(1);
    }
  ' || fail "JWKS_KEY must contain an RSA private JWKS"

  : > "$APP_SECRET_FILE"
  write_env "$APP_SECRET_FILE" KEY_VAULTS_SECRET "$KEY_VAULTS_SECRET"
  write_env "$APP_SECRET_FILE" AUTH_SECRET "$AUTH_SECRET"
  write_env "$APP_SECRET_FILE" JWKS_KEY "$JWKS_KEY"
  write_env "$APP_SECRET_FILE" POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  write_env "$APP_SECRET_FILE" DATABASE_URL \
    "postgresql://postgres:${POSTGRES_PASSWORD}@masterino-postgres:5432/lobechat"
  write_env "$APP_SECRET_FILE" REDIS_PASSWORD "$REDIS_PASSWORD"
  write_env "$APP_SECRET_FILE" REDIS_URL \
    "redis://:${REDIS_PASSWORD}@masterino-redis:6379/0"
  write_env "$APP_SECRET_FILE" S3_ACCESS_KEY "$S3_ACCESS_KEY_ID"
  write_env "$APP_SECRET_FILE" S3_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"
  write_env "$APP_SECRET_FILE" S3_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"
  write_env "$APP_SECRET_FILE" AIHUB_BRIDGE_TOKEN "$AIHUB_BRIDGE_TOKEN"
  write_env "$APP_SECRET_FILE" MARKET_TRUSTED_CLIENT_SECRET \
    "$MARKET_TRUSTED_CLIENT_SECRET"
  write_env "$APP_SECRET_FILE" AUTH_SSO_PROVIDERS "${AUTH_SSO_PROVIDERS:-wecom}"
  write_env "$APP_SECRET_FILE" AUTH_WECOM_AGENT_ID "$AUTH_WECOM_AGENT_ID"
  write_env "$APP_SECRET_FILE" AUTH_WECOM_CORP_ID "$AUTH_WECOM_CORP_ID"
  write_env "$APP_SECRET_FILE" AUTH_WECOM_CORP_SECRET "$AUTH_WECOM_CORP_SECRET"
  write_env "$APP_SECRET_FILE" MARKET_GITHUB_TOKEN "$MARKET_GITHUB_TOKEN"

  : > "$BRIDGE_SECRET_FILE"
  write_env "$BRIDGE_SECRET_FILE" AIHUB_BRIDGE_TOKEN "$AIHUB_BRIDGE_TOKEN"
  write_env "$BRIDGE_SECRET_FILE" AIHUB_READONLY_DATABASE_URL \
    "$AIHUB_READONLY_DATABASE_URL"

  : > "$SEARXNG_SECRET_FILE"
  write_env "$SEARXNG_SECRET_FILE" SEARXNG_SECRET "$SEARXNG_SECRET"

  local market_oauth_clients_json='{}'
  if [[ -n "${MARKET_OAUTH_CLIENTS_JSON:-}" ]]; then
    market_oauth_clients_json="$MARKET_OAUTH_CLIENTS_JSON"
  fi
  : > "$MARKET_SECRET_FILE"
  write_env "$MARKET_SECRET_FILE" MARKET_DATABASE_PASSWORD "$MARKET_DATABASE_PASSWORD"
  write_env "$MARKET_SECRET_FILE" MARKET_DATABASE_URL \
    "postgresql://masterino_market:${MARKET_DATABASE_PASSWORD}@masterino-postgres:5432/masterino_market"
  write_env "$MARKET_SECRET_FILE" MARKET_REDIS_URL \
    "redis://:${REDIS_PASSWORD}@masterino-redis:6379/0"
  write_env "$MARKET_SECRET_FILE" MARKET_TRUSTED_CLIENT_SECRET \
    "$MARKET_TRUSTED_CLIENT_SECRET"
  write_env "$MARKET_SECRET_FILE" MARKET_CREDENTIAL_ENCRYPTION_KEY \
    "$MARKET_CREDENTIAL_ENCRYPTION_KEY"
  write_env "$MARKET_SECRET_FILE" MARKET_IMPORT_SIGNING_KEY "$MARKET_IMPORT_SIGNING_KEY"
  write_env "$MARKET_SECRET_FILE" MARKET_RUNNER_INTERNAL_TOKEN "$MARKET_RUNNER_INTERNAL_TOKEN"
  write_env "$MARKET_SECRET_FILE" MARKET_OBJECT_STORAGE_ACCESS_KEY_ID \
    "$MARKET_OBJECT_STORAGE_ACCESS_KEY_ID"
  write_env "$MARKET_SECRET_FILE" MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY \
    "$MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY"
  write_env "$MARKET_SECRET_FILE" MARKET_OAUTH_CLIENTS_JSON "$market_oauth_clients_json"
  write_env "$MARKET_SECRET_FILE" MARKET_ADMIN_USER_IDS "$MARKET_ADMIN_USER_IDS"
  chmod 600 "$APP_SECRET_FILE" "$BRIDGE_SECRET_FILE" "$SEARXNG_SECRET_FILE" "$MARKET_SECRET_FILE"
}

check_aihub_authorization() {
  require_env ACK_TEST_AIHUB_USERNAME
  require_env AIHUB_MANAGED_TOKEN_NAME
  require_env AIHUB_REQUIRED_CHAT_MODEL
  require_env AIHUB_REQUIRED_EMBEDDING_MODEL

  kubectl -n "$NAMESPACE" exec deployment/masterino-aihub-db-bridge -- \
    node --input-type=module -e '
      const [
        username,
        tokenName,
        requiredChatModel,
        requiredEmbeddingModel,
      ] = process.argv.slice(1);
      const baseUrl = "http://127.0.0.1:3218";
      const bridgeToken = process.env.AIHUB_BRIDGE_TOKEN;
      if (!bridgeToken) throw new Error("AIHUB_BRIDGE_TOKEN is missing in the bridge pod");

      const request = async (path) => {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${bridgeToken}` },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body?.success !== true) {
          throw new Error(`Aihub bridge request failed (${response.status})`);
        }
        return body.data;
      };

      const user = await request(
        `/v1/users/resolve?username=${encodeURIComponent(username)}`,
      );
      const tokens = await request(
        `/v1/users/${user.id}/managed-tokens?name=${encodeURIComponent(tokenName)}`,
      );
      const exactToken = Array.isArray(tokens)
        ? tokens.find((token) => token.name === tokenName)
        : undefined;
      if (!exactToken) {
        throw new Error(`Aihub token "${tokenName}" was not found for the test user`);
      }

      const now = Math.floor(Date.now() / 1000);
      if (Number(exactToken.status) !== 1) {
        throw new Error(`Aihub token "${tokenName}" is disabled`);
      }
      if (Number(exactToken.expired_time) !== -1 && Number(exactToken.expired_time) <= now) {
        throw new Error(`Aihub token "${tokenName}" is expired`);
      }
      if (!exactToken.unlimited_quota && Number(exactToken.remain_quota) <= 0) {
        throw new Error(`Aihub token "${tokenName}" has no remaining quota`);
      }

      const models = await request(
        `/v1/users/${user.id}/models?tokenName=${encodeURIComponent(tokenName)}`,
      );
      const accessibleModels = new Set(Array.isArray(models) ? models : []);
      const missingModels = [requiredChatModel, requiredEmbeddingModel].filter(
        (model) => !accessibleModels.has(model),
      );
      if (missingModels.length > 0) {
        throw new Error(
          `Aihub user group or token "${tokenName}" does not authorize: ${missingModels.join(", ")}`,
        );
      }

      console.log(
        `Aihub authorization check passed for token "${tokenName}": ` +
          `${requiredChatModel}, ${requiredEmbeddingModel}`,
      );
    ' \
    "$ACK_TEST_AIHUB_USERNAME" \
    "$AIHUB_MANAGED_TOKEN_NAME" \
    "$AIHUB_REQUIRED_CHAT_MODEL" \
    "$AIHUB_REQUIRED_EMBEDDING_MODEL"
}

require_command bash
require_command base64
require_command mktemp
require_command wc

TEMP_DIR="$(mktemp -d)"
KUBECONFIG_FILE="$TEMP_DIR/kubeconfig"
ACK_RESPONSE_FILE="$TEMP_DIR/ack-response.json"
APP_SECRET_FILE="$TEMP_DIR/secret.env"
BRIDGE_SECRET_FILE="$TEMP_DIR/bridge-secret.env"
SEARXNG_SECRET_FILE="$TEMP_DIR/searxng-secret.env"
MARKET_SECRET_FILE="$TEMP_DIR/market-secret.env"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT_DIR"
prepare_kubeconfig

case "$ACK_TEST_ACTION" in
  preflight)
    bash ./deploy.sh --env test preflight
    ;;
  aihub-check)
    check_aihub_authorization
    ;;
  validate)
    require_digest MASTERINO_IMAGE_DIGEST
    require_digest BRIDGE_IMAGE_DIGEST
    require_digest MARKET_IMAGE_DIGEST
    export MASTERINO_IMAGE_DIGEST BRIDGE_IMAGE_DIGEST MARKET_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test validate
    ;;
  deploy)
    [[ "${CONFIRM_ACK_TEST_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_DEPLOY=$NAMESPACE to authorize a test deployment"
    require_digest MASTERINO_IMAGE_DIGEST
    require_digest BRIDGE_IMAGE_DIGEST
    require_digest MARKET_IMAGE_DIGEST
    export MASTERINO_IMAGE_DIGEST BRIDGE_IMAGE_DIGEST MARKET_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test validate
    prepare_secret_files
    bash ./deploy.sh --env test bootstrap
    bash ./deploy.sh --env test create-secret \
      "$APP_SECRET_FILE" "$BRIDGE_SECRET_FILE" "$SEARXNG_SECRET_FILE" "$MARKET_SECRET_FILE"
    bash ./deploy.sh --env test deploy
    bash ./deploy.sh --env test rollout
    check_aihub_authorization
    ;;
  gateway-update)
    [[ "${CONFIRM_ACK_TEST_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_DEPLOY=$NAMESPACE to authorize a test deployment"
    require_digest DEVICE_GATEWAY_IMAGE_DIGEST
    export DEVICE_GATEWAY_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test update-image device-gateway \
      "$DEVICE_GATEWAY_IMAGE@$DEVICE_GATEWAY_IMAGE_DIGEST"
    ;;
  app-update)
    [[ "${CONFIRM_ACK_TEST_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_DEPLOY=$NAMESPACE to authorize a test deployment"
    require_digest MASTERINO_IMAGE_DIGEST
    export MASTERINO_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test update-image masterino \
      "$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST"
    bash ./deploy.sh --env test update-image memory-worker \
      "$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST"
    ;;
  status)
    bash ./deploy.sh --env test status
    ;;
  *)
    fail "ACK_TEST_ACTION must be preflight, aihub-check, validate, deploy, gateway-update, app-update, or status"
    ;;
esac
