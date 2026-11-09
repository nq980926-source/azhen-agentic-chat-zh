# Agentic Chat 0.51.12 阿斟简体中文版

基于已审核的 Agentic Chat 0.51.11 阿斟汉化及 Memory 联动源码，加入 Android UI 集中优化。Windows 与 Android 使用相同插件文件。

## 更新内容

- Android 聊天在主工作区使用全宽 Tab，并在 Obsidian 启动时优先打开聊天。
- 手机输入框默认紧凑，多行草稿自动增高，键盘遮挡与底部安全区处理更完整。
- 手机消息、工具卡片和 Markdown 内容布局更紧凑；长表格只在自身区域横向滚动。
- 桌面端继续使用原有右侧栏布局、设置与工具审批体验。
- 保留简体中文、Memory 聊天联动、Knowledge MCP、模型设置、聊天历史和工具审批。
- 插件 ID 仍为 `agentic-chat`，现有 `data.json`、会话和 SecretStorage 不需要迁移。

## 验证

- 生产构建、TypeScript 检查、ESLint、feature map 和移动兼容静态检查通过。
- 单元测试 1759 通过、1 项既有条件跳过、0 失败。
- Android 真机 UI 与桌面端实际 E2E 尚未完成；用户接受在正式使用中继续验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 即可安装或更新。手动安装时只替换 `main.js`、`manifest.json` 和 `styles.css`，不要删除原有插件数据。
