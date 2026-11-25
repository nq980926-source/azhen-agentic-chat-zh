# 本地知识库与按需 COS 照片：差异审查

日期：2026-11-24。基线：正式 0.51.27，5ed335919e396834a410386dcd18a1e2112bac1a。
GitHub releases/branches 已实时核对，默认 main 仍旧，不能作为本轮基线。

## 已存在

- 本地/腾讯云知识库双模式、本地精确编辑和版本冲突保护。保持原实现及默认值。
- 聊天图片输入、历史、草稿、Memory、DeepSeek 联网及独立工作台。保持原路径。
- cos-s2-04 工作树有浏览器摘要/Content-MD5、操作 ID、上传确认及隔离镜像实现；其基线为 0.51.26，未提交，不整包合并。
- cos-photo-s2-03 有 uploads/status/renew/complete/integrity-report/read-authorizations 服务接口。复用契约，不重写服务端。

## 缺口及最小范围

- 旧镜像为自动上传，仅支持 synthetic 身份和本机 Mock，且配置依赖手工文件。替换为显式逐次批准的独立照片入口，取消和普通识图不触发授权。
- 复用浏览器摘要代码；保留服务端操作 ID/confirmed 语义。客户端仅接收服务端 UUID，不从对象 Key 猜测。
- 新增照片设置、批准选择弹窗、受限 HTTPS 客户端、设备本地任务摘要、稳定引用渲染及有界内存缓存。
- 聊天增加一个保存按钮和一个照片申请工具。工具仅从当前会话原始图片取数据，不接收模型提供的 URL/字节；目标路径及缩略图逐次批准。模型仍用既有 read/write/edit 保存正文。
- Reading View 和聊天复用原生 Markdown 后处理；Source 保留文本。Live Preview 单独验证，不能从 Reading View 推断。

## 兼容与风险

- 原生自定义图片协议须在真实 Obsidian 探测，再决定是否用专用代码块。Android 真机结果必须由用户验收。
- 移动代码仅使用 Web/Obsidian API。SecretStorage 自 1.11.4 提供（已有最低版本），只保存 secret 名称；API 不可用时仅会话内 Token，不降级明文保存。两台设备分别配置。
- 为禁止重定向及支持中止，使用 fetch redirect:error/credentials:omit。跨端需要服务端和 COS 对 Obsidian 实际 Origin 正确配置 CORS；证书须由设备信任，不跳过验证。
- 缓存仅驻留内存，有总字节上限/生命周期，卸载释放 Object URL。不在 Vault、公开目录或同步目录保存照片缓存。
- 不改变 Memory、模型图片输入，不把原图放入新增工具结果，不新增同步。

## 生产变更须另行批准

源码 production.py 仅接受 isolated-test/s2-05/<UUID>/；TencentCosAdapter 也限制 isolated-test/。客户端正式前缀拟采用 private-photos/v1/，不能冒用隔离目录。

待批准方案：增加这一个正式前缀的严格 allowlist，CAM 仅允许该前缀 PUT/GET/HEAD（不开放删除/列举/ACL），保留原测试限制；独立元数据库或先备份现有数据库，保留 owner/photoId 映射；核对 TLS、授权端/COS CORS；先限单张 2 MiB、批次 8 MiB、日上传 16 MiB、日读取 40 MiB，再经批准短时开启三个开关验收，完成后按批准结果决定是否持续启用。

预计无新服务或 SDK 采购成本；COS 存储、PUT/GET/HEAD 请求及公网下行按实际量收费。客户端不新增预算承诺。正式启用前核实账户当期价格和预算；本轮零真实 COS 请求，不登录服务器，不读取密钥，不部署/重启/改 Nginx/ACL/CAM。

## 发布与回退

独立分支 feat/local-cos-05128，候选 0.51.28-photos-test.1，仅 Pre-release，不修改 Latest 0.51.27。附件 main.js/manifest.json/styles.css 与标准 ZIP，下载回验及 SHA256。BRAT Add beta plugin with specific version，仓库 nq980926-source/azhen-agentic-chat-zh，版本 0.51.28-photos-test.1。回退同入口选择 0.51.27，稳定 Markdown 引用保留，恢复支持本功能的插件后可显示；照片不会自动删除。

官方依据：[SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)、[编辑器扩展与 Reading View 分工](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Editor/Editor%20extensions.md)。
