# Masterino v1.2.0 生产环境停机更新计划

## 1. 发布合同

本次在 `masterlion` namespace 内原地更新 Masterino，不迁移 PostgreSQL、Redis、OSS、TLS
或域名。维护窗口建议为 Asia/Shanghai 周末 `02:00–04:00`，其中 90 分钟用于执行，最后
30 分钟只用于回滚。

| 项目                             | 发布值                                                                    |
| -------------------------------- | ------------------------------------------------------------------------- |
| 源码变更基线                     | `v1.1.1..v1.2.0`                                                          |
| 目标 tag                         | `v1.2.0`                                                                  |
| 目标 commit                      | `e4f0a759e850f88fbc70bfd3f09a7f8065e5093b`                                |
| 生产配置分支                     | `codex/v1.2.0-deepseek-production`                                        |
| ACK 集群                         | `c23ea84b986c446d5b3fa9227962e77f4`（`biel-ai`）                          |
| 地域 /namespace                  | `cn-shenzhen` / `masterlion`                                              |
| 域名                             | `masterino.bielcrystal.com`                                               |
| NLB CNAME                        | `nlb-pkheesf2fnmqr7yil7.cn-shenzhen.nlb.aliyuncsslb.com`                  |
| TLS Secret                       | `20261122bielcrystal.com`                                                 |
| ACR 实例 /namespace              | `cri-8velxg2aueo822e4` / `biel_client`                                    |
| ACR pull Secret                  | `acr-credential-secret-aggregation`                                       |
| 节点池                           | `npb74caa73461b49c986f40c22580f91c1`                                      |
| Masterino digest                 | `sha256:acea845ad6bcb8c6221f5e0de7996686a635905fe172994e7e1a737c962431e5` |
| Bridge digest                    | `sha256:9140209ecab59d1617613feebc85d8c1da0de0ec14a1d44448786e33cb5e37d8` |
| Market digest                    | `sha256:53582abdb90b8672e8e2662ae0968530cb3fc13fb8d025e5c41501e2f9660242` |
| 应用副本                         | 私有验收 `1`，切流后 `2`                                                  |
| Bridge / Memory Worker / SearXNG | `1` / `1` / `1`                                                           |
| Market                           | `2`，HPA `2–6`，CPU 目标 `70%`                                            |

上述 digest 是 `v1.2.0` 已验证制品。部署前仍须通过 ACR `ListRepoTag` 和 live Deployment
再次回读；任何不一致都必须停止发布，不能用 `latest` 替代。

## 2. 配置清单

### 2.1 应用、域名与认证

| Key                                   | 生产值 / 来源                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_URL`                             | `https://masterino.bielcrystal.com`                                                                                                        |
| `APP_URL_DYNAMIC`                     | `1`                                                                                                                                        |
| `APP_URL_ALLOWED_HOSTS`               | `masterino.bielcrystal.com`                                                                                                                |
| `INTERNAL_APP_URL`                    | `http://masterino:3210`                                                                                                                    |
| `ENABLED_CSP`                         | `1`                                                                                                                                        |
| `OPENAPI_CORS_ALLOWED_ORIGINS`        | `https://aihub.bielcrystal.com`                                                                                                            |
| `MODEL_PROVIDER_ALLOWED_ORIGINS`      | `https://aihub.bielcrystal.com`                                                                                                            |
| `SKILL_IMPORT_ALLOWED_ORIGINS`        | `https://masterino.bielcrystal.com,https://github.com,https://raw.githubusercontent.com,https://codeload.github.com,https://pinchwork.dev` |
| `AUTH_DISABLE_EMAIL_SIGNUP`           | `1`                                                                                                                                        |
| `AUTH_DISABLE_EMAIL_PASSWORD`         | `0`                                                                                                                                        |
| `AUTH_SSO_PROVIDERS`                  | `wecom`                                                                                                                                    |
| `AUTH_WECOM_CORP_ID`                  | 继承 live Secret                                                                                                                           |
| `AUTH_WECOM_AGENT_ID`                 | 继承 live Secret                                                                                                                           |
| `AUTH_WECOM_CORP_SECRET`              | 继承 live Secret                                                                                                                           |
| `AUTH_SECRET`                         | 继承 live Secret，升级前后 SHA-256 必须一致                                                                                                |
| `JWKS_KEY`                            | 继承 live Secret，升级前后 SHA-256 必须一致                                                                                                |
| `KEY_VAULTS_SECRET`                   | 继承 live Secret，升级前后 SHA-256 必须一致                                                                                                |
| `ALIBABA_CLOUD_ECS_METADATA_DISABLED` | `true`                                                                                                                                     |
| `ALIBABA_CLOUD_IMDSV1_DISABLE`        | `true`                                                                                                                                     |
| `AWS_EC2_METADATA_DISABLED`           | `true`                                                                                                                                     |

