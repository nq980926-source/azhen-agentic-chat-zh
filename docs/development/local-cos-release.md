# 0.51.28-photos-test.1 客户端测试交付

日期：2026-11-25。仅 Pre-release。基于正式 0.51.27（5ed335919e396834a410386dcd18a1e2112bac1a），未合并或覆盖旧 main，Latest 正式版继续为 0.51.27。

**本轮没有生产操作或真实 COS 请求。已完成客户端与 Mock 验证，不代表正式照片目录或 Android 真机已接通。Live Preview 尚不支持照片显示，请切换 Reading View。**

## 修改摘要

- 新增默认关闭的照片客户端设置。凭据使用已有 SecretStorage，仅保存 secret 名称；不支持时仅会话内存，不写 data.json。当前 HTTPS 接口和广州私有桶/正式前缀固定校验，不能随意填写转发地址。
- 复用旧镜像的浏览器 SHA-256/Content-MD5 及服务端六接口契约；不合并旧 0.51.26 文件架构或自动镜像入口。普通图片聊天不调用照片服务，识图原图只走原有模型输入一次。
- 聊天图片的“保存照片至 COS”和 AI save_photos 共用本次未勾选的逐张确认；支持批量选择和取消。YOLO/旧历史工具调用不能绕过照片批准或本地模式检查。原图仅来自可识别的当前会话用户消息，不接收模型传入的字节、URL 或对象 Key。
- 每张最多 2 MiB，每批最多 4 张。操作 ID 在请求前保存到设备本地摘要，失败重试仍需批准且复用操作 ID，无自动重放；不持久化新增图片副本、Token、授权 URL 或笔记正文。
- 只有服务器 confirmed 才生成稳定 photoId 引用。上传失败不生成引用；原聊天和日记文字保留。写笔记失败保留已上传状态，可重试插入，不删除 COS 对象。
- 插入目标为完整 Vault 相对路径；已有 read/edit/write 工具负责精确追加、全文版本校验、路径/物理边界和 I/O 错误。重复 photoId 不重复追加，不整篇重写已有日记。AI 日记正文仍用原有本地工具和审批。
- 原生 Markdown 后处理负责 Reading View 和聊天原位置显示。缓存只在内存，最多 24 MiB，闲置 5 分钟回收，同时最多 32 个显示引用、2 个网络读取；重复引用共用 Blob URL。切换视图、卸载和清理时释放资源。离线/失败显示占位与重试，过期 GET 最多刷新一次。
- HTTPS、固定主机/区域/前缀、方法、签名头、有效期、大小及 SHA 校验；禁止重定向、环境 Cookie 和磁盘 HTTP 缓存；只向固定授权服务发送独立 Token。异常只暴露固定错误码。

## 保留的能力与隔离证据

本地 Vault 文件工具、knowledge-mode 隔离规则、Memory 客户端、web search/fetch 源文件均无修改。没有 Markdown 到 COS/Knowledge MCP 的新增路径，没有新增同步或第二知识库。腾讯云原配置及双模式保留，照片上传工具仅注册于本地模式，并在执行时再次检查；照片任务准备/批准/上传期间禁止知识库模式切换。

思考/工具折叠、图片发送和历史逻辑未重构；聊天仅增加每条图片消息的保存入口。Memory、DeepSeek 和财务工具不改存储路径。独立工作台代码未修改：其本地入口沿用原生 file-explorer/笔记视图；独立云文件阅读器另用 MarkdownRenderer，不能当作本地文件入口或云端回写路径。

## 验证结果

| 检查 | 结果 |
|---|---|
| 新功能 witness | 正式基线 1 项断言失败；候选同一断言 1 项通过。首次缺模块的加载失败不计合格 witness |
| 新增单元用例 | 49 项，全部通过 |
| 照片/本地知识库/Memory/联网/普通图片/快捷入口回归 | 192 passed，0 failed，0 skipped |
| 全套对照 | 基线 1940 passed / 9 failed / 1 skipped；候选 1989 passed / 9 failed / 1 skipped，9 个失败断言逐项相同，新增回归为 0 |
| 排除基线六个失败文件的广泛回归 | 1982 passed，0 failed，1 原有 skipped |
| Windows Obsidian 1.15 | 13/13（照片 9、本地知识库 4），脚本模型和 Mock COS |
| Obsidian 1.15 移动端模拟 390×844 | 同样 13/13；不等于 Android 真机 |
| 类型检查 | 主工程及 e2e 均通过 |
| Lint | 所改文件常规 lint 通过；照片模块 Obsidian lint 0 errors / 2 warnings，见下文 |
| 上下文静态 eval | 1 case，0 errors / 0 warnings；与已验收本地模式基线比较无回归。不代表真人模型测试 |
| 生产构建/版本/移动兼容 | npm run build 通过，发布包不含 e2e 模型脚本钩子 |

基线失败文件：check-feature-map.test.ts、check-review-gate.test.ts、plugin-sweep-recovery.test.ts、provider-cache-live.test.ts、witness-from-pr.test.ts、worktree-script.test.ts。本轮不扩大范围修复。原有 skipped 是隔离 Python Memory 集成；没有把跳过计为通过。

