# 自主呈现能力候选审核报告

基线：正式 0.51.24（7414a35）；分支 feat/presentation-capabilities。仅本地候选，未推送、未发布、未改版本号。

## 实现与边界
- 新增 src/agent/presentation-capabilities.ts，集中读取 Charts 状态并生成一份有界的能力契约。
- runtime-resource-state.ts 每次组合请求上下文时读取当前状态；runtime-resources.ts 通过现有 overlay 参数传递。用户基础提示词、日期、Memory、Skill、模式等仍按原方式组合。
- 必须同时满足：obsidian-charts 在启用集合内、插件实例存在且未标记未加载、MarkdownPreviewRenderer.codeBlockPostProcessors 中对应语言为自有函数。两种格式逐项确认。无注册表、未知结构、异常或停用均保守返回不可确认。无缓存、轮询、监听器、渲染探测或写操作。
- 该处理器注册表未列入 Obsidian 公开类型，是集中隔离的兼容性风险；已在 Windows Obsidian 1.15.0 实测其结构和启停变化。Android 尚未验证候选。
- 能力契约说明：普通文字/列表/表格/数字/文本进度无需 Charts；模型按问题自主选择趋势、比较或构成图；包含当前 Charts 两种内联格式的最小语法样例；不宣称热力图、原生卡片/进度组件或任意 HTML 安全性。样例明确标为语法示意，不是业务事实。
- 数字来源、目标/分母、缺失日期、范围单位及 FinanceFact 同源原则仅作为能力使用约束；不增加跨领域统计或声称模型输出具有确定性保证。
- 未修改原生快捷接口、消息发送/审批、财务工具与计算、Memory、Skill、Charts、云端工作台或任何正式配置。

## 自动化与构建
- 14 个相关文件：136 项通过，1 项原有 Memory 在线测试因 AZHEN_MEMORY_E2E_URL 未配置而跳过（不是本次新增测试）。
- 新增 6 项自动化断言：运行状态、格式缺失/未知结构、异常降级、长度边界、语法及用户/日期/Memory/Skill 保留；包含当前状态启用→停用→恢复。
- 红绿证据：新增上下文断言在基线失败（缺少 Charts 能力块，5 通过/1 失败），实现后通过。
- 类型检查、生产构建、release/mobile 静态检查、定点 ESLint 与 diff 检查通过。
- Windows 原生断言 3/3：原生新会话保留自定义提示词和实时启停能力；chart YAML 实际生成 Canvas；advanced-chart JSON 实际生成 Canvas。可复用断言为 test/native-presentation-probe.cjs；未更改 Charts 处理器。

## 一次真实模型 A–G 验收
使用现有实际模型配置和原生新会话。A/B/C/F 使用明确给出的合成验收事实；E 为普通知识；G 明示数据不足；D 使用现有真实只读财务工具。没有向测试问题追加图表格式说明（F 本身明确要求柱状图）。没有二次判断模型，没有调整契约后重试答案。

| 场景 | 实际结果 | 判定 |
| --- | --- | --- |
| A 普通训练安排 | 自然清单，无图表 | 通过 |
| B 月度目标进度 | 正确给出 8/12≈67%、6/10=60%，自动输出比较柱状图和文本条；柱状图与原始次数一致，但第一条字符条为 6/10 格却标 67% | 部分通过，文本条不满足严格图数一致 |
| C 六个月趋势 | 自主输出折线图；序列 4、6、5、8、7、10 与给定数据一致；合计 40、均值约 6.7 正确 | 核心通过；“最完整的一个月”等评价超出次数本身能证明的范围 |
| D 财务类别 | 读取财务 Skill 并调用 azhen_finance_query；返回 partial 覆盖，未画图；模型用表格重述，支出总额、各用途金额与 FinanceFact 核对一致，保留覆盖不完整提示 | 只读统计与保守呈现通过；完整财务图文同源的实时场景未验收；也未做到逐字保留工具 Markdown |
| E 普通知识 | 自然回答，无强制图表 | 通过 |
| F 明确要求 | 柱状图真实渲染，2/4/3 正确、零基线 | 通过 |
| G 缺少目标与记录 | 拒绝计算完成率/趋势，无编造图表 | 通过 |

Windows 实际运行中 B/C/F 均生成聊天 Canvas。原审批链允许 2 次已知只读操作；无写入审批、无未知操作批准。正式业务记录未修改。私密模型回答、配置、账本结果和加密测试配置均留在仓库外，不进入候选提交。

## 成本与结论
- 全格式启用：1671 ASCII 字符，约 418 tokens；不可用：1263 字符，约 316 tokens。估算采用字符数/4，不是供应商实际 tokenizer/计费值。所有布尔组合不超过 2600 字符，无历史累加；不增加模型判断请求或工具往返。
- 具备候选送审条件，但不得宣称 A–G 全部通过或自主选择已稳定。B 的字符条刻度、C 的过度评价、D 的 Markdown 重述说明模型约束仍非确定性保障；未追加规则以追求通过。
- 当前不建议以“全部验收通过”直接进入 Android 测试发布。请 GPT 审核上述限制及是否允许受限 Pre-release；本轮停止，无发布。Android、未知 Obsidian 注册表结构和其他模型仍未验收。

## 文件
生产：src/agent/presentation-capabilities.ts（新增）、src/agent/runtime-resource-state.ts、src/agent/runtime-resources.ts。
测试：test/presentation-capabilities.test.ts（新增）、test/runtime-resource-state.test.ts、test/mocks/obsidian.ts、test/native-presentation-probe.cjs（新增）。
文档：本报告与 finance-and-charts feature map。稳定工作树及其原有未提交修改保留。

本地证据位于 E:/AI/azhen-obsidian/presentation-live-20261113，报告仅记录不含私人正文的观察；真实业务数据不会随代码公开。
