# S2-05 官方 SDK 离线适配

`photo_auth/tencent_cos.py` 实现既有 `CosAdapter.sign/head`，MockCOS 仍使用原模拟签名。没有将真实适配接入默认启动入口；导入模块不会读取凭据或发起网络访问。`head()` 默认禁止网络，离线测试即使显式开启该标记，也会拦截 SDK 传输。

仅在本目录独立 `.venv-sdk` 中安装 `requirements-sdk.lock`。SDK 固定 `cos-python-sdk-v5==1.9.45`，锁定全部当前环境传递依赖。原 `.venv` 和生产环境均不受影响；Linux/Python 目标版本安装及供应链复核待部署阶段验收。

离线重现（在本目录）：

```powershell
.\.venv-sdk\Scripts\python.exe run_sdk_tests.py
.\.venv-sdk\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe run_tests.py
.\.venv\Scripts\python.exe -m unittest discover -s tests_http -v
```

SDK 测试阻断 DNS、socket connect 和 requests 实际发送，仅使用合成凭据及假桶。测试结果不能证明真实 CAM 授权或 Android 原生头部行为。

实际普通桶预签名通过官方 SDK 的 `get_presigned_url`，签入 Host 和原 HTTP 头名称；客户端只得到短时操作 URL，不得到 SecretKey。URL 中 `q-ak` 仍包含 SecretId 标识，不能声称其完全不含身份信息；完整链接是短期能力凭证，不持久化、不写日志。若要求连长期 SecretId 标识也不出客户端，需另行批准并实现 STS 提供器，不是本轮自动获得的能力。

HEAD 返回的自定义 MD5/SHA 元数据只是声明。真实 PUT 的 Content-MD5 由 COS 校验，HEAD 用于尺寸/MIME/元数据确认；GET 下载后对实际字节计算 SHA-256 才形成往返校验。ETag 不当作 MD5 或 SHA-256。原完整性状态名称保留；`confirmed/transport_checked` 不能解释为服务端独立计算 SHA-256，`roundtrip_sha256_client_verified` 仍是客户端报告等级。

PUT 头新增 `x-cos-meta-content-md5` 和 `x-cos-acl: private`；原 Content-MD5、Content-Length、Content-Type、SHA 元数据及禁止覆盖保留。Obsidian 原生传输继续由运行时生成 Content-Length，必须与签名值完全相等。对象 Key 使用适配器限定前缀，DB 记录对应 bucket/region；输入仍不能指定 Key/bucket/owner。每次批准测试运行要使用更窄的 `isolated-test/s2-05/<run UUID>/`，并与 CAM resource 完全一致。

SDK 禁用自动重试、域名重试切换、重定向及快速桶 session 授权，固定 HTTPS/TLS 校验。仅普通桶适用；SDK 的快速桶/CreateSession 流程不在范围内。异常和 SDK 调用日志脱敏，但部署仍必须禁用全局 HTTP debug/响应体日志。运行时契约、配额和幂等继续由现有 Service/SQLite 处理。
