import { describe, expect, it } from "vitest";
import {
  AZHEN_KNOWLEDGE_MCP_ENDPOINT,
  AZHEN_KNOWLEDGE_ENABLED_TOOLS,
  AZHEN_KNOWLEDGE_WRITE_TOOLS,
  azhenKnowledgeMcpLocalToolName,
  canonicalizeAzhenKnowledgeMcpEndpoint,
  hasConfiguredAzhenKnowledgeMcp,
  hasEnabledAzhenKnowledgeMcp,
  isAzhenKnowledgeMcpServerId,
  migrateAzhenKnowledgeMcpWritePolicy,
} from "../src/agent/azhen-knowledge-policy";
import { createMcpServerState } from "../src/mcp/settings";
import { pluginMcpServerId } from "../src/plugins/loader";
import { DEFAULT_SETTINGS, mergeSettings, type AgenticChatSettings } from "../src/settings";

const windowsServerId = pluginMcpServerId("knowledge", "knowledge");
const androidServerId = "plugin_plugin_mcp_4b3828edfaf8";
const knowledgeEndpoint = "https://106.55.92.40/mcp";

function legacyKnowledgeSettings(
  serverId = windowsServerId,
  lastUrl = knowledgeEndpoint,
): Partial<AgenticChatSettings> {
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
          lastUrl,
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
    expect(windowsServerId).toBe("plugin_knowledge_kn_d90e9d68823a");
    expect(isAzhenKnowledgeMcpServerId(windowsServerId)).toBe(true);
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
    const state = settings.plugins.mcpState[windowsServerId];

    expect(state.enabledTools).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
    expect(state.approval).toBe("ask");
    expect(state.azhenKnowledgeWritePolicy).toBe(1);
    expect(state.knownTools.map((tool) => tool.name)).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
    for (const tool of AZHEN_KNOWLEDGE_WRITE_TOOLS) {
      expect(settings.approval.perTool[azhenKnowledgeMcpLocalToolName(windowsServerId, tool)]).toBe("ask");
    }
  });

  it("migrates the Android server id when the endpoint identifies the same Knowledge service", () => {
    const settings = mergeSettings(
      legacyKnowledgeSettings(androidServerId, "HTTPS://106.55.92.40:443/mcp/"),
    );
    const state = settings.plugins.mcpState[androidServerId];

    expect(state.enabledTools).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
    expect(state.azhenKnowledgeWritePolicy).toBe(1);
    for (const tool of AZHEN_KNOWLEDGE_WRITE_TOOLS) {
      expect(settings.approval.perTool[azhenKnowledgeMcpLocalToolName(androidServerId, tool)]).toBe("ask");
    }
  });

  it("recognizes the migrated Android state for the MCP prompt and local-write boundary", () => {
    const settings = mergeSettings(legacyKnowledgeSettings(androidServerId));

    expect(hasEnabledAzhenKnowledgeMcp(settings)).toBe(true);
    expect(hasConfiguredAzhenKnowledgeMcp(settings)).toBe(true);
  });

  it("does not grant write access from a legacy-looking id without the Knowledge endpoint", () => {
    const settings = mergeSettings(
      legacyKnowledgeSettings(windowsServerId, "https://example.com/mcp"),
    );
    const state = settings.plugins.mcpState[windowsServerId];

    expect(state.enabledTools).toEqual(["list_files", "read_file"]);
    expect(state.azhenKnowledgeWritePolicy).toBeUndefined();
    for (const tool of AZHEN_KNOWLEDGE_WRITE_TOOLS) {
      expect(settings.approval.perTool[azhenKnowledgeMcpLocalToolName(windowsServerId, tool)]).toBeUndefined();
    }
  });

  it("retries migration after plugin loading supplies a previously missing endpoint", () => {
    const raw = legacyKnowledgeSettings(androidServerId);
    delete raw.plugins!.mcpState[androidServerId].lastUrl;
    const settings = mergeSettings(raw);
    const state = settings.plugins.mcpState[androidServerId];

    expect(state.enabledTools).toEqual(["list_files", "read_file"]);
    state.lastUrl = AZHEN_KNOWLEDGE_MCP_ENDPOINT;
    expect(migrateAzhenKnowledgeMcpWritePolicy(settings.plugins.mcpState, settings.approval)).toBe(true);
    expect(state.enabledTools).toEqual(AZHEN_KNOWLEDGE_ENABLED_TOOLS);
  });

  it("keeps the local-write boundary after a confirmed server goes offline", () => {
    const raw = legacyKnowledgeSettings(androidServerId);
    const state = raw.plugins!.mcpState[androidServerId];
    state.azhenKnowledgeWritePolicy = 1;
    delete state.lastUrl;

    const settings = mergeSettings(raw);
    expect(hasEnabledAzhenKnowledgeMcp(settings)).toBe(true);
    expect(hasConfiguredAzhenKnowledgeMcp(settings)).toBe(true);
  });

  it("canonicalizes only scheme, host, default port, and one trailing slash", () => {
    expect(canonicalizeAzhenKnowledgeMcpEndpoint("HTTPS://106.55.92.40:443/mcp/")).toBe(
      AZHEN_KNOWLEDGE_MCP_ENDPOINT,
    );
    expect(canonicalizeAzhenKnowledgeMcpEndpoint("https://106.55.92.40/mcp/?tenant=one")).toBe(
      "https://106.55.92.40/mcp?tenant=one",
    );
    expect(canonicalizeAzhenKnowledgeMcpEndpoint("https://106.55.92.40/mcp//")).toBe(
      "https://106.55.92.40/mcp/",
    );
    expect(canonicalizeAzhenKnowledgeMcpEndpoint("https://user@106.55.92.40/mcp")).toBeUndefined();
    expect(canonicalizeAzhenKnowledgeMcpEndpoint("https://106.55.92.40/mcp#section")).toBeUndefined();
  });

  it.each([
    "http://106.55.92.40/mcp",
    "https://106.55.92.40:444/mcp",
    "https://106.55.92.40/mcp/other",
    "https://106.55.92.40/mcp//",
    "https://106.55.92.40/mcp?tenant=other",
  ])("does not mistake a lookalike endpoint for Knowledge: %s", (lastUrl) => {
    const settings = mergeSettings(legacyKnowledgeSettings(androidServerId, lastUrl));
    expect(settings.plugins.mcpState[androidServerId].enabledTools).toEqual(["list_files", "read_file"]);
  });

  it("does not re-enable writes after the user later changes the migrated policy", () => {
    const first = mergeSettings(legacyKnowledgeSettings(androidServerId));
    const state = first.plugins.mcpState[androidServerId];
    state.enabledTools = ["list_files", "read_file"];

    const second = mergeSettings(first);
    expect(second.plugins.mcpState[androidServerId].enabledTools).toEqual(["list_files", "read_file"]);
  });

  it("preserves an explicit deny and leaves unrelated MCP servers untouched", () => {
    const raw = legacyKnowledgeSettings(androidServerId);
    const localWrite = azhenKnowledgeMcpLocalToolName(androidServerId, "write_file");
    const unrelatedLocal = "mcp__plugin_other_123456789012__one";
    raw.approval = {
      mutating: "ask",
      perTool: { [localWrite]: "deny", [unrelatedLocal]: "allow" },
      workingDirs: [],
    };
    raw.plugins = {
      ...raw.plugins!,
      mcpState: {
        ...raw.plugins!.mcpState,
        plugin_other_123456789012: createMcpServerState("plugin_other_123456789012", {
          approval: "deny",
          enabledTools: ["one"],
        }),
      },
    };

    const settings = mergeSettings(raw);
    expect(settings.approval.perTool[localWrite]).toBe("deny");
    expect(settings.approval.perTool[unrelatedLocal]).toBe("allow");
    expect(settings.plugins.mcpState.plugin_other_123456789012.approval).toBe("deny");
    expect(settings.plugins.mcpState.plugin_other_123456789012.enabledTools).toEqual(["one"]);
  });
});
