# Device Gateway 生产发布清单

本文用于把已在 `mlai-test.bielcrystal.com` 验收的 Device Gateway 与桌面客户端
`1.1.2` 发布到 `masterino.bielcrystal.com`。合并代码不等于完成生产发布；必须按以下阶段
执行，并在每个阶段保留可回滚的不可变镜像 digest 和旧资源快照。

## 当前边界

- 测试网关镜像已验证的 digest 为
  `sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d`。
- 当前仓库只包含 `masterino-test` 的 Device Gateway Deployment、Service、Ingress 和
  `create-gateway-secret` 受控命令；生产 overlay 尚未包含这些资源。
- `deploy.sh --env test create-gateway-secret` 只能操作测试环境，禁止把测试 Secret 文件、
  `SERVICE_TOKEN` 或测试 JWKS 复制到生产。
- 桌面正式构建已指向 `https://masterino.bielcrystal.com/device-gateway`；只有生产 Ingress
  就绪后才能发布正式客户端，否则客户端会持续离线。

## 发布前必须补齐

1. 新增并评审生产专用的 Device Gateway Deployment、Service 和 Ingress：
   - namespace 固定为 `masterino`；
   - Ingress host 固定为 `masterino.bielcrystal.com`，路径为
     `/device-gateway(/|$)(.*)`，保留 WebSocket upgrade、rewrite 和长连接超时；
   - 镜像必须使用 ACR 产出的不可变 `image@sha256:digest`，不得使用可变 tag；
   - 保留 non-root、只读根文件系统、最小 capabilities、requests/limits 和 readiness probe。
2. 增加生产受控 Secret 流程，要求显式生产确认变量、ACK context 与 API Server 校验。
   Secret 名称可以沿用 `masterino-device-gateway-secret`，但内容必须重新生成：
   - `SERVICE_TOKEN` 使用生产专用随机值，至少 32 字符；
   - `JWKS_PUBLIC_KEY` 只从生产 `masterino-secret/JWKS_KEY` 派生 `kty`、`n`、`e`、
     `kid`、`alg`、`use` 公共字段；严禁包含 `d`、`p`、`q`、`dp`、`dq`、`qi`；
   - 必须使用 `--from-literal` 写入 JSON，并在写入后逐字节校验，不能使用会剥离双引号的
     `kubectl --from-env-file`。
3. 确认生产 Masterino Deployment 引用同一个生产 `SERVICE_TOKEN`，并设置内部
   `DEVICE_GATEWAY_URL=http://masterino-device-gateway:8788`。Token 不得进入 ConfigMap、
   GitHub artifact、构建日志或浏览器。
4. 通过本地 `aliyun` CLI 提交 Alibaba Cloud ACR 构建；不得在开发机本地构建或推送
   Docker 镜像。记录构建 ID、源码 SHA、镜像 digest 和 ACR 构建中的 `go test ./...` 结果。

## 推荐发布顺序

1. 在独立生产发布 PR 中加入生产资源、受控 Secret 命令、render/validate 检查和回滚步骤。
2. 对生产 overlay 执行客户端 render、schema 校验和 server-side dry-run，确认只新增网关资源
   及预期的 Masterino 环境变量，不覆盖现有 Ingress 根路径、TLS Secret、数据库或 OSS 配置。
3. 通过 `aliyun cs` 获取短期 ACK 凭据，先执行只读 preflight；人工核对 cluster ID、region、
   context、API Server、namespace 注解及当前工作负载快照。
4. 创建生产网关 Secret，随后部署 Deployment/Service；先只做集群内健康检查，不创建公网
   Ingress。
5. 验证 `/health`、有效 JWT、无效 JWT、`sub` 不匹配、未认证超时、Service Token 规则及
   Secret/日志无敏感数据后，再应用生产 Ingress。
6. 从公网验证：
   - `https://masterino.bielcrystal.com/device-gateway/health` 返回 200；
   - WebSocket URL 不携带 `userId` 也能升级，并在首条有效 JWT 后收到 `auth_success`；
   - `auth_success.userId` 与服务端验签后的 `sub` 一致；
   - API Key 仍通过对应 Masterino 生产服务验证，Service Token 仍强制显式 `userId`。
7. 先让少量内部账号使用生产指向的 `1.1.2` 客户端验收至少一小时，再发布 OSS canary：
   - 登录后 15 秒内在线，服务端 `online=true` 且设备数量正确；
   - 设备列表、系统信息、工作区扫描、只读文件操作和安全本地工具调用正常；
   - 断网恢复、休眠唤醒、Token 刷新后自动重连；
   - 开关保持用户启用意图，只有真正 `auth_success` 才显示绿色在线。
8. 手动运行 `Build Unsigned Desktop`，版本输入 `1.1.2`，确认三个平台构建和 OSS 校验成功后，
   再检查 Draft Release。正式发布前确认 OSS 当前 manifest 最后写入，所有引用对象 HTTP 200、
   size 与 SHA512 一致。

## 监控与回滚

- 重点监控 WebSocket 400/401、JWT 验签失败、用户不匹配、认证超时、心跳超时、重连数量、
  Pod 重启和内存；日志不得记录 Token 或完整用户 ID。
- 网关异常时先移除或回滚 `/device-gateway` Ingress，再把 Deployment 回滚到上一 digest；
  不删除 Secret，不修改 Bucket ACL，不影响主站根路径。
- 客户端发布异常时不要覆盖已有 OSS 版本目录；将 `canary.yml` 与 `canary-mac.yml` 恢复到
  上一个已验证版本。版本文件不可变，当前 manifest 必须最后更新。
- 回滚后再次确认主站登录、OAuth callback、文件上传、记忆和 Aihub 模型调用不受影响。

## 禁止事项

- 禁止复用测试 `SERVICE_TOKEN`、测试 JWKS、测试客户端数据目录或测试 namespace 资源。
- 禁止把生产私钥字段写入网关 Secret，禁止在命令输出、PR 或日志中打印完整 Secret。
- 禁止本地构建生产 Docker 镜像，禁止使用可变镜像 tag，禁止跳过 ACK target guard。
- 禁止在生产网关未就绪前发布指向生产 URL 的正式客户端。
- 未完成上述生产资源 PR、dry-run、灰度验收和回滚演练前，不得视为生产发布完成。
