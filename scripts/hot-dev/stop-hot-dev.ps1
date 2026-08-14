param(
  [switch]$KeepState
)

# 停止 Masterino 单镜像本地热更新环境（Windows）。
#
# 清理项：
#   - docker compose 启动的 masterino-hot 容器
#   - kubectl port-forward 进程及其子进程
#   - 临时 kubeconfig、环境文件和 PID 文件（-KeepState 保留）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/hot-dev/stop-hot-dev.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$HOT_COMPOSE = Join-Path $ROOT 'docker-compose/deploy/docker-compose.hot.yml'
$STATE_DIR = Join-Path $env:TEMP 'masterino-hot-dev'
$PID_FILE = Join-Path $STATE_DIR 'port-forward-pids.txt'
$KUBECONFIG_FILE = Join-Path $STATE_DIR 'kubeconfig'
$ENV_FILE = Join-Path $STATE_DIR 'hot.env'
$LOG_FILE = Join-Path $STATE_DIR 'start.log'

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  if (Test-Path $LOG_FILE) { Add-Content -Path $LOG_FILE -Value $line -Encoding utf8 }
}

function Stop-ComposeContainer {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Log 'docker not found; skipping compose down'
    return
  }
  # 独立 compose 文件，只影响 masterino-hot 容器，不会触碰 ACK 依赖。
  # down 也需要 ${MASTERLION_DEV_IMAGE} 等插值；从状态文件补上必要变量，避免
  # 因镜像/令牌未记录而无法清理容器。
  $devImageFile = Join-Path $STATE_DIR 'dev-image.json'
  if (-not $env:MASTERLION_DEV_IMAGE -and (Test-Path $devImageFile)) {
    try {
      $state = Get-Content $devImageFile -Raw | ConvertFrom-Json
      if ($state.image) { $env:MASTERLION_DEV_IMAGE = $state.image }
    } catch { }
  }
  if (-not $env:MASTERLION_DEV_IMAGE) { $env:MASTERLION_DEV_IMAGE = 'placeholder:unused' }
  if (Test-Path $ENV_FILE) {
    # 环境文件仍是裸 KEY=VALUE 行，直接加载补全插值变量。
    Get-Content $ENV_FILE | ForEach-Object {
      if ($_ -match '^([A-Z0-9_]+)=(.*)$') {
        if (-not (Test-Path "env:$($matches[1])")) {
          Set-Item -Path "env:$($matches[1])" -Value $matches[2]
        }
      }
    }
  }
  & docker compose -f $HOT_COMPOSE down --remove-orphans 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log 'masterino-hot container stopped'
}

function Stop-PortForwards {
  # 先杀记录的 PID，再按命令行特征兜底（覆盖子进程/未记录的情况）。
  if (Test-Path $PID_FILE) {
    Get-Content $PID_FILE | ForEach-Object {
      try { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
  Get-CimInstance Win32_Process -Filter "Name = 'kubectl.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -match 'port-forward' -and $_.CommandLine -match $env:TEMP -and $_.CommandLine -match 'masterino-test') {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
  Write-Log 'port-forward processes stopped'
}

function Remove-TempFiles {
  foreach ($f in @($KUBECONFIG_FILE, $ENV_FILE, $PID_FILE)) {
    if (Test-Path $f) {
      Remove-Item -Path $f -Force -ErrorAction SilentlyContinue
      Write-Log "removed $f"
    }
  }
  if (-not $KeepState) {
    # 保留 dev-image.json 状态（便于复用 digest），只清理敏感文件。
    Write-Log 'temp kubeconfig / env / pid files removed'
  }
}

Stop-ComposeContainer
Stop-PortForwards
if ($KeepState) {
  Write-Log 'Keeping temp state (kubeconfig/env/pid retained)'
} else {
  Remove-TempFiles
}
Write-Log 'Hot dev environment stopped'
