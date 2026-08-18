# Masterino v1.2.1 生产发布交接

`v1.2.1` 是针对 `v1.2.0` 的补丁版本，不覆盖或重写 `v1.2.0` 的 Git 标签、Release 附件和
OSS 版本目录。

本次包含：

- 生产 Device Gateway Deployment、Service、内部服务地址和独立受控公网 Ingress；
- macOS 菜单栏与 Windows 系统托盘 tooltip 统一显示 `Masterino`；
- 中文托盘、快捷键设置和屏幕录制提示统一使用“快捷创作”；
- 补齐 `tray.settings`，实际加载英文 fallback，并在语言切换后重建现有托盘菜单；
- 根应用、桌面应用和 unsigned desktop workflow 默认版本升级到 `1.2.1`。

发布顺序不可调整：

1. 合并代码并通过 CI。
2. 按 `docs/operations/device-gateway-production-release.md` 完成生产 preflight、Secret、私网部署、
   认证验证和公网 cutover。
3. 确认公网 `/device-gateway/health` 为 `200 OK`，真实账号 WebSocket 在 15 秒内收到
   `auth_success` 且 userId 与 JWT `sub` 一致。
4. 创建新的 `v1.2.1` GitHub Release。
5. 运行 `Build Unsigned Desktop`，构建 Windows x64、macOS arm64、macOS x64 并更新 OSS
   canary。
6. 回读 Release 附件、OSS 对象、size、SHA-512、签名 JSON 与双架构清单。

生产盘点确认当前正式服务仍位于 `masterlion` namespace。Gateway 上线必须使用
`scripts/operations/deployProductionDeviceGateway.sh` 和 `production-live-gateway*` overlays；
不得为了本次补丁应用未来 `masterino` namespace 的完整生产 overlay。

桌面安装包仍为公司内部未公证、未 Authenticode 签名产物。macOS 用户只应对公司可信发布源
下载的 Masterino 执行安装说明中的 quarantine 清理命令；不得要求用户关闭系统全局
Gatekeeper。
