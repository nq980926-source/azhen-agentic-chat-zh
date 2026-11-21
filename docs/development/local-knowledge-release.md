# 阿斟本地知识库测试版交付报告

版本：0.51.27-local-test.1（仅 Pre-release，等待用户实机验收）
基线：0.51.26 / c071cd7f961b268b163e90b25321aba49699bc8e
开发分支：feat/local-knowledge-05127。未从默认 main 分支开发，未修改腾讯云生产环境。

## 修改摘要

- 新增独立的本地知识库 / 腾讯云知识库设置。新安装默认本地；旧配置按原 Knowledge 写入边界保留位置，升级提示及设置说明明确显示迁移结果。切换不复制、迁移或同步任何文件。
- 本地模式不发现或注册已识别的专用 Knowledge MCP 文件服务，注册列表、执行前审批门禁及 MCP 工具闭包再次检查模式；旧历史调用和内部财务读取均受阻。其他 MCP 服务与联网搜索独立保留。当前专用 Knowledge 服务的工具均为文件或文件操作回执能力；未来增加的非文件能力须先明确分类，不默认放行。
- 本地使用原有 Vault 工具。创建拒绝覆盖；整篇替换必须 overwrite:true、完整当前读取和逐次审批。精确修改在 Vault.process 内核对完整读取内容并验证全部替换，任一失败即不落盘。正文、属性修改均检查读取后变化。
- 重复读取先读取当前内容；外部编辑或 Syncthing 更新会使旧内容缓存失效。删除回收站失败不再退回永久删除。移动、删除及整篇替换逐次审批，不提供记住允许。
- 拦截盘符、URI、控制字符、上级目录及歧义路径；标准 Windows 文件系统额外核对实际路径，拒绝指向 Vault 外的 junction/symlink。移动端先退出桌面检查，不加载 Node 文件模块。非标准桌面适配器无法证明边界时拒绝操作。
- 切换检查所有聊天标签、回合准备、工具/审批/写入、排队消息和会话切换；切换保存期间阻止新回合。清除工具、读取版本、Skill 加载状态和各标签的笔记/提示上下文缓存。聊天历史保留，历史文件正文须在当前模式重新核实。
- 本地不提供 azhen_finance_query，也禁止旧对象继续内部读取云端；云端模式保留原确定性统计；未配置云端服务时禁止退回本地写入正文。不增加本地财务计算器，不修改独立记账 APP。
- 业务 Skill 使用加载时的存储兼容适配。只替换已知 MCP 专属存储指令，保留教学、日记、练琴和统计规则。独立 azhen-business-skills 仓库文件及正式版本均未修改或发布；本轮不需要第二个 Skill 安装包。云端加载原始正文。
- Memory 的 /profile.md、/recent.md 云端注入及候选接口不变；联网搜索不随知识库模式关闭。未改写聊天历史格式、图片发送、折叠、滚动及云端工作台。工作台仍为独立手动云端插件。本地模式不是全离线 AI 或全离线 Memory。

## 自动化证据

| 检查 | 结果 |
|---|---|
| 正式版见证测试，修正测试适配器后在隔离基线上运行 | 8 失败、3 通过；候选同一组 11 全通过 |
| 3 个新增测试文件 | 39 通过、0 跳过 |
| 另增的 MCP 旧对象撤权、切换期间发送阻止 | 2 项通过 |
| 针对性综合回归 | 169 通过、1 原有跳过、0 失败 |
| 排除已确认的 6 个基线失败测试文件的全量回归 | 1933 通过、1 原有跳过、0 失败 |
| 不排除基线问题的完整套件 | 1940 通过、9 失败、1 跳过；9 个失败断言与基线逐项相同 |
| 正式版完整套件 | 1899 通过、9 失败、1 跳过 |
| 真实 Obsidian 1.15.0 Windows | 4/4，通过设置下拉框切换、后台标签阻止、原生 Vault 冲突、准备/排队阻止和缓存清理 |
| 同一应用的 emulate-mobile 模式 | 4/4；不等于真实 Android 设备 |
| 原有通用 smoke 脚本 | 候选和正式版同为 8 通过、4 失败，失败场景完全相同 |
| 类型检查、e2e 类型检查、修改范围 lint、Obsidian lint | 通过 |
| 生产构建、发布结构检查、移动兼容检查 | 通过 |
| Feature map | 10 journeys / 227 rows / 410 refs 通过；更新引用并纠正原有 unit-only 行的覆盖标记 |
| 静态上下文 eval / 基线比较 | 0 error、0 warning；无回归 |

已确认的 6 个基线失败文件：check-feature-map.test.ts、check-review-gate.test.ts、plugin-sweep-recovery.test.ts、provider-cache-live.test.ts、witness-from-pr.test.ts、worktree-script.test.ts。未修改其无关实现来制造全绿。
原有跳过为 Windows 下的隔离 Python Memory 后端 AgentService 联调；Memory 契约与注入回归继续通过，未访问真实云端服务。
原通用 smoke 的 4 个失败：/help、/dirs 的文案断言、旧 memory-manager 流程、plan-tracker 流程；正式版复现一致。全仓 lint 还有未修改的历史脚本/财务文件问题；本轮修改范围 lint 通过。

隔离证据：本地资源加载测试的 Knowledge 网络请求计数为 0；模型注册表无 Knowledge 文件工具和 azhen_finance_query，保留 web_search、fetch_url、Memory 与无关 MCP；旧 MCP 对象执行在 RPC 前被拒绝；旧财务对象执行未调用 getMcpTools。实际云端模式测试使用协议模拟，不操作腾讯云生产数据。

