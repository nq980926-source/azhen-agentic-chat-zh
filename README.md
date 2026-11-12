# 阿斟 · Agentic Chat 简体中文汉化版

这是 Obsidian 插件 [Agentic Chat](https://github.com/tardigrde/obsidian-agentic-chat) 的**非官方简体中文汉化构建**，保留阿斟 Memory 聊天联动、Knowledge MCP、模型设置、工具审批和聊天历史能力。当前正式版本为 **0.51.23**，Windows 与 Android 使用同一组插件文件。

> 本项目并非 Agentic Chat 官方版本，与原作者无官方隶属关系。原项目作者为 [tardigrde](https://github.com/tardigrde)。

## 功能与原则

- 汉化聊天界面、设置、按钮、常用提示、会话和部分工具状态。
- 简体中文环境显示中文；其他语言使用英文回退。
- 保留原版 Agentic Chat 的插件 ID `agentic-chat` 和内部协议标识。
- 不汉化模型 ID、MCP 协议字段、工具调用参数、Slash 命令标识、用户笔记内容及模型回答。
- Android 端在 Obsidian 主工作区使用全宽聊天 Tab，并优先在启动时打开聊天。
- Android 输入法弹出后，输入卡保持在键盘和 Obsidian 导航栏上方，消息区独立滚动。
- 手机输入框默认紧凑，多行草稿自动增高，超过上限后在输入框内部滚动。
- Android「安装插件 → 压缩包文件」现在使用挂载在当前 Modal 中的文件输入，可正常打开系统文件选择器。
- Knowledge MCP 通过正式 HTTPS 端点跨设备识别同一服务，不再依赖 Windows 或 Android 各自的插件生成服务器 ID。
- Knowledge MCP 恢复新增、覆盖、精确编辑、追加和软删除能力；五个写工具在 Safe/YOLO 下均使用 per-tool 审批。
- 知识库正文不能通过本地 Vault 写工具绕过 MCP；本地写入仅保留给业务 Skills 维护。
- 每次模型请求都会获得设备本地日期、时间、星期、IANA 时区、昨天、明天及本周/上周范围。
- 财务统计通过统一 `FinanceFact` 生成文字和 Charts 数据；图表包含明确配色，用途超过 8 项时自动使用横向柱状图。
- 账本“用途”不会被冒充为未经核实的大类分类，图例、扇区和文字统计保持一致。
- 桌面端继续使用原有右侧栏布局和操作习惯。

## 安装

### 使用 BRAT

1. 在 Obsidian 的「第三方插件」中安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 在 BRAT 中选择添加 Beta 插件，输入本仓库地址：`nq980926-source/azhen-agentic-chat-zh`。
3. 安装并启用 Agentic Chat，将 Obsidian 的语言设置为简体中文。

每次正式 Release 都包含 `main.js`、`manifest.json`、`styles.css` 三个独立附件。BRAT 会读取仓库根目录的 `versions.json` 并下载对应版本资产。

### 手动安装

把 `main.js`、`manifest.json` 和 `styles.css` 三个文件放在 Obsidian 测试仓库的：

```text
<你的仓库>/.obsidian/plugins/agentic-chat/
```

重启 Obsidian，在「第三方插件」中启用 Agentic Chat。升级时只替换上述三个文件，保留原有 `data.json`、`sessions/`、`artifacts/` 与 SecretStorage。

## 兼容与更新

- 插件版本：`0.51.22`
- 最低 Obsidian 版本：`1.11.4`
- 同一个仓库中，汉化版与原版不能作为两个不同插件并存（两者 ID 相同）。
- 安装后不要删除原有 `data.json`、`sessions/`、`artifacts/` 等数据。
- 更新自定义汉化版时，注意避免社区插件更新将它覆盖。

0.51.19 保留 0.51.18 的财务统计、Charts 接入、运行时日期、Knowledge MCP 七工具和审批能力。正式构建通过 TypeScript、ESLint、生产构建和移动兼容检查；财务图表相关单元测试 15 项、真实 Obsidian 1.15.0 与 Charts `3.9.0-zh.1` E2E 1 项通过。升级不需要重新填写 Token、知识库路径或统计参数；实际 Android 渲染仍需在手机上做最终验收。

## 原项目、许可与致谢

上游项目：[tardigrde/obsidian-agentic-chat](https://github.com/tardigrde/obsidian-agentic-chat)

汉化基线：Git commit [`c311506fdd190132ff9eeacc61043c88965785fe`](https://github.com/tardigrde/obsidian-agentic-chat/commit/c311506fdd190132ff9eeacc61043c88965785fe)

汉化工作基于阿斟 Obsidian 迁移项目，主要是用户界面简体中文本地化；原始 Agentic Chat 的作者与其他开源贡献者保留相应版权。

本仓库保留上游 [MIT License](LICENSE) 和 [第三方组件声明](THIRD_PARTY_NOTICES.md)。其中版权和第三方项目声明原文来自上游 `0.51.10` 标签，不作修改。

## 发布文件

- `main.js`：插件构建代码
- `manifest.json`：Obsidian 插件信息
- `styles.css`：插件样式
- `versions.json`：BRAT 使用的版本与最低 Obsidian 版本映射
- `LICENSE`：上游 MIT 许可证
- `THIRD_PARTY_NOTICES.md`：上游第三方依赖与来源说明

只发布插件运行产物；不包含聊天历史、API Key、真实 Memory 或私人 Obsidian 仓库数据。

## 0.51.20 输入与图片

移动端 Enter 换行，Windows Enter 发送、Shift+Enter 换行。工具栏“添加图片”通过系统选择器添加 PNG/JPEG/WebP/GIF，支持缩略图、移除和图文发送；最多 4 张、单张 10 MB、合计 20 MB。复用现有多模态模型与会话链路，非视觉模型明确拦截，发送失败保留草稿。Android 实机与真实服务识图仍待验收。详细限制和验证记录见 [发布说明](release/0.51.20/release-notes.md)。

## 0.51.22 视觉能力识别

按已核实的服务端点与精确模型 ID 修复 DeepSeek V4.1 Flash 图片能力识别，复用 OpenRouter 模态元数据。保留未知或非视觉模型拦截，不更改用户模型、API 地址或 Token。[发布说明](release/0.51.22/release-notes.md)。

## 0.51.23 思考与工具统一折叠

同一轮思考和工具记录默认统一收起，展开保留原始顺序与完整详情，正文独立显示。Windows / Android 共用安装资源。见[发布说明](release/0.51.23/release-notes.md)。
