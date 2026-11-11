# Agentic Chat 0.51.21 — DeepSeek 视觉能力识别

根因：模型构建时 input 固定为 text，OpenRouter 缓存没有保存图片模态，导致 supportsImages 拦截已有多模态链路。

修复范围：
- OpenRouter 模型复用自身目录 architecture.input_modalities，缓存保存图片能力；旧缓存缺少字段时保持保守，等待现有缓存周期刷新。
- OpenAI 兼容模型仅启用已核实的端点与精确 ID：阿里云 Token Plan 北京 /compatible-mode/v1 的 deepseek-v4.1-flash、deepseek-v4.1-flash-1017；DeepSeek 官方根路径或 /v1 的 deepseek-flash、deepseek-v4-flash-vision-exp。
- 未知网关、不同路径、其他模型不因同名而被启用。Ollama 能力识别保持原样。
- 修正 DeepSeek 官方根地址被通用 OpenWebUI 规则附加 /api 的问题；用户保存的地址、模型和 Token 均不改写。
- 图片选择、编码、预览、会话、Memory、Knowledge MCP、财务图表与审批逻辑未修改。Windows/Android 使用同一能力判断。

端点与模型 ID：deepseek-flash 是 DeepSeek 官方 ID；阿里云有自己的 deepseek-v4.1-flash / deepseek-v4.1-flash-1017 ID，不自动相互替换。

验证：修复前 11 项见证测试 5 失败、6 通过；修复后定向回归 84 项全部通过。验证两个阿里云 ID 的文字与真实图片数据被序列化到同一次 image_url 请求；非视觉与未知端点拦截、文字请求回归通过。TypeScript、生产构建、移动兼容和修改文件 ESLint 通过。请求测试使用模拟服务，未取得真实 API 识图响应；没有 Android 实机验收。

参考：
- https://api-docs.deepseek.com/guides/vision/
- https://api-docs.deepseek.com/
- https://help.aliyun.com/en/model-studio/deepseek-api
- https://help.aliyun.com/en/model-studio/qwen-code

插件 ID agentic-chat，最低 Obsidian 1.11.4，保留历史 Release、BRAT 映射、MIT 与第三方声明；无需迁移配置、会话或 SecretStorage。
