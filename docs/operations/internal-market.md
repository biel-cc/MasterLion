# Masterino 内部 Market 运维说明

内部 Market 由 `masterlion-market` API、`masterlion-market-runner`、独立 PostgreSQL 逻辑库、独立对象存储 Bucket 和 Redis 独立前缀组成。主应用运行时不允许回退到外部 Market 或 npm 索引。

## 上线前准备

1. 创建数据库 `masterlion_market` 和最小权限账号，执行一次迁移 Job。
2. 创建专用 Bucket，并为 Market API 配置只读写该 Bucket 的账号。
3. 复制 `k8s/base/market-credentials.template.yaml` 并在集群密钥管理系统中创建 Secret。真实密钥不得进入 Git。
4. 将平台管理员的 Masterino user ID 写入 `MARKET_ADMIN_USER_IDS`。
5. 部署 Connector 出口代理。Runner 的 NetworkPolicy 只允许连接该代理；代理再执行域名、端口和协议白名单。
6. 通过 `/ready` 验证数据库、Redis、对象存储和迁移版本。

OAuth Provider 还需在已审核的 Provider manifest 中配置 `oauth.authorizationUrl`、`oauth.tokenUrl` 和 `oauth.scopes`，在 `MARKET_OAUTH_CLIENTS_JSON` Secret 中配置对应 `clientId/clientSecret`，并把授权端点和 token 端点都加入该 Provider 的白名单。允许的 Masterino 回跳来源由 `MARKET_OAUTH_REDIRECT_ORIGINS` 控制。

## 内容导入与发布

离线导入包必须包含固定 JSON payload 和其 HMAC-SHA256 Base64 签名。服务会核对文件 SHA-256、拒绝路径穿越和符号链接，并将内容放入 `submitted` 队列。管理员依次执行扫描通过、批准和发布；只有 `published` 版本能被检索、下载、安装或执行。

## 回滚与恢复

- 数据库按独立逻辑库做时间点恢复；对象存储开启版本控制。
- 版本记录不可变。应用回滚不会改变资源版本，只要旧应用仍指向内部服务即可。
- 下架使用 `deprecated`，不要删除版本或对象。
- 轮换 Trusted Client、凭据加密、导入签名和 Runner token 时，先部署兼容窗口，再撤销旧密钥。

## 网络验收

在测试命名空间观察 DNS、代理和防火墙日志：Market API、主应用与后台任务不得访问 `market.lobehub.com` 或 npm agents/plugins index；只有 Runner 可经出口代理访问已批准目标。任何未命中白名单的调用必须返回 403 并进入审计日志。
