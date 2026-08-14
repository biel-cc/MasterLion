param(
  [string]$Image = '',
  [switch]$SkipPreflight,
  [switch]$DryRun
)

# 启动 Masterino 单镜像本地热更新环境（Windows）。
#
# 流程：
#   1. 校验 aliyun/kubectl/docker 可用，获取 ACK 临时 kubeconfig 并通过仓库
#      deploy.sh 的集群/namespace/API Server 守卫（preflight）。
#   2. 对 ACK 测试环境的 PostgreSQL / Redis / Aihub DB Bridge / SearXNG 启动
#      kubectl port-forward，仅绑定 127.0.0.1。
#   3. 读取测试 ConfigMap 与允许注入的 Secret，生成权限受限的临时环境文件；
#      绝不读取或注入 AIHUB_READONLY_DATABASE_URL。
#   4. 预检 PostgreSQL、Redis、Bridge、SearXNG、Aihub Proxy、OSS；任一必需
#      依赖失败则输出服务名/目标地址/错误类型并停止。
#   5. docker compose -f docker-compose.hot.yml up -d --no-deps（不执行 migration）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/hot-dev/start-hot-dev.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/hot-dev/start-hot-dev.ps1 -Image 'registry/...@sha256:...'

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------- 常量 ----------
$ACK_REGION = 'cn-shenzhen'
$ACK_CLUSTER_ID = 'c23ea84b986c446d5b3fa9227962e77f4'
$ACK_CONTEXT = 'ack-c23ea84b-masterlion-test'
$ACK_KUBECONFIG_MINUTES = 120
$NAMESPACE = 'masterino-test'
$KUBE_BIN = (Get-Command kubectl -ErrorAction SilentlyContinue).Source
$ALIYUN_BIN = (Get-Command aliyun -ErrorAction SilentlyContinue).Source

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DEPLOY_SH = Join-Path $ROOT 'deploy.sh'
$HOT_COMPOSE = Join-Path $ROOT 'docker-compose/deploy/docker-compose.hot.yml'

$STATE_DIR = Join-Path $env:TEMP 'masterino-hot-dev'
$KUBECONFIG_FILE = Join-Path $STATE_DIR 'kubeconfig'
$ENV_FILE = Join-Path $STATE_DIR 'hot.env'
$PID_FILE = Join-Path $STATE_DIR 'port-forward-pids.txt'
$DEV_IMAGE_FILE = Join-Path $STATE_DIR 'dev-image.json'
$LOG_FILE = Join-Path $STATE_DIR 'start.log'

# 端口转发映射：本机端口 -> 集群 Service 与远端端口。
$FORWARDS = @(
  @{ Name = 'PostgreSQL'; LocalPort = 15432; Resource = 'svc/masterino-postgres'; RemotePort = 5432 },
  @{ Name = 'Redis'; LocalPort = 16379; Resource = 'svc/masterino-redis'; RemotePort = 6379 },
  @{ Name = 'Aihub DB Bridge'; LocalPort = 13218; Resource = 'svc/masterino-aihub-db-bridge'; RemotePort = 3218 },
  @{ Name = 'SearXNG'; LocalPort = 18080; Resource = 'svc/masterino-searxng'; RemotePort = 8080 }
)

# masterino-secret 中允许注入本地环境的键（不含任何 AIHUB_READONLY_DATABASE_URL）。
$ALLOWED_SECRET_KEYS = @(
  'KEY_VAULTS_SECRET', 'AUTH_SECRET', 'JWKS_KEY',
  'POSTGRES_PASSWORD', 'REDIS_PASSWORD',
  'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'AIHUB_BRIDGE_TOKEN', 'MARKET_TRUSTED_CLIENT_SECRET',
  'AUTH_SSO_PROVIDERS', 'AUTH_WECOM_AGENT_ID', 'AUTH_WECOM_CORP_ID', 'AUTH_WECOM_CORP_SECRET'
)
# 环境变量名大小写敏感（Linux 容器），但 Secret 键可能为小写，这里统一按
# masterino-secret 实际键名读取，仅注入允许列表。
$FORBIDDEN_ENV_KEYS = @('AIHUB_READONLY_DATABASE_URL')

$FORWARD_PIDS = [System.Collections.Generic.List[int]]::new()
$startedAt = Get-Date

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $LOG_FILE -Value $line -Encoding utf8
}

function Fail([string]$Message) {
  Write-Log "ERROR: $Message"
  Cleanup-Forwards
  exit 1
}

function Require-Command([string]$Name, [string]$Hint = '') {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "required command is missing: $Name $Hint"
  }
}

