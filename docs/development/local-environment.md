# 独立本地开发与 Electron 内测联调

本地模式运行当前分支 Web、Next.js 后端和 Electron，数据、会话、文件及 Gateway 都在本机；默认远端业务依赖只有 Aihub 模型 API。内测模式运行当前分支 Electron，连接既有测试集群。正式 App 和生产部署不使用这些脚本。

## 首次启动

前置：安装仓库要求的 Node.js / pnpm，安装依赖，启动 Docker Desktop。当前脚本以 macOS 为实际验证平台；不要据此认定 Windows 全流程已经通过。Gateway 使用固定 Go 开发容器运行仓库源码，不需要在宿主机安装 Go，也不需要构建应用 Docker 镜像。

```bash
pnpm dev:local:setup
# 编辑 .local-dev/config.env，填写专用 AIHUB_API_KEY 并确认模型权限。
pnpm dev:local
```

看到 `LOCAL DEVELOPMENT READY` 后打开 `http://localhost:3010/__local-dev`。它会自动建立独立开发账号的正常 Better Auth 会话并进入首页。直接访问首页可以保持退出状态；重新进入开发账号时再访问这个入口。

首次创建数据库、编译 Gateway、预构建 Vite 和 Next 接口会比较慢。等待启动输出，不要连续重复启动多个实例。后续启动复用数据卷与缓存。使用仓库固定的 pnpm 10（packageManager 字段）；其他大版本可能尝试自动重装依赖。16 GB 机器不要同时运行全量类型检查、两个冷启动 Vite 实例和 Next 的首次接口编译。

`setup` 初始化 Docker 基础服务、存储桶及数据库迁移；账号和模型配置在 `dev:local` 中调用正常 Better Auth 接口后完成初始化。重复启动不会清空话题或文件。

## 两个 Electron 入口

```bash
# 本地完整联调，先启动 pnpm dev:local
pnpm dev:desktop:local

# 当前客户端连接测试集群，不需要本地后端或本地模型 Key
pnpm dev:desktop:test
```

两种 Electron 源码模式使用 5173 端口，切换前关闭原模式的终端进程和 App。不会自动结束已有实例。

| 模式                       | 后端                                | Gateway                 | Electron 数据目录名                |
| -------------------------- | ----------------------------------- | ----------------------- | ---------------------------------- |
| 本地                       | `http://localhost:3010`             | `http://localhost:8788` | `masterino-desktop-local-<实例ID>` |
| 内测                       | `https://mlai-test.bielcrystal.com` | 同域 `/device-gateway`  | `masterino-desktop-test-server`    |
| 原有 dev / 测试包 / 正式包 | 保持原配置                          | 保持原配置              | 保持原目录                         |

开发用户目录不同，因此旧测试 App 的 Cookie、Token 和话题不会被迁移到本地模式。首次桌面连接仍需走正常 OIDC 授权；本地代理会将本地登录页转到开发账号入口，并在建立会话后保留 OIDC 回跳，不需要企业微信；内测模式保留真实登录。

启动器会显示后端、Gateway 和 profile。内测源码 App 只是“最新客户端 + 已部署后端”，不能作为本地后端改动已验证的证据。内测安装包还需单独验收。

## 配置隔离

- `.local-dev/config.env`：开发 Key、模型、可选能力和端口。
- `.local-dev/instance.json`：本地账号凭据、认证密钥、OIDC JWKS、Gateway 服务间密钥和实例 ID。文件权限为 0600；不要删除后继续复用原数据卷，否则已有加密数据不能正常解密。
- `.local-dev/logs`：按服务保存日志。
- `.local-dev/reports`：诊断和版本记录，不包含 Cookie、Token、Key。
- `.local-dev/cache/next`：独立 Next 缓存；Web / Electron 缓存在 `node_modules/.cache/masterino/`。生产构建及原有开发模式不使用这些目录。Vite 拒绝访问 `.local-dev`，避免开发凭据被当作静态文件暴露。

本地启动器不读取仓库旧 `.env`，也不继承 shell 中的数据库、SSO、生产 Key 或 NODE_OPTIONS。Next 开发 watcher 的强制环境重载也被限制到独立空目录；这是开发启动器专用适配，有针对当前 Next 版本的测试，升级 Next 时要运行该测试。

不要直接调用本地 Compose：入口负责提供实例名、凭据和端口，并核对数据库容器归属。只有 localhost 地址不足以证明数据库是本机创建的，它也可能是远端端口转发。

修改端口后重启环境，不要手动只改 APP_URL 或 Gateway URL。端口必须互不重复；冲突时启动器会报错，不自动杀掉其他进程。

