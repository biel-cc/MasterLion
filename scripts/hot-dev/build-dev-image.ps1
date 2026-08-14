param(
  [string]$Branch = '',
  [switch]$SkipBuild,
  [switch]$DryRun
)

# 触发 ACR 云端构建 masterino 开发镜像（FINAL_STAGE=dev），并记录
# BuildRecordId、tag 和不可变 digest。运行前需要：
#   - aliyun CLI 可用，并已配置可访问 ACR 与目标仓库的凭据
#   - 当前分支已 push 到 GitHub（ACR 从绑定仓库拉取源码）
#
# 用法示例：
#   powershell -ExecutionPolicy Bypass -File scripts/hot-dev/build-dev-image.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/hot-dev/build-dev-image.ps1 -Branch feat/my-branch
#
# 成功后在 $env:TEMP\masterino-hot-dev\dev-image.json 记录构建信息。

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ACR_REGION = 'cn-shenzhen'
$ACR_INSTANCE_ID = 'cri-8velxg2aueo822e4'
$ACR_REPO_ID = 'crr-vrxmxr0vf4jkxd59'
$ACR_REPO_NAME = 'biel_client/masterino'
# 与 deployAckTestWithAliyunCli.sh 保持一致的内网基础镜像参数。
$ACR_BUILD_ARGS = @(
  'BASE_REGISTRY=boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client',
  'USE_CN_MIRROR=true',
  'FINAL_STAGE=dev'
)
$STATE_DIR = Join-Path $env:TEMP 'masterino-hot-dev'
$STATE_FILE = Join-Path $STATE_DIR 'dev-image.json'
$POLL_INTERVAL_SEC = 20
$POLL_TIMEOUT_SEC = 3600

function Fail([string]$Message) {
  Write-Error "ERROR: $Message"
  exit 1
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "required command is missing: $Name"
  }
}

# 返回当前分支名，未指定 -Branch 时使用。
function Get-CurrentBranch {
  $branch = git rev-parse --abbrev-ref HEAD 2>$null
  if (-not $branch -or $branch -eq 'HEAD') {
    Fail 'cannot resolve the current git branch; pass -Branch explicitly'
  }
  return $branch
}

# 校验分支已 push 到 origin，避免云端构建的不是预期提交。
# 本机可能未直连 github.com（需代理），ls-remote 失败时给出提示并中止。
function Assert-BranchPushed([string]$Branch) {
  $local = git rev-parse "$Branch" 2>$null
  if (-not $local) {
    Fail "git branch does not exist locally: $Branch"
  }
  $remote = git ls-remote origin "refs/heads/$Branch" 2>$null | ForEach-Object { ($_ -split "`t")[0] }
  if (-not $remote) {
    Fail "branch is not pushed to origin (no remote ref); if your network requires a proxy, run: git config --global http.proxy http://127.0.0.1:<port>"
  }
  if ($local -ne $remote) {
    Fail "local '$Branch' ($local) does not match origin ('$remote'); push first"
  }
}

function Get-ShortSha([string]$Branch) {
  return (git rev-parse --short "$Branch" 2>$null)
}

function Invoke-AliyunJson {
  # 透传 aliyun 输出 JSON；非零退出码直接失败。
  param([string[]]$CliArgs)
  $output = & aliyun @CliArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Fail "aliyun command failed (exit $code): aliyun $($CliArgs -join ' ')"
  }
  return ($output -join "`n") | ConvertFrom-Json
}

function New-DevBuildRule([string]$Branch, [string]$Tag) {
  # 为当前分支创建/复用 dev 构建规则。ImageTag 唯一，规则按 PushName 复用。
  $existing = Invoke-AliyunJson @('cr','list-repo-build-rule','--region',$ACR_REGION,'--instance-id',$ACR_INSTANCE_ID,'--repo-id',$ACR_REPO_ID)
  $match = $existing.BuildRules | Where-Object {
    $_.PushType -eq 'GIT_BRANCH' -and $_.PushName -eq $Branch -and $_.ImageTag -eq $Tag
  }
  if ($match) {
    Write-Host "Reusing build rule $($match.BuildRuleId) for $Branch -> $Tag"
    return $match.BuildRuleId
  }

  $body = @(
    'cr','create-repo-build-rule',
    '--region', $ACR_REGION,
    '--instance-id', $ACR_INSTANCE_ID,
    '--repo-id', $ACR_REPO_ID,
    '--push-type', 'GIT_BRANCH',
    '--push-name', $Branch,
    '--image-tag', $Tag,
    '--dockerfile-location', '.',
    '--dockerfile-name', 'Dockerfile',
    '--platforms', 'linux/amd64'
  )
  foreach ($arg in $ACR_BUILD_ARGS) { $body += '--build-args'; $body += $arg }
  $result = Invoke-AliyunJson $body
  $ruleId = $result.BuildRuleId
  if (-not $ruleId) {
    Fail 'ACR did not return a BuildRuleId'
  }
  Write-Host "Created build rule $ruleId for $Branch -> $Tag"
  return $ruleId
}

