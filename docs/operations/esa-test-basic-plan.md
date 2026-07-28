# 使用阿里云 CLI 为测试环境接入 ESA 基础版

## 摘要

- 保持业务域名 `https://mlai-test.bielcrystal.com` 不变，不修改代码、不重建镜像。
- ESA 使用国内加速、CNAME 接入、基础版 1 个月、手动续费。
- 当前实时价格为 ¥9.90，含 50GB；购买前再次查询价格并设置付款确认门槛。参见[基础版计费](https://help.aliyun.com/en/edge-security-acceleration/esa/product-overview/basic-package-fee)。
- 基础版不能直接创建子域名站点，因此创建根站点 `bielcrystal.com`，仅代理 `mlai-test.bielcrystal.com`，不迁移根域名 NS。
- 除 TXT 验证和最终 CNAME 切换由域名管理员操作外，其余配置全部通过 Aliyun CLI 完成。

## CLI 配置步骤

### 1. 购买套餐并创建站点

1. 执行 `CheckSiteName bielcrystal.com`。
2. 执行 `DescribeRatePlanPrice --PlanName basic --Period 1 --Amount 1`。
3. 展示实时金额并获得最终付款确认后执行：

```powershell
aliyun esa PurchaseRatePlan `
  --PlanName basic `
  --PlanCode basicplan `
  --SiteName bielcrystal.com `
  --Coverage domestic `
  --Type CNAME `
  --Period 1 `
  --Amount 1 `
  --ChargeType PREPAY `
  --AutoPay true `
  --AutoRenew false
```

4. 轮询 `ListUserRatePlanInstances` 和 `ListSites`，取得 `InstanceId`、`SiteId`、`VerifyCode`。
5. 若购买接口未自动创建站点，则用该 `InstanceId` 调用 `CreateSite`。

参考：[PurchaseRatePlan](https://help.aliyun.com/en/edge-security-acceleration/esa/api-esa-2024-09-10-purchaserateplan)

### 2. 完成站点所有权验证

暂停执行并向域名管理员提供以下记录：

| 配置项 | 值 |
| --- | --- |
| 类型 | `TXT` |
| 主机记录 | `_esaauth` |
| 完整名称 | `_esaauth.bielcrystal.com` |
| 记录值 | ESA 返回的 `VerifyCode` |
| TTL | 600 秒 |

公网解析确认生效后，调用 `VerifySite --SiteId <SiteId>`。

### 3. 创建加速记录和回源配置

调用 `CreateRecord`，配置如下：

| 参数 | 值 |
| --- | --- |
| `RecordName` | `mlai-test.bielcrystal.com` |
| `Type` | `CNAME` |
| `Data` | `nlb-pkheesf2fnmqr7yil7.cn-shenzhen.nlb.aliyuncsslb.com` |
| `SourceType` | `Domain` |
| `Proxied` | `true` |
| `BizName` | `web` |
| `HostPolicy` | `follow_hostname` |
| `Ttl` | `1` |

调用 `CreateOriginRule`，仅匹配 `mlai-test.bielcrystal.com`：

- 使用 HTTPS 443 回源。
- Origin Host 与 SNI 均为 `mlai-test.bielcrystal.com`。
- 开启源站证书验证。
- 回源读取超时设为 300 秒。
- 不启用 Range 分片。

通过 `GetRecord` 取得 ESA 分配的 `RecordCname`。

参考：[CreateRecord](https://help.aliyun.com/en/edge-security-acceleration/esa/api-esa-2024-09-10-createrecord)

### 4. HTTPS 与网络兼容配置

先通过 `SetCertificate` 绑定现有 CAS 泛域名证书：

| 参数 | 值 |
| --- | --- |
| `Type` | `cas` |
| `CasId` | `21071605` |
| `Region` | `cn-hangzhou` |

该证书覆盖 `*.bielcrystal.com`，有效期至 2026-11-21。

- 启用 HTTPS、HTTP/2、HTTP/3、TLS 1.2 和 TLS 1.3。
- 关闭 TLS 1.0 和 TLS 1.1。
- 暂不启用 HSTS 和额外强制跳转。
- 网络优化仅针对测试域名：开启 WebSocket，上传上限 100MB，关闭智能路由和 gRPC。
- 切流稳定后，申请 `mlai-test.bielcrystal.com` 的 ESA 托管 Let's Encrypt 证书，作为自动续签证书。

参考：[ESA 边缘证书](https://help.aliyun.com/en/edge-security-acceleration/esa/user-guide/configure-edge-certificates/)

### 5. 缓存和压缩规则

全局配置为 `bypass_all`、关闭 POST 缓存、完整保留查询参数，确保页面、接口、OAuth、SSE 和用户数据不被缓存。

创建优先级最高的长期静态缓存规则：

- `/_next/static/`
- `/_spa/assets/`
- `/_spa/vendor/`
- `/_spa-auth/assets/`
- `/_spa-auth/vendor/`
- 边缘及浏览器 TTL：31,536,000 秒。

创建第二条公共媒体缓存规则：

- `/brand/`
- `/avatars/`
- `/icons/`
- `/images/`
- `/videos/`
- `/screenshots/`
- `/og/`
- 边缘 TTL：604,800 秒。
- 浏览器 TTL：86,400 秒。

两条规则均按以下方式配置：

- 仅允许 GET/HEAD 进入缓存流程。
- 保留全部查询参数。
- 开启缓存欺骗防护和过期内容服务。
- 对匹配的静态路径启用 Brotli 和 Gzip。
- 不压缩动态接口与流式响应。

ESA 的路径规则优先于全局配置，因此静态路径可缓存，其余请求仍统一回源。参考[规则优先级](https://help.aliyun.com/en/edge-security-acceleration/esa/user-guide/overview-of-rules/)。

### 6. 预切流验证和 DNS 切换

使用 ESA `RecordCname` 配合 `curl --connect-to` 验证，不修改本机 hosts：

- 首页和登录页正常。
- TLS 证书匹配。
- 静态资源重复访问出现缓存命中。
- `/api/`、`/webapi/`、`/trpc/`、`/oauth/`、`/oidc/` 无缓存。
- Cookie、Authorization、查询参数完整传递。
- SSE、聊天流式输出、上传和 WebSocket 正常。

验证通过后，向 DNS 管理员提供最终变更：

- 将 `mlai-test` 的 CNAME 从当前 NLB 地址改为 ESA 返回的 `RecordCname`。
- TTL 保持 600 秒。

切换后连续监控 30 分钟：HTTP 4xx/5xx、回源错误、TLS、缓存命中、登录、OAuth、聊天流和上传。

## 接口与回滚

- 应用代码、API 路径、请求协议、域名、Kubernetes 服务和镜像均不改变。
- OAuth 验收前先确认线上 `APP_URL=https://mlai-test.bielcrystal.com`，并确保企业微信已放行 ACK 出口 IP `39.108.126.145`；否则原登录错误与 ESA 无关。
- 回滚时由 DNS 管理员把 `mlai-test` CNAME 恢复为 `nlb-pkheesf2fnmqr7yil7.cn-shenzhen.nlb.aliyuncsslb.com`。
- ESA 站点和已购套餐暂时保留，确认无需继续测试后再解绑，避免影响快速重试。

## 已选定假设

- 使用中国内地加速，`bielcrystal.com` 已完成有效 ICP 备案。
- 套餐为 1 个月基础版、手动续费；当前报价 ¥9.90，实际以下单前 API 报价为准。
- 域名管理员人工完成 TXT 和 CNAME 两次 DNS 修改。
- 当前 Aliyun CLI 账号继续管理 ESA 与 CAS，但不接收或保存域名账号密钥。
