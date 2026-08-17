# Device Gateway 生产发布清单

本文用于把已在 `mlai-test.bielcrystal.com` 验收的 Device Gateway 部署到
`masterino.bielcrystal.com`。网关 Deployment 与 Service 属于生产 overlay；公网 Ingress
独立放在 cutover overlay，只有私网检查通过后才允许创建。

## 固定边界

- namespace：`masterino`
- Gateway 镜像：
  `sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d`
- 内部地址：`http://masterino-device-gateway:8788`
- 公网地址：`https://masterino.bielcrystal.com/device-gateway`
- Gateway 保持单副本；当前版本把活动连接保存在进程内存中。
- 生产 `SERVICE_TOKEN` 和由生产 `JWKS_KEY` 派生的 public-only RS256 JWKS 必须存放在
  仓库外；不得复用测试 Secret、提交到 Git 或输出私钥字段。

生产 Gateway 资源位于：

- `k8s/overlays/production/device-gateway.yaml`
- `k8s/overlays/production-gateway-cutover/device-gateway-ingress.yaml`
- `k8s/overlays/production/device-gateway-secret.env.example`

## 发布前准备

1. 准备仓库外的生产 `KUBECONFIG`，并记录 `ACK_CONTEXT` 和 API Server。
2. 准备当前生产 Masterino 与 Aihub DB Bridge 的不可变镜像 digest。
3. 从 `device-gateway-secret.env.example` 创建仓库外临时文件：
   - `SERVICE_TOKEN` 使用全新随机值，至少 32 字符；
   - `JWKS_PUBLIC_KEY` 只能包含 `kty`、`n`、`e`、`kid`、`alg`、`use`；
   - JWKS 必须由生产 `masterino-secret/JWKS_KEY` 派生。
4. 不要把 Secret 内容写入 shell history、终端日志、GitHub artifact 或 PR。

所有命令都必须显式带生产凭据与镜像 digest：

```bash
export KUBECONFIG='/absolute/path/outside/repository/production-kubeconfig'
export ACK_CONTEXT='<production-context>'
export ACK_API_SERVER='<exact-api-server-from-preflight>'
export MASTERINO_IMAGE_DIGEST='sha256:<current-production-digest>'
export BRIDGE_IMAGE_DIGEST='sha256:<current-production-digest>'
```

## 分阶段上线

### 1. 只读预检和渲染验证

```bash
./deploy.sh --env production preflight
./deploy.sh --env production validate
./deploy.sh --env production render > /tmp/masterino-production-rendered.yaml
kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT" \
  apply --server-side --dry-run=server -f /tmp/masterino-production-rendered.yaml
```

核对集群、region、namespace 注解、固定 Gateway digest、单副本、探针、资源限制、
`DEVICE_GATEWAY_URL` 和 Secret 引用。此时渲染结果不得包含 Gateway 公网 Ingress。

### 2. 创建生产 Gateway Secret

`create-gateway-secret` 会拒绝短 Token、测试 Token、私有 JWKS 字段、非生产 JWKS 和未确认的
生产操作：

```bash
CONFIRM_GATEWAY_SECRET=masterino \
  ./deploy.sh --env production create-gateway-secret \
  '/absolute/path/outside/repository/device-gateway-secret.env'
```

### 3. 部署私网 Gateway

```bash
./deploy.sh --env production deploy
./deploy.sh --env production rollout
```

确认 Gateway 只有一个 Available replica。通过 Kubernetes API Server 的 Service proxy 检查
`/health`，并完成有效 JWT、无效 JWT、`sub` 不匹配、未认证超时及 Service Token 行为验证。

### 4. 公网切流

只有私网健康与认证验证全部通过后才执行：

```bash
CONFIRM_GATEWAY_CUTOVER=masterino \
  ./deploy.sh --env production gateway-cutover
```

该命令会再次检查 Secret、单副本、私网 `/health` 和 server-side dry-run，然后创建独立 Ingress，
并等待公网健康接口返回 `OK`。

### 5. 验收

- `GET https://masterino.bielcrystal.com/device-gateway/health` 返回 `200 OK`；
- `WSS /device-gateway/ws` 在 15 秒内完成 upgrade 和 `auth_success`；
- `auth_success.userId` 与服务端验签后的 JWT `sub` 一致；
- 生产 Masterino Pod 已注入内部 Gateway URL 与生产 Service Token 引用；
- 主站登录、OAuth callback、文件上传、记忆和 Aihub 模型调用不受影响。

网关验证完成后才创建 `v1.2.1` Release，并运行 `Build Unsigned Desktop` 发布 Windows x64、
macOS arm64 和 macOS x64。不得修改 `v1.2.0` 标签、附件或 OSS 版本目录。

## 精确回滚

Gateway 公网异常时只移除专用 Ingress：

```bash
CONFIRM_GATEWAY_ROLLBACK=masterino \
  ./deploy.sh --env production gateway-rollback
```

该操作不会删除 Gateway Secret、Deployment、Service 或主站 Ingress。若还需回滚 Gateway
Deployment，使用已记录的上一不可变 digest；不要删除 Secret，也不要修改 Bucket ACL 或系统全局
安全设置。

## 禁止事项

- 禁止复用测试 `SERVICE_TOKEN`、测试 JWKS 或测试 namespace 数据。
- 禁止把生产私钥字段写入 Gateway Secret 或打印到日志。
- 禁止使用可变镜像 tag，禁止跳过 ACK target guard 和生产确认变量。
- 禁止在私网验证通过前创建公网 Gateway Ingress。
- 禁止在生产 Gateway 就绪前发布指向生产地址的新桌面客户端。
