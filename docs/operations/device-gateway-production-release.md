# Device Gateway 生产发布清单

生产盘点确认 `masterino.bielcrystal.com` 当前由 `masterlion` namespace 中的
`deployment/masterino` 提供服务。`k8s/overlays/production` 对应未来的 `masterino` namespace
迁移目标，当前不得为了发布 Gateway 而应用该完整 overlay。

## 当前正式环境边界

- namespace：`masterlion`
- 主应用：`deployment/masterino`
- Gateway 固定镜像：
  `sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d`
- 内部地址：`http://masterino-device-gateway:8788`
- 公网地址：`https://masterino.bielcrystal.com/device-gateway`
- Gateway 保持单副本；当前版本把活动连接保存在进程内存中。

只使用以下当前正式环境资源和脚本：

- `k8s/overlays/production-live-gateway`
- `k8s/overlays/production-live-gateway-cutover`
- `scripts/operations/deployProductionDeviceGateway.sh`

脚本只管理 Gateway Deployment、Service、Secret、专用 Ingress，以及现有 Masterino
Deployment 的 `DEVICE_GATEWAY_URL`/`DEVICE_GATEWAY_SERVICE_TOKEN` 两个环境变量。它不包含
数据库、Redis、主站 Ingress 或其他生产工作负载。

## 发布前准备

1. 通过阿里云 CLI 的 `DescribeClusterUserKubeconfig` 获取仓库外的短期 kubeconfig。
2. 设置固定 context：`ack-c23ea84b-masterino-production`。
3. 从集群读取当前 Masterino 与 Aihub DB Bridge 的不可变镜像 digest，作为 mutation guard。
4. 在仓库外生成全新至少 32 字符的生产 `SERVICE_TOKEN`。
5. 从 `masterlion/masterino-secret` 的 `JWKS_KEY` 只保留 `kty`、`n`、`e`、`kid`、`alg`、
   `use`，生成 public-only RS256 JWKS。不得输出或写入私钥字段。

```bash
export KUBECONFIG='/absolute/path/outside/repository/kubeconfig'
export ACK_CONTEXT='ack-c23ea84b-masterino-production'
export ACK_API_SERVER='<exact-api-server-from-kubeconfig>'
export MASTERINO_IMAGE_DIGEST='sha256:<current-live-digest>'
export BRIDGE_IMAGE_DIGEST='sha256:<current-live-digest>'
```

## 分阶段上线

### 1. 预检与渲染

```bash
scripts/operations/deployProductionDeviceGateway.sh preflight
scripts/operations/deployProductionDeviceGateway.sh validate
scripts/operations/deployProductionDeviceGateway.sh render
```

预检必须确认 context、API Server、region、`masterlion` namespace、正式域名所有权、TLS/ACR
Secret，以及当前两个生产镜像均为不可变 digest。

### 2. 创建生产 Secret

```bash
CONFIRM_GATEWAY_SECRET=masterlion \
  scripts/operations/deployProductionDeviceGateway.sh create-secret \
  '/absolute/path/outside/repository/device-gateway-secret.env'
```

脚本会拒绝短 Token、测试 Token、私有 JWKS 字段、非生产 JWKS、错误集群和未确认操作。

### 3. 私网部署

```bash
CONFIRM_GATEWAY_DEPLOY=masterlion \
  scripts/operations/deployProductionDeviceGateway.sh deploy
```

命令会依次执行 server-side dry-run、应用 Gateway Deployment/Service、战略合并主应用两个环境
变量、等待两个 Deployment rollout，并通过 Kubernetes Service proxy 验证 `/health` 返回 `OK`。
此阶段不创建公网 Gateway Ingress。

### 4. 认证验证与公网切流

在私网完成有效 JWT、无效 JWT、`sub` 不匹配、未认证超时和 Service Token 行为验证后执行：

```bash
CONFIRM_GATEWAY_CUTOVER=masterlion \
  scripts/operations/deployProductionDeviceGateway.sh cutover
```

cutover 会再次检查 Secret、单副本、私网健康和 server-side dry-run，然后只创建
`ingress/masterino-device-gateway`，并等待公网健康接口返回 `OK`。

### 5. 验收与桌面发布

- `GET /device-gateway/health` 返回 `200 OK`；
- `WSS /device-gateway/ws` 在 15 秒内完成 upgrade 和 `auth_success`；
- `auth_success.userId` 与 JWT `sub` 一致；
- 主站登录、OAuth callback、上传、记忆和 Aihub 模型调用不受影响。

全部通过后才创建 `v1.2.1` Release 并运行 `Build Unsigned Desktop`。不得修改 `v1.2.0`
标签、附件或 OSS 版本目录。

## 精确回滚

```bash
CONFIRM_GATEWAY_ROLLBACK=masterlion \
  scripts/operations/deployProductionDeviceGateway.sh rollback
```

回滚只删除 `masterlion/ingress/masterino-device-gateway`，不删除 Secret、Deployment、Service，
也不修改主站 Ingress、数据库、Redis 或 Bucket ACL。