### 2.2 Aihub 与模型

| Key                                     | 生产值 / 来源                                 |
| --------------------------------------- | --------------------------------------------- |
| `AIHUB_PROXY_URL`                       | `https://aihub.bielcrystal.com`               |
| `AIHUB_DEFAULT_MODEL`                   | `deepseek-v4-flash`                           |
| `AIHUB_HIDDEN_MODELS`                   | `glm-5.1`                                     |
| `AIHUB_ADMIN_USER_ID`                   | `1`                                           |
| `AIHUB_ADMIN_ACCESS_TOKEN`              | 继承 live Secret                              |
| `AIHUB_DATA_SOURCE`                     | `bridge`                                      |
| `AIHUB_BRIDGE_URL`                      | `http://masterino-aihub-db-bridge:3218`       |
| `AIHUB_BRIDGE_TOKEN`                    | 应用与 Bridge 使用同一 live Secret            |
| `AIHUB_READONLY_DATABASE_URL`（应用）   | 空字符串，禁止应用直连 Aihub DB               |
| `AIHUB_READONLY_DATABASE_URL`（Bridge） | 继承 live 只读 MySQL URL                      |
| `AIHUB_DB_EXPECTED_DATABASE`            | `newapi`                                      |
| `AIHUB_DB_EXPECTED_HOST`                | `rm-wz9cdjs2ql8o0z192.mysql.rds.aliyuncs.com` |
| `AIHUB_DB_EXPECTED_PORT`                | `3306`                                        |
| `AIHUB_IAM_PROVIDER_ID`                 | `1`                                           |
| `AIHUB_MANAGED_TOKEN_NAME`              | `masterlion-managed`                          |
| `AIHUB_USAGE_PAGE_SIZE`                 | `100`                                         |
| `AIHUB_QUERY_TIMEOUT_MS`                | `15000`                                       |
| `AIHUB_QUOTA_DISPLAY_TYPE`              | `CNY`                                         |
| `AIHUB_QUOTA_PER_UNIT`                  | `500000`                                      |
| `AIHUB_USD_EXCHANGE_RATE`               | `7.12`                                        |

上线前必须通过 Bridge 确认目标用户组 abilities 和 `masterlion-managed` 的 `model_limits`
同时包含 `deepseek-v4-flash` 与 `text-embedding-3-large`。不得因默认模型不存在而回退到未
审核模型。

### 2.3 PostgreSQL 与 Redis

