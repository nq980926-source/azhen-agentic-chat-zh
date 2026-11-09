import type { ApprovalSettings } from "./approval";
import type { McpServerState } from "../mcp/settings";

export const AZHEN_KNOWLEDGE_WRITE_POLICY_REVISION = 1 as const;
export const AZHEN_KNOWLEDGE_MCP_SERVER_ID_PATTERN = /^plugin_knowledge_[a-z0-9]+_[a-f0-9]{12}$/;

export const AZHEN_KNOWLEDGE_ENABLED_TOOLS = [
  "list_files",
  "read_file",
  "create_file",
  "write_file",
  "edit_file",
  "append_file",
  "move_to_trash",
] as const;

export const AZHEN_KNOWLEDGE_WRITE_TOOLS = [
  "create_file",
  "write_file",
  "edit_file",
  "append_file",
  "move_to_trash",
] as const;

const LEGACY_READ_ONLY_TOOLS = new Set<string>(["list_files", "read_file"]);

export const AZHEN_BUSINESS_SKILLS_PACKAGE = "azhen-business-skills";

export const AZHEN_KNOWLEDGE_PROMPT_OVERLAY = `## Azhen Knowledge MCP write boundary
- Knowledge-base note creation, edits, appends, whole-note overwrites, and deletion must use the Knowledge MCP tools.
- Before modifying a knowledge-base note, state the exact path and substantive change once, then rely on the existing tool approval prompt. Do not add a second ceremonial confirmation.
- For a localized change, read the current note and use edit_file with the returned SHA-256.
- Before write_file, read the current version and pass that exact SHA-256. Never overwrite without the hash.
- Use move_to_trash when asked to delete a knowledge-base note.
- Never write, rename, delete, or change properties in a knowledge-base note through the local Vault tools. Local Vault mutations are restricted to the ${AZHEN_BUSINESS_SKILLS_PACKAGE} Skills package for maintenance.`;

export function isAzhenKnowledgeMcpServerId(serverId: string): boolean {
  return AZHEN_KNOWLEDGE_MCP_SERVER_ID_PATTERN.test(serverId);
}

export function azhenKnowledgeMcpLocalToolName(serverId: string, remoteToolName: string): string {
  return `mcp__${serverId}__${remoteToolName}`;
}

export function hasEnabledAzhenKnowledgeMcp(settings: {
  mcp: { enabled: boolean; servers: Array<{ id: string; enabled: boolean }> };
  plugins: { mcpState: Record<string, Pick<McpServerState, "enabled">> };
}): boolean {
  if (!settings.mcp.enabled) return false;
  if (
    Object.entries(settings.plugins.mcpState).some(
      ([serverId, state]) => isAzhenKnowledgeMcpServerId(serverId) && state.enabled,
    )
  ) {
    return true;
  }
  return settings.mcp.servers.some(
    (server) => isAzhenKnowledgeMcpServerId(server.id) && server.enabled,
  );
}

/** The local-write boundary persists even if MCP or the server is temporarily disabled. */
export function hasConfiguredAzhenKnowledgeMcp(settings: {
  mcp: { servers: Array<{ id: string }> };
  plugins: { mcpState: Record<string, unknown> };
}): boolean {
  return (
    Object.keys(settings.plugins.mcpState).some(isAzhenKnowledgeMcpServerId) ||
    settings.mcp.servers.some((server) => isAzhenKnowledgeMcpServerId(server.id))
  );
}

/**
 * One-time migration for the approved Azhen Knowledge server that was first
 * connected with a deliberately read-only two-tool allowlist. The marker is
 * persisted on the server state so a later user choice is never overwritten.
 */
export function migrateAzhenKnowledgeMcpWritePolicy(
  mcpState: Record<string, McpServerState>,
  approval: ApprovalSettings,
): boolean {
  let changed = false;
  for (const [serverId, state] of Object.entries(mcpState)) {
    if (!isAzhenKnowledgeMcpServerId(serverId)) continue;
    if (state.azhenKnowledgeWritePolicy === AZHEN_KNOWLEDGE_WRITE_POLICY_REVISION) continue;
    if (!sameToolSet(state.enabledTools, LEGACY_READ_ONLY_TOOLS)) continue;

    state.enabledTools = [...AZHEN_KNOWLEDGE_ENABLED_TOOLS];
    state.approval = "ask";
    const knownByName = new Map(state.knownTools.map((tool) => [tool.name, tool]));
    state.knownTools = AZHEN_KNOWLEDGE_ENABLED_TOOLS.map(
      (name) =>
        knownByName.get(name) ?? {
          name,
          localName: azhenKnowledgeMcpLocalToolName(serverId, name),
          title: name,
          readOnlyHint: false,
        },
    );
    for (const tool of AZHEN_KNOWLEDGE_WRITE_TOOLS) {
      const localName = azhenKnowledgeMcpLocalToolName(serverId, tool);
      // Preserve an explicit deny; otherwise force the existing approval prompt
      // even while the chat is in YOLO mode.
      if (approval.perTool[localName] !== "deny") approval.perTool[localName] = "ask";
    }
    state.azhenKnowledgeWritePolicy = AZHEN_KNOWLEDGE_WRITE_POLICY_REVISION;
    changed = true;
  }
  return changed;
}

function sameToolSet(actual: readonly string[], expected: ReadonlySet<string>): boolean {
  if (actual.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const tool of actual) {
    if (!expected.has(tool) || seen.has(tool)) return false;
    seen.add(tool);
  }
  return true;
}
