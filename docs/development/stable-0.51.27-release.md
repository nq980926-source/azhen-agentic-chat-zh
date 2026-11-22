# Agentic Chat 0.51.27 正式版发布核验

## 唯一功能基线与用户验收

唯一功能基线：0.51.27-local-test.1，完整提交 89e018edca727080ec0d949c4920c5d244a97a4e。
用户已于本轮确认 Android 实机验收通过：本地知识库文件修改正常，未修改腾讯云 Knowledge MCP 文件，并明确批准发布正式版 0.51.27。本轮不追加功能、重构、测试项目或实机验收要求。

## 本次变更范围

仅更新 manifest.json、package.json、package-lock.json、versions.json 中必要的版本元数据，以及 README 发布说明和本核验文档。依赖锁定内容除版本字段外完全相同；src/、test/、scripts/ 及构建配置相对已验收提交无差异。
保留本地／腾讯云双模式及原有 Knowledge MCP 配置。本轮不操作腾讯云生产服务、Memory、COS、独立记账 APP、云端工作台或独立 Skill 插件。

## 构建与附件核验

执行 npm run build，通过类型检查、生产构建、版本映射核验和移动兼容检查。
本轮不新增或重跑功能测试项目，沿用已经通过的测试版与用户 Android 实机验收结果。

| 文件 | 与已验收测试版对比 | SHA-256 |
|---|---|---|
| main.js | 逐字节相同，1814544 字节 | a50e26bb84e275d122669e9986dfd56e0a4d45462817f40110782bad53b9d95f |
| styles.css | 逐字节相同，61140 字节 | a38ff7f33da74994badbb4f4d2c4ab30a30ad35341c3b6950d55b9147c7d6b93 |

manifest.json、package.json、package-lock.json 的版本均为 0.51.27；versions.json 映射 0.51.27 → 1.11.4。插件 ID 保持 agentic-chat，isDesktopOnly=false，Android 与 Windows 共用附件。
安装 ZIP 仅含 agentic-chat/main.js、agentic-chat/manifest.json、agentic-chat/styles.css；发布流程检查 CRC、版本和附件三件套一致性。不包含配置、密钥或聊天记录。

## 发布与回退

正式 Release： https://github.com/nq980926-source/azhen-agentic-chat-zh/releases/tag/0.51.27
发布为非 Draft、非 Pre-release，并将 Latest 指向 0.51.27。通过 BRAT 更新本仓库即可，无需手动复制或编译。
保留正式版 0.51.26 的 Release、标签及全部附件作为回退基线，同时保留已验收测试版。发布后重新下载正式附件回验哈希，并核对旧版本附件未改变。

完成正式发布后停止开发，等待后续实际使用反馈。
