# COS 正式目录启用提案（待单独授权，未执行）

日期：2026-11-25。此文件是审批材料，不是生产配置或部署脚本。

## 当前证据与边界

用户已提供隔离测试目录 PUT/confirmed/GET/哈希成功的证据，并说明三个开关已经关闭。本轮只读取本地服务源码，未登录 Lighthouse、未查询真实凭据、未请求生产照片接口或 COS。

现有 `production.load_config` 只接受 `isolated-test/s2-05/<UUID>/`，`TencentCosAdapter` 也只接受 `isolated-test/`。新客户端仅接受正式前缀 `private-photos/v1/`，会拒绝隔离前缀的 COS 授权地址。目前不能直接启用正式照片存储。

## 建议单独批准的最小变更

| 项目 | 必要变更 | 限制与回退 |
|---|---|---|
| 服务代码 | 在现有前缀校验中增加这一个正式前缀；保留原隔离限制。沿用现有六个接口及服务端 photoId/owner/operationId 映射 | 不重写服务，不迁移 Markdown；生成的完整路径为 `private-photos/v1/photos/v1/<ownerHash24>/<photoId>/original.<ext>` |
| CAM | 对正式前缀和实际 owner 子目录单独设置 PUT/GET/HEAD 窄授权。旧隔离权限是否保留由用户决定 | 不增加列举、删除、ACL 管理或桶管理权限，不改公开读；不直接把测试前缀当正式目录 |
| 状态 | 备份现有元数据库并验证可恢复，正式环境继续保留操作 ID 和 photoId 映射 | 不清空现有数据库或对象，不伪造旧 photoId，不自动删除上传后未插入笔记的对象 |
| HTTPS/CORS | 验证现有 IP 证书能被 Windows/Android 信任；对照片接口和 COS 配置必要 CORS，支持 OPTIONS 和实际签名所需的 PUT 请求头 | 本客户端使用可中止且 `redirect:error` 的 fetch，不能用忽略 TLS 或自动跳转绕过。仅批准实测 Obsidian Origin，凭据使用独立 Bearer Token；如需证书、域名或 Nginx 变更，先提供具体差异再批准 |
| Token | 用户通过 Obsidian SecretStorage 在两台设备分别配置照片服务独立 Token | 不复用 Knowledge MCP/Memory/COS 密钥，不在插件 data.json 或 Markdown 保存 Token。无 SecretStorage 时只在当前会话内存保存 |
| 开关 | 经批准的窗口内开启 uploads/reads/HEAD，执行限额验收，结束后恢复关闭 | 持续开放必须由用户另行明确批准；不因客户端开关而改变服务端开关 |

## 首次真实验收的建议硬上限

仅用 2 张程序生成的非个人 PNG，各不超过 128 KiB；不使用用户真实照片。总 PUT 不超过 2 次、HEAD 不超过 4 次、GET 不超过 4 次（重试计入），授权接口请求不超过 12 次，总上传不超过 256 KiB，总下载不超过 512 KiB。达到任一上限或出现权限/证书/数据完整性异常即停止，不自动重试或扩大范围。

先验证两端相同 photoId 的阅读视图，再验证一次拒绝/取消，以及本地笔记保存失败后的引用重试。测试后的开关状态、对象保留与测试对象清理须按用户的单独批准执行；本轮没有删除权限或删除客户端代码。

## 成本

不新增 Lighthouse 实例或独立相册服务。新增费用来自 COS 原图存储、PUT/GET/HEAD 请求和公网下载；缓存仅在内存，重启或过期会重新下载。真实测试前核实账户当期计费和预算通知，不以旧价格估算费用。本轮只用 Mock，实际 COS 存储/请求/流量费用为零。

## 尚未完成

正式目录有效权限、真实 CORS/TLS、真实 confirmed、真实 Android/Windows 跨端读取及长期使用验收均未完成。不得将本轮 Mock 成功当作上述项目成功。
