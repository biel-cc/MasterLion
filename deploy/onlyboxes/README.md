# Masterino Onlyboxes 0.7.1 部署包

此目录用于把 Onlyboxes Console 与 Docker Worker 部署到独立内网 Linux 节点。Masterino 仍运行在 K8s，通过 `https://onlyboxes.internal.bielcrystal.com` 调用 Console。这里固定 Onlyboxes `0.7.1`，不在启动或沙箱执行时访问外部镜像仓库。

## 1. 预先镜像全部产物

发布前，在受控环境完成来源校验、漏洞扫描和摘要记录，并把以下产物镜像到内部仓库：

- Console：`coolfan1024/onlyboxes:0.7.1` → `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/onlyboxes:0.7.1`
- 上游 Runtime：`coolfan1024/onlyboxes-runtime:0.7.1-lobehub`，先镜像到内部 ACR，并在后续构建中使用内部 `@sha256:` 摘要，不使用 tag 作为基础镜像。
- Masterino 统一 Runtime：使用 `Dockerfile.office-runtime` 在 ACR 云端构建，发布为 `.../onlyboxes-sandbox-runtime:0.7.1-officecli-1.0.143-pydata1`。Python 与 Terminal capability 必须引用同一个最终 digest。
- GitHub Release `0.7.1` 中与节点架构匹配的 `onlyboxes-worker-docker` 二进制 → 内部制品库

生产节点只从内部仓库拉取这些产物。部署记录必须保存上游摘要、内部摘要和 Worker 二进制 SHA-256；禁止使用 `latest`。

统一 Runtime 在上游数据分析与 Office 基线之上固定增加 `python-pptx`、`XlsxWriter`、`seaborn`、`pyarrow`、`polars`、`fastexcel`、`duckdb`、`statsmodels`、`charset-normalizer`、`rapidfuzz` 和 `tabulate`。`patsy` 与 `polars-runtime-32` 作为必需的运行时依赖一起锁定。版本与 amd64/arm64 Linux wheel SHA-256 位于 `runtime-requirements.txt`；构建使用 `--no-deps --require-hashes`，随后运行 `pip check`。构建完成后 `/opt/masterino/runtime-manifest.json` 会记录最终包、许可证、字体和系统工具。

### 1.1 ACR 云端构建契约

不要在开发机或 Onlyboxes 节点执行本地 Docker build。ACR 构建任务必须使用仓库根目录作为 context、`deploy/onlyboxes/Dockerfile.office-runtime` 作为 Dockerfile，并传入：

- `ONLYBOXES_RUNTIME_BASE`：内部上游 Runtime 的完整 `@sha256:` 引用
- `MASTERINO_PYPI_INDEX_URL`：不含凭据、由服务端执行包与版本白名单的内部 Python 镜像地址
- `MASTERINO_RUNTIME_BUILD_DATE`：UTC ISO-8601 构建时间
- `MASTERINO_RUNTIME_SOURCE_REVISION`：Git commit SHA

构建脚本拒绝空的基础镜像和 Python 镜像地址，也拒绝 URL 中包含用户名或密码。ACR 构建完成后必须记录不可变 digest，并导出 ACR 漏洞扫描、SBOM 与许可证结果；镜像自身无法在构建阶段知道最终 digest，因此该值保存在发布记录中，而不是伪造到镜像内部 manifest。

## 2. 安装 Console

1. 将本目录复制到节点的 `/opt/onlyboxes`，把 Worker 二进制安装为 `/opt/onlyboxes/bin/onlyboxes-worker-docker`。
2. 创建专用用户和持久化目录：`onlyboxes` 用户、`/var/lib/onlyboxes/console`，目录仅允许 root 和服务用户访问。
3. 将 `.env.example` 复制到 `/etc/masterino/onlyboxes-console.env`，替换所有 `CHANGE_ME`，设置权限为 `root:root 0600`。
4. `CONSOLE_HASH_KEY` 与 Dashboard 密码分别生成；`CONSOLE_JIT_SIGNING_KEY` 使用至少 32 字节随机值。该 JIT 值必须与 K8s Secret 中的 `ONLYBOXES_JIT_SIGNING_KEY` 完全一致。
5. 安装 `masterino-onlyboxes-console.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload && systemctl enable --now masterino-onlyboxes-console`。

Compose 只把 HTTP `8089` 和 gRPC `50051` 映射到宿主机回环地址。`CONSOLE_ENABLE_REGISTRATION=false` 禁止 Onlyboxes 自身注册。SQLite 数据保存在 `/var/lib/onlyboxes/console`。

