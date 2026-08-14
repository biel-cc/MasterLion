# Masterino 单镜像本地热更新环境计划

> 状态：已执行。实施产物：
>
> - `docker-compose/deploy/docker-compose.hot.yml`（单服务独立 compose）
> - `Dockerfile` 的 `dev` 阶段 + `FINAL_STAGE` 构建参数
> - `scripts/hot-dev/build-dev-image.ps1`、`start-hot-dev.ps1`、`stop-hot-dev.ps1`
>
> 范围：仅建设本地单镜像热更新开发环境；OCR、图片识别、模型能力判定和视觉降级逻辑均不在本计划内。

## 摘要

- 本地仅运行 `masterino` 开发容器，通过源码 bind mount 提供 Next.js 与 Vite 热更新。
- 开发镜像仅通过阿里云 ACR 云端构建，本地按不可变 digest 拉取，不执行本地 Docker build。
- PostgreSQL、Redis、Aihub DB Bridge、SearXNG 等复用 ACK 测试环境，不构建或启动依赖镜像。
- OCR 及图片能力降级全部排除；现有图片处理行为、`analyzeVisualMedia` 和相关配置保持不变。

## 实施改动

### 单镜像热更新

`docker-compose/deploy/docker-compose.hot.yml` 改为独立 compose 文件（不再叠加
`docker-compose.yml`，避免继承 postgres/redis/searxng/bridge 依赖服务）：

- 只定义 `masterino` 一个服务，`container_name: masterino-hot`。
- 无 `depends_on`；启动固定使用 `--no-deps`，不会拉起任何依赖容器。
- 保留源码、`packages`、`apps`、`locales`、`public` 和入口文件的 bind mount。
- `RUN_HOT_DB_MIGRATE=0` 固定写入，禁止对共享测试数据库自动执行 migration。
- `AIHUB_READONLY_DATABASE_URL` 固定为空：主应用只能访问 Aihub DB Bridge。

### 开发镜像

- 主 Dockerfile 新增 `dev` 阶段（复用 `builder` 全部依赖层），并以
  `ARG FINAL_STAGE` + 末尾 `FROM ${FINAL_STAGE} AS final` 支持同一 Dockerfile
  产出开发镜像（`--build-arg FINAL_STAGE=dev`）或生产镜像（默认）。ACR 云构建
  规则无法传 `--target`，该模式是让 ACR 产出 dev 阶段的唯一途径，已分别在
  BuildKit 与 legacy builder 下验证。
- 由 `scripts/hot-dev/build-dev-image.ps1` 通过本地 `aliyun` CLI 创建/复用
  `GIT_BRANCH` 构建规则（tag `dev-<shortsha>`，`BuildArgs` 含 `FINAL_STAGE=dev`），
  触发 `CreateBuildRecordByRule`，轮询 `GetRepoBuildRecordStatus`，从
  `ListRepoTag` 取得不可变 digest。
- 记录 BuildRecordId、tag 和 digest 到 `%TEMP%\masterino-hot-dev\dev-image.json`。
- Compose 只引用不可变 digest（`MASTERLION_DEV_IMAGE`），不使用本地构建产物或
  可变 `latest` 直接运行。

### ACK 测试环境接入

`scripts/hot-dev/start-hot-dev.ps1`（Windows）：

- 校验 ACK 集群 ID、context 和 namespace `masterino-test`，临时 kubeconfig 通过
  仓库既有 `deploy.sh preflight` 守卫（集群 ID、context、namespace 标签、region）。
- 使用临时 kubeconfig 启动 `kubectl port-forward`，仅绑定 `127.0.0.1`。
- 将测试 ConfigMap `masterino-config` 和允许注入的 Secret（`masterino-secret`
  白名单键）转换为权限受限的临时环境文件，退出时删除。
- 不得读取或注入 `AIHUB_READONLY_DATABASE_URL`；主应用只能访问 Aihub DB Bridge。
- Secret、临时 kubeconfig、完整连接串和令牌不得写入仓库或日志（环境文件落在
  `%TEMP%`，用 icacls 限制为当前用户）。

容器内地址映射：

| 依赖 | 本地容器访问地址 |
| --- | --- |
| PostgreSQL | `host.docker.internal:15432` |
| Redis | `host.docker.internal:16379` |
| Aihub DB Bridge | `host.docker.internal:13218` |
| SearXNG | `host.docker.internal:18080` |

Aihub Proxy、测试 OSS、Market 和 Device Gateway 使用现有测试环境 HTTPS 地址
（`https://aihub.bielcrystal.com`、深圳 OSS、`https://mlai-test.bielcrystal.com/market`、
`/device-gateway`）。

## 启动与失败策略

- 启动前依次验证 PostgreSQL（TCP）、Redis（TCP）、Bridge（鉴权 health）、
  SearXNG（HTTP）、Aihub Proxy（HTTPS）和 OSS（HTTPS）。
- 任一必需依赖失败时，输出服务名、目标地址和错误类型，并停止启动，避免产生
  半可用环境。
- Onlyboxes 不作为基础开发环境启动的硬阻塞项，但必须明确提示沙箱功能不可用
  （当前 `onlyboxes.internal.bielcrystal.com` 无法解析）。
- 停止脚本负责关闭主容器、端口转发及其子进程，并删除临时 kubeconfig 和环境文件。

## 测试与验收

- `docker compose -f docker-compose.hot.yml config` 只渲染一个 `masterino` 服务，
  无依赖服务和隐式 `depends_on`（已验证）。
- 已验证：数据库只读查询（TCP + 集群内 bridge health）、Redis 连通、
  Bridge 鉴权健康检查、OSS 同源上传代理、SearXNG、Aihub Proxy 预检全部通过。
- 修改前端组件后确认 Vite HMR 生效；修改服务端代码后确认 Next.js 自动重载，
  两个场景均不得重建镜像。
- 失败预检能分别报告具体不可连接项，且不会输出 Secret。
- 停止脚本清理容器、端口转发、临时文件和子进程。
- 不新增数据库 migration，不修改 Bridge、Redis、PostgreSQL、SearXNG、Onlyboxes
  或其他依赖服务镜像。
- 不修改任何 OCR、图片识别、模型能力判定或视觉降级逻辑。

## 执行前置条件（执行时已确认）

- `aliyun` CLI 可用（3.4.4），并具有获取目标 ACK 临时凭据及触发目标 ACR 构建的
  最小权限（已用 `ListInstance`/`ListRepository`/`ListRepoBuildRecord` 验证）。
- `kubectl` 可用，临时 context 通过仓库既有的集群、namespace 和 API Server 守卫。
- ACR 中存在可供本机拉取的主开发镜像 digest（由 build-dev-image.ps1 构建并记录）。
- 已确认共享测试数据库允许本次开发验证，且全过程不执行 migration。
- 沙箱验证需要工作站先接入能够解析并访问 Onlyboxes 的公司网络（当前不可用，
  已明确提示，不阻塞其他开发能力）。
