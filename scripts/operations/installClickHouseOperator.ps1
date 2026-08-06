param(
  [Parameter(Mandatory = $true)] [string] $OperatorDigest,
  [Parameter(Mandatory = $true)] [string] $MetricsExporterDigest
)

$ErrorActionPreference = 'Stop'
$digestPattern = '^sha256:[0-9a-f]{64}$'
foreach ($digest in @($OperatorDigest, $MetricsExporterDigest)) {
  if ($digest -notmatch $digestPattern) { throw "Invalid image digest: $digest" }
}

$version = '0.27.0'
$bundleSha256 = 'C210E53DDB0B1E30058CA4645AA6AF03DF03A2774E9E58D7AB6E02255126C667'
$bundleUri = "https://raw.githubusercontent.com/Altinity/clickhouse-operator/release-$version/deploy/operator/clickhouse-operator-install-bundle.yaml"
$bundlePath = Join-Path ([System.IO.Path]::GetTempPath()) "clickhouse-operator-$version-$PID.yaml"
$acr = 'boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client'

try {
  Invoke-WebRequest -UseBasicParsing -Uri $bundleUri -OutFile $bundlePath
  $actualSha256 = (Get-FileHash -Algorithm SHA256 $bundlePath).Hash
  if ($actualSha256 -ne $bundleSha256) {
    throw "ClickHouse operator bundle checksum mismatch: $actualSha256"
  }

  $bundle = Get-Content -Raw $bundlePath
  $bundle = $bundle.Replace(
    "altinity/clickhouse-operator:$version",
    "$acr/clickhouse-operator@$OperatorDigest"
  )
  $bundle = $bundle.Replace(
    "altinity/metrics-exporter:$version",
    "$acr/metrics-exporter@$MetricsExporterDigest"
  )
  if ($bundle -match 'altinity/(clickhouse-operator|metrics-exporter):') {
    throw 'An upstream operator image reference remains in the bundle'
  }

  $bundle | kubectl apply -f -
  if ($LASTEXITCODE -ne 0) { throw 'kubectl apply failed' }

  kubectl -n kube-system patch deployment clickhouse-operator `
    --type merge `
    --patch '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"acr-credential-secret-aggregation"}]}}}}'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to configure the operator ACR image pull secret' }
} finally {
  Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
}