function Wait-BuildSuccess([string]$RuleId, [string]$BuildRecordId) {
  $deadline = (Get-Date).AddSeconds($POLL_TIMEOUT_SEC)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $POLL_INTERVAL_SEC
    $status = Invoke-AliyunJson @(
      'cr','get-repo-build-record-status','--region',$ACR_REGION,
      '--instance-id',$ACR_INSTANCE_ID,'--repo-id',$ACR_REPO_ID,
      '--build-record-id',$BuildRecordId
    )
    $state = $status.BuildStatus
    Write-Host "Build status: $state"
    if ($state -eq 'SUCCESS') { return }
    if ($state -eq 'FAILURE' -or $state -eq 'CANCELLED') {
      Fail "ACR build $BuildRecordId ended with $state"
    }
  }
  Fail "ACR build $BuildRecordId timed out after $POLL_TIMEOUT_SEC seconds"
}

function Get-TagDigest([string]$Tag) {
  # ListRepoTag 返回 Digest（hex），拼接成 sha256: 形式。
  $tags = Invoke-AliyunJson @(
    'cr','list-repo-tag','--region',$ACR_REGION,
    '--instance-id',$ACR_INSTANCE_ID,'--repo-id',$ACR_REPO_ID,
    '--page-size','100'
  )
  $item = $tags.Images | Where-Object { $_.Tag -eq $Tag } | Select-Object -First 1
  if (-not $item) {
    Fail "tag '$Tag' not found after build"
  }
  if (-not $item.Digest -or $item.Digest -notmatch '^[0-9a-f]{64}$') {
    Fail "tag '$Tag' returned an invalid digest"
  }
  return "sha256:$($item.Digest)"
}

Require-Command aliyun
Require-Command git

if (-not $Branch) { $Branch = Get-CurrentBranch }
Assert-BranchPushed $Branch
$shortSha = Get-ShortSha $Branch
$tag = "dev-$shortSha"
$imageRef = "boen-registry.cn-shenzhen.cr.aliyuncs.com/$ACR_REPO_NAME@$tag"

Write-Host "Branch: $Branch"
Write-Host "Tag:    $tag"
Write-Host "Image:  $imageRef"

if ($DryRun) {
  Write-Host 'Dry run: skipping rule creation and build trigger.'
  exit 0
}

# 校验最终镜像引用使用不可变 digest（不依赖本地 build 或 latest）。
if ($SkipBuild) {
  Write-Host "SkipBuild: resolving existing digest for $tag"
} else {
  $ruleId = New-DevBuildRule $Branch $tag
  $record = Invoke-AliyunJson @(
    'cr','create-build-record-by-rule','--region',$ACR_REGION,
    '--instance-id',$ACR_INSTANCE_ID,'--repo-id',$ACR_REPO_ID,
    '--build-rule-id',$ruleId
  )
  $buildRecordId = $record.BuildRecordId
  if (-not $buildRecordId) {
    Fail 'ACR did not return a BuildRecordId'
  }
  Write-Host "BuildRecordId: $buildRecordId"
  Wait-BuildSuccess $ruleId $buildRecordId
}

$digest = Get-TagDigest $tag
$fullImage = "boen-registry.cn-shenzhen.cr.aliyuncs.com/$ACR_REPO_NAME@$digest"

if (-not (Test-Path $STATE_DIR)) { New-Item -ItemType Directory -Path $STATE_DIR | Out-Null }
$state = [ordered]@{
  branch         = $Branch
  tag            = $tag
  buildRecordId  = $buildRecordId
  digest         = $digest
  image          = $fullImage
  updatedAt      = (Get-Date).ToString('o')
}
$state | ConvertTo-Json | Set-Content -Path $STATE_FILE -Encoding utf8
# 只允许当前用户读写。
icacls $STATE_FILE /inheritance:r /grant:r "$env:USERNAME:(R)" | Out-Null

Write-Host ''
Write-Host "Dev image ready (recorded in $STATE_FILE):"
Write-Host "  MASTERLION_DEV_IMAGE=$fullImage"
Write-Host 'Start the hot dev environment with scripts/hot-dev/start-hot-dev.ps1'