## 3. 配置内部 HTTPS

1. 用内部 CA 为 `onlyboxes.internal.bielcrystal.com` 签发证书。
2. 渲染 `nginx/onlyboxes.conf.template` 中的 `${MASTERLION_EGRESS_CIDR}` 和 `${OPERATIONS_CIDR}`，安装到 Nginx。
3. 让内部 DNS 只解析到专用节点地址，并确保 Masterino Pod 信任内部 CA。
4. 先运行 `nginx -t`，再重新加载 Nginx。

Dashboard 和 REST/MCP API 共用 HTTPS 入口，模板默认仅允许 Masterino 的固定出口 CIDR 与运维网段。同机 Worker 可以通过 `127.0.0.1:50051` gRPC 通信；跨主机 Worker 必须通过受控 TLS 网关接入，不能把明文 gRPC 暴露到网络。

## 4. 注册并启动 Worker

1. 通过受限运维网段登录 Dashboard，创建 `normal` Worker，立即保存只显示一次的 `WORKER_ID` 和 `WORKER_SECRET`。
2. 将 `onlyboxes-worker.env.example` 复制到 `/etc/masterino/onlyboxes-worker.env`，填入凭据并设为 `root:root 0600`。
3. 预拉取 `WORKER_TERMINAL_EXEC_DOCKER_IMAGE` 指定的 digest，并确认 Python 与 Terminal 配置引用同一个值。
4. 安装 `onlyboxes-worker.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload && systemctl enable --now onlyboxes-worker`。
5. 在 Dashboard 确认 Worker 状态为 `online`。

systemd 服务会在 Worker 启动前用 `--network none` 运行 `/opt/masterino/runtime-smoke.py --quick`。导入、OfficeCLI、字体或黄金文件失败时 Worker 不会上线。`WORKER_CONSOLE_INSECURE=true` 仅用于同机回环 gRPC；任何跨主机 Worker 都必须在 gRPC 前增加 TLS 网关并移除此设置。

### 4.1 30 并发 N+1 基线

- 部署 4 个独立 Worker 节点，每节点至少 16 vCPU / 32 GiB。
- 每节点 10 个 `terminalExec` 和 10 个 `terminalResource` inflight，单会话保持串行，最多管理 50 个活动会话。
- 每个执行容器限制 2048 MiB、1.5 CPU、256 PID。四节点提供 40 个槽位，任一节点下线后仍保留 30 个槽位。
- 这些值已写入 `onlyboxes-worker.env.example`；如压测结果要求调整，资源限制和 inflight 必须成组修改。

## 5. Masterino 生产配置

仓库的 production ConfigMap 已设置：

```dotenv
SANDBOX_PROVIDER=onlyboxes
ONLYBOXES_BASE_URL=https://onlyboxes.internal.bielcrystal.com
ONLYBOXES_JIT_ISSUER=https://masterino.bielcrystal.com
AUTH_DISABLE_EMAIL_SIGNUP=1
AUTH_DISABLE_EMAIL_PASSWORD=0
OFFICECLI_ENABLED=false
```

在生产 Secret 的外部 env 文件中加入以下值，再通过现有 `deploy.sh --env production create-secret ...` 流程更新 Secret：

```dotenv
ONLYBOXES_JIT_SIGNING_KEY=<与 Console 相同的随机值>
```

默认沿用 Masterino 的 `ONLYBOXES_JIT_TTL_SEC=1800` 和 `ONLYBOXES_LEASE_TTL_SEC=900`。不要把 Dashboard、Worker 或 JIT 密钥写入 ConfigMap、Git 或命令历史。

Office Runtime digest 在测试节点完成 Word、Excel、PowerPoint 黄金样例验证后，将 `OFFICECLI_ENABLED` 改为 `true` 并按受控 ACK 流程发布。回滚时先关闭该开关，再恢复上一版 Runtime digest。

## 6. 出口隔离

在 Onlyboxes 节点上游防火墙 / 安全组实施默认拒绝公网出口。允许项应精确到目的地址和端口：

- 内部 DNS（TCP/UDP 53）和内部 NTP（UDP 123）
- 明确批准的内网镜像仓库、日志、监控与运维服务
- 执行项目和版本白名单的内部 Python 镜像代理；禁止直连公网 PyPI 或使用 `extra-index-url`
- `masterlion-prd.oss-cn-shenzhen.aliyuncs.com:443`，用于沙箱文件初始化和导出