## 模型、文件与记忆

模型使用用户级加密凭据，默认 provider 为 newapi。聊天和 embedding 权限分别检查，向量维度必须匹配当前的 2048 维配置。不要借用生产托管 Token。

```bash
# 修改 Key / 模型 / MEMORY_ENABLED 后，显式刷新开发账号配置
pnpm dev:local:seed -- --refresh-models
# 常规依赖状态检查，不调用模型
pnpm dev:local:doctor
# 显式调用聊天和向量模型，会消耗开发 Key 的额度
pnpm dev:local:doctor -- --models
```

Key 首次配置时会初始化；再次改变已有 Key 需要显式 refresh，避免每次启动覆盖用户设置。显式刷新也同步更新 `defaultAgent.config.model/provider`，保留其他默认 Agent 配置；已单独指定模型的现有 Agent 不会被批量重写。记忆默认启用本地 Redis worker；如果暂时没有 embedding 权限，可设 `MEMORY_ENABLED=0`，刷新账号配置后重启。

文件保存在 RustFS；浏览器上传仍经过同源 `/api/upload/s3-proxy`。文件下载地址仅本机可达；远端视觉模型的图片请求使用现有服务端转 base64 配置。

基础环境运行五个常驻容器：PostgreSQL、Redis、RustFS、Gateway、QStash；另有一个一次性存储初始化镜像。`SEARCH_ENABLED=1` 时额外启动本地 SearXNG。市场和云沙箱不在本套基础环境中完整复制；市场使用现有 feature flag 关闭，意外调用会明确返回本地不可用错误，不回退内测。需要市场、云沙箱、企业用户同步或配额验收时，使用内测环境。

消息后的 Agent Signal 工作流也依赖 QStash，因此基础环境包括官方 QStash 开发服务，端口只发布在回环地址。启动器从当前容器读取开发签名配置，不关闭回调验签。它是内存服务，重启会丢弃其待执行任务；业务数据仍保留在 PostgreSQL。参见 [Upstash 本地开发说明](https://upstash.com/docs/qstash/howto/local-development)。

容器用 `host.docker.internal:3011` 回调本机 IPv4 后端；本地 Next 启动适配器将同一主机名解析为 `127.0.0.1`，供宿主机内部请求使用。不修改系统 DNS、hosts 或 Docker Desktop 设置。Next / Web 的热更新仍在宿主机运行，Gateway 源码变更后需重启其开发容器，不构建镜像。

## 停止与恢复

```bash
pnpm dev:local:stop
pnpm dev:local
```

停止保留 Docker 卷，不执行 `down -v`。独立 Electron 窗口和其启动终端可单独关闭，以免丢失未发送草稿。进程 Ctrl+C 只关闭其子进程；基础服务可通过 stop 统一停止。

迁移前检查本工具实际创建的 PostgreSQL 容器及端口映射，不执行远端迁移。脚本没有默认清空数据命令。如果密钥或配置损坏，先备份 `.local-dev` 并检查原因，不直接删除实例文件。

## 内测验收

```bash
# 只渲染并检查仓库中的 test overlay，不访问或部署集群
pnpm dev:test:check
# 可选：明确指定测试 context 后，只读列出内测部署镜像
pnpm dev:test:check -- --live --context <测试context>
```

检查报告在 `.local-dev/reports/test-environment.json`。源码 SHA、镜像 digest、测试 App 版本、memory worker 版本、数据库迁移状态及未覆盖项目应一起记录。工具不从集群读取 Secret、不自动部署、不修改当前 kubectl context。渲染检查按 `envFrom` 顺序和显式 `env` 的优先级解析容器的 `APP_URL`、`DEVICE_GATEWAY_URL`，包含 init container 和清单内的 key 引用；关键地址无法解析或使用变量展开时明确失败，不把未知配置当作通过。`--live` 额外读取部署清单，仍只做镜像和就绪副本盘点，不宣称校验了整个运行中集群。kubectl 专用子进程保留调用者的 `KUBECONFIG`（支持多个配置路径），本地应用仍不继承它。

仍沿用原有内测镜像部署和真实企业登录。测试桌面构建路径覆盖共享前端、packages、locales 和构建配置；正式构建与生产发布 workflow 不变。

## 验收范围

至少验证开发登录、项目 / scratch、文件、聊天、记忆、Web → Gateway → Electron 执行、Token 刷新与环境切换；确认服务端修改被当前本地进程执行。自动测试、人工操作和未覆盖内容分开记录，不将源码客户端连内测的结果算作本地服务端验收。
