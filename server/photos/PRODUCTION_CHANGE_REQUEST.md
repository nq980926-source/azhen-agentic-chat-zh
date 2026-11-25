# 一次性生产变更审批单：阿斟日常私有照片 RC.1

状态：待明确批准；没有执行本单任何生产写入。候选版本 `0.51.28-rc.1`。

目标：本地 Markdown 保持本地，批准后保存原图到正式私有 COS，跨设备打开笔记自动显示。取消临时单图窗口作为交付流程。

## 精确变更

| 项目 | 批准后具体操作 | 影响与回退 |
|---|---|---|
| COS 正式命名空间 | 仅启用 `azhen-photos-1301105804` / `ap-guangzhou` 中的 `private-photos/v1/`，完整对象键为 `private-photos/v1/photos/v1/<ownerHash24>/<photoId>/original.<ext>`。首张正常保存自然产生对象，不创建空占位文件 | 不迁移或删除隔离照片。停止新授权即可停用；已有对象与 photoId 保留 |
| CAM | 给现有受限照片身份新增附件 `deploy/cam-production-addition.json` 的 Allow：仅该正式前缀上的 PutObject、GetObject、HeadObject | 不授予 DeleteObject、ListBucket、管理 ACL、其他目录或管理员权限。保留原隔离权限用于旧读取与回退。回退只撤销这次新增策略关联 |
| COS Bucket CORS | 保留已保存的 `http://localhost` 规则，只新增 `app://obsidian.md` 的 PUT/GET、相同 6 个指定请求头、300 秒缓存；不增加 `*` 或 credentials | Bucket 保持私有；CORS 不代替权限。回退只撤销本次新增 Origin 规则，不重写其他规则 |
| Nginx 照片 CORS | 仅在 `/etc/nginx/conf.d/azhen-mcp-access.conf` 既有照片 A2 标记块内增加 Windows Origin，保留其他字节、响应头及路由。两种准确 Origin 的 OPTIONS 为 204，其余为 403，GET/POST 业务接口继续认证；首次配对 POST 使用一次性码验证 | `nginx -t` 成功才 reload。备份并可恢复原文件，不修改 Memory/MCP 的 location。共享 Nginx reload 是影响面的一部分 |
| 照片服务代码 | 安装到 `/opt/azhen-photo-auth/releases/0.51.28-rc.1`，沿用原服务用户和原 SQLite 目录，独立 venv 使用现有固定版本 SDK/依赖 | 仅新增照片服务 drop-in `azhen-photo-auth.service.d/50-photos-production.conf` 指向新 release，不覆盖原 unit。回退恢复原 drop-in/执行路径 |
| 正式运行配置 | `/etc/azhen-photo-auth/config.json` 合并 `deploymentMode: production`、正式 prefix 和三个开关长期 true；原 Bucket、Region、owner、stateDirectory、credentialsFile、端口全部保留 | 原始配置备份、SHA 核验，写入失败/健康失败回退。不是 15 分钟限时。原 SDK 继续在服务端读取已有密钥；本次不轮换、导出或下发 COS 密钥 |
| 实际限额 | 每张 10485760 字节；每批 4 张、41943040 字节。日上传 100 张及 1073741824 字节，日读取授权预留 4294967296 字节 | 相比隔离服务的 2/8 MiB、日 8 张/16 MiB、日读 40 MiB 明确扩大，纳入本次批准。保持并发、期限、幂等、MD5/HEAD/SHA 检查。不扩大仅收 JSON 的 32 KiB 接口 |
| 设备配置 | 使用同一业务 owner 下每设备独立、可撤销的随机凭据；后端仅存摘要。一次性 80 bit 配对码 10 分钟有效，失败尝试也计入每分钟 10 次的全局配对限速 | 用户只在各设备照片设置输入配对码，不查看 Token。管理终端生成码，禁止发到聊天。正式模式停止接受原共享客户端 Token；COS SDK 密钥保留原样 |
| 进程持久化 | 仅 enable/restart `azhen-photo-auth.service`，失败自动重启。停用旧 `azhen-photo-live-a3-close.timer/.service`，保留旧文件和成果 | 防止旧临时任务误关正式服务。不重启 Lighthouse 整机、Knowledge MCP 或 Memory |
| 证书续期 | 复用当前 `106.55.92.40` 的现有 Certbot/acme.sh 证书、账户和配置，不新造域名/ACME 账户。新增 `azhen-photos-tls.service/.timer`：每 12 小时检查，剩余不足 48 小时才续期，失败 30 分钟重试；成功后先 nginx -t 再 reload | 脚本先识别当前证书和可安全复用的非停服挑战方式，不能确认时在变更配置前停止。不会自行配置 DNS、向 Codex 提供或输出私钥、或停 Nginx；签发密钥仍由现有 ACME 客户端在服务器内使用。证书共享入口的 reload 会影响同 IP 的 TLS 呈现，路由保持原样；不回滚到过期证书 |
| 元数据备份 | 部署前以原服务账户做 SQLite backup API 一致性快照到私有变更备份；新增 `azhen-photos-backup.service/.timer` 每日备份到原 stateDirectory/backups，保留最近 30 份，部署时立即做一份 | 不复制正在使用的裸 DB 而忽略 WAL；不备份原图/真实 SDK 密钥。只清理该备份目录内超过保留数的本程序快照，不删除主数据库、COS 对象或本地日记 |

