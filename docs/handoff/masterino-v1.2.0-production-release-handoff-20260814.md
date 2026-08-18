# Masterino v1.2.0 生产发布交接

## 1. 交接范围

- 目标版本：`1.2.0`
- Git Tag：`v1.2.0`
- 变更基线：`v1.1.1..v1.2.0`
- 测试站点：`https://mlai-test.bielcrystal.com`
- 生产站点：`https://masterino.bielcrystal.com`
- 应用镜像：`boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino`
- 桌面更新源：`https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases`

本次发布将根应用与桌面客户端版本统一为 `1.2.0`。生产发布必须使用阿里云 ACR
云端构建的不可变 digest，不允许在本地构建生产镜像，也不允许用可变的 `latest` 直接部署。

## 2. 版本内容

### 2.1 桌面客户端与阿里云 OSS 更新

- 增加 Windows x64、macOS arm64、macOS x64 无签名安装包构建和 OSS 发布链路。
- 修复 OSS virtual-hosted 访问、对象 ACL、公共读取生效等待、SHA512 校验和 macOS
  双架构清单合并。
- Windows 任务栏和安装包图标恢复为 Masterino 图标。
- 更新检测、下载和安装不再使用 GitHub Release 资产，运行时流量只允许访问指定的
  深圳 OSS 前缀。
- 新增 Ed25519 签名的 `canary.json`；客户端验证签名、通道、SemVer、OSS 路径、大小和
  SHA512 后才允许下载。
- Windows 可后台下载 NSIS，并支持 “重启并安装” 或 “退出时安装”；系统仍会显示未签名
  SmartScreen 提示。
- macOS 根据运行架构下载并校验 DMG，只提供打开安装包，不在未签名状态下尝试自动覆盖。
- 高级设置新增默认开启的自动下载开关；保留每小时检查和手动检查。

涉及 PR：#64-#73、#92。

### 2.2 设备网关与桌面运行时

- Device Gateway 改为 WebSocket 建连后 10 秒内通过首条 `auth` 消息认证。
- JWT/API Key 的用户身份由服务端验证结果确定；旧客户端 URL 中的 `userId` 只能做一致性
  校验，不能用于认证或路由。
- 未认证连接不进入 Hub、不计入在线设备，也不能替换已有连接。
- 桌面端等待 `auth_success` 后才显示在线，区分认证失效、握手失败、网络错误和超时。
- 网关开关表示用户的自动连接意图；重连期间保持开启，并支持网络恢复、Token 刷新和
  应用重启后的自动恢复。
- OAuth scope 增加 `openid`，打包日志使用 `electron-log` 落盘且不记录 Token 或完整用户 ID。

涉及 PR：#72、#75。

### 2.3 Office、Onlyboxes 与文件能力

- 通过 OfficeCLI 增加 Word、Excel 和 PowerPoint 生成能力，并在测试环境启用。
- Onlyboxes Office 工具增加结构化错误、容量 / 离线识别和三次有界退避重试。
- 模型 Provider 查询增加 PostgreSQL 恢复态短重试，最终错误隐藏 SQL、用户 ID 和数据库字段。
- 测试 PostgreSQL 内存上限调整为 4 GiB，并关闭不适合当前工作负载的 ParadeDB
  Join/Aggregate Custom Scan。
- 发布流程继续复用现有 Onlyboxes 节点和 JIT 鉴权，不再要求或下发
  `ONLYBOXES_CONTROL_API_KEY`。

涉及 PR：#74、#76-#79、#89-#91。

### 2.4 社区、Market 与精选内容

- 启用社区首页、助理、Skills、MCP 列表和详情；旧 Market 根入口导向可用社区入口。
- 增加精选助理目录、官方 Skills/MCP 和版本化幂等 Seed。
- 支持 Skill ZIP/GitHub 与 MCP 投稿，服务端限制体积并检查路径穿越、压缩炸弹、危险脚本、
  安装命令和敏感信息。
- MarketSDK 改为按需初始化，Onlyboxes、技能和通用工具不再因 Market 未配置而启动失败。
- 测试环境 Market 使用独立数据库账号、Secret、NetworkPolicy 和不可变镜像 digest；固定
  “迁移 → Market 就绪 → Seed → Masterino” 的发布顺序。
- 修复作者对象导致的 React 渲染异常、管理页乱码、OSS 就绪检查以及 ACK 字段切换兼容。

涉及 PR：#80-#89。

### 2.5 ACK 发布与安全边界

- 测试 StorageClass 初始化保持幂等，SearXNG Secret 只在启用时要求。
- ACK 更新使用临时 kubeconfig、固定集群 /namespace 守卫和不可变镜像 digest。
- 桌面 OSS Bucket ACL 保持 `private`，仅 `desktop/releases/*` 对象使用 `public-read`。
- GitHub Draft Release 仅作为管理员审计备份，客户端不得引用其资产或重定向。
- Device Gateway、Market、本地工具、MCP 和设备 RPC 的现有权限边界没有扩大。

