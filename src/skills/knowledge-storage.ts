import type { Skill } from "./skill-prompt";
import type { KnowledgeMode } from "../agent/knowledge-mode";

/** Runtime adapter only. Never install, overwrite or publish the independent
 * business-Skills repository. Original business text stays intact. */
export function adaptKnowledgeStorage(skill: Skill, mode: KnowledgeMode): Skill {
  if (mode !== "local" || !skill.filePath.replaceAll("\\", "/").includes("/azhen-business-skills/")) return skill;
  const storage = "知识库位置由 Agentic Chat 当前模式决定。本地模式用当前 Vault 的 read、vault_inspect、write（仅新建）和 edit（精确修改或追加），不得调用 Knowledge MCP；云端模式沿用原 MCP 规则。所有业务口径、格式和经验保持不变。";
  const content = skill.content
    .replace("Knowledge MCP 负责用户知识库数据。", storage)
    .replace(/知识库正文只能通过 Knowledge MCP 修改。[^\n]*/u, storage + " 修改已有文件先读取当前版本；冲突、失败或结果不明时停止并核实，不盲目重试。")
    .replace("查询历史账目、计算收支、用途汇总、周月报数据或图表时，调用 `azhen_finance_query`。", "本地模式不提供 azhen_finance_query；财务汇总核验和图表必须说明暂不可用，不能用模型自行计算冒充。需要确定性核验时由用户切换腾讯云知识库。原统计口径保持不变。");
  return { ...skill, content: `<!-- Agentic Chat runtime storage compatibility: local; source Skill file is unchanged. -->\n${storage}\n\n${content}` };
}