| Key / 资源          | 生产值 / 处理方式                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_DRIVER`   | `node`                                                                                                 |
| `LOBE_DB_NAME`      | `lobechat`                                                                                             |
| `DATABASE_URL`      | 原样继承 live URL，数据库名必须为 `lobechat`                                                           |
| `POSTGRES_PASSWORD` | 原样继承 live Secret                                                                                   |
| PostgreSQL          | 复用 ECS `i-wz9h1x0m1yq7cxc124uw`（`Masterino-PG`，`10.80.136.163:5432`），不创建新 StatefulSet 或 PVC |
| `REDIS_URL`         | 原样继承 live URL                                                                                      |
| `REDIS_PASSWORD`    | 原样继承 live Secret                                                                                   |
| `REDIS_DATABASE`    | `0`                                                                                                    |
| `REDIS_PREFIX`      | `lobechat`                                                                                             |
| `REDIS_TLS`         | `0`                                                                                                    |
| `REDIS_USERNAME`    | 未启用 ACL 时不设置                                                                                    |
| Redis               | 复用现有实例，不把缓存或会话当作唯一业务备份                                                           |

### 2.4 OSS、上传与知识库

| Key                           | 生产值 / 来源                                                        |
| ----------------------------- | -------------------------------------------------------------------- |
| `S3_ENDPOINT`                 | `https://oss-cn-shenzhen.aliyuncs.com`                               |
| `S3_REGION`                   | `cn-shenzhen`                                                        |
| `S3_BUCKET`                   | `masterlion-prd`                                                     |
| `S3_PUBLIC_DOMAIN`            | `https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com`                |
| `S3_ENABLE_PATH_STYLE`        | `0`                                                                  |
| `S3_SET_ACL`                  | `0`                                                                  |
| `S3_PUBLIC_UPLOAD_ENDPOINT`   | 不设置；浏览器统一走 `/api/upload/s3-proxy`                          |
| `S3_ACCESS_KEY_ID`            | 继承 live Secret                                                     |
| `S3_SECRET_ACCESS_KEY`        | 继承 live Secret                                                     |
| `S3_ACCESS_KEY`               | 如仍存在，必须等于 `S3_ACCESS_KEY_ID`                                |
| `S3_PREVIEW_URL_EXPIRE_IN`    | `7200`                                                               |
| `DEFAULT_FILES_CONFIG`        | `embedding_model=newapi/text-embedding-3-large,query_mode=full_text` |
| `CHUNKS_AUTO_EMBEDDING`       | `1`                                                                  |
| `CHUNKS_AUTO_GEN_METADATA`    | `1`                                                                  |
| `EMBEDDING_BATCH_SIZE`        | `50`                                                                 |
| `EMBEDDING_CONCURRENCY`       | `10`                                                                 |
| `LLM_VISION_IMAGE_USE_BASE64` | `1`                                                                  |

### 2.5 Memory Worker

| Key                                           | 生产值                                      |
| --------------------------------------------- | ------------------------------------------- |
| `FEATURE_FLAGS`                               | `+memory`                                   |
| `MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER`      | `newapi`                                    |
| `MEMORY_USER_MEMORY_GATEKEEPER_MODEL`         | `deepseek-v4-flash`                         |
| `MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER` | `newapi`                                    |
| `MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL`    | `deepseek-v4-flash`                         |
| `MEMORY_USER_MEMORY_PERSONA_WRITER_PROVIDER`  | `newapi`                                    |
| `MEMORY_USER_MEMORY_PERSONA_WRITER_MODEL`     | `deepseek-v4-flash`                         |
| `MEMORY_USER_MEMORY_EMBEDDING_PROVIDER`       | `newapi`                                    |
| `MEMORY_USER_MEMORY_EMBEDDING_MODEL`          | `text-embedding-3-large`                    |
| `MEMORY_USER_MEMORY_CONCURRENCY`              | `1`                                         |
| `MEMORY_QUEUE_REDIS_URL`                      | 不设置，回退使用 `REDIS_URL`                |
| `MEMORY_QUEUE_WORKER_ENABLED`                 | `1`，仅 Memory Worker Pod 设置              |
| `MEMORY_QUEUE_SCHEDULER_ENABLED`              | `1`，只运行一个 Scheduler                   |
| `GATEWAY_MANAGER_DISABLED`                    | `1`                                         |
| `NODE_EXTRA_CA_CERTS`                         | `/etc/ssl/certs/masterino-onlyboxes-ca.crt` |

### 2.6 SearXNG

