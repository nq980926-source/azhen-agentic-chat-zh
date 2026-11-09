# Agentic Chat 0.51.13 阿斟简体中文版

本次更新只修复 Android 的本地 ZIP 文件选择与导入入口，保留 0.51.12 的简体中文、Memory 联动、Knowledge MCP、模型设置、审批、聊天历史和手机全宽聊天 UI。

## 修复

- 修正 Android「资源 → 安装插件 → 压缩包文件……」点击后无响应的问题。
- 文件输入现在挂载到当前 Modal，成功选择 ZIP 后继续使用原有校验、解压、同名更新和错误提示流程。
- 用户取消文件选择时正常退出；打开选择器发生同步异常时显示明确错误。
- Windows 原有的 ZIP 导入及仓库文件夹入口保持不变。

## 验证

- 生产构建、TypeScript、ESLint、移动兼容静态检查和相关 82 项测试通过。
- 新增文件选择测试覆盖 DOM 挂载、取消、错误提示及完整 ZIP 安装链路。
- 当前环境没有 Android 真机或 ADB，Android 系统文件选择器将在正式安装后验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 即可安装或更新。升级时保留原有 `data.json`、会话、SecretStorage 和其他插件数据。
