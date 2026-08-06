param(
  [Parameter(Mandatory = $true)] [string] $ClusterId,
  [Parameter(Mandatory = $true)] [string] $Project,
  [string] $Region = 'cn-shenzhen',
  [string] $DataRegion = 'cn-shenzhen-b',
  [string] $HaRegion = 'cn-shenzhen-ha'
)

$ErrorActionPreference = 'Stop'
$machineGroup = "k8s-group-$ClusterId"

function Resolve-FirstIPv4([string] $Name) {
  $address = Resolve-DnsName $Name -Type A -ErrorAction Stop |
    Where-Object IPAddress |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $address) { throw "No IPv4 address found for $Name" }
  $address
}

# Some enterprise DNS servers return a parking address for *.log.aliyuncs.com.
# Resolve the authoritative public/intranet targets before writing pod-scoped
# host aliases. This intentionally avoids changing cluster-wide DNS behavior.
$hostAliases = @(
  @{
    ip = Resolve-FirstIPv4 "$Region-intranet.log.aliyuncs.com"
    hostnames = @("$Region-intranet.log.aliyuncs.com")
  },
  @{
    ip = Resolve-FirstIPv4 "logtail.$Region-intranet.log.aliyuncs.com"
    hostnames = @("logtail.$Region-intranet.log.aliyuncs.com")
  },
  @{
    ip = Resolve-FirstIPv4 "ali-$Region-sls-admin.$Region-intranet.log.aliyuncs.com"
    hostnames = @("ali-$Region-sls-admin.$Region-intranet.log.aliyuncs.com")
  },
  @{
    ip = Resolve-FirstIPv4 "$Project.$DataRegion.log.aliyuncs.com"
    hostnames = @(
      "$Project.$Region-intranet.log.aliyuncs.com",
      "$Project.$DataRegion-intranet.log.aliyuncs.com",
      "$DataRegion-intranet.log.aliyuncs.com"
    )
  },
  @{
    ip = Resolve-FirstIPv4 "ali-$DataRegion-sls-admin.$DataRegion.log.aliyuncs.com"
    hostnames = @("ali-$DataRegion-sls-admin.$DataRegion-intranet.log.aliyuncs.com")
  },
  @{
    ip = Resolve-FirstIPv4 "$HaRegion.log.aliyuncs.com"
    hostnames = @(
      "$HaRegion-intranet.log.aliyuncs.com",
      "ali-$HaRegion-sls-admin.$HaRegion-intranet.log.aliyuncs.com"
    )
  }
)

$identityManifest = kubectl -n kube-system create configmap masterino-loongcollector-identity `
  --from-literal="user_defined_id=$machineGroup" `
  --dry-run=client `
  -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Failed to render the LoongCollector identity ConfigMap' }
$identityManifest | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply the LoongCollector identity ConfigMap' }

$patch = @{
  spec = @{
    template = @{
      spec = @{
        hostAliases = $hostAliases
        volumes = @(
          @{
            name = 'masterino-loongcollector-identity'
            configMap = @{ name = 'masterino-loongcollector-identity' }
          }
        )
        containers = @(
          @{
            name = 'loongcollector'
            volumeMounts = @(
              @{
                name = 'masterino-loongcollector-identity'
                mountPath = '/etc/ilogtail/user_defined_id'
                subPath = 'user_defined_id'
                readOnly = $true
              }
            )
          }
        )
      }
    }
  }
}

$patchPath = Join-Path ([System.IO.Path]::GetTempPath()) "masterino-loongcollector-$PID.json"
try {
  [System.IO.File]::WriteAllText(
    $patchPath,
    ($patch | ConvertTo-Json -Depth 20 -Compress),
    [System.Text.UTF8Encoding]::new($false)
  )
  kubectl -n kube-system patch daemonset loongcollector-ds `
    --type strategic `
    --patch-file $patchPath
  if ($LASTEXITCODE -ne 0) { throw 'Failed to patch loongcollector-ds' }

  kubectl -n kube-system rollout status daemonset/loongcollector-ds --timeout=420s
  if ($LASTEXITCODE -ne 0) { throw 'LoongCollector rollout did not complete' }
} finally {
  Remove-Item -LiteralPath $patchPath -Force -ErrorAction SilentlyContinue
}
