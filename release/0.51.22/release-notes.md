# Agentic Chat 0.51.22

基于 0.51.21 集成 DeepSeek 官方 Search + Fetch，保留图片、输入框、视觉识别、简体中文、Knowledge MCP 和 Memory 接入。

在网络设置中启用网页搜索，搜索提供商选择 DeepSeek，配置独立搜索 API Key。Search 和 Fetch 共用该搜索专用密钥，不使用聊天模型密钥；切换提供商保留各自凭据。

保留 Tavily、Brave、SearXNG，原有网页工具名称、审批、目标 URL 防护、来源链接及正文分页不变。

验证：174 项相关及 0.51.21 回归测试全部通过；TypeScript、E2E 类型检查、构建及移动端静态检查通过。未调用付费 DeepSeek API，未进行 Android 实机验证，未自动安装插件。

BRAT 用户可检查更新至 0.51.22。Windows 与 Android 共用安装资源。保留 0.51.21 Release 用于回退。
