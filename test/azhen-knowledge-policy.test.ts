import { describe, expect, it } from "vitest";
import {
  AZHEN_KNOWLEDGE_ENABLED_TOOLS,
  AZHEN_KNOWLEDGE_WRITE_TOOLS,
  azhenKnowledgeMcpLocalToolName,
  isAzhenKnowledgeMcpServerId,
} from "../src/agent/azhen-knowledge-policy";
import { createMcpServerState } from "../src/mcp/settings";
import { pluginMcpServerId } from "../src/plugins/loader";
import { DEFAULT_SETTINGS, mergeSettings, type AgenticChatSettings } from "../src/settings";

const serverId = pluginMcpServerId("knowledge", "knowledge");

function legacyKnowledgeSettings(): Partial<AgenticChatSettings> {
  return {
    mcp: {
      enabled: true,
      proxyUrl: "",
      noProxy: "localhost,127.0.0.1,::1",
      servers: [],
    },
    plugins: {
      ...DEFAULT_SETTINGS.plugins,
      mcpState: {
        [serverId]: createMcpServerState(serverId, {
          enabled: true,
          approval: "ask",
          authType: "bearer",
          enabledTools: ["list_files", "read_file"],
          knownTools: [
            { name: "list_files", title: "list_files", readOnlyHint: false },
            { name: "read_file", title: "read_file", readOnlyHint: false },
          ],
        }),
      },
    },
    approval: { mutating: "ask", perTool: {}, workingDirs: [] },
  };
}

describe("Azhen Knowledge MCP write policy", () => {
  it("recognizes the plugin-derived Knowledge server and exact minimal tool set", () => {
    expect(serverId).toBe("plugin_knowledge_kn_d90e9d68823a");
    expect(isAzhenKnowledgeMcpServerId(serverId)).toBe(true);
    expect(isAzhenKnowledgeMcpServerId("knowledge")).toBe(false);
    expect(isAzhenKnowledgeMcpServerId("plugin_knowledge_evil")).toBe(false);
    expect(AZHEN_KNOWLEDGE_ENABLED_TOOLS).toEqual([
      "list_files",
      "read_file",
      "create_file",
      "write_file",
      "edit_file",
      "append_file",
      "move_to_trash",
    ]);
    expect(AZHEN_KNOWLEDGE_WRITE_TOOLS).toEqual([
      "create_file",
      "write_file",
      "edit_file",
      "append_file",
      "move_to_trash",
    ]);
  });

  it("migrates the approved legacy Knowledge allowlist once and forces write approvals", () => {
    const settings = mergeSettings(legacyKnowledgeSettings());
    const state = settings.plugins.mcpState[serverId];

    expect(state.enabledTools).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
    expect(state.approval).toBe("ask");
    expect(state.azhenKnowledgeWritePolicy).toBe(1);
    expect(state.knownTools.map((tool) => tool.name)).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
    for (const tool of AZHEN_KNOWLEDGE_WRITE_TOOLS) {
      expect(settings.approval.perTool[azhenKnowledgeMcpLocalToolName(serverId, tool)]).toBe("ask");
    }
  });

  it("does not re-enable writes after the user later changes the migrated policy", () => {
    const first = mergeSettings(legacyKnowledgeSettings());
    const state = first.plugins.mcpState[serverId];
    state.enabledTools = ["list_files", "read_file"];

    const second = mergeSettings(first);
    expect(second.plugins.mcpState[serverId].enabledTools).toEqual(["list_files", "read_file"]);
  });

  it("preserves an explicit deny and leaves unrelated MCP servers untouched", () => {
    const raw = legacyKnowledgeSettings();
    const localWrite = azhenKnowledgeMcpLocalToolName(serverId, "write_file");
    raw.approval = { mutating: "ask", perTool: { [localWrite]: "deny" }, workingDirs: [] };
    raw.plugins = {
      ...raw.plugins!,
      mcpState: {
        ...raw.plugins!.mcpState,
        plugin_other_123456789012: createMcpServerState("plugin_other_123456789012", {
          enabledTools: ["one"],
        }),
      },
    };

    const settings = mergeSettings(raw);
    expect(settings.approval.perTool[localWrite]).toBe("deny");
    expect(settings.plugins.mcpState.plugin_other_123456789012.enabledTools).toEqual(["one"]);
  });
});