# ---------- 清理 ----------
function Cleanup-Forwards {
  foreach ($procId in $FORWARD_PIDS) {
    try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch { }
  }
  $FORWARD_PIDS.Clear()
}

function Cleanup-State {
  Cleanup-Forwards
  foreach ($f in @($KUBECONFIG_FILE, $ENV_FILE, $PID_FILE)) {
    if (Test-Path $f) { Remove-Item -Path $f -Force -ErrorAction SilentlyContinue }
  }
}

# ---------- 1. ACK 临时 kubeconfig + 守卫 ----------
function Get-TempKubeconfig {
  if (-not (Test-Path $STATE_DIR)) { New-Item -ItemType Directory -Path $STATE_DIR | Out-Null }

  Write-Log "Requesting temporary ACK kubeconfig for cluster $ACK_CLUSTER_ID ($ACK_KUBECONFIG_MINUTES min)"
  $response = & $ALIYUN_BIN cs describe-cluster-user-kubeconfig `
    --cluster-id $ACK_CLUSTER_ID `
    --private-ip-address true `
    --region $ACK_REGION `
    --temporary-duration-minutes $ACK_KUBECONFIG_MINUTES 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "aliyun cs describe-cluster-user-kubeconfig failed: $($response -join ' ')"
  }
  $json = $response -join "`n" | ConvertFrom-Json
  if (-not $json.config) {
    Fail 'ACK did not return a kubeconfig config'
  }
  Set-Content -Path $KUBECONFIG_FILE -Value $json.config -Encoding utf8 -NoNewline
  # 权限受限：仅当前用户可读写。
  icacls $KUBECONFIG_FILE /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  Write-Log "Temp kubeconfig written to $KUBECONFIG_FILE"

  # 将 context 重命名为守卫期望的 context 名。
  $current = & kubectl --kubeconfig $KUBECONFIG_FILE config current-context 2>$null
  if ($LASTEXITCODE -eq 0 -and $current -and $current -ne $ACK_CONTEXT) {
    & kubectl --kubeconfig $KUBECONFIG_FILE config rename-context $current $ACK_CONTEXT | Out-Null
  }
}

function Assert-GuardedTarget {
  Write-Log 'Running guarded preflight via deploy.sh'
  $env:KUBECONFIG = $KUBECONFIG_FILE
  $env:ACK_CONTEXT = $ACK_CONTEXT
  # 使用仓库既有的集群/namespace/API Server 守卫（只读）。
  & bash $DEPLOY_SH --env test preflight *>> $LOG_FILE
  if ($LASTEXITCODE -ne 0) {
    Fail "deploy.sh preflight guard rejected the ACK target (exit $LASTEXITCODE); see $LOG_FILE"
  }
  Write-Log 'Guarded preflight passed (cluster id, context, namespace, region)'
}

# ---------- 2. 端口转发 ----------
function Start-PortForwards {
  $env:KUBECONFIG = $KUBECONFIG_FILE
  foreach ($fw in $FORWARDS) {
    Write-Log "Port-forward $($fw.Name): 127.0.0.1:$($fw.LocalPort) -> $($fw.Resource):$($fw.RemotePort)"
    $proc = Start-Process -FilePath $KUBE_BIN -ArgumentList @(
      '--kubeconfig', $KUBECONFIG_FILE,
      '--context', $ACK_CONTEXT,
      'port-forward',
      '-n', $NAMESPACE,
      '--address', '127.0.0.1',
      $fw.Resource,
      "{0}:{1}" -f $fw.LocalPort, $fw.RemotePort
    ) -WindowStyle Hidden -RedirectStandardError (Join-Path $STATE_DIR "pf-$($fw.Name -replace ' ','')-err.log") -PassThru
    $FORWARD_PIDS.Add($proc.Id)
    Start-Sleep -Milliseconds 400
  }
  $FORWARD_PIDS | Set-Content -Path $PID_FILE

  # 等待端口就绪。
  $deadline = (Get-Date).AddSeconds(60)
  foreach ($fw in $FORWARDS) {
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      $conn = New-Object System.Net.Sockets.TcpClient
      try {
        $conn.Connect('127.0.0.1', $fw.LocalPort)
        $ready = $true
        $conn.Close()
        break
      } catch {
        $conn.Close()
        Start-Sleep -Milliseconds 500
      }
    }
    if (-not $ready) {
      Fail "port-forward for $($fw.Name) (127.0.0.1:$($fw.LocalPort)) did not open"
    }
  }
  Write-Log 'All port-forwards are open'
}

