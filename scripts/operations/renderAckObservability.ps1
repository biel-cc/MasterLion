param(
  [Parameter(Mandatory = $true)] [string] $ClickHouseDigest,
  [Parameter(Mandatory = $true)] [string] $LangfuseWebDigest,
  [Parameter(Mandatory = $true)] [string] $LangfuseWorkerDigest,
  [Parameter(Mandatory = $true)] [string] $ClickHouseBackupDigest
)

$ErrorActionPreference = 'Stop'
$digestPattern = '^sha256:[0-9a-f]{64}$'
foreach ($digest in @($ClickHouseDigest, $LangfuseWebDigest, $LangfuseWorkerDigest, $ClickHouseBackupDigest)) {
  if ($digest -notmatch $digestPattern) { throw "Invalid image digest: $digest" }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')
$manifest = kubectl kustomize (Join-Path $repoRoot 'k8s/observability')
if ($LASTEXITCODE -ne 0) { throw 'kubectl kustomize failed' }

$rendered = $manifest -join "`n"
$acr = 'boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client'
$rendered = $rendered.Replace("$acr/clickhouse-server:25.8-lts-digest-marker", "$acr/clickhouse-server@$ClickHouseDigest")
$rendered = $rendered.Replace("$acr/langfuse-web:3-digest-marker", "$acr/langfuse-web@$LangfuseWebDigest")
$rendered = $rendered.Replace("$acr/langfuse-worker:3-digest-marker", "$acr/langfuse-worker@$LangfuseWorkerDigest")
$rendered = $rendered.Replace("$acr/clickhouse-backup:2.7.0-digest-marker", "$acr/clickhouse-backup@$ClickHouseBackupDigest")

if ($rendered -match 'digest-marker') { throw 'An image digest marker remains in the rendered manifest' }
$rendered
