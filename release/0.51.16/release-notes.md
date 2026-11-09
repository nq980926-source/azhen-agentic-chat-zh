# Agentic Chat 0.51.16 阿斟简体中文版

本次正式更新修复 Windows 与 Android 对同一个 Knowledge MCP 服务的跨设备识别问题。

## 跨设备识别

- 不再依赖插件包名生成的固定服务器 ID。
- 使用规范化后的正式 HTTPS 端点 `https://106.55.92.40/mcp` 识别 Knowledge MCP。
- 正确处理协议、主机、默认端口和末尾斜杠，同时保留路径及查询参数。
- Windows 与 Android 可分别执行一次七工具配置迁移。
- 五个写工具继续使用当前实际服务器 ID 的 per-tool `ask`。

## 安全边界

- Android 和 Windows 的本地 Knowledge 正文写入限制均会生效。
- Safe、YOLO 下，本地 `write`、`edit`、`rename`、`delete`、`set_properties` 不能修改知识库正文。
- `azhen-business-skills` 的本地维护仍经过原有审批。
- 用户已关闭的 MCP 工具不会在后续加载时被反复开启。
- 不修改 Knowledge MCP 服务端、云端知识库、Memory、Skills 或 Syncthing。

## 兼容

- 插件 ID 仍为 `agentic-chat`。
- 原有设置、聊天记录、附件和 SecretStorage 不需要迁移。
- 不新增依赖、配置界面或审核系统。
- 原有 Release、标签和 Android 测试 Pre-release 全部保留。

## 验证

- TypeScript、ESLint、生产构建、移动兼容静态检查和 feature map 通过。
- 本次受影响 Knowledge MCP、运行时资源、审批边界和 MCP 配置测试共 142 项通过。
- Android 真机升级后的七工具注册、五个审批提示和生产知识库写入仍需在更新后验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 后更新 Agentic Chat。
更新后完整重载 Obsidian 一次，使当前设备执行 Knowledge 工具配置迁移。

建议升级前备份正式插件目录中的 `data.json`、`sessions/`、`artifacts/` 和其他个人数据。
