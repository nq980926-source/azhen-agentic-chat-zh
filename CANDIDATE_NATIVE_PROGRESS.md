# 原生进度与自主可视化候选审核

基线：b8fed45（feat/presentation-capabilities）；隔离分支 feat/native-progress。正式 0.51.24、云端工作台 0.1.15、Charts 3.9.0-zh.1 及原有工作树未提交修改保留。本候选未改版本号、未推送、未创建 Release。

## 最小实现
- 新增 src/ui/progress-block.ts；在 main.ts 通过现有 registerMarkdownCodeBlockProcessor 注册 agentic-progress YAML。使用独立语言名，避免占用通用 progress 名称。原聊天与笔记 MarkdownRenderer、重开历史均复用该处理器，不改聊天渲染框架。
- 模型仅提供 current、total 及可选 label、unit。程序统一计算一位小数百分比，原生 HTMLProgressElement 和文字共用结果；超额显示实际百分比，视觉填充最多 100%。不是字符拼接，也不是执行模型 HTML。
- 严格拒绝非数字、非有限数、负完成数、非正目标、缺字段、未知字段（含模型自填百分比）、非法标签/单位及不安全数值范围。块长度上限 2000 字符；标签/单位上限 200/40 字符。错误仅显示固定说明，不显示伪百分比。所有模型文本通过 text 节点写入。
- CSS 仅用 Obsidian 主题变量，保留原生可访问进度语义及 aria-valuetext。超额的辅助说明同时保留实际完成率。
- presentation-capabilities.ts 同时要求 owning Agentic Chat 已启用/加载，且实际代码块注册表中的对应处理器正是本模块的处理函数，才声明原生进度可用。Charts 仍逐语言读取；无轮询、无渲染探测。未知 Obsidian 注册表结构保守降级。
- 统一契约加入原生进度协议、优先于字符格子，以及“次数不能证明训练质量/技术/动作完成程度”的最小事实边界。不改用户系统提示词、业务 Skill、工具权限、Memory 或跨领域统计。

协议示例（语法示意，不是业务事实）：
```agentic-progress
label: 个人训练
current: 8
total: 12
unit: 次
```

组件只保证给定数字的呈现一致，不核验数字是否来自 Knowledge，也不控制组件外模型自行撰写的全部文字。

## 自动化、生产构建与原生验证
- 16 个相关测试文件：160 通过、1 跳过。跳过为原有 AZHEN_MEMORY_E2E_URL 未配置的 Memory 在线测试。类型检查、生产构建、release/mobile 静态检查、定点 ESLint 与 diff 检查通过。
- 确定性数值见 test/progress-block.test.ts：8/12→66.7%、6/10→60%、0/10→0%、10/10→100%、12/10→120%/填充100%；非法输入与标签数据边界均覆盖。红绿记录：空实现阶段 6 失败/16 通过，完成后 22/22 通过。
- 进度能力实际处理器/归属检测、缺失降级以及原有自定义提示词/Memory/Skill/快捷会话/审批相关回归通过。
- Windows Obsidian 1.15.0 隔离原生断言 8/8：原生新会话与 Charts 启停、两种 Charts 协议、五组进度值、无效输入与 HTML 外观标签、浅色/深色/Blue Topaz/260px、财务完整覆盖图文、原生 JSONL 历史关闭重开。
- 候选 main.js 与隔离安装文件逐字节一致。原生断言为 test/native-progress-probe.cjs 和已有 native-presentation-probe.cjs；测试驱动仅在隔离环境执行。

## 一组真实模型场景（未添加“画图”指令）
只运行一组，不按输出偏差反复加规则。A/B/C/G 使用明确给定的验收事实；D 使用真实模型、原财务工具和已有合成账本夹具的只读 I/O 替身，不能描述为真实个人账本验收。

| 场景 | 实际观察 |
| --- | --- |
| 今天个人训练练什么 | 自然清单，无强制图表 |
| 本月训练目标完成情况 | 主动输出两个 agentic-progress；原生显示 6/10 次·60%、8/12 次·66.7%，填充与组件数字一致，无字符格子 |
| 六个月训练次数变化 | 主动输出折线图并生成 Canvas；4/6/5/8/7/10 与输入一致，合计40、均值约6.7；明确只能分析频率，质量需要其他证据 |
| 本月不同类别支出 | 调用 azhen_finance_query，完整覆盖；原样保留工具 Markdown，环形图生成 Canvas |
| 无目标与记录的完成率 | 说明不足，无伪造进度或趋势，未越权查询 |

模型补充文字把 66.7% 整数舍入为 67%；程序控制的组件仍为 66.7%。这说明组件内部准确并不等于模型外部自然语言已受到确定性约束，不能宣称彻底消除模型输出风险。

## 财务图文同源的完整覆盖证据
新增 test/finance-presentation.test.ts 与 test/helpers/complete-finance-fixture.ts，复用既有财务工具测试中的合成账本（早餐0.10、午餐0.20、工资100.00、还款50.00、回填30.00）。生产财务工具与计算代码零改动。

- 实际原工具查询回执：coverage=complete，核验支出0.30 CNY、收入100.00 CNY；区间2026-11-01至2026-11-30。
- 图表类别顺序与 FinanceFact 用途一致，每项 chart value 与 amountMinor/100 一致，总和换回整数分后为30。
- 同一次工具回执的文字、JSON 图表、范围和单位一致；Windows 原生实际渲染 advanced-chart。
- 真实模型 D 场景对原工具完整 Markdown 和图表均逐字保留；金额/用途对照、日期和 CNY 单位核对通过。
- 以上是现有可信统计链的完整覆盖夹具验收，不是修改私人云端账本来制造完整数据。工具审批仍走原链，允许1次已知只读调用，无业务写入获批。

## Token、风险与发布判断
- 所有呈现能力启用时 2221 字符，约556 tokens；全部不可确认时1508字符，约377 tokens。字符数/4为估算，不是供应商计费 tokenizer；所有组合维持2600字符以内，不追加到历史，不增加二次模型判断或新工具往返。
- 非公开 Obsidian 处理器注册表仍为兼容风险，集中读取并保守降级；其他模型选择非确定性，不能将一次场景成功视为长期保证。
- Android 本候选尚未实机验收。需测试进度比例/超额/错误、浅深色与第三方主题、窄屏、历史重开及快捷新对话，确认 WebView 的 progress 样式和实际处理器状态。
- 当前具备提交 GPT 审核并考虑 Android Pre-release 的条件；本轮未发布，须等待审核授权。

## 本轮修改文件
生产：src/ui/progress-block.ts（新增）、src/main.ts、src/agent/presentation-capabilities.ts、styles.css。
测试：test/progress-block.test.ts（新增）、test/finance-presentation.test.ts（新增）、test/helpers/complete-finance-fixture.ts（新增）、test/native-progress-probe.cjs（新增）、test/presentation-capabilities.test.ts。
文档：本报告、finance-and-charts feature map。

私密运行配置、Memory/Skill 正文及模型会话均仅在仓库外隔离目录 E:/AI/azhen-obsidian/progress-candidate-20261113，不能作为发布附件。仓库内夹具仅含公开合成数据。
