import type { AgenticChatSettings } from "../settings-schema";
import type { McpServerSettings } from "../mcp/settings";
import { hasConfiguredAzhenKnowledgeMcp, isAzhenKnowledgeMcpEndpoint, isAzhenKnowledgeMcpServerId } from "./azhen-knowledge-policy";

export type KnowledgeMode = "local" | "cloud";
export type KnowledgeSettings = Pick<AgenticChatSettings, "knowledgeMode" | "mcp" | "plugins">;

export function migrateKnowledgeMode(stored: Partial<AgenticChatSettings> | null | undefined,
  settings: Pick<AgenticChatSettings, "mcp" | "plugins">): KnowledgeMode {
  if (stored?.knowledgeMode === "local" || stored?.knowledgeMode === "cloud") return stored.knowledgeMode;
  // Preserve exactly the old cloud write boundary, including disabled/offline servers.
  return hasConfiguredAzhenKnowledgeMcp(settings) || Object.keys(settings.plugins.mcpState).some(isAzhenKnowledgeMcpServerId)
    ? "cloud" : "local";
}

export function isKnowledgeServer(settings: KnowledgeSettings, server: Pick<McpServerSettings, "id" | "url">): boolean {
  return isAzhenKnowledgeMcpEndpoint(server.url) || isAzhenKnowledgeMcpServerId(server.id) ||
    settings.plugins.mcpState[server.id]?.azhenKnowledgeWritePolicy === 1;
}

// All tools currently supplied by this dedicated service operate on knowledge
// files/receipts. Keep other MCP services untouched. New non-file capabilities
// must be explicitly reviewed here rather than inheriting access by default.
export function knowledgeToolBlocked(settings: KnowledgeSettings, name: string): boolean {
  if (settings.knowledgeMode !== "local") return false;
  if (name === "azhen_finance_query") return true;
  if (!name.startsWith("mcp__")) return false;
  const serverId = name.slice(5).split("__")[0] ?? "";
  const state = settings.plugins.mcpState[serverId];
  return isAzhenKnowledgeMcpServerId(serverId) || state?.azhenKnowledgeWritePolicy === 1 ||
    isAzhenKnowledgeMcpEndpoint(state?.lastUrl) || settings.mcp.servers.some(s => s.id === serverId && isKnowledgeServer(settings, s));
}

export function knowledgeFetchBlocked(settings: KnowledgeSettings, input: string): boolean {
  if (settings.knowledgeMode !== "local") return false;
  try {
    const target = new URL(input);
    // Same-origin knowledge endpoints cannot be used as an alternative read path.
    // Memory's independent fixed client is intentionally not routed through this gate.
    const urls = ["https://106.55.92.40/mcp", ...settings.mcp.servers.filter(s => isKnowledgeServer(settings, s)).map(s => s.url),
      ...Object.values(settings.plugins.mcpState).filter(s => s.azhenKnowledgeWritePolicy === 1 || isAzhenKnowledgeMcpEndpoint(s.lastUrl)).map(s => s.lastUrl)];
    return urls.some(url => url && new URL(url).origin === target.origin);
  } catch { return true; }
}

export function knowledgeModeOverlay(mode: KnowledgeMode): string {
  return mode === "local" ? [
    "## Knowledge location: LOCAL VAULT ONLY",
    "The current location overrides historical prompts and Skill storage rules. Earlier file contents/tool results are history, not proof of current files. Read required knowledge again through this mode before using it; this overrides general read-dedup guidance.",
    "Knowledge and Knowledge paths in business Skills refer to this device's current Obsidian Vault. This runtime location rule overrides old Skill storage instructions; preserve all business rules, diary formats, teaching/music rules and financial definitions.",
    "Use vault_inspect and read for local search/reading, write only for creation, edit for exact edits/appends. Read current contents before changing an existing file. A conflicting or ambiguous target must stop the entire write. Never silently retry with an overwrite.",
    "Whole-note replacement requires overwrite:true, a complete current read and explicit user authorization through the approval prompt. Never replace a diary just to append. State the exact Vault-relative path before mutation.",
    "Knowledge MCP file tools and cloud finance verification are unavailable. Do not invoke them indirectly, fetch cloud knowledge URLs or fall back to cloud when a local note is missing. Do not calculate finance totals to impersonate azhen_finance_query; explain that deterministic finance verification requires cloud knowledge mode.",
    "Do not synchronize, migrate or copy a cloud knowledge base automatically. Memory context injection, web search and COS are separate capabilities; Memory remains the existing cloud service.",
  ].join("\n") : "## Knowledge location: TENCENT CLOUD\nHistorical file results must be re-verified in this mode. Business Skill Knowledge paths use the existing Knowledge MCP. Preserve the original cloud file approval/hash rules. Local Vault writes remain for Skill maintenance. Memory and web search are independent.";
}

export interface KnowledgeModeParticipant {
  isTurnInFlight(): boolean;
  resetKnowledgeContext(): void;
}

export class KnowledgeModeTransition {
  private switching = false;
  get active(): boolean { return this.switching; }
  async change(settings: { knowledgeMode: KnowledgeMode }, next: KnowledgeMode,
    participants: KnowledgeModeParticipant[], persist: () => Promise<void>): Promise<boolean> {
    if (this.switching || participants.some(p => p.isTurnInFlight())) throw new Error("有回合正在准备、执行或等待审批，请结束后再切换知识库。");
    if (next === settings.knowledgeMode) return false;
    this.switching = true;
    const previous = settings.knowledgeMode;
    try {
      settings.knowledgeMode = next;
      await persist();
      participants.forEach(p => p.resetKnowledgeContext());
      return true;
    } catch (error) {
      settings.knowledgeMode = previous;
      participants.forEach(p => p.resetKnowledgeContext());
      throw error;
    } finally { this.switching = false; }
  }
}