## 3. 版本与制品矩阵

| 项目                        | 值                                                                        |
| --------------------------- | ------------------------------------------------------------------------- |
| 根应用版本                  | `1.2.0`                                                                   |
| 桌面客户端版本              | `1.2.0`                                                                   |
| Git Tag                     | `v1.2.0`                                                                  |
| ACR 实例                    | `cri-8velxg2aueo822e4`                                                    |
| ACR namespace               | `biel_client`                                                             |
| Masterino RepoId            | `crr-vrxmxr0vf4jkxd59`                                                    |
| 测试 namespace              | `masterino-test`                                                          |
| 测试部署前 Masterino digest | `sha256:6fb1c51e86c2e7ba1ab7fbbb93279af9e6873d367dfc7506dc8e4ab04e00f033` |
| 测试部署后 Masterino digest | `sha256:acea845ad6bcb8c6221f5e0de7996686a635905fe172994e7e1a737c962431e5` |
| Bridge digest               | `sha256:9140209ecab59d1617613feebc85d8c1da0de0ec14a1d44448786e33cb5e37d8` |
| Device Gateway digest       | `sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d` |
| Market digest               | `sha256:53582abdb90b8672e8e2662ae0968530cb3fc13fb8d025e5c41501e2f9660242` |

历史文档中的 Masterino RepoId `crr-7thpo7idrw2qnt3e` 已失效，后续必须使用上表的实时
RepoId，并在操作前通过 `aliyun cr ListRepository` 再次确认。

## 4. 测试环境发布记录

### 4.1 发布前状态

- `masterino-test` 的 Masterino、Aihub DB Bridge、Device Gateway、Market、Memory Worker、
  PostgreSQL、Redis 和 SearXNG 均为 Ready。
- Masterino 与 Memory Worker 使用相同应用 digest。
- 持久化卷均为 Bound；本次只更新 Masterino 与 Memory Worker 镜像，不改数据库、Redis、
  Bridge、Market、Device Gateway 和存储资源。
- 使用 `ACK_TEST_ACTION=app-update`，由受控 helper 校验集群、namespace、确认值和不可变
  digest，并等待 Masterino 与 Memory Worker 两个 rollout 完成。

### 4.2 ACR 构建

Masterino 仓库已绑定 `chaaak6/Masterino`，`main` 分支规则
`crbr-vdhnvdhyy7p38itf` 生成 `latest`（linux/amd64）。发布时通过本地 `aliyun` CLI 触发
或确认云端构建，并从 `ListRepoTag` 取得完成后的不可变 digest。

实际记录：

- Release commit：`e4f0a759e850f88fbc70bfd3f09a7f8065e5093b`
- Git Tag：`v1.2.0`，注释 Tag 已回读确认指向上述 commit
- ACR BuildRecordId：`08de2281-6144-4d19-8a0d-2f0e03fb42022`
- ACR BuildStatus：`SUCCESS`；构建日志确认拉取 `main e4f0a75`
- ACR Tag：`v1.2.0`
- 新 digest：`sha256:acea845ad6bcb8c6221f5e0de7996686a635905fe172994e7e1a737c962431e5`
- ACK rollout：2026-08-14 10:56（Asia/Shanghai）完成；Masterino 与 Memory Worker 均为
  `1/1 Ready`，新 Pod 重启次数为 0，两个 Deployment 使用相同新 digest
- 资源边界：Bridge、Device Gateway、Market、PostgreSQL、Redis、SearXNG、Ingress、Secret
  和存储未更新
- 站点验证：匿名首页 HTTP 302 跳转登录；`/oauth/callback/success`、
  `/device-gateway/health`、`/market/health` 均为 HTTP 200

## 5. 生产发布前置条件

### 5.1 通用条件

- `main` CI、E2E、桌面测试和发布相关检查全部通过。
- `v1.2.0` 必须指向包含 `package.json=1.2.0` 的提交。
- 记录生产当前所有 Deployment/StatefulSet 镜像 digest、ReplicaSet 和数据库备份点。
- 使用生产专用 RAM 身份、ACK 临时凭据和生产 Secret；禁止复用测试凭据。
- 所有变更先 render/validate，再部署私有状态，最后单独确认公网切换。

### 5.2 Device Gateway

当前仓库只提供测试环境 Device Gateway 资源。生产前必须按
`docs/operations/device-gateway-production-release.md` 新增受控生产 PR，至少包含：

1. `masterino` namespace 专用 Deployment、Service、`/device-gateway` Ingress 和回滚步骤。
2. 从生产 `JWKS_KEY` 仅派生公开字段生成 `JWKS_PUBLIC_KEY`。
3. 新生成生产 `SERVICE_TOKEN`，不得复用测试 Token。
4. 集群内认证验证通过后再开放公网，并进行真实账号灰度。
5. 生产网关就绪前，不得发布指向生产 Gateway URL 的正式桌面客户端。

