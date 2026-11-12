# 思考与工具统一折叠测试说明

测试标签：0.51.22-thought-tool-summary-test.2。基于 feat/tool-call-summary，未改正式版号 0.51.22 或插件 ID agentic-chat。
Windows / Android 共用同一插件包，Obsidian >= 1.11.4，无需 APK。

## 修改与顺序

- src/ui/tool-call-group.ts：在原轮次控制器增加外层开关、思考项计数及综合状态。
- src/ui/assistant-bubble.ts：向展示控制器登记原思考 details 节点及完成状态。空状态占位不算思考，不产生空汇总。
- styles.css：增加原位隐藏类，复用原汇总的主题、换行和手机 44px 点击区域。
- test/tool-call-group.test.ts：增加 5 项外层、顺序、流式、边界和正文排除测试。
- test/e2e/specs/beautifului-polish.e2e.ts：补充历史顺序、外层计数与开关断言。
- .agents/skills/verify-obsidian-chat/features/chat-turn.md：更新验证入口。
- 本测试说明。

一条真实用户消息到下一条用户消息为同一轮，沿用原工具分组边界。
外层为逻辑组合容器：所有思考及工具节点保留原 DOM 位置，通过同一开关原位隐藏，避免搬移详情打乱顺序。
外层默认收起，计数为实际思考记录数加一组工具（若存在）。只有工具时沿用原汇总。
外层展开后，原思考 details 与工具汇总继续独立操作；再次收起外层不会重置内部展开状态。
最终回答节点不参与折叠。流式追加只更新已有控制器；失败和未完成状态保留，不显示为全部成功。
不改变模型、AgentService、MCP、执行、审批、持久化、Memory、Knowledge 或服务接口，无新增依赖。

## 测试结果及限制

修改前新增 witness 5 项失败，原 6 项通过；修改后 3 个相关测试文件共 19 项通过，0 失败。
TypeScript、E2E 类型检查、修改文件 ESLint、生产构建及移动静态兼容检查通过。
真实 Obsidian E2E 启动因下载 obsidian-versions.json 报 TypeError: fetch failed，0 项 UI 测试执行，未宣称实机验收通过。
Windows/Android 深浅主题、输入法、滚动与触摸仍需本次用户实测。此为 Pre-release，不是稳定版或 Latest。

## 安装与回退

建议使用独立测试 Vault，先备份 .obsidian/plugins/agentic-chat/。
解压 ZIP 得到 agentic-chat 文件夹，将其中 main.js、manifest.json、styles.css 复制到测试库 .obsidian/plugins/agentic-chat/。
Windows 关闭并重新启用插件；Android 使用能显示隐藏文件的文件管理器复制，然后完全重启 Obsidian。
只替换三个安装资产，保留 data.json、sessions 和其他已有设置。ZIP 内保留原 LICENSE。
回退时关闭插件并恢复备份三个文件，或使用原 test.1 / 正式 0.51.22 安装资源；不删除用户数据。

## 双端验收清单

1. 无思考/工具：无空汇总。只有思考：一个外层；只有工具：原工具汇总。
2. 思考 A → 工具 1 → 思考 B → 工具 2、3 → 思考 C：外层一个，计 4 项，内部工具计 3 次；展开后顺序保持。
3. 参数、长结果、错误内容、原复制/路径链接等交互完整；正文不被折叠。
4. 思考/工具运行中显示进行中，工具失败在外层可见；流式追加不重复计数、不强制收起。
5. 重新打开历史、切换轮次，默认收起且相互独立。
6. PC 鼠标和文字选择；手机触摸、长内容滚动、输入法、侧栏及返回；深浅主题无溢出。