# ---------- 3. 环境文件提取 ----------
# compose 的 --env-file 解析要求：值不能含换行。测试确认裸格式（不加引号）
# 可正确承载内嵌双引号、单引号、空格、#、逗号与 JSON 结构；仅换行必须拒绝。
function ConvertTo-EnvLine([string]$Key, [string]$Value) {
  if ($FORBIDDEN_ENV_KEYS -contains $Key) {
    throw "refusing to inject forbidden key: $Key"
  }
  if ($Value -match "[\r\n]") {
    throw "cannot inject '$Key' into the env file: value contains a newline"
  }
  return "$Key=$Value"
}

function Build-EnvFile {
  $env:KUBECONFIG = $KUBECONFIG_FILE
  Write-Log "Reading ConfigMap masterino-config from namespace $NAMESPACE"
  $cmJson = & kubectl --kubeconfig $KUBECONFIG_FILE --context $ACK_CONTEXT get configmap masterino-config -n $NAMESPACE -o json 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "cannot read ConfigMap masterino-config: $($cmJson -join ' ')"
  }
  $cm = ($cmJson -join "`n") | ConvertFrom-Json

  Write-Log "Reading allowed keys from Secret masterino-secret (excluding forbidden keys)"
  $secJson = & kubectl --kubeconfig $KUBECONFIG_FILE --context $ACK_CONTEXT get secret masterino-secret -n $NAMESPACE -o json 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "cannot read Secret masterino-secret: $($secJson -join ' ')"
  }
  $sec = ($secJson -join "`n") | ConvertFrom-Json

  $lines = [System.Collections.Generic.List[string]]::new()
  # ConfigMap 全部为非 Secret 配置，直接注入。
  foreach ($prop in $cm.data.PSObject.Properties) {
    $lines.Add((ConvertTo-EnvLine $prop.Name ([string]$prop.Value)))
  }
  # Secret 只允许指定键；base64 解码。
  foreach ($key in $ALLOWED_SECRET_KEYS) {
    $b64 = $sec.data.$key
    if (-not $b64) {
      Fail "masterino-secret is missing allowed key: $key"
    }
    $value = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $lines.Add((ConvertTo-EnvLine $key $value))
  }
  # 本地专用覆盖：
  # - APP_URL_ALLOWED_HOSTS 追加 localhost/127.0.0.1，保证本机直接访问时 auth
  #   回调与 SPA 静态资源不跳回线上域名（ConfigMap 只允许测试域名）。
  $allowedHosts = ([string]$cm.data.APP_URL_ALLOWED_HOSTS).Trim()
  if ($allowedHosts -and $allowedHosts -notmatch '(^|,)localhost($|,)' -and $allowedHosts -notmatch '\*') {
    $allowedHosts += ',localhost,127.0.0.1'
  }
  if ($allowedHosts) {
    $lines.Add("APP_URL_ALLOWED_HOSTS=$allowedHosts")
  }

  $lines | Set-Content -Path $ENV_FILE -Encoding utf8
  icacls $ENV_FILE /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  Write-Log "Temp env file written to $ENV_FILE ($($lines.Count) entries)"
}

# ---------- 4. 预检 ----------
function Test-Tcp([int]$Port, [int]$TimeoutMs = 5000) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch { return $false }
  finally { $client.Close() }
}

function Test-Http([string]$Url, [string]$Bearer = '', [int]$TimeoutMs = 10000) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Timeout = $TimeoutMs
    if ($Bearer) { $req.Headers['Authorization'] = "Bearer $Bearer" }
    # 连通性检查：任何 HTTP 状态（含 401/403/404）都说明目标可达。
    try {
      $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
      $resp = $_.Exception.Response
    }
    if ($null -eq $resp) { return $false }
    $resp.Close()
    return $true
  } catch { return $false }
}

