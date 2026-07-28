# Masterino 文件预览、复制、下载与导出修复交接

更新时间：2026-07-21

覆盖版本：v0.0.15 至 v0.0.16 后续提交

已合并 PR：

- [#27 沙箱文件导出可靠性修复](https://github.com/chaaak6/MasterLion/pull/27)
- [#28 修复 HTML Artifact 复制、下载与空间保存](https://github.com/chaaak6/MasterLion/pull/28)
- [#29 修复 HTML Agent 文档保存与空间预览](https://github.com/chaaak6/MasterLion/pull/29)
- [#30 修复 Agent 文档 Markdown 导出失败](https://github.com/chaaak6/MasterLion/pull/30)

本文前半部分保留 #27 的沙箱/OSS 导出链路说明；第 11 节开始记录本会话后续完成的 HTML Artifact、Agent 文档和 Markdown 导出修复。

## 1. 处理结果

本次已完成沙箱文件预览、下载和 OSS 导出链路的可靠性修复，并发布至 ACK 测试环境。

- `writeFile` 已返回浏览器的文本、代码、HTML 和 SVG，可直接预览、复制正文和下载，不依赖 OSS。
- `exportFile` 会先检查文件，再由 Onlyboxes Worker 直传 OSS；失败后使用新签名重试一次。
- Worker 两次直传均失败时，不超过 10 MiB 的文件由 Masterino 中转上传 OSS。
- 成功导出的文件使用稳定的 Masterino 文件链接，可站内预览、附件下载和复制链接。
- 导出失败会返回结构化阶段、错误码和是否可重试，并支持复用原工具调用重新导出。
- Onlyboxes Worker 输出上限已由 1 MiB 调整为 16 MiB，以容纳 10 MiB 文件的 Base64 中转。
- 用户已确认测试环境端到端测试通过。

本次没有部署 Onlyboxes 到 K8s。Onlyboxes Console 与 Worker 仍运行在独立内网主机 `10.80.137.220`。

## 2. 原问题与根因

### 2.1 现象

沙箱可以成功生成文件，但 `exportFile` 报错，用户无法下载生成结果。失败后模型可能尝试在沙箱中启动临时 HTTP 服务，但沙箱端口不会暴露给浏览器，因此该方案不可用。

### 2.2 根因

原导出链路过度依赖 Worker 对单个 OSS 预签名 PUT 的一次性上传：

1. 导出前没有统一检查文件是否存在、大小和 MIME 类型。
2. Worker 上传失败后没有新签名重试。
3. Masterino 没有受大小限制的服务端中转兜底。
4. `writeFile` 已经把正文返回浏览器，但页面没有利用该内容提供本地下载。
5. 大文件下载先完整拉入浏览器内存，稳定性和内存占用不理想。
6. 错误结果缺少阶段和可重试信息，用户只能看到笼统失败。

## 3. 最终交付架构

### 3.1 `writeFile` 浏览器直出

适用内容：文本、代码、HTML、SVG 等已经包含在工具结果中的文件。

- 下载：浏览器基于正文创建 Blob，不经过 OSS。
- 复制：复制文件正文。
- 预览：HTML/SVG 使用受限 iframe，避免内容注入 Masterino 主页面。

### 3.2 `exportFile` 持久文件链路

适用内容：PDF、Office、图片、视频以及需要长期保存的文件。

```text
检查文件存在性、大小、MIME
  -> 生成唯一且清理过的 OSS 对象键
  -> Worker 使用带 Content-Type 的预签名 PUT 上传
  -> 失败后获取新签名并重试一次
  -> 仍失败且文件 <= 10 MiB：Masterino 读取并 uploadBuffer
  -> 创建文件记录
  -> 返回稳定的 /f/:id 链接
```

超过 10 MiB 的文件不走 Masterino 中转，必须由 Worker 直传成功。

### 3.3 下载与预览

- `/f/:id`：默认用于站内预览。
- `/f/:id?download=1`：返回带安全文件名的 attachment 签名地址。
- 复制链接时复制稳定的 Masterino 地址，不复制临时 OSS 签名 URL。
- FileViewer 已覆盖 HTML、PDF、图片、视频、代码和 Office 文件。

## 4. 安全边界

- HTML/SVG 仅在受限 iframe 中运行。
- 日志不得输出 OSS 签名 URL、密钥或文件正文。
- OSS 对象键包含 UUID，并清理用户文件名，避免同名覆盖和路径注入。
- Masterino 中转硬上限为 10 MiB，不提供无限大小的流式代理。
- 文件权限模型保持不变，本次没有增加公开分享能力。
- 导出失败后不得启动沙箱临时 HTTP 服务。

## 5. 关键代码位置

| 范围 | 主要文件 | 说明 |
| --- | --- | --- |
| 沙箱导出服务 | `apps/server/src/services/sandbox/service.ts` | 文件检查、Worker 重试、10 MiB 中转和结构化错误 |
| Onlyboxes Provider | `apps/server/src/services/sandbox/providers/onlyboxes.ts` | 检查文件、受限读取、上传执行 |
| 沙箱类型 | `apps/server/src/services/sandbox/types.ts` | Provider 能力和错误阶段 |
| OSS 签名 | `apps/server/src/modules/S3/index.ts` | PUT Content-Type 与 attachment 下载签名 |
| 文件服务 | `apps/server/src/services/file/index.ts` | `uploadBuffer` 中转上传 |
| 文件路由 | `src/app/(backend)/f/[id]/route.ts` | `?download=1` 和 Unicode 安全文件名 |
| writeFile UI | `packages/builtin-tool-cloud-sandbox/src/client/Render/WriteFile/index.tsx` | 预览、Blob 下载、复制正文 |
| exportFile UI | `packages/builtin-tool-cloud-sandbox/src/client/Render/ExportFile/index.tsx` | 预览、下载、复制链接、重新导出 |
| 文件预览 | `src/features/FileViewer/index.tsx` | SVG/HTML 隔离预览路由 |
| 沙箱提示词 | `packages/builtin-tool-cloud-sandbox/src/systemRole.ts` | 禁止临时 HTTP 服务 |
| Worker 示例配置 | `deploy/onlyboxes/onlyboxes-worker.env.example` | 输出上限 16 MiB |

## 6. 测试与验证记录

### 6.1 代码验证

- 8 个定向 Vitest 文件通过，共 117 个测试。
- `bun run type-check` 通过。
- Prettier、Stylelint、ESLint 提交检查通过。
- `git diff --check` 通过。
- 覆盖直传成功、重试、10 MiB 内中转、超限失败、MIME、唯一对象键、结构化错误、下载路由和 UI 操作。

### 6.2 ACR 构建

- ACR 实例：`cri-8velxg2aueo822e4`
- 仓库：`biel_client/masterlion`
- 仓库 ID：`crr-7thpo7idrw2qnt3e`
- 构建规则：GitHub `main` 分支自动构建 `latest`，未进行本地构建或推送。
- PR squash 提交：`58c7f0a335c6696e249cc62349c2a33ab97c49ff`
- 自动发布提交：`6d4aa3abe460fa094523759883818f852a8445be`
- 构建记录：`7322b773-79c1-4934-8e23-e2cf2e7a4fcf2`
- 构建结果：SUCCESS，镜像内版本 `0.0.15`。

### 6.3 PR #27 部署时的 ACK 测试环境

- 集群 ID：`c23ea84b986c446d5b3fa9227962e77f4`
- 命名空间：`masterlion-test`
- 站点：`https://mlai-test.bielcrystal.com`
- Masterino 当时镜像：

```text
boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion@sha256:e1dc3630341872178fb2a55256c9c1866f225f3f6e3e0d7805533589fed54750
```

- 探测 Pod 验证镜像版本为 `0.0.15`，imageID 与上述 digest 一致；探测 Pod 已删除。
- Deployment 为 `1/1` Ready、Updated、Available。
- 新 Pod Ready，重启次数为 0。
- 启动日志无 fatal、unhandled 或 failed-to-start，Gateway 启动成功。
- Bridge 保持原 digest：

```text
sha256:7cc8fa3e5e9cc4ac09dd6d86c317230ab2d627225a3f4658f13cf3a6d922cf27
```

### 6.4 Onlyboxes Worker

- 主机：`10.80.137.220`
- systemd 服务：`onlyboxes-worker`
- 环境文件：`/etc/masterlion/onlyboxes-worker.env`
- 当前值：`WORKER_TERMINAL_OUTPUT_LIMIT_BYTES=16777216`
- 配置备份：`/etc/masterlion/onlyboxes-worker.env.bak.20260716174722`
- 重启后状态：active，`NRestarts=0`，警告日志为空。
- 主机到以下地址的 DNS 与 HTTPS 443 连通正常：
  - `masterlion-test.oss-cn-shenzhen.aliyuncs.com`
  - `oss-cn-shenzhen.aliyuncs.com`

### 6.5 产品验收

- 测试账号登录正常。
- 用户已确认本次文件生成、预览和下载测试通过。
- 测试环境仍设置：
  - `AUTH_DISABLE_EMAIL_SIGNUP=1`
  - `AUTH_DISABLE_EMAIL_PASSWORD=0`
  - `SANDBOX_PROVIDER=onlyboxes`
  - `ONLYBOXES_BASE_URL=https://onlyboxes.internal.bielcrystal.com`

## 7. 回滚方法

### 7.1 回滚 ACK Masterino

PR #27 部署前的 Masterino digest：

```text
sha256:050fc9e772a04186d756964ba64551878d88a3eeccfc2fd6e60d1a30e87be8a3
```

使用外部安全 kubeconfig 和受保护脚本，仅回滚 Masterino Deployment：

```bash
export KUBECONFIG=/secure/path/masterlion-test.yaml
export ACK_CONTEXT=kubernetes-admin-c23ea84b986c446d5b3fa9227962e77f4
export ACK_API_SERVER=https://120.79.213.152:6443

./deploy.sh --env test update-image masterlion \
  boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion@sha256:050fc9e772a04186d756964ba64551878d88a3eeccfc2fd6e60d1a30e87be8a3
```

不要执行完整 Kustomize apply；否则可能覆盖测试环境中其他独立配置。Bridge 不需要回滚。

### 7.2 回滚 Worker 输出上限

在 `10.80.137.220` 上执行：

```bash
cp -a /etc/masterlion/onlyboxes-worker.env.bak.20260716174722 \
  /etc/masterlion/onlyboxes-worker.env
systemctl restart onlyboxes-worker
systemctl is-active onlyboxes-worker
```

## 8. 运维检查命令

```bash
# ACK rollout 与镜像
kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT" \
  -n masterlion-test get deployment masterlion

kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT" \
  -n masterlion-test get pods -o wide

# Masterino 启动日志
kubectl --kubeconfig "$KUBECONFIG" --context "$ACK_CONTEXT" \
  -n masterlion-test logs deployment/masterlion --tail=200

# Worker 状态
systemctl status onlyboxes-worker --no-pager
grep '^WORKER_TERMINAL_OUTPUT_LIMIT_BYTES=' /etc/masterlion/onlyboxes-worker.env

# Worker 到 OSS 的网络连通性；未签名根请求返回 403 属正常
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://masterlion-test.oss-cn-shenzhen.aliyuncs.com/
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://oss-cn-shenzhen.aliyuncs.com/
```

## 9. 后续注意事项

1. 10 MiB 是 Masterino 中转硬上限；更大文件失败时优先检查 Worker 到 OSS 的网络、签名时钟和 Content-Type。
2. Worker 输出上限必须不低于 Base64 后的兜底结果；当前 16 MiB 与 10 MiB 文件上限配套。
3. ACR 自动发布可能因 PR 合并与自动版本提交连续触发构建。部署前必须核对构建日志中的 `main` 提交，并使用临时 Pod 验证版本和 imageID。
4. `latest` 只用于触发拉取和探测，Deployment 必须固定到 `@sha256:` digest。
5. 不要把 K8s Secret、Onlyboxes JIT 签名密钥、SSH 私钥、OSS 签名 URL 或临时 kubeconfig 写入仓库或日志。
6. 如需公开分享文件，应另行设计权限和有效期；不要复用本次站内文件链接直接开放匿名访问。
7. 建议后续把 HTML、PDF、XLSX、图片、中文文件名和 10 MiB 边界场景加入稳定的浏览器 E2E 流水线。

## 10. 本次未修改的范围

- 未修改生产环境。
- 未重建或更新 Bridge 镜像。
- 未将 Onlyboxes 迁入 K8s。
- 未扩大文件公开访问权限。
- 未覆盖或暂存工作区中原有的 ACK、K8s 和部署脚本改动。

## 11. HTML Artifact 与 Agent 文档后续修复

### 11.1 PR 与提交

| PR | 合并时间 | 合并提交 | 处理范围 |
| --- | --- | --- | --- |
| [#28](https://github.com/chaaak6/MasterLion/pull/28) | 2026-07-17 09:04 UTC | `374a06a8680e06e012d0e93c621f01d245d50440` | HTML Artifact 复制、下载和空间保存 |
| [#29](https://github.com/chaaak6/MasterLion/pull/29) | 2026-07-17 13:25 UTC | `7791caa4fc263a1c72dfda61ddb02108c27bc6e1` | HTML Agent 文档原文保存、预览和菜单操作 |
| [#30](https://github.com/chaaak6/MasterLion/pull/30) | 2026-07-17 16:10 UTC | `0ac48559660cb658d9b68e27cc407986af0b105d` | Agent 文档 Markdown 导出兜底 |

相关本地工作树：

```text
D:\MasterLion\.codex\worktrees\html-document-raw-preview
```

本地分支 `codex/fix-agent-markdown-export` 的开发提交为 `2671c62b`。PR #30 合并时生成了新的 squash 提交，因此本地提交 SHA 与 `main` 上的合并提交不同。

### 11.2 HTML Artifact 复制与下载

- `HtmlPreviewDrawer` 标题栏按“复制、下载”顺序提供操作，保留“预览 / 代码”切换。
- 预览模式和代码模式均复制完整原始 HTML `content`，不是 iframe 渲染后的纯文本。
- 复制成功显示“已复制”；失败显示明确提示并记录错误。
- 下载使用完整 HTML 内容并导出 `.html` 文件。
- 文件名优先取 HTML `<title>`，清理 Windows/浏览器非法字符；缺少标题时使用带时间戳的默认名称。
- 默认英文、`en-US` 和 `zh-CN` 的 `components` 命名空间已补充相关文案。
- Portal Artifact 标题区域同步补齐了复制、下载和保存到空间的入口及测试。

关键文件：

- `src/components/HtmlPreview/PreviewDrawer.tsx`
- `src/components/HtmlPreview/fileName.ts`
- `src/features/Portal/Artifacts/Title.tsx`
- `src/components/HtmlPreview/PreviewDrawer.test.tsx`
- `src/features/Portal/Artifacts/Title.test.tsx`

### 11.3 HTML Agent 文档保存与空间预览

原问题是聊天中的 HTML Artifact 能渲染，但保存到 Agent 空间后的文档没有可靠保留/识别原始 HTML，导致文档区出现“有文件但预览为空”，同时 HTML 不会仅因为聊天中生成就自动进入空间。

最终行为：

- 聊天中的 HTML Artifact 默认不是持久化 Agent 文档；必须显式执行保存/创建文档动作后才进入空间。
- 服务端 Agent Document VFS 和文档服务会保留并识别原始 HTML 内容。
- Agent 文档页根据文档类型使用 HTML 预览，不再把完整 HTML 当成普通 Markdown/富文本内容加载。
- HTML 文档标题栏可以直接使用已保存的原始 HTML 进行复制和下载。
- 普通 Markdown、富文本及其他文件预览路径保持原有行为，HTML 分支通过类型判断隔离。

关键文件：

- `apps/server/src/services/agentDocumentVfs/index.ts`
- `apps/server/src/services/agentDocuments/headlessEditor.ts`
- `apps/server/src/services/agentDocuments/index.ts`
- `src/features/AgentDocumentPage/HtmlDocumentPreview.tsx`
- `src/features/AgentDocumentPage/useAgentDocumentItem.ts`
- `src/features/AgentDocumentPage/Header/useMenu.tsx`
- `src/features/PageEditor/PageEditor.tsx`

### 11.4 Markdown 导出修复

HTML 修复后暴露出的回归是：Agent 文档菜单选择“导出 -> Markdown 格式”时可能提示“页面导出失败”。根因是导出链路只依赖当前编辑器实例序列化；编辑器尚未准备好或序列化抛错时，没有持久化内容兜底。

PR #30 的处理方式：

1. 优先调用当前编辑器的 `editor.getDocument('markdown')`，确保导出最新未保存内容。
2. 编辑器不可用或序列化失败时，记录 warning，并通过 `documentService.getDocumentById(documentId)` 读取已保存内容。
3. 浏览器端继续使用现有 `exportFile` 下载 Markdown，不新增 API 或数据结构。
4. 实时内容和持久化内容都失败时记录最终 error，并显示现有“页面导出失败”提示。
5. HTML 导出仍读取并下载持久化原始 HTML，不受 Markdown 兜底逻辑影响。

测试覆盖：

- 实时 Markdown 导出成功。
- 编辑器序列化异常时回退持久化内容。
- 编辑器未初始化时回退持久化内容。
- 实时与持久化路径均失败时显示错误反馈。
- HTML 原始内容导出回归测试。
- PR #30 共运行 4 个定向 Vitest 文件、10 个测试，全部通过；相关 ESLint、Prettier 和 `git diff --check` 通过。
- 完整类型检查受工作树重复依赖解析及既有 Desktop 类型错误影响；禁用增量并过滤本次修改路径后未发现相关类型错误。

## 12. PR #30 CI 说明

PR #30 的 Web App/Database/Packages 检查出现仓库既有数据库迁移失败，核心报错为：

```text
column cannot have more than 2000 dimensions for hnsw index
```

失败发生在 `user_memories_summary_vector_1024_index` 相关迁移，与 PR #30 仅修改的以下两个前端文件无关：

- `src/features/AgentDocumentPage/Header/useMenu.tsx`
- `src/features/AgentDocumentPage/Header/useMenu.test.tsx`

Desktop 检查通过。PR 最终通过普通 `gh pr merge` 合并，没有使用管理员绕过。后续如果该 CI 仍失败，应单独修复迁移/测试数据库基线，不要把规避逻辑加入文档导出代码。

## 13. PR #30 ACR 与 ACK 部署记录

### 13.1 ACR 构建

- 构建记录：`46dd1b33-c3b4-4f26-956b-7c21f6c5db4a2`
- 标签：`latest`
- 结果：`SUCCESS`
- 本次部署使用的不可变摘要：

```text
sha256:0cf9e4b243d41eb4009829f71b4900f3ef544b13d4dd604c14d7084017a6adca
```

不要直接把 Deployment 固定到可变的 `latest` 标签；必须先读取构建后 `latest` 的 digest，再使用 `@sha256:` 更新。

### 13.2 ACK 部署结果

- kube context：`ack-c23ea84b-masterlion-test`
- namespace：`masterlion-test`
- Deployment/container：`masterlion` / `masterlion`
- 部署前摘要：`sha256:a9ad3d24df0de4e045c27e1f773758436aae995c6012a5032faac4add41de5f4`
- 部署后摘要：`sha256:0cf9e4b243d41eb4009829f71b4900f3ef544b13d4dd604c14d7084017a6adca`
- Rollout：成功，Deployment `1/1` Ready。
- 运行时 `imageID`：与部署摘要一致。
- `https://mlai-test.bielcrystal.com/` 返回 HTTP `302`，属于正常登录重定向。
- 本次只更新主镜像，没有更新数据库、Aihub DB Bridge 或其他工作负载。

### 13.3 2026-07-21 当前现场

测试环境后来已被其他发布继续更新。截至 2026-07-21 的只读核对结果：

- GitHub `main`：`afe06cc88102a28a6b3c1da309868d8e7f2b34ee`
- Deployment：`masterlion`，`1/1` Ready、Updated、Available。
- 当前镜像：

```text
boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion@sha256:bf67c9323b55817d51b3b3fed468e58c13f3d7f22dfc198da8453067b191d70e
```

因此 `0cf9e4b2...` 是本会话最后一次部署的历史摘要，不是当前测试环境摘要。任何回滚或再次部署前都必须重新查询现场，不应直接套用第 13.2 节的前后摘要。

## 14. ACR 拉取凭据与部署注意事项

- 测试集群使用 Secret `acr-credential-secret-aggregation` 拉取 ACR 私有镜像。
- ACR `GetAuthorizationToken` 返回的是临时凭据；集群未发现自动刷新组件，凭据过期时新 Pod 会出现 `401 Unauthorized` 或 `ImagePullBackOff`。
- PR #30 部署前已刷新该 Secret，但临时凭据会再次过期。后续部署必须先检查或刷新，且不得在终端、日志或文档中输出 token。
- 刷新时只替换现有 Secret 中目标 registry 的认证数据，不要改名或改变 Deployment 的 `imagePullSecrets` 关系。
- 如果 rollout 失败，先检查新 Pod events；只有确认是新 Pod 拉取失败时才删除失败的新 Pod，不能删除仍在提供服务的旧 Pod。

## 15. 后续接手建议

1. GitHub 操作优先使用 `gh` CLI：`gh pr view`、`gh pr checks`、`gh run view --log-failed`、`gh pr merge`。
2. 主工作区 `D:\MasterLion` 存在多项与本会话无关的未提交修改；不要批量暂存、覆盖或清理。
3. 本交接文档本身当前也是未跟踪文件，接手人提交前应单独审阅并只暂存该文件。
4. 如继续修改文档导出，至少定向回归 HTML 原文复制/下载、HTML Agent 文档预览、Markdown 实时导出与持久化兜底。
5. 生产环境尚未由本会话更新；生产部署前重新确认主镜像摘要、ACR 凭据、配置差异与回滚点。
6. 仓库说明引用的 `.agents/skills/ux/SKILL.md` 和 `.agents/skills/review-checklist/SKILL.md` 在本次处理时缺失；后续若恢复，应在交互变更或代码评审前重新读取。
