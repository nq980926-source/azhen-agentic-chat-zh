# Agentic Chat 0.51.19 阿斟简体中文版

本次正式更新只修复 Android 财务 Charts 的配色、图例和用途口径问题。

## 财务图表

- 环形图、柱状图和折线图现在显式提供背景色、边框色和数据点颜色。
- 环形图扇区与图例共用同一组高辨识度颜色，不再出现几乎透明或白色空框。
- 颜色不依赖 Charts 插件内部默认值，深色和浅色主题均可正常显示。
- 账本超过 8 个支出用途时，自动从拥挤的环形图切换为横向柱状图。
- 文字和图表仍来自同一份 `FinanceFact`，统计总额与图表数据保持一致。
- 账本“用途”明确标为用途汇总；没有可信大类映射时，不再把具体商户或用途
  冒充为消费分类。

## 兼容与边界

- 完整保留 0.51.18 的财务统计、大型 MCP Artifact 回执、Charts 接入、
  运行时日期上下文、Knowledge MCP 七工具和审批能力。
- 插件 ID 仍为 `agentic-chat`，最低 Obsidian 版本仍为 `1.11.4`。
- 兼容 `obsidian-charts` `3.9.0-zh.1`；`advanced-chart` 协议不变。
- 不修改 Charts 插件、Knowledge MCP 服务端、Memory、Syncthing、正式账本
  或其他业务 Skills。
- 原有设置、聊天记录、Artifact 和 SecretStorage 不需要迁移。

## 财务 Skill

财务 Skill 是独立私有交付物，不包含在本次公开 Release 中。BRAT 更新
Agentic Chat 不会自动更新手机或电脑中的本地财务 Skill，需要单独更新。

## 验证

- TypeScript 主源码和 E2E 类型检查通过。
- 针对性 ESLint、生产构建、发布物校验和移动兼容检查通过。
- 财务单元与查询工具测试 15 项通过。
- 真实 Obsidian 1.15.0 与 Charts `3.9.0-zh.1` E2E 通过：环形图、柱状图、
  折线图、22 项用途降级、深色/浅色主题、容器高度和重新打开恢复。
- Android 真机仍需要安装 0.51.19 后完成一次实际图表显示验收。

## 安装

通过 BRAT 更新 Agentic Chat，并完整重载 Obsidian。升级前建议备份现有插件目录
中的 `data.json`、`sessions/` 和 `artifacts/`。0.51.18 继续保留用于回退。
