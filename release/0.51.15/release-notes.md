# Agentic Chat 0.51.15 阿斟简体中文版

本次正式更新恢复 Knowledge MCP 云端写入能力，并阻止 Agent 使用本地 Vault 文件工具绕过 MCP 修改知识库正文。

## Knowledge MCP 写入

- 客户端工具白名单从 `list_files`、`read_file` 扩展为七个工具：
  `list_files`、`read_file`、`create_file`、`write_file`、`edit_file`、`append_file`、`move_to_trash`。
- `create_file`、`write_file`、`edit_file`、`append_file`、`move_to_trash` 使用 per-tool `ask`；Safe 和 YOLO 下均继续弹出原有工具审批。
- 局部修改优先使用 `edit_file`；整篇覆盖要求读取当前 SHA-256；删除使用可恢复的 `move_to_trash`。
- 继续复用 Knowledge MCP 服务端现有哈希冲突保护、写前备份、operation 回执、原子提交和读回验证。
- 不修改 Knowledge MCP 服务端、Memory 0.2.2、九个业务 Skills 或 Syncthing 配置。

## 本地写入边界

- 当 Knowledge MCP 已配置时，本地 Vault 的 `write`、`edit`、`rename`、`delete`、`set_properties` 只能操作业务 Skills 包 `azhen-business-skills`。
- 知识库正文的新增、覆盖、编辑、追加和删除不能通过本地 Vault 工具绕过 Knowledge MCP。
- 路径检查使用既有规范化、目录段边界和源/目标双路径校验，不使用简单字符串前缀判断。
- 插件自身配置、聊天记录、附件和缓存不受这个 Agent 工具边界影响。

## 配置与兼容

- 插件 ID 仍为 `agentic-chat`，升级不需要迁移 `data.json`、聊天记录、附件或 SecretStorage。
- Windows 与 Android 会在各自设备第一次加载本版本时独立执行一次旧双工具配置迁移。
- 迁移标记会保留，用户以后主动关闭写工具时不会被自动重新开启。
- 系统提示会增加最少必要的 Knowledge MCP 写入规则，不覆盖用户已有自定义提示。

## 验证

- TypeScript、E2E TypeScript、ESLint、生产构建、移动兼容静态检查和 feature map 通过。
- Knowledge MCP 直接相关客户端测试 92/92 通过。
- 隔离 Knowledge MCP 实际调用创建、追加、编辑、覆盖、旧哈希拒绝、软删除和回执链路通过。
- Windows Obsidian 与手机仿真中的 YOLO 本地知识正文写入均被阻止，未创建文件。
- 手机聊天布局相关 E2E 3/3、Windows 相关 E2E 3/3 通过。

## 安装

BRAT 添加 `nq980926-source/azhen-agentic-chat-zh` 后更新 Agentic Chat。升级后完整重载 Obsidian 一次，使当前设备执行 Knowledge 工具配置迁移。

建议升级前备份 `.obsidian/plugins/agentic-chat/` 中的 `data.json`、`sessions/`、`artifacts/` 和其他个人数据。