function Run-Preflight {
  Write-Log 'Preflight: verifying required dependencies'
  $env:KUBECONFIG = $KUBECONFIG_FILE

  # 从环境文件取 bridge token 做鉴权健康检查。
  $bridgeToken = ''
  $envContent = Get-Content $ENV_FILE -Raw
  $m = [regex]::Match($envContent, "(?m)^AIHUB_BRIDGE_TOKEN=(.+)$")
  if ($m.Success) { $bridgeToken = $m.Groups[1].Value }

  $checks = @(
    @{ Name = 'PostgreSQL'; Check = { Test-Tcp 15432 }; Address = '127.0.0.1:15432' },
    @{ Name = 'Redis'; Check = { Test-Tcp 16379 }; Address = '127.0.0.1:16379' },
    @{ Name = 'Aihub DB Bridge'; Check = { Test-Http 'http://127.0.0.1:13218/health' $bridgeToken }; Address = '127.0.0.1:13218/health' },
    @{ Name = 'SearXNG'; Check = { Test-Http 'http://127.0.0.1:18080/' }; Address = '127.0.0.1:18080' },
    @{ Name = 'Aihub Proxy'; Check = { Test-Http 'https://aihub.bielcrystal.com/' }; Address = 'https://aihub.bielcrystal.com' },
    @{ Name = 'OSS'; Check = { Test-Http 'https://oss-cn-shenzhen.aliyuncs.com/' }; Address = 'https://oss-cn-shenzhen.aliyuncs.com' }
  )

  $failed = $false
  foreach ($c in $checks) {
    $ok = & $c.Check
    if ($ok) {
      Write-Log "  [OK] $($c.Name) ($($c.Address))"
    } else {
      Write-Log "  [FAIL] $($c.Name) ($($c.Address)) - unreachable"
      $failed = $true
    }
  }

  # Onlyboxes 沙箱非硬阻塞，但必须提示。
  $onlyboxes = 'https://onlyboxes.internal.bielcrystal.com'
  if (-not (Test-Http $onlyboxes)) {
    Write-Log "  [WARN] Onlyboxes sandbox ($onlyboxes) is unreachable - sandbox features are unavailable, other features are not blocked"
  } else {
    Write-Log "  [OK] Onlyboxes sandbox reachable"
  }

  if ($failed) {
    Fail 'one or more required dependencies failed the preflight; fix them and re-run'
  }
  Write-Log 'Preflight passed'
}

# ---------- 5. compose up ----------
function Resolve-DevImage {
  if ($Image) { return $Image }
  if (Test-Path $DEV_IMAGE_FILE) {
    $state = Get-Content $DEV_IMAGE_FILE -Raw | ConvertFrom-Json
    if ($state.image) { return $state.image }
  }
  Fail "no dev image digest found; run scripts/hot-dev/build-dev-image.ps1 first or pass -Image 'repo@sha256:...'"
}

function Start-Compose([string]$ImageRef) {
  if ($ImageRef -notmatch '^[^@]+@sha256:[0-9a-f]{64}$') {
    Fail "MASTERLION_DEV_IMAGE must be an immutable repo@sha256: digest, got: $ImageRef"
  }
  Write-Log "Starting compose with MASTERLION_DEV_IMAGE=$ImageRef"
  $env:MASTERLION_DEV_IMAGE = $ImageRef
  $env:LOBE_PORT = '3210'
  $env:VITE_DEV_PORT = '9876'

  # --env-file 提供 ${VAR} 插值；--no-deps 固定不拉起任何依赖服务。
  # PS 5.1 下 ErrorActionPreference=Stop 会把 docker compose 的 stderr 进度
  # 当终止错误，这里临时放宽并按退出码判断成败。
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $args = @(
      'compose',
      '--env-file', $ENV_FILE,
      '-f', $HOT_COMPOSE,
      'up', '-d', '--no-deps'
    )
    & docker @args *>> $LOG_FILE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) {
    Fail "docker compose up failed (exit $LASTEXITCODE); see $LOG_FILE"
  }
  Write-Log 'Compose up succeeded'
}

# ---------- 入口 ----------
Require-Command aliyun '(- install Alibaba Cloud CLI and configure RAM credentials)'
Require-Command kubectl '(- install kubectl)'
Require-Command docker '(- install Docker Desktop)'
Require-Command bash '(- Git Bash is required for the deploy.sh guard)'

if (Test-Path $LOG_FILE) { Remove-Item $LOG_FILE -Force }
if (-not (Test-Path $STATE_DIR)) { New-Item -ItemType Directory -Path $STATE_DIR | Out-Null }
Set-Content -Path $LOG_FILE -Value "Masterino hot-dev start at $(Get-Date -Format o)" -Encoding utf8

if ($DryRun) {
  Write-Log 'Dry run: checks complete; skipping ACK, port-forwards, preflight and compose up.'
  exit 0
}

try {
  Get-TempKubeconfig
  Assert-GuardedTarget
  Start-PortForwards
  Build-EnvFile
  if (-not $SkipPreflight) { Run-Preflight }
  $imageRef = Resolve-DevImage
  Start-Compose $imageRef
} catch {
  Fail $_.Exception.Message
}

$elapsed = ((Get-Date) - $startedAt).TotalSeconds
Write-Log "Environment started in $([math]::Round($elapsed))s"
Write-Host ''
Write-Host '=============================================================='
Write-Host ' Masterino hot dev environment is running'
Write-Host '   Next.js  : http://localhost:3210'
Write-Host '   Vite SPA : http://localhost:9876'
Write-Host '   Logs     : docker logs -f masterino-hot'
Write-Host '   Stop     : scripts/hot-dev/stop-hot-dev.ps1'
Write-Host '=============================================================='
