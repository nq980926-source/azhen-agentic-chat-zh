# Agentic Chat 0.51.14 阿斟简体中文版

本次正式更新修复 Android 系统输入法弹出后聊天页面布局不合理的问题，保留 0.51.13 的简体中文、Memory 联动、Knowledge MCP、模型设置、审批、聊天历史和手机全宽聊天 UI。

## 修复

- 修正 Obsidian `.view-content` 覆盖聊天根节点样式的问题，避免聊天页面本身成为可滚动容器。
- Android 输入法出现时按当前聊天视图的 `visualViewport` 同步可用高度，避免输入框随页面平移被抬到屏幕中部。
- 输入卡保持在系统键盘和 Obsidian 移动导航栏上方；关闭键盘后恢复全宽聊天布局。
- 手机工具栏保持紧凑单行，模型、思考强度、安全/YOLO 和发送入口继续保留。
- 多行输入自动扩展，最大高度受屏幕高度约束，超出后在输入框内部滚动。
- 消息历史占据剩余高度并保持独立滚动；竖屏和横屏均增加布局回归断言。

## 兼容与数据

- 插件 ID 仍为 `agentic-chat`，可直接通过同一 BRAT 插件项升级。
- `data.json`、聊天记录、附件和 SecretStorage 不需要迁移。
- 正式 `0.51.13` Release 与 Git 标签继续保留，可回退。
- Android 独立测试包 `0.51.14-android-test.1` 继续保留，不影响正式更新链路。

## 验证

- TypeScript 检查、E2E TypeScript、ESLint、生产构建、移动兼容静态检查和 feature map 通过。
- 视口布局单测 5/5 通过。
- 手机竖屏相关 E2E 3/3、横屏相关 E2E 3/3 通过。
- Windows 输入卡、上下文环和思考强度相关 E2E 3/3 通过。
- 自动化使用真实 Obsidian 1.15.0 的桌面移动仿真；Android 真实系统键盘仍需在手机安装后验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 后更新 Agentic Chat。手动安装时只替换 `main.js`、`manifest.json` 和 `styles.css`，不要删除原有插件数据。

建议在升级前备份 `.obsidian/plugins/agentic-chat/` 中的 `data.json`、`sessions/`、`artifacts/` 和其他个人数据。