| Key / 资源                              | 生产值                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEARCH_PROVIDERS`                      | `searxng`                                                                                                                                   |
| `SEARXNG_URL`                           | `http://masterino-searxng:8080`                                                                                                             |
| `SEARXNG_SETTINGS_FILE`                 | `/etc/searxng/settings.yml`                                                                                                                 |
| `SEARXNG_PORT` / `SEARXNG_BIND_ADDRESS` | `8080` / `0.0.0.0`                                                                                                                          |
| `SEARXNG_SECRET`                        | 继承 live Secret                                                                                                                            |
| ConfigMap                               | `searxng-config`                                                                                                                            |
| 镜像                                    | `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/searxng@sha256:663c20b2d6487ac6f34d741975ada147b996b1a0b68b1cd1e06300c6b5703803` |

### 2.7 OnlyBoxes

| Key / 资源                                          | 生产值                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| `SANDBOX_PROVIDER`                                  | `onlyboxes`                                      |
| `ONLYBOXES_BASE_URL`                                | `https://onlyboxes.internal.bielcrystal.com`     |
| `ONLYBOXES_JIT_ISSUER`                              | `https://masterino.bielcrystal.com`              |
| `ONLYBOXES_JIT_SIGNING_KEY`                         | 与 Console 的 `CONSOLE_JIT_SIGNING_KEY` 完全一致 |
| `ONLYBOXES_JIT_TTL_SEC` / `ONLYBOXES_LEASE_TTL_SEC` | `1800` / `900`                                   |
| `OFFICECLI_ENABLED`                                 | `false`；Office Runtime 黄金样例验收前不启用     |
| `ONLYBOXES_DATA_DIR`                                | `/var/lib/onlyboxes/console`                     |
| `CONSOLE_DASHBOARD_USERNAME`                        | `masterino-admin`                                |
| `CONSOLE_ENABLE_REGISTRATION`                       | `false`                                          |
| Console HTTP / gRPC                                 | `127.0.0.1:8089` / `127.0.0.1:50051`             |
| `WORKER_CONSOLE_GRPC_TARGET`                        | `127.0.0.1:50051`                                |
| `WORKER_CONSOLE_INSECURE`                           | `true`，仅限同机回环                             |
| Worker heartbeat / jitter                           | `5` 秒 / `20`%                                   |
| `WORKER_TERMINAL_OUTPUT_LIMIT_BYTES`                | `16777216`                                       |

Console、Python runtime、Terminal runtime 和 Worker 二进制都必须从内部制品库按 digest
固定。Dashboard 密码、Worker ID/Secret、Console hash key 和 JIT key 不得进入 Git、
ConfigMap 或日志。

### 2.8 内部 Market

| Key                                                      | 生产值 / 来源                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `MARKET_BASE_URL`                                        | `http://masterino-market:3220`                                                     |
| `MARKET_ALLOW_EXTERNAL_FALLBACK`                         | `0`                                                                                |
| `MARKET_TRUSTED_CLIENT_ID` / `MARKET_TRUSTED_CLIENT_IDS` | `masterino`                                                                        |
| `MARKET_TRUSTED_CLIENT_SECRET`                           | 主应用与 Market 使用同一 live Secret                                               |
| `MARKET_PORT`                                            | `3220`                                                                             |
| `MARKET_PUBLIC_BASE_URL`                                 | `https://masterino.bielcrystal.com/market`                                         |
| `MARKET_OAUTH_REDIRECT_ORIGINS`                          | `https://masterino.bielcrystal.com`                                                |
| `MARKET_DATABASE_URL`                                    | 继承生产 URL；当前与应用共用 `lobechat` 数据库，凭据哈希必须与 `DATABASE_URL` 一致 |
| `MARKET_REDIS_URL`                                       | 继承生产 Redis URL                                                                 |
| `MARKET_OBJECT_STORAGE_ENDPOINT`                         | `https://s3.oss-cn-shenzhen.aliyuncs.com`                                          |
| `MARKET_OBJECT_STORAGE_BUCKET`                           | `masterlion-prd`                                                                   |
| `MARKET_OBJECT_STORAGE_REGION`                           | `cn-shenzhen`                                                                      |
| `MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE`                 | `0`                                                                                |
| Market OSS AK/SK                                         | live Market Secret，权限限制到所需 bucket/prefix                                   |
| `MARKET_CREDENTIAL_ENCRYPTION_KEY`                       | 继承 live Secret                                                                   |
| `MARKET_IMPORT_SIGNING_KEY`                              | 继承 live Secret                                                                   |
| `MARKET_OAUTH_CLIENTS_JSON`                              | 没有 Provider 时为 `{}`，否则继承审核后的 JSON                                     |
| `MARKET_ADMIN_USER_IDS`                                  | 已确认的生产管理员 user ID                                                         |
| `MARKET_RUNNER_INTERNAL_TOKEN`                           | 保留 Secret，本次不启动 Runner                                                     |
| `CONNECTOR_EGRESS_PROXY_URL`                             | `http://connector-egress-proxy:3128`；代理未就绪前 Runner 禁用                     |

