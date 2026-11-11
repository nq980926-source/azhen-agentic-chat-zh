# DeepSeek 官方联网搜索开发报告

日期：2026-11-12。开发基线：源码提交 `f5ee32d`（manifest 0.51.19）。分支：`feature/deepseek-web-search`。

## 修改摘要

| 文件 | 修改原因 |
| --- | --- |
| `src/tools/web-search.ts` | 增加 DeepSeek 提供商；query 按 Unicode 码点限制 128；仅发送 query/count/need_content=false；summary 回退 snippet，保留原 URL，保持最多 10 条 |
| `src/tools/deepseek-web.ts` | 固定官方 Search/Fetch POST 端点、Bearer、JSON；统一安全错误，不回显服务响应或传输异常中的敏感信息；不自动重试 |
| `src/tools/web-fetch.ts` | 增加官方 Fetch；发送前校验目标 URL、白名单、长度及 URL 凭据；转换 Markdown；复用分页、正文限制、来源制品及外部输出包装 |
| `src/tools/web-tools.ts` | 仅 DeepSeek 提供商启用官方 Fetch，沿用 web.enabled 和原工具名称 |
| `src/settings-schema.ts` | 增加提供商到密钥引用的映射，不存储明文 |
| `src/secrets/secret-store.ts` | 切换时保存旧提供商的安全存储引用，加载新提供商独立引用；继续使用 web.searchApiKeySecretId 作为当前搜索密钥槽 |
| `src/settings.ts` | 原有下拉框增加 DeepSeek，切换时隔离凭据，显示搜索专用 Key 输入 |
| `src/i18n/zh-cn.ts` | 中英文说明明确搜索专用 Key，不使用聊天凭据 |
| `test/deepseek-web.test.ts` | 34 项模拟测试覆盖请求、响应、来源制品、分页、URL 防护、错误、密钥切换与存储 |
| `test/e2e/specs/settings-ui.e2e.ts` | 增加 DeepSeek 下拉选择、密钥隔离及切回恢复的 UI 断言（未实机执行） |
| `.agents/skills/verify-obsidian-chat/features/settings.md` | 更新入口与证据，修正本次设置文件行号变化造成的引用 |
| `docs/development/deepseek-web-delivery.md` | 本报告 |

未修改模型聊天协议、工具审批路径、版本号或发布标签。选择 DeepSeek 后，Search 和 Fetch 使用同一搜索专用 Key；未配置时明确报错，绝不回退到聊天 Key 或其他服务。

## 验证结果

- Witness：最初 1 项 DeepSeek 请求测试失败，原实现找不到适配器；实现后通过。
- `node node_modules/vitest/vitest.mjs run test/deepseek-web.test.ts test/web-search.test.ts test/web-fetch.test.ts test/web-tools.test.ts test/secret-store.test.ts test/settings.test.ts`：6 文件，131 项通过，0 失败，0 跳过。其中 DeepSeek 新测试 34 项。
- `npm run typecheck`：通过。
- `npm run typecheck:e2e`：通过。
- 对所有修改的 TypeScript 文件运行 ESLint：通过。
- `npm run build`：通过，包含 TypeScript、production bundle、release 检查及移动兼容静态检查。
- `git diff --check`：通过。
- 扩展全量测试：1819 项，1811 通过，7 失败，1 跳过；另有 3 个测试文件加载失败。涉及 check-feature-map、check-review-gate、witness-from-pr、provider-cache-live、worktree-script 五个文件，错误均为脚本导入时 SyntaxError。相同五文件在未修改的 f5ee32d 快照中复现相同 7 项失败及 3 个加载失败，不属于本次引入；未扩大范围修复。
- `node scripts/check-feature-map.mjs`：剩余 3 条 finance-and-charts 文档错误；同样在未修改基线复现。
- 全量机器报告：本地忽略目录 `logs/deepseek-full-tests.json`。未修改基线快照位于忽略目录 `logs/deepseek-baseline`。

没有将全量检查称为通过。未执行真实 Windows/Android UI 测试、真实 DeepSeek 付费请求或模型自主调用实测；已提交的 E2E 断言只通过类型检查。未安装插件。

## 安全与兼容

没有读取真实密钥、调用付费 API 或修改用户配置；测试仅用明显的合成 fixture。未修改 Memory、Knowledge MCP、云端工作台、生产服务器或现有安装。无新增依赖；通过目录 junction 复用已有 node_modules，未安装依赖。

继续使用原有 Obsidian 请求能力，不增加 DeepSeek 专用 Node 路径。Android 静态检查通过不等于 Android 实机通过；已有桌面代理限制仍适用。

请求体只包含所需搜索词或 URL；不附加 Memory、历史、本地文件或设备地址。Search/Fetch 的 Key 仅发送到固定官方 API，来源制品保留原始网页地址。现有 SSRF 防护仍是主机名/IP 字面量级别的尽力检查；客户端无法核查 DeepSeek 服务内部的重定向。

## Git 与后续安装包

本分支只提交本任务源码、测试和文档；不合并、不推送、不发布。构建生成的 main.js 保留在独立工作区，未加入提交，不覆盖正式安装或发布包。manifest 仍是基线版本号，因此此构建仅供审查，不应作为正式 0.51.19 包分发。

审查批准后，在独立分支确定新版本号并更新项目版本文件，重新执行正常构建，再把 main.js、manifest.json、styles.css 打包为同一插件目录；Windows 与 Android 共用这组文件。打包前检查不包含 data.json、sessions、artifacts、密钥或 node_modules。本轮没有生成安装 ZIP。

保留原始 0.51.19 Release/安装 ZIP 及校验值，后续升级前按原有安全方式备份插件设置和会话，回退时恢复旧插件文件并重载。旧版不识别 DeepSeek 提供商，回退后需检查网页搜索选项；不得假定旧版保留新凭据映射。不自动发布或安装。
