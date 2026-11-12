# agentic-chat 0.51.24 正式版

基于已通过 Windows 联调和用户 Android 实机验收的 0.51.24-shortcuts-test.1 制作，仅更新版本与发布元数据，不修改功能代码。正式版本为 0.51.24，插件 ID 保持 agentic-chat。

Agentic Chat 0.51.24 提供 shortcutApiVersion === 1 和 openShortcut()；工作台 0.1.15 复用此接口。多级板块、原生新会话、原文预设发送、三标签 FIFO、SVG 图标网格、管理齿轮及云知识库保持已验收行为。工作台不增加业务逻辑。

## 验证
- 本仓相关自动化测试 84/84 通过，零跳过；类型检查和生产构建通过。
- 正式 main.js、styles.css 与已验收测试版逐字节相同。仅 manifest/package/lock 版本、Agentic Chat versions.json（如适用）及本发布说明改变。
- 不重新运行业务服务写入测试，不修改 Skill、Knowledge MCP、Memory 或正式业务数据。
- 附件沿用原格式：main.js、manifest.json、styles.css、安装 ZIP、SHA-256 清单；Agentic Chat 另含 versions.json。ZIP 仅含插件运行文件与许可证，无私人配置、Skill、会话或凭据。

## BRAT 正式更新
先 Agentic Chat 0.51.24，再阿斟云端工作台 0.1.15。
在 Obsidian 设置 → BRAT 的已安装插件列表，点击原仓库条目的编辑（铅笔），将固定测试标签改为“最新版本 / Latest”，保留原 GitHub 密钥选择，确认更改并更新。不要继续固定在 shortcuts-test 标签。两插件分别操作，无需重装、编译或复制插件文件。

本 Release 为非 Draft、非 Pre-release，并设置 Latest。旧正式版 0.51.23 及全部测试版保持可用，可通过原 BRAT 条目选择旧标签回退。
