# photos-test.2：唯一隔离目录联调候选

日期：2026-11-25。基线为 0.51.28-photos-test.1，完整提交 a4d921b0dd861a77c72b0d234f40c6a75e86d147。新版本 0.51.28-photos-test.2，仅 Pre-release，不改变 Latest 0.51.27。

## 本轮仅两处客户端适配

1. 将允许的前缀替换为用户线上确认的 `isolated-test/s2-05/492d2883-a19e-4929-bedd-86db673b7f51/`。本候选不同时接受正式前缀或其他隔离 UUID；未增加配置入口以绕过限制。Bucket、广州 Region、HTTPS 接口、签名/方法/头/大小、逐次批准和服务端 photoId 校验均沿用 test.1。
2. Agent 设置 → COS 按需照片新增“本机 WebView Origin”，显示运行时 `window.origin` 和 `location.origin`。不发送请求、不存储凭据、不收集日志，也不手工设置网络 Origin。页面安全源是 CORS 的诊断依据；若为 `null` 或两值不同，须以实际预检的 Origin 确认，不能猜测或改成 `*`。

代码仅修改 `src/photos/client.ts` 和 `src/photos/settings.ts`；其余变更为版本元数据、说明和 feature-map 注记。本地 Markdown 工具、Memory、图片理解和批准机制没有改动。

## 本轮校验范围

仅生产构建（含类型、发布版本及移动兼容检查）、基线差异检查、依赖锁一致性、安装包/ZIP CRC/SHA-256 和 GitHub 附件回验。不运行 Mock、旧功能回归或真实 COS 请求。test.1 的历史测试记录不是本候选的 Android 真机验收。

三个服务端开关保持 false；没有服务器、Nginx、CAM、Bucket CORS、ACL 或密钥变更。用户确认的 HTTPS 证书有效至 2026-11-28，实际联调当天仍须在 Android 正常验证，不绕过 TLS。

## BRAT 安装及当前唯一需要回传的信息

仓库 `nq980926-source/azhen-agentic-chat-zh`，BRAT 选择指定版本 `0.51.28-photos-test.2`。无需编译或复制插件文件。

安装后在 Android 打开 Agent 设置中的“本机 WebView Origin”，只回传显示的两个 Origin 值。此操作不要求开启客户端开关或输入 Token；不要在聊天发送 Token、密钥或签名 URL。

当前还不能声称真实上传已经接通。Reading View 和聊天的显示能力沿用 test.1，Live Preview 的既有限制不在本轮扩大处理。

## 待批准的最小服务端变更单（本轮未执行）

所有变更以实际 Android Origin 为精确值，先确认现有配置是否已满足；已经满足的条目不重复改。Origin 未取得前，本清单不是可执行的生产补丁。

### A. 现有照片授权入口的 OPTIONS/CORS

目标仅为现有 `/photos/v1/` → `127.0.0.1:8001` 的 Nginx location。历史目标文件为 `/etc/nginx/conf.d/azhen-mcp-access.conf`，实施前以线上文件/行号确认，不新增第二个 server 或服务。

- 对唯一批准的 Android Origin，允许预检 OPTIONS 返回 204，预检本身不要求 Bearer Token，也不进入上传/确认业务。
- `Access-Control-Allow-Origin` 只返回该实际 Origin；不使用 `*`，不无条件反射任意 Origin。
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`；`Access-Control-Allow-Headers: Authorization, Content-Type`；预检缓存建议 300 秒。
- 所有照片 API 响应（包括 401/403/503）按该 Origin 返回必要的 CORS 响应头及 `Vary: Origin`。客户端 `credentials: omit`，不新增 `Access-Control-Allow-Credentials`。
- GET/POST 的原有 Bearer 验证和上游 Authorization 传递保持有效；开放 OPTIONS 不等于开放上传权限。其他路由、Memory、Knowledge MCP、8443、证书和上游端口不改。
- 经批准后备份相关配置，只对照片 location 做差异修改；执行 Nginx 配置校验，通过才 reload，不 restart。若 inherited 认证会先拦 OPTIONS，须把确切继承关系纳入补丁后再批准，不能擅自关闭整个站点认证。

影响：只改变指定来源访问照片 API 的浏览器跨域行为。回退：恢复该 location/相关受影响配置的原件，经配置校验后 reload Nginx；不触碰其他路由。

### B. 现有私有 Bucket 的 CORS

控制台先查看当前规则，保留其他已有规则。确有缺项时仅追加一条面向实际 Android Origin 的规则：

- 来源：唯一批准的 Android Origin。
- 方法：`PUT, GET`。HEAD 由 Lighthouse 服务端执行，不需为浏览器增加 HEAD；不增加 DELETE。
- 允许请求头：`Content-Type, Content-MD5, X-Cos-Forbid-Overwrite, X-Cos-Meta-Sha256, X-Cos-Meta-Content-Md5, X-Cos-Acl`。
- `Host`、`Content-Length` 由浏览器控制，不手工注入；COS 请求不携带照片服务 Bearer Token。客户端不依赖额外暴露响应头，预检缓存建议 300 秒。

CORS 规则本身是桶级设置，不能限制对象前缀；对象访问仍由现有 CAM 隔离前缀和服务端签名限制。桶保持私有，不改 CAM、ACL 或对象权限，不扩大目录。

影响：该来源可以对已有授权的 COS PUT/GET 进行浏览器跨域读取。回退：只移除本次新增规则或恢复原规则快照，不清空其他规则。

### C. 临时开启现有服务的三个开关

目标 `/etc/azhen-photo-auth/config.json`，仅把 `uploadsEnabled`、`readsEnabled`、`headNetworkEnabled` 从 false 改为 true；prefix、owner、bucket、region、port、凭据引用不改。现有源码在启动时加载开关，因此经批准修改后需**只重启 `azhen-photo-auth.service`**，不能只编辑文件就宣称生效。

批准窗口结束或发生异常时，三个值恢复 false，并仅重启该照片服务。该操作会中断正在进行的照片请求，必须等本次任务停止或结果明确后回退；不清空元数据库、不删除对象，不因结果不明换新操作 ID 重传。

前提：Android Origin 已确认，A/B 的实际预检满足需求；控制台确认现有 CAM 对该唯一隔离前缀有 PUT/GET/HEAD 权限。若权限不符，停止提交新变更单，不自动扩权。

### D. 获批后的一张图片验收及费用边界

仅一张无隐私 PNG，建议不超过 128 KiB。PUT 最多 1 次、HEAD 最多 2 次、GET 最多 2 次（含重试）；达到上限或出现异常即停止，不重复后端 PUT/GET 演练、不跑旧功能回归。没有真实请求授权前不发生对象费用。

Android 选择该照片 → 本次明确批准 → 现有服务返回真实 confirmed → 现有本地工具插入 `![照片](azhen-photo://v1/<photoId>)` → 同一本地日记 Reading View 显示照片。只报告状态、稳定 photoId 和本地路径，不回传授权 URL 或凭据。

完成后按批准结果恢复三个开关关闭。图片及元数据保留用于该 photoId 的后续验收，不自动删除；关闭读取后，内存缓存失效的图片暂不可加载是预期状态，并非引用被删除。

## 回退

客户端可通过 BRAT 指定回退 `0.51.28-photos-test.1` 或正式 `0.51.27`，旧 Release 保留。本轮客户端回退不删除日记、图片或服务端 photoId 元数据。服务器变更须用户另行明确批准，本轮到客户端发布及变更单为止。