## 管理员实际操作顺序

批准本单后，先在腾讯云控制台保存原策略和 CORS 快照，并只读确认正式前缀不受现有自动到期删除规则影响。若存在覆盖正式前缀的生命周期删除规则，停止相关部署，不猜测或擅自修改规则；本单不授权对象删除、迁移或未列明的生命周期改动。

1. CAM → 策略 → 创建自定义策略 → 按 JSON 创建：使用 `cam-production-addition.json`，关联到已经使用的受限照片身份。不要替换它的其他策略，不给它 CAM 管理权限；若有显式 Deny 阻止正式前缀，停止报告，不自动扩权。
2. COS → 现有私有 Bucket → 安全管理 → 跨域访问：保留 Android 规则，新增 `cors-production.json` 中准确的 Windows Origin 及方法、请求头。不要改 ACL；控制台若拒绝指定 Origin，则停止，不改成通配符。
3. 使用 Release 固定服务包 + SHA-256 校验命令运行 `deploy/manage.py apply`。脚本自动准备 venv、校验旧配置和现有续期配置、备份、合并、验证、重启及开启持久任务；不要求用户编辑代码或配置文件。
4. 仅出现 `PHOTO_PRODUCTION_READY_NO_OBJECT_REQUESTS` 才认为部署成功。设备配对就绪不代表已经上传真实照片，不用模拟照片补充这个状态。
5. 管理终端对每台设备各运行一次 `deploy/manage.py pair`，配对码只输入该设备插件设置。BRAT 更新本候选版后即可正常使用，不安排临时小图、Mock 或额外用户回归清单。

部署脚本不会调用 COS PUT/GET/HEAD 来制造验收对象。管理员运行的配对码命令会在其自己的 FinalShell 显示一次性码，Codex 不索取或代收此码。

## 备份及失败自动回退

变更备份位于 `/var/backups/azhen-photos-production/<UTC时间>/`，root 私有。保存原照片配置、Nginx 文件、原有 drop-in/任务文件、SHA/权限与启用状态，以及包含 WAL 提交的一致性 SQLite 快照。原 COS 密钥不复制到交付包或聊天。

配置改动后发生校验/重启/健康失败，脚本按清单恢复自己修改的文件及启用状态，验证 Nginx 后 reload，恢复照片原服务。检测到第三方并发修改则停止，避免覆盖外部改动。

手动回退使用同一固定服务包中的 `deploy/manage.py rollback`，它只恢复配置和运行版本，**绝不把现有数据库自动替换成部署前快照**，否则会丢失部署后新产生的 photoId。COS 对象、认证表、照片记录、客户端任务和本地日记全部保留。原插件正式版 0.51.27 与原服务代码仍可回退；回退期间照片功能可以暂停，重新前滚可恢复新命名空间读取。

只暂停照片能力使用 `deploy/manage.py pause`，三个开关恢复 false 并重启照片服务，保留正式 metadata/prefix，不调用旧 A3 临时脚本。已签发 COS 授权在到期前不能靠开关即时撤销。

控制台回退只撤销新增的正式 CAM 策略关联和 Windows CORS 规则，原有规则、ACL 和隔离权限保持。已成功更新且受信任的证书不降级为旧/过期证书；现有 ACME 账户与原续期安排不删除。

## 真实约束

这是一次性生产配置授权请求，不是用户测试安排。尚无 SSH 连接，批准前只完成本地代码、部署文件、构建及 Release 发布，不谎称已经部署。

现有 ACME 的具体落盘方式只能由部署时的安全预检确认；当前公开证书已通过受信任 TLS 读取，IP SAN 为 106.55.92.40，颁发者 Let's Encrypt YE2，有效至 2026-12-01 22:34:58 UTC（香港时间 12 月 2 日 06:34:58）。IP 证书短有效期必须自动续期，不能把证书更新理解成永不到期。

主机内 30 份快照不是异地容灾；原有 Lighthouse 快照/管理员异地备份仍须保留。没有新增 Markdown 云同步、照片批量迁移、对象删除、COS 公共读或其他生产插件改动。

依据：[腾讯云 COS API 授权](https://cloud.tencent.com/document/product/436/31923)、[Let's Encrypt IP 短期证书](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)、[Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)。