Docker 会创建自己的 iptables 规则，因此 Docker/UFW 不能作为唯一隔离层。安全边界必须由上游防火墙或云安全组强制执行，并对放行项记录负责人和到期复核时间。

## 7. 备份与恢复

每天对 `/var/lib/onlyboxes/console` 做应用一致性备份，并把加密备份复制到受控备份存储。备份前短暂停止 Console，或使用 SQLite 在线备份能力；至少每季度在隔离节点恢复并验证 Dashboard、Worker 注册信息和访问令牌。密钥配置单独进入企业密钥备份，不与数据库快照存放在同一位置。

## 8. 上线前烟测

完成配置但在实际 rollout 前，依次验证：

- Python、JavaScript 和 Shell 命令执行
- 同一会话内的文件写入、读取和状态保持
- 从 Masterino 上传文件完成沙箱初始化
- 生成文件并通过 Aliyun OSS 预签名 URL 导出
- 停止 Worker 后，Masterino 返回明确的 Worker 离线错误
- 临时使用不匹配的 JIT 签名密钥后，Masterino 返回明确的认证 / 签名错误；测试后立即恢复正确密钥
- Onlyboxes Dashboard 无法注册新账号，公网无法访问 Console HTTP/gRPC，沙箱无法访问未放行的公网地址

在 canary Worker 上执行完整黄金任务，并把输出目录和 JSON 摘要随发布记录保存：

```bash
docker run --rm --network none --memory 2048m --cpus 1.5 --pids-limit 256 \
  -v /var/lib/onlyboxes/golden:/golden \
  "${WORKER_TERMINAL_EXEC_DOCKER_IMAGE}" \
  python3 /opt/masterino/runtime-smoke.py --golden --rows 1000000 --output-dir /golden
```

随后以 30 个混合数据 / Office 会话持续压测 30 分钟，要求容量错误为 0、调度等待 p95 小于 3 秒；停止任一 Worker 后重复 30 并发。监控至少包含请求量、执行耗时、容量耗尽、超时 / OOM、导出失败、在线 Worker 数与可用槽位。

仓库提供不依赖第三方 Python 包的重复压测工具。它为每条 lane 保持一个串行会话，循环执行 Python 数据导入、OfficeCLI、Office Python 库和 Shell 四类请求，并生成机器可读报告：

```bash
ONLYBOXES_BASE_URL=https://onlyboxes.internal.bielcrystal.com \
  ONLYBOXES_JIT_ISSUER=https://masterino.bielcrystal.com \
  ONLYBOXES_JIT_SIGNING_KEY='<从受控 Secret 注入>' \
  python3 deploy/onlyboxes/capacity-load.py \
  --concurrency 30 --duration-seconds 1800 \
  --output /var/lib/onlyboxes/reports/capacity-report.json
```

该报告将 Console 往返时延作为保守的调度等待代理，检查 p95 小于 3 秒且容量错误为 0。首轮通过后停止任一 Worker 再运行一次，并把两份报告、OTel worker/slot 指标和故障时间线一起归档；脚本不会自动停止 Worker。

### 8.1 可观测性契约

Masterino Server 已直接记录 `sandbox_onlyboxes_tool_requests_total`、`sandbox_onlyboxes_tool_duration_ms`、`sandbox_onlyboxes_worker_retries_total`、`sandbox_onlyboxes_capacity_exhausted_total`、`sandbox_onlyboxes_failures_total`、`sandbox_onlyboxes_exports_total` 和 `sandbox_onlyboxes_export_duration_ms`。失败按 `capacity`、`timeout`、`oom`、`other` 分类，工具、结果和错误码使用有界 attributes。

在线 Worker 数与可用 slot 属于 Onlyboxes 控制面状态，不能由某次用户 JIT 请求可靠推断。生产 OTel Collector 必须从 Console/Worker 管理面采集这两个 gauge，并与上述 Server 指标在相同 service/environment 维度关联；如果当前 0.7.1 管理面不能直接导出，应由受控的运维 exporter 读取 Dashboard / 管理接口，不能把管理凭据加入 Masterino Server。近 30 天失败原因矩阵以这些指标、Worker journal 和 ACR 扫描记录为数据源。

本部署包不会自动构建镜像、修改防火墙或执行 K8s/Onlyboxes rollout；这些步骤必须在发布确认后由运维流程执行。
