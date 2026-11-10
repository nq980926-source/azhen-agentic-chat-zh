# Agentic Chat 0.51.17 阿斟简体中文版

本次正式更新为父 Agent 和子 Agent 增加统一的运行时日期上下文。

## 日期上下文

- 每次新的模型请求重新取得设备当前本地日期、时间、星期和 IANA 时区。
- 同时提供昨天、明天、本周周一至周日和上周周一至周日。
- 日期计算基于目标时区下的本地年月日，不使用 UTC 日期替代本地日期。
- 正确处理跨月、跨年、闰年和夏令时边界。
- 跨过本地午夜后的下一次请求会自动使用新日期。
- 用户明确指定的历史日期仍优先于当前日期。

## 兼容与边界

- 原有自定义系统提示、Knowledge MCP 提示、安全审批和九个业务 Skills 保持兼容。
- 日期块只作为系统上下文，不写入聊天记录、用户消息或长期 Memory。
- 不修改 Obsidian Daily Notes 核心插件。
- 不修改 Knowledge MCP 服务端、云端知识库、Memory、Syncthing、财务或教学逻辑。
- 插件 ID 仍为 `agentic-chat`，设置、聊天记录、附件和 SecretStorage 不需要迁移。

## 验证

- 三套 TypeScript、两套 ESLint、生产构建、发布校验和移动兼容静态检查通过。
- 受影响日期上下文与提示集成测试 `34/34` 通过。
- 覆盖本地日期与 UTC 差异、昨天/明天、本周/上周、月末、年末、闰日、夏令时、跨午夜更新、子 Agent 和真实 outgoing replay。
- Windows 与 Android 的真实系统时区切换仍需在 BRAT 升级后进行最终使用验收。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 后更新 Agentic Chat。更新后完整重载 Obsidian 一次。

建议升级前备份正式插件目录中的 `data.json`、`sessions/`、`artifacts/` 和其他个人数据。
