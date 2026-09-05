# 本地开发环境验收记录

日期：2026-09-05。平台：macOS，16 GB 内存。分支：`feat/workspace-runtime`，验收对象为当前未提交的环境工具改动及当前分支业务源码。

## 已实际验证

| 链路                     | 结果                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| 独立 Docker 基础服务     | PostgreSQL、Redis、RustFS、Gateway、QStash 均健康；端口发布在回环地址                |
| 本地数据库迁移           | 使用当前仓库迁移成功；迁移前核对 Docker 项目归属和端口                               |
| Web 登录                 | 开发入口通过正常 Better Auth 创建本地用户会话，进入首页，不使用企业微信或内测 Cookie |
| 真实聊天                 | Web 发送后收到“本地聊天成功”；调用本地 Next.js 和远端 Aihub                          |
| 模型                     | 聊天模型 HTTP 200；embedding HTTP 200，向量维度 2048                                 |
| 文件                     | 同源签名上传 HTTP 200，RustFS 下载内容逐字匹配                                       |
| 记忆写入与搜索           | 正常业务接口写入偏好，生成 embedding，搜索命中；后续聊天能召回该偏好                 |
| 记忆后台任务             | `requestMemoryFromChatTopic` 任务状态 success，`completedTopics=1`、`totalTopics=1`  |
| Agent Signal 工作流      | QStash 多步回调 HTTP 200；完成时正常删除工作流运行，`cancel=false`；保留签名验证     |
| Electron 本地授权        | 正常 OIDC 授权完成，桌面显示本地账号和 Web 中已有话题                                |
| Web → Gateway → Electron | 设备列表显示在线；真实 `device.statPath('/tmp')` 返回目录存在                        |
| Electron 内测入口        | 启动当前源码，显示首次引导；输出的后端和 Gateway 均指向内测，独立 profile            |
| 私密文件保护             | Web Vite 和 Electron Vite 读取 `.local-dev/config.env` 均返回 403                    |
| 内测部署边界             | 渲染现有 test overlay 并检查通过；未部署或修改集群                                   |

停止五个基础服务并重新启动后，2 个验收话题、5 条记忆及已上传文件均保留；两个话题的提取状态仍为 `completed`。

## 自动检查

- 本地环境及内测检查器：12 项测试通过，包含环境变量隔离、Next 强制 dotenv 重载隔离、生产模式拒绝使用开发适配器、远端 Docker 拒绝、Host / Origin、一次性登录凭证和回跳地址限制。
- Electron profile 初始化：7 项测试通过，包含已打包 App 不接受开发 profile。
- 配置、代理和基础设施模块的定向类型检查通过。
- 全仓类型检查未完成：本机测得进程物理占用约 13.7 GB，已终止以恢复开发环境。扩大范围的定向检查另出现共享包类型导出及全局声明错误，不能替代全仓通过结论。
- 格式化及 `git diff --check` 通过。

## 已发现、未纳入环境改动的业务问题

Web 会继承 Electron 最近使用的“本机”执行状态，此时新建话题显示“本机”和项目选择，发送时后端拒绝：`A web client cannot create a local execution target`。手动切换为“无设备”后真实聊天成功。在线 Gateway 也正常出现在设备列表。

这是当前分支跨端默认状态的后续修复项；遵循此前“Web 业务先调查，不改代码”的要求，本次只记录。不能将本套环境完成理解为当前分支全部业务已通过验收。

## 尚未覆盖

内测新 profile 的企业登录及完整业务回归、真实集群部署状态、正式安装包、长时间 Token 自动刷新、可选 SearXNG、Windows、云沙箱及企业市场均未作为本次通过项。上线前仍需按现有流程部署内测候选并验收。

启动和切换方式见 [本地环境说明](./local-environment.md)。本地凭据、运行日志和诊断 JSON 位于 Git 忽略的 `.local-dev`，不提交到仓库。

## Review 修复复验

- 补齐 `/package.json` 的 Vite 路由；新代理连接现有 Vite 的 `/package.json?import` 返回 200、`text/javascript` 及正常模块导出。
- 显式模型刷新更新普通 Agent 的默认 model/provider，并保留提示词、参数和其他默认配置。
- 内测清单检查覆盖容器显式 env、envFrom 优先级、key 引用、未知来源、前缀及 init container；不输出 Secret 值。
- kubectl 专用环境保留 KUBECONFIG，本地应用环境白名单不变。
- 本轮相关测试共 21 项通过；现有 test overlay 渲染检查通过。未访问或修改线上和内测集群。
