# Agentic Chat 0.51.23

- 同一轮 AI 回复的思考与工具记录统一折叠，默认收起，最终回答独立显示。
- 展开后保留原始先后顺序、思考独立折叠及完整工具输入、输出和错误详情。
- 沿用真实用户轮次分组，流式追加保持展开状态，失败状态可见，历史聊天可恢复。
- Windows / Android 使用同一安装包，插件 ID 保持 agentic-chat；不改变模型、工具执行、审批或聊天数据格式。

用户已确认 test.2 双端实机验收通过。本次正式构建通过 TypeScript、19 项相关测试、生产打包及移动静态兼容检查。

安装：解压 ZIP，将 main.js、manifest.json、styles.css 放入 Vault/.obsidian/plugins/agentic-chat/，重新加载插件。升级只替换这三个文件，保留 data.json、sessions、artifacts 及已有设置。Android 无需 APK。

回退：关闭插件，使用旧版本三个安装文件覆盖后重新启用。正式 0.51.22、test.1、test.2 均保留。