两个 Obsidian lint 警告：使用 fetch 是为支持 AbortSignal 和 redirect:error（原生 requestUrl 无此控制，正式启用需 CORS）；使用 ownerDocument.createElement 是标准的多窗口安全 DOM API。没有禁用检查规则或跳过类型错误。

## 视图兼容矩阵

| 视图 | Windows / 移动端模拟观察 |
|---|---|
| Reading View | 原位置显示、重复引用、离线占位、重试和文件切换通过 |
| Agentic Chat | 现有 MarkdownRenderer 显示稳定引用和多图，不再向模型发送原图 |
| Source Mode | 原始引用文本保留，笔记可编辑 |
| Live Preview | 已单独检查：原生图片部件保留自定义协议，未显示 COS 图片（renderedPhotos=0），本候选不提供编辑器扩展；请用阅读视图看图 |
| 独立工作台 | 本地文件入口通向 Obsidian 原生文件视图；本轮未发布或实机验收独立工作台版本 |
| Android 真机 / 真实 COS | 待单独授权的服务启用与用户实机验收，不以 Mock 替代 |

## 安装、验收和回退

预发布地址：https://github.com/nq980926-source/azhen-agentic-chat-zh/releases/tag/0.51.28-photos-test.1

在 BRAT 使用 Add beta plugin with specific version（已有安装使用指定版本更新），仓库 nq980926-source/azhen-agentic-chat-zh，版本 0.51.28-photos-test.1。不需要复制或编译插件文件。插件 ID 仍为 agentic-chat，最低 Obsidian 1.11.4，两端使用相同附件。普通 Latest 更新不会被本预发布覆盖。

当前可先验收：本地笔记创建/修改、普通图片识图不自动上传、原有聊天/草稿/折叠/Memory/联网正常。不要把当前服务开关仍关闭时的授权失败视为已接通。

服务端经单独批准启用后，Android/Windows 验收：

1. 两台设备分别通过 SecretStorage 配置照片服务 Token；不在聊天中发送 Token。
2. 普通发送 2 张经批准的测试图片，只识图，确认无 COS 上传。
3. 选择保存后先取消，确认无授权和 PUT；再只勾选其中 1 张确认，检查 confirmed 与数量一致。
4. AI 写本地日记并配图，或在结果页输入完整现有笔记路径追加；正文和格式保留，引用只含 azhen-photo photoId。
5. 按既有 Syncthing 方案同步 Markdown，在另一设备 Reading View 打开同一日记，显示同一照片。
6. 断网后正文可读、图片占位；恢复网络点击重试；连续消息、标签切换、Android 键盘/滚动/保存正常。
7. 重开历史、重试保存或重复插入，确认不重复上传或插入；模拟写入冲突后照片状态与引用仍可恢复。
8. 检查本地/云端隔离、Memory 和 DeepSeek 仍按原规则运行。

回退：BRAT 指定正式 0.51.27（也保留更早 0.51.26）。不会自动迁移或删除笔记/照片；老版本不解析照片协议，原始引用仍保留，回到支持此功能的版本后可继续读取。

生产所需独立授权及请求/字节上限见 [正式启用提案](photos-production-proposal.md)，初始差异见 [差异审查](local-cos-review.md)。未经实机验收不发布正式版。

## 实际变更文件

已有功能源码改动限于可选工具注入、照片设置和图片消息按钮。其余既有 feature-map 文件仅随源代码行号变动更新锚点。完整清单：

```text
.agents/skills/verify-obsidian-chat/features/README.md
.agents/skills/verify-obsidian-chat/features/approval-and-permissions.md
.agents/skills/verify-obsidian-chat/features/chat-turn.md
.agents/skills/verify-obsidian-chat/features/commands-and-skills.md
.agents/skills/verify-obsidian-chat/features/local-knowledge.md
.agents/skills/verify-obsidian-chat/features/mcp-and-oauth.md
.agents/skills/verify-obsidian-chat/features/open-and-compose.md
.agents/skills/verify-obsidian-chat/features/photos.md
.agents/skills/verify-obsidian-chat/features/sessions-and-tabs.md
.agents/skills/verify-obsidian-chat/features/settings.md
.agents/skills/verify-obsidian-chat/features/subagents-and-context.md
README.md
docs/development/local-cos-release.md
docs/development/local-cos-review.md
docs/development/photos-production-proposal.md
manifest.json
package-lock.json
package.json
src/agent/agent-service.ts
src/agent/runtime-resource-state.ts
src/agent/runtime-resources.ts
src/main.ts
src/photos/cache.ts
src/photos/client.ts
src/photos/digests.ts
src/photos/modals.ts
src/photos/renderer.ts
src/photos/runtime.ts
src/photos/settings.ts
src/photos/tasks.ts
src/photos/tool.ts
src/settings-schema.ts
src/settings.ts
src/ui/chat-view.ts
styles.css
test/e2e/specs/photo-syntax.e2e.ts
test/e2e/specs/private-photos.e2e.ts
test/mocks/obsidian.ts
test/photos-settings-witness.test.ts
test/photos/boundary.test.ts
test/photos/insertion.test.ts
test/photos/photos.test.ts
versions.json
```
