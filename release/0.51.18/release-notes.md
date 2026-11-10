# Agentic Chat 0.51.18 阿斟简体中文版

本次正式更新恢复旧版阿斟所需的确定性财务统计，并接入 Agentic Chat
聊天中的 Charts 图表展示。

## 财务统计

- 通过现有 Knowledge MCP 读取真实财务档案和月度账本。
- 校验读取正文与 SHA-256 回执。
- 使用精确分数单位计算金额，不使用 JavaScript 浮点作为最终金额。
- 覆盖收入、支出、信用卡消费、内部转账、还款、用途分类和时间序列。
- 缺少账本、哈希不一致或格式异常时停止生成可信总额，不把缺失数据当作零。
- 大型 MCP 回执通过现有 Artifact 存储读取全文，不再依赖截断预览。

## Charts

- 使用统一 `FinanceFact` 同时生成文字摘要和 Charts 数据。
- 支持环形图和饼图、分类或跨月柱状图、收支折线图。
- 文字、分类合计和图表金额使用同一份可信统计结果。
- 使用 `advanced-chart` 协议，不改写 Chart.js 数据。
- Charts 未安装或未启用时只保留可信文字并明确提示，不生成空白图或伪造图表。
- 兼容已发布的 `obsidian-charts` 3.9.0 简体中文版；插件 ID 和
  `advanced-chart` 协议保持不变。

## 兼容与边界

- 保留 0.51.17 运行时日期上下文和全部正式功能。
- 保留 Knowledge MCP 七工具、跨设备端点识别和原有审批保护。
- 插件 ID 仍为 `agentic-chat`。
- 原设置、会话、Artifact 和 SecretStorage 不需要迁移。
- 未增加稳定操作身份、持久计划、跨文件事务或重启恢复机制。
- 不修改 Memory、Knowledge MCP 服务端、Syncthing 或正式设备配置。

## 财务 Skill

财务 Skill 属于独立本地私有交付物，不包含在本插件 Release 中。
BRAT 更新 Agentic Chat 不会自动更新本地财务 Skill，需要在审核后单独部署。

## 验证

- 三套 TypeScript、两套 ESLint、生产构建、发布物校验和移动兼容检查通过。
- 财务、Artifact 回执、运行时资源与审批相关测试共 73 项通过。
- 真实 Knowledge MCP 只读查询通过。
- 桌面 Obsidian 1.15.0 和 390×844 移动视口通过三种真实 canvas、
  中文 Charts 创建向导及聊天重新打开恢复测试。
- Windows 和 Android 的系统时区、真实 Android WebView 与生产知识库写入仍按
  既有边界独立验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 后更新 Agentic Chat，
再完整重载 Obsidian 一次。升级前建议备份正式插件目录中的 `data.json`、
`sessions/` 和 `artifacts/`。
