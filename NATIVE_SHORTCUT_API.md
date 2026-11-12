# 原生快捷任务候选接口

基于稳定源码 002cf4a（0.51.23），分支 feat/native-shortcuts。未引入旧只读接口或业务解析方案，未更改正式版本或部署。

## 契约

插件 ID：agentic-chat。能力标记：`shortcutApiVersion === 1`。

`openShortcut({requestId: string, message: string}): Promise<NativeShortcutResult>`

- requestId 必填，最长 128 字符；同一次操作必须使用同一个 ID，不得用相同 ID 表达不同任务。
- message 必须为字符串，最多 64000 UTF-16 单元。空字符串仅新建原生空白对话；非空字符串保持原文，包括空白、`/`、`#`，不进入 slash/standing-instruction 命令分支。
- 本次插件运行期间重复 requestId 返回同一 Promise/结果，包括失败，不自动重执行；插件卸载清理内存，不实现跨重启事务或自动恢复发送。
- 返回 sessionId 及 status：opened（空白对话已创建）、submitted（原生用户消息事件已进入原持久化流程且未报告错误）、not_sent（未确认发送）、unknown（错误或持久化/发送状态未确认）。后两种可附 error。
- submitted 不代表 AI 已答完，更不代表工具写入或业务保存成功。工作台不显示此类成功承诺。

## 原生执行与安全

main.ts 复用 activateView 的桌面/移动端选路，等待 loadIfDeferred，返回实际目标视图；不再次选择另一个历史视图。不同任务在创建/交接期间冲突时明确拒绝；相同请求去重。

ChatView.openShortcut 使用原 createTab、原 ChatTab.service.newSession 和原 JSONL 持久化。新标签在创建成功前不放入 tabs，原界面无法在此期间切换该服务。成功后捕获新 sessionId/token，检查当前视图、原标签集合和活动标签是否变化。发送复用原 ChatView 的普通消息管线、上下文隐私处理和 service 的令牌检查；仅快捷分支保留字面文本，不添加 Skill/业务前缀。AgentService.sendPrompt 新增可选 preserveWhitespace，默认 false，普通聊天保持原行为。

原 ChatTab 自己注册原 ask_user、工具审批和事件订阅，生命周期归原聊天视图；工作台不创建独立 AgentService。创建失败、视图关闭、切换标签或令牌变化均不发送到旧会话，不自动重试。

## 三标签 FIFO

沿用原单一 ChatView 中最多三个原生标签。数组顺序就是打开顺序，手动切换不重排。满三个时只考虑 tabs[0]；若最早标签有运行中/准备中的回合、会话切换、待审批、草稿、附件、本地图片、排队消息或编辑状态，则拒绝本次快捷任务，不跳过、不强关。

新会话准备成功后再次检查保护状态，再调用原 closeTab(0)，该方法只释放标签服务，不删除历史。只在原默认标签完全空白且无保护状态时替换该空标签。关闭视图会终止尚未发布的快捷标签服务。移动端迁移同样使用保护检查，避免仅复制文字后丢失其他草稿状态。

范围是原生单聊天视图的三标签管理，不跨多个用户手动建立的 Obsidian leaf 强制全局清理。创建成功而交接取消时可能留一份空白原生历史；不自动删除它。

## 文件与证据

- src/main.ts：公共 API、去重、创建互斥、视图选路返回值与卸载标记。
- src/ui/chat-view.ts：原生标签创建交接、FIFO、保护、字面发送及移动端迁移保护。
- src/agent/agent-service.ts：可选空白保留参数，原默认行为不变。
- test/native-shortcut.test.ts、native-shortcut-api.test.ts：接口、会话失败、关闭/切换、重复请求、FIFO 和草稿保护。
- test/native-shortcut-harness.cjs、shortcut-provider.cjs：仅开发测试用临时插件及 loopback 合成提供端，不进入 main.js 或正式插件安装包。

6 个相关测试文件 84/84 通过；类型检查、production build、mobile 静态兼容检查及定点 ESLint 通过。新增能力在稳定基线上的首次断言失败，实施后通过；去重超过 64 次的回归先失败后通过。

Windows Obsidian 1.15.0 中，最新构建与隔离安装文件哈希一致，原生断言 15/15 通过：空白、含 `/`/`#`/空白原文、去重、FIFO 历史保留、忙碌/审批/草稿保护、创建失败、切换/关闭、原 ask_user 连续交互、工作台实际按钮交接、默认浅/深色和 Blue Topaz。这里是真实原生聊天及持久化，仅模型响应由合成本机 OpenAI-compatible 提供端产生，不是生产模型/业务 Skill 验收。

Android 实机、真实个人 Skill/Memory/Knowledge MCP/图表生产组合仍待后续验收；本轮不发布、不接触正式业务记录。配套工作台需检查 shortcutApiVersion=1，未来先更新 Agentic Chat，再更新工作台；候选仍保持基线版本号，正式编号待联合审核后分配。