## 已知边界及回退

- 真实 Android、真实 Syncthing 双设备同步、实际模型完成整轮日记/教学任务，等待用户验收。自动化不是实机验收。
- 本地模式不提供确定性财务汇总及图表；需要时由用户在空闲状态选择腾讯云知识库。
- 本地文件必须已经存在于当前 Vault。缺失时报告，不自动读取或复制云端副本。
- 不合并 Syncthing 冲突副本，不提供跨设备事务；只对本设备当前文件进行版本检查与原生 API 写入。
- 标准 Android/Windows 路径受支持；外部符号链接不是知识库入口。自定义桌面适配器可能被安全拒绝。
- 整篇覆盖需要完整读取；大型日记优先分段读取并精确修改，不应为追加而整篇重写。
- Memory 仍需网络；COS 继续搁置，未上传、删除或迁移任何照片。
- 正式版 0.51.26 和其附件保留。可在 BRAT 选择该版本回退；MCP 配置、原云端规则和成果未删除。本轮不发布正式版。

## Android 实机验收

1. BRAT 在仓库 nq980926-source/azhen-agentic-chat-zh 选择 0.51.27-local-test.1 安装；核对设置版本。
2. 设置 → Agentic Chat → Agent → 知识库工作模式选择“本地知识库”。旧云端用户升级后保留云端，需要主动选择本地。
3. 让 AI 在明确指定的本地测试目录创建一篇日记，检查 Obsidian 文件列表和正文。
4. 追加一段，再只修改其中一句；检查原有正文、格式和同名文件未被覆盖。
5. 搜索一段教学正文，跨两份本地文件读取并总结，核对来源路径。
6. 让 AI 先读取测试文件，用 Obsidian 修改其中另一段，再要求继续精确修改；应提示版本冲突，重新读取后才可继续。
7. 查看工具记录：没有 Knowledge MCP 文件调用、没有 azhen_finance_query；请求财务汇总时应说明本地暂不可核验，不能伪造统计。
8. 测 DeepSeek Search/Fetch、Memory 已确认上下文、图片发送、思考/工具折叠、输入与滚动、旧聊天历史。
9. 打开两个聊天标签，在一个执行或等待审批时尝试切换，应拒绝。结束后切换腾讯云，检查原有云端能力；再切回本地。
10. Windows 测基本创建、检索和精确修改。经现有 Syncthing 同步测试 Markdown，核对两端内容及冲突情况；插件不负责同步。

请反馈结果与失败时的版本、模式、目标路径和工具错误文字；无需提供密钥。未验收前不会转正式版。

## 实际修改文件

以下为相对上述完整基线的代码、测试、元数据和验证文档清单。生成的 main.js、styles.css 作为 Release 附件交付，不把运行数据、账户配置或测试 Vault 纳入提交。

- `.agents/skills/verify-obsidian-chat/features/README.md`
- `.agents/skills/verify-obsidian-chat/features/approval-and-permissions.md`
- `.agents/skills/verify-obsidian-chat/features/chat-turn.md`
- `.agents/skills/verify-obsidian-chat/features/commands-and-skills.md`
- `.agents/skills/verify-obsidian-chat/features/finance-and-charts.md`
- `.agents/skills/verify-obsidian-chat/features/local-knowledge.md`
- `.agents/skills/verify-obsidian-chat/features/mcp-and-oauth.md`
- `.agents/skills/verify-obsidian-chat/features/open-and-compose.md`
- `.agents/skills/verify-obsidian-chat/features/sessions-and-tabs.md`
- `.agents/skills/verify-obsidian-chat/features/settings.md`
- `.agents/skills/verify-obsidian-chat/features/subagents-and-context.md`
- `README.md`
- `docs/development/local-knowledge-release.md`
- `manifest.json`
- `package-lock.json`
- `package.json`
- `scripts/verify-mobile-compat.mjs`
- `src/agent/agent-service.ts`
- `src/agent/knowledge-mode.ts`
- `src/agent/prompt-turn-runtime.ts`
- `src/agent/runtime-resource-state.ts`
- `src/agent/runtime-resources.ts`
- `src/agent/subagent-runtime.ts`
- `src/agent/tool-call-controller.ts`
- `src/main.ts`
- `src/mcp/tools.ts`
- `src/settings-schema.ts`
- `src/settings.ts`
- `src/skills/knowledge-storage.ts`
- `src/tools/azhen-finance-tools.ts`
- `src/tools/vault-tool-definitions.ts`
- `src/tools/vault-tools.ts`
- `src/tools/web-fetch.ts`
- `src/tools/web-tools.ts`
- `src/ui/approval-modal.ts`
- `src/ui/chat-view.ts`
- `src/vault/path.ts`
- `src/vault/physical-boundary.ts`
- `src/vault/read-memo.ts`
- `test/agent-service.test.ts`
- `test/azhen-finance-tools.test.ts`
- `test/e2e/specs/local-knowledge.e2e.ts`
- `test/local-knowledge-files.test.ts`
- `test/local-knowledge-isolation.test.ts`
- `test/local-knowledge.test.ts`
- `test/mcp-tools.test.ts`
- `test/mocks/obsidian.ts`
- `test/prompt-turn-runtime.test.ts`
- `test/runtime-date-context.test.ts`
- `test/runtime-resources.test.ts`
- `test/tool-call-controller.test.ts`
- `test/vault-tools.test.ts`
- `versions.json`
