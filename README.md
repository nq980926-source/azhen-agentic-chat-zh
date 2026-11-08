# 阿斟 · Agentic Chat 简体中文汉化版

这是 Obsidian 插件 [Agentic Chat](https://github.com/tardigrde/obsidian-agentic-chat) 的**非官方简体中文汉化构建**。基于上游 **0.51.10** 版本，面向 Windows 与 Android 的 Obsidian 使用。

> 本项目并非 Agentic Chat 官方版本，与原作者无官方隶属关系。原项目作者为 [tardigrde](https://github.com/tardigrde)。

## 功能与原则

- 汉化聊天界面、设置、按钮、常用提示、会话和部分工具状态。
- 简体中文环境显示中文；其他语言使用英文回退。
- 保留原版 Agentic Chat 的插件 ID `agentic-chat`、版本号 `0.51.10` 和内部协议标识。
- 不汉化模型 ID、MCP 协议字段、工具调用参数、Slash 命令标识、用户笔记内容及模型回答。

## 安装

### 使用 BRAT（需要本仓库已有 GitHub Release）

1. 在 Obsidian 的「第三方插件」中安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 在 BRAT 中选择添加 Beta 插件，输入本仓库地址：`nq980926-source/azhen-agentic-chat-zh`。
3. 安装并启用 Agentic Chat，将 Obsidian 的语言设置为简体中文。

**注意：** 仓库需要发布一个包含 `main.js`、`manifest.json`、`styles.css` 三个**独立附件**的 GitHub Release，供 BRAT 获取；只把 ZIP 作为 Release 附件不够。

### 手动安装（测试仓库优先）

把 `main.js`、`manifest.json` 和 `styles.css` 三个文件放在 Obsidian 测试仓库的：

```text
<你的仓库>/.obsidian/plugins/agentic-chat/
```

重启 Obsidian，在「第三方插件」中启用 Agentic Chat。Windows 与 Android 使用相同的插件文件。

在安卓端请先使用**独立测试仓库**，不要覆盖目前已验证可用的原版插件。

## 兼容与更新

- 插件版本：`0.51.10`
- 最低 Obsidian 版本：`1.11.4`
- 同一个仓库中，汉化版与原版不能作为两个不同插件并存（两者 ID 相同）。
- 安装后不要删除原有 `data.json`、`sessions/`、`artifacts/` 等数据。
- 更新自定义汉化版时，注意避免社区插件更新将它覆盖。

汉化实施报告显示：类型检查、Lint、自动测试、生产构建和移动兼容静态检查通过。**真实 Windows / Android 图形界面与实际设备兼容性仍需验证。**

## 原项目、许可与致谢

上游项目：[tardigrde/obsidian-agentic-chat](https://github.com/tardigrde/obsidian-agentic-chat)

汉化基线：Git commit [`c311506fdd190132ff9eeacc61043c88965785fe`](https://github.com/tardigrde/obsidian-agentic-chat/commit/c311506fdd190132ff9eeacc61043c88965785fe)

汉化工作基于阿斟 Obsidian 迁移项目，主要是用户界面简体中文本地化；原始 Agentic Chat 的作者与其他开源贡献者保留相应版权。

本仓库保留上游 [MIT License](LICENSE) 和 [第三方组件声明](THIRD_PARTY_NOTICES.md)。其中版权和第三方项目声明原文来自上游 `0.51.10` 标签，不作修改。

## 发布文件

- `main.js`：插件构建代码
- `manifest.json`：Obsidian 插件信息
- `styles.css`：插件样式
- `LICENSE`：上游 MIT 许可证
- `THIRD_PARTY_NOTICES.md`：上游第三方依赖与来源说明

只发布插件运行产物；不包含聊天历史、API Key、真实 Memory 或私人 Obsidian 仓库数据。
