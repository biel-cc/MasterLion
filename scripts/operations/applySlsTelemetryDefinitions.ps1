param(
  [Parameter(Mandatory = $true)] [string] $Project,
  [Parameter(Mandatory = $true)] [string] $MachineGroup,
  [string] $AliyunCli = 'aliyun'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')
$collectorPath = Join-Path $repoRoot 'k8s/observability/sls-product-events-config.json'
$dashboardPath = Join-Path $repoRoot 'k8s/observability/sls-dashboard.json'

foreach ($path in @($collectorPath, $dashboardPath)) {
  Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
}

# Windows PowerShell removes nested JSON quotes when invoking native commands.
# Let Node read the body and spawn aliyun.exe so --body reaches the CLI unchanged.
function Invoke-AliyunJson(
  [string] $Operation,
  [string[]] $Parameters,
  [string] $BodyPath
) {
  $runner = @'
const fs = require('fs');
const { spawnSync } = require('child_process');
const executable = process.argv[1];
const operation = process.argv[2];
const bodyPath = process.argv[3];
const parameters = process.argv.slice(4);
const body = fs.readFileSync(bodyPath, 'utf8');
const args = ['sls', operation, ...parameters, '--body', body];
const result = spawnSync(executable, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
'@
  node -e $runner $AliyunCli $Operation $BodyPath @Parameters
  if ($LASTEXITCODE -ne 0) { throw "aliyun sls $Operation failed" }
}

& $AliyunCli sls GetConfig --project $Project --configName masterino-product-events 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Invoke-AliyunJson UpdateConfig @(
    '--project', $Project,
    '--configName', 'masterino-product-events'
  ) $collectorPath
} else {
  Invoke-AliyunJson CreateConfig @('--project', $Project) $collectorPath
}

& $AliyunCli sls ApplyConfigToMachineGroup `
  --project $Project `
  --machineGroup $MachineGroup `
  --configName masterino-product-events
if ($LASTEXITCODE -ne 0) { throw 'Failed to bind the SLS collector configuration' }

& $AliyunCli sls GetDashboard --project $Project --dashboardName masterino-product-telemetry 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Invoke-AliyunJson UpdateDashboard @(
    '--project', $Project,
    '--dashboardName', 'masterino-product-telemetry'
  ) $dashboardPath
} else {
  Invoke-AliyunJson CreateDashboard @('--project', $Project) $dashboardPath
}

Write-Output 'SLS collector configuration and dashboard are up to date.'
