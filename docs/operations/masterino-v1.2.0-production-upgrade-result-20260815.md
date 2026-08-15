# Masterino v1.2.0 生产更新执行记录（2026-08-15）

## 1. 执行结论

本次更新已完成生产切流，未触发回滚。Masterino、Aihub DB Bridge、内部 Market、Memory Worker、SearXNG 和企业微信验证服务均处于 Ready 状态；PostgreSQL、Redis 与 OSS 沿用原生产资源，没有迁移或替换。

所有生成类默认模型已经从 `glm-5.2` 切换为 `deepseek-v4-flash`，Embedding 模型保持 `text-embedding-3-large`。Aihub 真实 Chat 与 Embedding 请求均返回 200，30 分钟观察期内未出现不可用副本、Pod 重启或关键错误。

发布分支为 `codex/v1.2.0-deepseek-production`，首个生产配置提交为 `aacf0eec`，草稿 PR 为 [#98](https://github.com/chaaak6/Masterino/pull/98)。

## 2. 窗口与停机时间

| 时间（Asia/Shanghai） | 事件                                                                |
| --------------------- | ------------------------------------------------------------------- |
| 14:56                 | 导出生产资源、数据库基线和配置审计结果                              |
| 15:01:02              | `/` 与 `/market` 切换到维护页，停止应用写入                         |
| 15:03                 | PostgreSQL CHECKPOINT、Redis SAVE，并创建两份磁盘快照               |
| 15:06:50              | Market migration Job 完成                                           |
| 15:07                 | 新版 Market、Bridge、SearXNG、Masterino 单副本及 Memory Worker 启动 |
| 15:18:57              | Masterino 扩容到 2 副本，Ingress 恢复正式服务                       |
| 15:21:26–15:52:28     | 连续 30 分钟、60 次稳定性采样                                       |

实际维护窗口约 17 分 55 秒，短于发布合同中的 90 分钟执行预算。

## 3. 发布制品与工作负载

| 工作负载         |              最终副本 | 镜像 digest                                                               |
| ---------------- | --------------------: | ------------------------------------------------------------------------- |
| Masterino        |                   2/2 | `sha256:acea845ad6bcb8c6221f5e0de7996686a635905fe172994e7e1a737c962431e5` |
| Memory Worker    |                   1/1 | `sha256:acea845ad6bcb8c6221f5e0de7996686a635905fe172994e7e1a737c962431e5` |
| Aihub DB Bridge  |                   1/1 | `sha256:9140209ecab59d1617613feebc85d8c1da0de0ec14a1d44448786e33cb5e37d8` |
| 内部 Market      | 2/2，HPA 2–6，CPU 70% | `sha256:53582abdb90b8672e8e2662ae0968530cb3fc13fb8d025e5c41501e2f9660242` |
| SearXNG          |                   1/1 | `sha256:663c20b2d6487ac6f34d741975ada147b996b1a0b68b1cd1e06300c6b5703803` |
| 企业微信验证服务 |                   1/1 | 与 Masterino 相同                                                         |

渲染文件校验和：

| 文件                        | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `production-bluegreen.yaml` | `7bc23708d4b57cc43e7c8efe43ba1e90c59d270c93082df9544d414754a0327a` |
| `production-market.yaml`    | `e71fdddf97d2521544846218a2fc0df0f32a090f4e4144aef295a5e2a3f903b0` |
| `production-cutover.yaml`   | `ba65d2d0fc139b404c47d3f8c610cd5dfd4afed90b645f98167db9ffd72dc509` |

三个渲染文件均不包含 `Secret`、StatefulSet 或 PVC 资源，也没有可变镜像 tag。

## 4. 最终生产配置

### 4.1 应用与 Aihub DB Bridge

| Key                                  | 最终值                                          |
| ------------------------------------ | ----------------------------------------------- |
| `AIHUB_DEFAULT_MODEL`                | `deepseek-v4-flash`                             |
| `AIHUB_DATA_SOURCE`                  | `bridge`                                        |
| `AIHUB_BRIDGE_URL`                   | `http://masterino-aihub-db-bridge:3218`         |
| 应用侧 `AIHUB_READONLY_DATABASE_URL` | 空字符串，禁止直连 Aihub DB                     |
| Bridge 侧只读数据库                  | 继承原生产 Secret，数据库 `newapi`、端口 `3306` |
| `AIHUB_QUOTA_DISPLAY_TYPE`           | `CNY`                                           |
| `AIHUB_QUOTA_PER_UNIT`               | `500000`                                        |
| `AIHUB_USD_EXCHANGE_RATE`            | `7.12`                                          |

Aihub 管理 Token 的模型限制同时包含 `deepseek-v4-flash` 与 `text-embedding-3-large`。发布期间分别发起真实 Chat 和 2048 维 Embedding 请求，均返回 200。最近 30 分钟 Bridge 用量聚合显示 DeepSeek 209 次请求、Embedding 42 次请求，证明新模型路径已被实际使用。

### 4.2 Memory Worker

| Key                                           | 最终值                   |
| --------------------------------------------- | ------------------------ |
| `FEATURE_FLAGS`                               | `+memory`                |
| `MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER`      | `newapi`                 |
| `MEMORY_USER_MEMORY_GATEKEEPER_MODEL`         | `deepseek-v4-flash`      |
| `MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER` | `newapi`                 |
| `MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL`    | `deepseek-v4-flash`      |
| `MEMORY_USER_MEMORY_PERSONA_WRITER_PROVIDER`  | `newapi`                 |
| `MEMORY_USER_MEMORY_PERSONA_WRITER_MODEL`     | `deepseek-v4-flash`      |
| `MEMORY_USER_MEMORY_EMBEDDING_PROVIDER`       | `newapi`                 |
| `MEMORY_USER_MEMORY_EMBEDDING_MODEL`          | `text-embedding-3-large` |
| `MEMORY_USER_MEMORY_CONCURRENCY`              | `1`                      |

最终使用的内容哈希 ConfigMap 为 `masterino-memory-config-bf7gdtm9f8`，Scheduler 数量为 1。

### 4.3 内部 Market

| Key                                      | 最终值                                     |
| ---------------------------------------- | ------------------------------------------ |
| `MARKET_BASE_URL`                        | `http://masterino-market:3220`             |
| `MARKET_ALLOW_EXTERNAL_FALLBACK`         | `0`                                        |
| `MARKET_PORT`                            | `3220`                                     |
| `MARKET_PUBLIC_BASE_URL`                 | `https://masterino.bielcrystal.com/market` |
| `MARKET_OBJECT_STORAGE_ENDPOINT`         | `https://s3.oss-cn-shenzhen.aliyuncs.com`  |
| `MARKET_OBJECT_STORAGE_BUCKET`           | `masterlion-prd`                           |
| `MARKET_OBJECT_STORAGE_REGION`           | `cn-shenzhen`                              |
| `MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE` | `0`                                        |

`masterino-market-migrate` Job 成功执行，日志为 `Masterino Market migrations applied`；最终 migration 为 `0001_market.sql`。

### 4.4 SearXNG 与 OnlyBoxes

| Key                       | 最终值                                       |
| ------------------------- | -------------------------------------------- |
| `SEARCH_PROVIDERS`        | `searxng`                                    |
| `SEARXNG_URL`             | `http://masterino-searxng:8080`              |
| `SANDBOX_PROVIDER`        | `onlyboxes`                                  |
| `ONLYBOXES_BASE_URL`      | `https://onlyboxes.internal.bielcrystal.com` |
| `ONLYBOXES_JIT_TTL_SEC`   | `1800`                                       |
| `ONLYBOXES_LEASE_TTL_SEC` | `900`                                        |
| `OFFICECLI_ENABLED`       | `true`（2026-08-16 黄金样例通过后启用）      |

SearXNG JSON 搜索返回 200；OnlyBoxes 根接口返回 200，应用 JIT key 与 OnlyBoxes Console key 的 SHA-256 一致，未输出密钥明文。

### 4.5 PostgreSQL、Redis 与 OSS

| 项目                                                 | 最终值 / 结果                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| PostgreSQL                                           | 复用 ECS `Masterino-PG`；数据库 `lobechat`；migration 数 118，最新 `1784871076634`   |
| Redis                                                | `REDIS_DATABASE=0`、`REDIS_PREFIX=lobechat`、`REDIS_TLS=0`；RDB 与 AOF 状态均为 `ok` |
| OSS Endpoint                                         | `https://oss-cn-shenzhen.aliyuncs.com`                                               |
| OSS Region / Bucket                                  | `cn-shenzhen` / `masterlion-prd`                                                     |
| `S3_ENABLE_PATH_STYLE` / `S3_SET_ACL`                | `0` / `0`                                                                            |
| `S3_PREVIEW_URL_EXPIRE_IN`                           | `7200`                                                                               |
| 浏览器上传路径                                       | 同源 `/api/upload/s3-proxy`                                                          |
| `DEFAULT_FILES_CONFIG`                               | `embedding_model=newapi/text-embedding-3-large,query_mode=full_text`                 |
| `CHUNKS_AUTO_EMBEDDING` / `CHUNKS_AUTO_GEN_METADATA` | `1` / `1`                                                                            |
| `EMBEDDING_BATCH_SIZE` / `EMBEDDING_CONCURRENCY`     | `50` / `10`                                                                          |

## 5. 备份与数据核对

两份快照均为 30 天保留，最终状态为 `accomplished`、进度 `100%`：

| 资源                  | Snapshot ID              |
| --------------------- | ------------------------ |
| PostgreSQL ECS 系统盘 | `s-wz9a9b8c52slxctrwh86` |
| Redis PVC 云盘        | `s-wz9c48hz6fd4f8hg4tru` |

| 指标               |        停机前 |        部署后 |  观察期结束后 |
| ------------------ | ------------: | ------------: | ------------: |
| 数据库大小（byte） | 2,491,504,307 | 2,492,937,907 | 2,493,773,491 |
| users              |         1,688 |         1,688 |         1,688 |
| messages           |        69,765 |        69,765 |        69,765 |
| files              |         4,158 |         4,158 |         4,158 |
| user_memories      |        16,875 |        16,897 |        16,911 |
| market_resources   |             0 |             0 |             0 |
| market_versions    |             0 |             0 |             0 |

业务关键表没有丢失或回退；`user_memories` 持续增长，说明 Memory Worker 正在产生有效结果。

本次发布未应用任何 Secret 资源。最终集群内共有 7 个 Secret、55 个数据 key，脱敏后的整套哈希清单 SHA-256 为 `6b62a8fb01dfcfcc8a791875527c8a87c52da2095ae4b9c0d4b2a978a4548f90`。

## 6. 验收结果

### 6.1 自动化与服务验收

- `node scripts/operations/verifyProductionBlueGreen.mjs`：通过。
- `node scripts/operations/verifyProductionMaintenance.mjs`：通过。
- `tests/config/ack-deploy-script.test.ts`：3 个测试通过。
- 生产配置审计：必填项缺失 0，重复配置冲突 0；仅可选 `S3_ACCESS_KEY` 别名未设置。
- Kubernetes server-side dry-run：Blue/Green、Market 和 Cutover 三套清单全部通过。
- 内部服务：Bridge 鉴权接口、Market health/ready、SearXNG、OnlyBoxes、企业微信验证服务全部返回 200。
- 公网：`/` 与 `/chat` 正确跳转登录页并返回 200；`/market/health`、`/market/ready` 和企业微信验证文件返回 200；`GET /api/upload/s3-proxy` 返回预期 405，证明路由存在且方法保护生效。
- 浏览器：未登录访问正确进入标题为 “登录” 的 Masterino 页面；企业微信登录、账号登录、服务条款和隐私政策入口均可见。
- 30 分钟观察：60/60 次采样均为 `unavailable=0`、`badPods=0`、`restartDelta=0`、`criticalErrorLike=0`。

发布时创建的临时数据库审计 Pod `masterino-v12-db-audit` 已删除。

### 6.2 需人工登录态完成的回归

当前浏览器没有生产授权登录态，因此以下项目不能作为已完成项记录：

1. 完整企业微信授权回调并进入工作区。
2. 使用真实用户发起 UI 聊天、同源文件上传和知识库写入。
3. 从 UI 创建并操作 OnlyBoxes 沙箱。

以上操作涉及生产账号授权和真实业务写入，应由发布负责人使用测试账号在 PR 合并前补充回归；自动化服务链路与路由检查已经通过。

## 7. 非阻断遗留项

1. 16:01 的 Memory 队列为 `wait=36`、`active=1`、`failed=1000`（保留上限）、`delayed=1`、`repeat=1`；10 秒采样曾从 41 降至 36，队列仍在消费。最近 20 分钟日志中，主要失败为部分用户额度不足和历史上下文超过模型限制，另有少量结构化结果解析失败。这些任务按用户隔离并 fail-closed，未造成应用或模型通道全局故障。建议后续补充额度预检、长上下文截断 / 摘要和失败队列分原因告警。
2. 未登录页控制台记录到 4 条 `registry.npmmirror.com` 字体或 KaTeX CSS 加载失败；页面主体和登录控件仍正常渲染。建议将关键字体 / CSS 自托管或增加稳定镜像源，避免外部 CDN 波动。
3. 旧的、未被 Deployment 引用的 Memory 哈希 ConfigMap `masterino-memory-config-542d95ffd4` 仍保留，用于短期回滚；确认观察周期结束后可按配置保留策略清理。