## 3. 发布前闸门

1. `v1.2.0` tag、commit、三个 ACR digest 与本节发布合同一致。
2. 导出 live Deployment、ReplicaSet、Ingress、ConfigMap、Secret key 列表与 Secret 哈希。
3. 数据库完成可恢复备份；生产 PostgreSQL 位于 ECS `Masterino-PG`，停写后创建系统盘人工快照并记录 Snapshot ID，同时记录 migration journal 和关键表行数。
4. `node scripts/operations/auditProductionConfig.mjs` 不报告缺失或冲突。
5. `node scripts/operations/verifyProductionBlueGreen.mjs` 通过。
6. 渲染清单不包含 Secret、StatefulSet、PVC 或可变镜像 tag。
7. Aihub 检查确认 `deepseek-v4-flash` 与 `text-embedding-3-large` 同时可用。
8. OnlyBoxes JIT key 两端哈希一致；Market migration 和 Seed 已在快照上预演。

任何一项失败均为 No-Go。

## 4. 停机执行顺序

1. 将 `masterino.bielcrystal.com` 切换到维护 Ingress，验证 `/` 返回维护页且写 API 不可达。
2. 记录副本数与 revision，停止 Masterino、Memory Worker/Scheduler、Market 及全部写入任务。
3. 确认数据库无应用写连接，生成最终一致性备份与校验和。
4. 更新 `masterino-config` 和 content-hashed Memory ConfigMap；本次不轮换 Secret。
5. 如 migration journal 有新增，使用 `v1.2.0` 镜像执行一次迁移 Job；失败时不得盲目重跑。
6. 按 “Market migration → Market → Bridge → SearXNG → Masterino 单副本” 启动。
7. 私有验证默认聊天、Memory 三个生成阶段均实际调用 `deepseek-v4-flash`，embedding 仍调用
   `text-embedding-3-large`。
8. 启动一个 Memory Worker/Scheduler，确认没有重复任务与队列积压。
9. 将 Masterino 扩到 2 副本，恢复公网 Ingress，观察至少 30 分钟。

## 5. 验收与回滚

验收覆盖企业微信登录、聊天与工具调用、Aihub 模型 / 配额、文件同源上传、知识库、Memory、
SearXNG、OnlyBoxes、Market、桌面与移动关键路由。日志不得出现 Token、Secret、完整用户 ID
或 SQL 连接串。

下列任一情况触发回滚：数据库迁移失败、10 分钟内 Pod 无法 Ready、登录 / 写入 / 上传失败、
Aihub 401/403、`deepseek-v4-flash` 不可用、Memory 结构化结果无法解析、持续 5xx 或 OOM。

回滚时先切维护页并停止新版本。若数据库 schema 未变化，仅恢复旧 ConfigMap、Memory
ConfigMap、镜像 digest 和副本数；模型专项故障可把四个生成模型 key 恢复为 `glm-5.2`，
embedding 不变。若执行了不兼容迁移，则先恢复数据库备份并复核 journal 与关键表行数，
再启动旧版本。开放流量后如已产生新写入，不得直接覆盖恢复，必须先由 DBA 处理增量。