### 5.3 Market、社区与 Office

- 检查生产 Market 数据库备份和 migration Job，按 “数据库 → migration → Market → Seed →
  Masterino” 顺序执行。
- 确认 `MARKET_GITHUB_TOKEN`、对象存储、可信客户端、加密、签名和 Runner Token 均使用
  生产 Secret。
- Seed 必须幂等；失败时不能继续启动引用新目录的 Masterino。
- 确认生产 Onlyboxes 内部 CA、JIT issuer 和签名密钥；不向 Masterino Pod 注入 Worker 管理凭据。
- Office 验收只使用无敏感数据的 Word/Excel/PPT 样例。

### 5.4 桌面 OSS 自动更新

- GitHub Secrets 必须存在：
  - `DESKTOP_OSS_ACCESS_KEY_ID`
  - `DESKTOP_OSS_ACCESS_KEY_SECRET`
  - `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY_B64`
- 私钥必须与 `apps/desktop/resources/update-public-key.json` 中的公钥匹配；私钥不得进入仓库、
  OSS、Actions artifact 或日志。
- `1.2.0` 是包含新自动更新协议的引导客户端。`1.1.3` 及更早客户端仍需手动安装
  `1.2.0`。
- 发布 `1.2.0` Canary 后，必须再发布严格更高版本（建议 `1.2.1`）验证完整链路：
  Windows 自动下载 / 安装，以及 macOS arm64/x64 自动下载并打开 DMG。
- Canary 至少观察 24 小时。Stable 不自动推广，必须另行确认。
- 签名、通道、路径、大小或 SHA512 任一校验失败时禁止下载或安装；不得回退到 GitHub。
- 坏版本不能回写旧清单，必须发布更高补丁版本修复。

## 6. 生产发布建议顺序

1. 冻结 `v1.2.0` 对应 commit，确认 CI 和测试环境验收记录。
2. 通过 ACR 对 `v1.2.0` 提交云端构建 Masterino；记录 BuildRecordId 和 digest。
3. 如生产需要 Device Gateway，先完成其独立生产 PR、Secret 和灰度验证。
4. 备份数据库并记录现有 digest；部署 Market migration/Market/Seed。
5. 使用不可变 digest 部署 Masterino 和 Memory Worker，先保持私有验证。
6. 验证登录、模型、记忆、社区、Office、文件、网关和本地工具后再执行公网切换。
7. 手动触发 `Build Unsigned Desktop` 发布 `1.2.0` Canary；确认 OSS 资产、签名 JSON 和 Draft
   Release。
8. 发布 `1.2.1` Canary 验证自动更新，观察至少 24 小时后再决定 Stable。

## 7. 验收清单

- 企业微信登录回调不会落入 `Not Found`，刷新后会话仍有效。
- Aihub 管理 Token 精确命中，`deepseek-v4-flash` 和 `text-embedding-3-large` 均可用。
- 个人记忆入口和 Memory Worker 正常，任务不重复执行。
- 社区助理、Skills、MCP 列表 / 详情、投稿和审核可用，Market 根入口不返回 404。
- Word、Excel、PowerPoint 生成成功；Onlyboxes 临时离线可恢复且错误不泄露内部信息。
- Device Gateway 登录后 15 秒内在线，设备数、系统信息、工作区扫描、只读文件和安全本地
  工具调用正常。
- 断网恢复、休眠唤醒和 Token 刷新后网关可自动重连。
- Windows 安装包图标和任务栏图标正确；macOS 两种架构安装包匹配。
- 自动更新网络只访问指定 OSS；签名篡改、SHA512 不匹配和跨域重定向均被拒绝。
- 关键日志不包含 Token、Secret、完整用户 ID 或本地完整路径。

## 8. 回滚

- Web/Worker：将两个 Deployment 同时回滚到发布前记录的相同 Masterino digest，并等待
  rollout 完成；测试环境本次发布前 digest 见第 3 节。
- Device Gateway、Bridge、Market：本次测试部署不更新这些镜像；生产若单独更新，必须分别
  记录和回滚其 digest。
- 数据库：不要仅通过回滚应用镜像假设 schema 自动回退。涉及不可逆 migration 时必须使用
  预先验证的数据库恢复方案。
- 桌面：已发布 OSS 文件不可删除或覆写；使用更高补丁版本和新的签名清单修复。
- 公网：应用异常时先回退 Ingress / 流量，再处理工作负载，避免失败版本继续接受请求。

## 9. 禁止事项

- 禁止本地构建或手工拼装生产 Docker 镜像。
- 禁止使用 `latest`、分支 Tag 或未记录 digest 直接部署。
- 禁止跳过 ACK 集群、namespace、字段互斥和 Secret 守卫。
- 禁止在日志、PR、交接文档或命令参数中写入 Secret。
- 禁止在生产网关未就绪时发布指向生产 Gateway URL 的桌面客户端。
- 禁止让桌面更新回退到 GitHub Release 资产。
