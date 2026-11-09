import { App, ButtonComponent, Notice, Platform, PluginSettingTab, Setting, TFile, TFolder, ToggleComponent, type SettingDefinitionItem } from "obsidian";
import type AgenticChatPlugin from "./main";
import { DEFAULT_PLUGINS_FOLDER, resolveMcpServers } from "./plugins/loader";
import type { LoadedPlugin } from "./plugins/loader";
import { createMcpServerState, mcpServerStateFromServer, type McpServerState } from "./mcp/settings";
import { validateMcpUrl } from "./plugins/manifest";
import {
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  listOpenRouterModels,
  type ProviderId,
} from "./llm/models";
import { type ApprovalPolicy, clearMcpPerToolApprovals, setPerToolApproval } from "./agent/approval";
import { type AgentMode, MODE_ORDER, MODES } from "./agent/modes";
import { addWorkingDir, removeWorkingDir } from "./agent/working-dir";
import { DEFAULT_SYSTEM_PROMPT } from "./agent/system-prompt";
import { MUTATING_TOOLS } from "./tools/tool-contracts";
import { createVaultTools } from "./tools/vault-tools";
import {
  exportMcpServerConfig,
  mcpServerSetupSteps,
  nextUniqueMcpServerId,
  normalizeMcpServerId,
  resetMcpCredentials,
  resetMcpServerSecretRefs,
  serverIdFromMcpUrl,
  type McpAuthType,
  type McpServerSettings,
} from "./mcp/settings";
import {
  authenticateMcpServer,
  forgetMcpOAuthTokens,
  DEFAULT_MCP_OAUTH_REDIRECT_URI,
  hasMcpOAuthAccess,
  MCP_OAUTH_OBSIDIAN_REDIRECT_URI,
  type McpOAuthProgressEvent,
} from "./mcp/oauth";
import { createFetchFromWebFetcher, createMcpFetcher, createProxiedFetcher } from "./mcp/fetcher";
import { localMcpToolNames, probeMcpServer } from "./mcp/tools";
import {
  formatMcpServerSummary,
  formatMcpToolApprovalDescription,
  formatMcpToolSample,
  mcpAuthProblem,
  mcpCredentialResourceChanged,
  mcpEndpointProblem,
  mcpKnownToolLocalName,
  mcpSecretIds,
  mcpTestButtonState,
} from "./settings-mcp-state";
import {
  WEB_SEARCH_PROVIDER_LABELS,
  WEB_SEARCH_PROVIDERS,
  type WebSearchProvider,
} from "./tools/web-search";
import { FolderSuggestModal } from "./ui/folder-suggest";
import { InstallPluginModal, noticeInstallResult } from "./ui/install-plugin-modal";
import { NewSkillModal } from "./ui/new-skill-modal";
import { ModelSuggestModal } from "./ui/model-suggest-modal";
import { healMcpToolGlobs } from "./mcp/tool-filter";
import {
  type ObservabilityBackend,
  type ObservabilityPayloadMode,
} from "./observability/settings";
import {
  activeEmbeddingModel,
  DEFAULT_EMBEDDING_SETTINGS,
  type EmbeddingProviderId,
  type EmbeddingSettings,
} from "./retrieval/embeddings";

import { effectiveProxy, DEFAULT_PROXY_SETTINGS, PROXY_URL_EXAMPLE, type ProxySettings } from "./network/proxy";
import { normalizeAllowedHosts } from "./tools/web-allowlist";
import { t } from "./i18n";
import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  PROVIDER_LABELS,
  embeddingModelPlaceholder,
  healSubagentTimeout,
  type AgenticChatSettings,
  type NetworkSettings,
} from "./settings-schema";
export {
  DEFAULT_SETTINGS,
  PROVIDERS,
  PROVIDER_LABELS,
  THINKING_LEVELS,
  activeModelConfig,
  activeModelId,
  apiKeyForProvider,
  embeddingModelPlaceholder,
  mergeSettings,
} from "./settings-schema";
export type {
  AgenticChatSettings,
  CompactionSettings,
  NetworkSettings,
  NotificationSettings,
  WebSettings,
} from "./settings-schema";
const OBSERVABILITY_BACKEND_LABELS: Record<ObservabilityBackend, string> = {
  langfuse: "Langfuse",
  otlp: t("settings.otlpGeneric"),
};

const OBSERVABILITY_PAYLOAD_LABELS: Record<ObservabilityPayloadMode, string> = {
  metadata: t("settings.metadataOnly"),
  "redacted-previews": t("settings.redactedPreviews"),
  "full-content": t("settings.fullContent"),
};

export interface OpenAICompatiblePreset {
  id: string;
  label: string;
  baseUrl: string;
  modelPlaceholder: string;
  apiKeyPlaceholder: string;
  privacy: "local" | "hosted";
  description: string;
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAICompatiblePreset[] = [
  {
    id: "openwebui",
    label: t("settings.preset.openwebui"),
    baseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    modelPlaceholder: "qwen2.5-coder",
    apiKeyPlaceholder: "sk-...",
    privacy: "local",
    description: t("settings.preset.openwebuiDesc"),
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    modelPlaceholder: "use the loaded LM Studio model id",
    apiKeyPlaceholder: "lm-studio",
    privacy: "local",
    description: t("settings.preset.lmStudioDesc"),
  },
  {
    id: "vllm",
    label: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    modelPlaceholder: "served-model-name",
    apiKeyPlaceholder: "token-or-empty",
    privacy: "local",
    description: t("settings.preset.vllmDesc"),
  },
  {
    id: "llama-cpp",
    label: "llama.cpp",
    baseUrl: "http://localhost:8080/v1",
    modelPlaceholder: "gpt-3.5-turbo",
    apiKeyPlaceholder: "sk-no-key-required",
    privacy: "local",
    description: t("settings.preset.llamaCppDesc"),
  },
  {
    id: "chutes",
    label: "Chutes",
    baseUrl: "https://llm.chutes.ai/v1",
    modelPlaceholder: "deepseek-ai/DeepSeek-V3.1",
    apiKeyPlaceholder: "chutes-...",
    privacy: "hosted",
    description: t("settings.preset.chutesDesc"),
  },
  {
    id: "venice",
    label: "Venice.ai",
    baseUrl: "https://api.venice.ai/api/v1",
    modelPlaceholder: "zai-org-glm-5-1",
    apiKeyPlaceholder: "venice-...",
    privacy: "hosted",
    description: t("settings.preset.veniceDesc"),
  },
];

export function openAICompatiblePresetForBaseUrl(baseUrl: string): OpenAICompatiblePreset | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.baseUrl.replace(/\/+$/, "") === normalized);
}

export function applyOpenAICompatiblePreset(settings: AgenticChatSettings, presetId: string): boolean {
  const preset = OPENAI_COMPATIBLE_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return false;
  settings.provider = "openai-compatible";
  settings.openaiCompatibleBaseUrl = preset.baseUrl;
  return true;
}

export class AgenticChatSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AgenticChatPlugin,
  ) {
    super(app, plugin);
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private refresh(): void {
    void this.save().then(() => this.redraw());
  }

  private redraw(): void {
    // ponytail: Obsidian 1.13.0 deprecated PluginSettingTab.display() in favor of
    // getSettingDefinitions(). Full migration to declarative settings deferred.
    (this as unknown as { display: () => void }).display();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  /** Settings grouped into virtual tabs so the page isn't one long scroll. */
  private readonly tabs: Array<{
    label: string;
    render: (containerEl: HTMLElement, settings: AgenticChatSettings) => void;
  }> = [
    { label: t("settings.tabs.models"), render: (el, settings) => this.renderModels(el, settings) },
    { label: t("settings.tabs.agent"), render: (el, settings) => this.renderAgent(el, settings) },
    { label: t("settings.tabs.approval"), render: (el, settings) => this.renderApproval(el, settings) },
    { label: t("settings.tabs.web"), render: (el, settings) => this.renderWebAccess(el, settings) },
    { label: t("settings.tabs.mcp"), render: (el, settings) => this.renderMcp(el, settings) },
    { label: t("settings.tabs.observability"), render: (el, settings) => this.renderObservability(el, settings) },
    { label: t("settings.tabs.notifications"), render: (el, settings) => this.renderNotifications(el, settings) },
    { label: t("settings.tabs.resources"), render: (el, settings) => this.renderResources(el, settings) },
  ];
  private activeTab = 0;
  private pluginsLoadedOnce = false;
  private pendingMcpServerName = "";
  private pendingMcpServerUrl = "";
  private externallyDeletedPlugins: LoadedPlugin[] = [];
  private externalDeleteCheckRunning = false;
  private lastExternalDeleteCheck = 0;

  /** Trigger an async plugin load once; redraw when it lands so rows appear. */
  private ensurePluginsLoaded(): void {
    if (this.pluginsLoadedOnce && this.plugin.pluginService.hasCache()) {
      // Dot-folders deleted externally don't fire vault.delete; poll the adapter so
      // Resources doesn't show a stale cache until the user clicks Remove.
      const now = Date.now();
      if (this.externalDeleteCheckRunning) return;
      if (now - this.lastExternalDeleteCheck < 2000) return;
      this.externalDeleteCheckRunning = true;
      this.lastExternalDeleteCheck = now;
      void this.plugin.pluginService
        .listExternallyDeletedPlugins()
        .then((deleted) => {
          if (deleted.length > 0) {
            this.externallyDeletedPlugins = deleted;
            // Keep transient until dismissed; auto-prune orphan settings via reload on next display.
            this.pluginsLoadedOnce = false;
            this.ensurePluginsLoaded();
          }
        })
        .catch(() => {})
        .finally(() => {
          this.externalDeleteCheckRunning = false;
        });
      return;
    }
    this.pluginsLoadedOnce = true;
    void this.plugin.pluginService
      .reload()
      .then((plugins) => {
        const mutated = this.reconcileLoadedPlugins(plugins);
        if (mutated) void this.save();
        // Transient prune does not count as settings mutation (reconcile handles split)
        if (this.externallyDeletedPlugins.length > 0) this.redraw();
        return plugins;
      })
      .catch((error: unknown) => {
        console.warn("Agentic chat: could not load agent plugins", error);
      })
      .then(() => this.redraw());
  }

  private reconcileLoadedPlugins(plugins: LoadedPlugin[]): boolean {
    // S10: shape lives in mcp.json; ensure every derived plugin server has a
    // client-owned entry in settings.plugins.mcpState (enabled/approval/auth).
    // No merge into settings.mcp.servers — the two cannot diverge.
    const pluginServers = plugins.flatMap((plugin) => plugin.mcpServers);
    let mutated = false;
    const derivedIds = new Set(pluginServers.map((server) => server.id));
    for (const server of pluginServers) {
      const existing = this.plugin.settings.plugins.mcpState[server.id];
      if (!existing) {
        this.plugin.settings.plugins.mcpState[server.id] = createMcpServerState(server.id, {
          enabled: server.enabled,
          approval: server.approval,
          lastUrl: server.url,
        });
        mutated = true;
      } else if (existing.lastUrl !== server.url) {
        if (existing.lastUrl && existing.lastUrl !== server.url) {
          existing.authHeaderValue = "";
          existing.oauth = { ...existing.oauth, accessToken: "", refreshToken: "", expiresAt: 0 };
          existing.knownTools = [];
          existing.pendingOAuthChallenge = undefined;
          existing.pendingOAuthResourceUrl = undefined;
        }
        existing.lastUrl = server.url;
        mutated = true;
      }
    }
    // A retained import backup still owns the state keys of its package. Keep
    // them until the backup is restored or removed, then prune on a later pass.
    if (!this.plugin.pluginService.hasRetainedImportBackup()) {
      for (const id of Object.keys(this.plugin.settings.plugins.mcpState)) {
        if (!derivedIds.has(id)) {
          const isLegacyUser = this.plugin.settings.mcp.servers.some((entry) => entry.id === id && entry.source !== "plugin");
          if (!isLegacyUser) {
            delete this.plugin.settings.plugins.mcpState[id];
            clearMcpPerToolApprovals(this.plugin.settings.approval, id);
            mutated = true;
          }
        }
      }
    }
    // Prune transient deleted cache entries that have reappeared (recreated outside)
    const alivePaths = new Set(plugins.map((plugin) => plugin.rootPath));
    this.externallyDeletedPlugins = this.externallyDeletedPlugins.filter((plugin) => !alivePaths.has(plugin.rootPath));
    return mutated;
  }

  private mcpDisplayServers(settings: AgenticChatSettings): McpServerSettings[] {
    const pluginServers = this.plugin.pluginService.getLoaded().filter((p) => p.enabled).flatMap((p) => p.mcpServers);
    // Use the same resolution as the runtime (state map primary, legacy mcp.servers fallback for tests/pre-migration).
    return resolveMcpServers(settings, pluginServers);
  }

  private ensureMcpStateEntry(id: string): McpServerState {
    const existing = this.plugin.settings.plugins.mcpState[id];
    if (existing) return existing;
    const created = createMcpServerState(id);
    this.plugin.settings.plugins.mcpState[id] = created;
    return created;
  }

  private syncMcpServerToState(server: McpServerSettings): void {
    if (server.source !== "plugin") return;
    const state = this.ensureMcpStateEntry(server.id);
    const next = mcpServerStateFromServer(server);
    // Preserve secret ids already in state (they are derived from id, but keep if present)
    state.enabled = next.enabled;
    state.approval = next.approval;
    state.authType = next.authType;
    state.authHeaderName = next.authHeaderName;
    state.authHeaderValueSecretId = next.authHeaderValueSecretId;
    state.authHeaderValue = next.authHeaderValue;
    state.oauth = next.oauth;
    state.knownTools = next.knownTools;
    state.enabledTools = [...next.enabledTools];
    state.disabledTools = [...next.disabledTools];
    state.pendingOAuthChallenge = next.pendingOAuthChallenge;
    state.pendingOAuthResourceUrl = next.pendingOAuthResourceUrl;
    if (next.lastUrl) state.lastUrl = next.lastUrl;
    else delete state.lastUrl;
  }

  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();

    if (this.activeTab < 0 || this.activeTab >= this.tabs.length) this.activeTab = 0;

    const nav = containerEl.createDiv({ cls: "agentic-chat-settings-tabs" });
    const body = containerEl.createDiv({ cls: "agentic-chat-settings-tabbody" });
    this.tabs.forEach((tab, index) => {
      const button = nav.createEl("button", { cls: "agentic-chat-settings-tab", text: tab.label });
      if (index === this.activeTab) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.activeTab = index;
        this.redraw();
      });
    });
    this.tabs[this.activeTab].render(body, settings);
  }

  private renderModels(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.section.provider")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.modelProvider"))
      .setDesc(t("settings.modelProviderDesc"))
      .addDropdown((dropdown) => {
        for (const provider of PROVIDERS) {
          dropdown.addOption(provider, PROVIDER_LABELS[provider]);
        }
        dropdown.setValue(settings.provider).onChange(async (value) => {
          settings.provider = value as ProviderId;
          await this.save();
          this.redraw();
        });
      });

    new Setting(containerEl).setName(t("settings.networkProxy")).setHeading();

    this.renderProxySettingRows(containerEl, settings.network, {
      proxyDesc: t("settings.proxyDesc"),
      noProxyDesc: t("settings.noProxyDesc"),
    }, async (update) => {
      Object.assign(settings.network, update);
      await this.save();
    });

    if (settings.provider === "openrouter") {
      this.renderOpenRouter(containerEl, settings);
    } else if (settings.provider === "openai-compatible") {
      this.renderOpenAICompatible(containerEl, settings);
    } else {
      this.renderOllama(containerEl, settings);
    }
  }

  private renderOpenRouter(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    this.renderApiKeyWarning(containerEl);
    this.renderSecretInput(containerEl, {
      name: t("settings.openRouterKey"),
      desc: t("settings.openRouterKeyDesc"),
      placeholder: "sk-or-...",
      hasValue: Boolean(settings.openrouterApiKey),
      onSet: async (value) => {
        settings.openrouterApiKey = value;
        await this.save();
      },
      onForget: async () => {
        settings.openrouterApiKey = "";
        await this.save();
      },
    });

    new Setting(containerEl)
      .setName(t("settings.model"))
      .setDesc(t("settings.openRouterModelDesc"))
      .addText((text) =>
        text
          .setPlaceholder("moonshotai/kimi-k2.6")
          .setValue(settings.openrouterModel)
          .onChange(async (value) => {
            settings.openrouterModel = value.trim();
            await this.save();
          }),
      )
      .addButton((button) =>
        button.setButtonText(t("common.browse")).onClick(async () => {
          if (!settings.openrouterApiKey) {
            new Notice(t("settings.setOpenRouterKey"));
            return;
          }
          button.setDisabled(true);
          try {
            const models = (
              await listOpenRouterModels(settings.openrouterApiKey, {
                zdr: settings.privacy.requireZDR,
                denyDataCollection: settings.privacy.denyDataCollection,
                fetchImpl: createFetchFromWebFetcher(createProxiedFetcher(settings.network)),
              })
            )
              .filter((model) => model.supportsTools)
              .sort((a, b) => a.id.localeCompare(b.id));
            new ModelSuggestModal(this.app, models, (model) => {
              settings.openrouterModel = model.id;
              this.refresh();
            }).open();
          } catch (error) {
            new Notice(t("chat.status.agentError", { message: error instanceof Error ? error.message : String(error) }));
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl).setName(t("settings.privacy")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.denyTraining"))
      .setDesc(t("settings.denyTrainingDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.privacy.denyDataCollection).onChange(async (value) => {
          settings.privacy.denyDataCollection = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.requireZdr"))
      .setDesc(t("settings.requireZdrDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.privacy.requireZDR).onChange(async (value) => {
          settings.privacy.requireZDR = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.allowFallbacks"))
      .setDesc(t("settings.allowFallbacksDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.privacy.allowFallbacks).onChange(async (value) => {
          settings.privacy.allowFallbacks = value;
          await this.save();
        }),
      );
  }

  private renderOllama(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl)
      .setName(t("settings.ollamaUrl"))
      .setDesc(t("settings.ollamaUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_OLLAMA_BASE_URL)
          .setValue(settings.ollamaBaseUrl)
          .onChange(async (value) => {
            settings.ollamaBaseUrl = value.trim() || DEFAULT_OLLAMA_BASE_URL;
            await this.save();
          }),
      );
    new Setting(containerEl)
      .setName(t("settings.model"))
      .setDesc(t("settings.ollamaModelDesc"))
      .addText((text) =>
        text
          .setPlaceholder("llama3.1")
          .setValue(settings.ollamaModel)
          .onChange(async (value) => {
            settings.ollamaModel = value.trim();
            await this.save();
          }),
      );
  }

  private renderOpenAICompatible(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    this.renderApiKeyWarning(containerEl);
    const activePreset = openAICompatiblePresetForBaseUrl(settings.openaiCompatibleBaseUrl);
    new Setting(containerEl)
      .setName(t("settings.gatewayPreset"))
      .setDesc(activePreset ? activePreset.description : t("settings.gatewayPresetDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("settings.custom"));
        for (const preset of OPENAI_COMPATIBLE_PRESETS) {
          dropdown.addOption(preset.id, preset.label);
        }
        dropdown.setValue(activePreset?.id ?? "").onChange(async (value) => {
          if (!value) return;
          applyOpenAICompatiblePreset(settings, value);
          await this.save();
          this.redraw();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.baseUrl"))
      .setDesc(t("settings.baseUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
          .setValue(settings.openaiCompatibleBaseUrl)
          .onChange(async (value) => {
            settings.openaiCompatibleBaseUrl = value.trim() || DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
            await this.save();
          }),
      );
    this.renderSecretInput(containerEl, {
      name: t("settings.apiKey"),
      desc: t("settings.apiKeyDesc"),
      placeholder: activePreset?.apiKeyPlaceholder ?? "sk-...",
      hasValue: Boolean(settings.openaiCompatibleApiKey),
      onSet: async (value) => {
        settings.openaiCompatibleApiKey = value;
        await this.save();
      },
      onForget: async () => {
        settings.openaiCompatibleApiKey = "";
        await this.save();
      },
    });
    new Setting(containerEl)
      .setName(t("settings.model"))
      .setDesc(t("settings.gatewayModelDesc"))
      .addText((text) =>
        text
          .setPlaceholder(activePreset?.modelPlaceholder ?? "qwen2.5-coder")
          .setValue(settings.openaiCompatibleModel)
          .onChange(async (value) => {
            settings.openaiCompatibleModel = value.trim();
            await this.save();
          }),
      );
    new Setting(containerEl)
      .setName(t("settings.contextWindowTokens"))
      .setDesc(t("settings.contextWindowOverrideDesc"))
      .addText((text) =>
        text
          .setPlaceholder("0 = auto-detect")
          .setValue(settings.openaiCompatibleContextWindow > 0 ? String(settings.openaiCompatibleContextWindow) : "")
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            settings.openaiCompatibleContextWindow = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
            await this.save();
          }),
      );
  }

  private renderAgent(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.tabs.agent")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.permissionMode"))
      .setDesc(t("settings.permissionModeDesc"))
      .addDropdown((dropdown) => {
        // S4: single list, same labels as `/config` and MODES — every surface reflects the same source (Codex atomic override).
        for (const id of MODE_ORDER) dropdown.addOption(id, MODES[id].label);
        dropdown.setValue(settings.mode).onChange(async (value) => {
          const target = value as AgentMode;
          await this.plugin.requestModeChange(target);
          // Re-sync the dropdown to the actual persisted value (blocked transitions leave it unchanged; Notice is shown by requestModeChange).
          dropdown.setValue(this.plugin.settings.mode);
        });
      });

    new Setting(containerEl).setName(t("settings.temperature")).addSlider((slider) =>
      slider
        .setLimits(0, 2, 0.1)
        .setValue(settings.temperature)
        .onChange(async (value) => {
          settings.temperature = value;
          await this.save();
        }),
    );

    new Setting(containerEl)
      .setName(t("settings.maxResponseTokens"))
      .setDesc(t("settings.maxResponseTokensDesc"))
      .addText((text) =>
        text.setValue(String(settings.maxTokens)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.requestTimeout"))
      .setDesc(t("settings.requestTimeoutDesc"))
      .addText((text) =>
        text.setValue(String(Math.round(settings.requestTimeoutMs / 1000))).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.requestTimeoutMs =
            Number.isFinite(parsed) && parsed >= 5 ? parsed * 1000 : DEFAULT_SETTINGS.requestTimeoutMs;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.networkRetries"))
      .setDesc(t("settings.networkRetriesDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 5, 1)
          .setValue(settings.maxNetworkRetries)
          .onChange(async (value) => {
            settings.maxNetworkRetries = value;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.systemPrompt"))
      .setDesc(t("settings.systemPromptDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 10;
        text.inputEl.addClass("agentic-chat-system-prompt");
        text.setValue(settings.systemPrompt).onChange(async (value) => {
          settings.systemPrompt = value.trim() ? value : DEFAULT_SYSTEM_PROMPT;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.standingInstructions"))
      .setDesc(t("settings.standingInstructionsDesc"));

    new Setting(containerEl).setName(t("settings.contextWindow")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.autoCompaction"))
      .setDesc(t("settings.autoCompactionDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.compaction.enabled).onChange(async (value) => {
          settings.compaction.enabled = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.compactAt"))
      .setDesc(t("settings.compactAtDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(50, 95, 5)
          .setValue(settings.compaction.thresholdPercent)
          .onChange(async (value) => {
            settings.compaction.thresholdPercent = value;
            await this.save();
          }),
      );

    new Setting(containerEl).setName(t("settings.toolBudget")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.dropOptionalTools"))
      .setDesc(t("settings.dropOptionalToolsDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.toolBudget.enabled).onChange(async (value) => {
          settings.toolBudget.enabled = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.dropToolsPercent"))
      .setDesc(t("settings.dropToolsPercentDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(settings.toolBudget.thresholdPercent)
          .onChange(async (value) => {
            settings.toolBudget.thresholdPercent = value;
            await this.save();
          }),
      );
  }

  private renderApproval(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.approvalGates")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.beforeMutating"))
      .setDesc(t("settings.beforeMutatingDesc"))
      .addDropdown((dropdown) => {
        const options: Record<ApprovalPolicy, string> = {
          allow: t("settings.allowAutomatically"),
          ask: t("settings.askEachTime"),
          deny: t("settings.denyReadOnly"),
        };
        for (const [value, label] of Object.entries(options)) dropdown.addOption(value, label);
        dropdown.setValue(settings.approval.mutating).onChange(async (value) => {
          settings.approval.mutating = value as ApprovalPolicy;
          await this.save();
        });
      });

    this.renderWorkingDirs(containerEl, settings);

    new Setting(containerEl)
      .setName(t("settings.perToolOverrides"))
      .setDesc(t("settings.perToolOverridesDesc"))
      .setHeading();
    for (const tool of createVaultTools(this.app)) {
      const mutating = MUTATING_TOOLS.has(tool.name);
      new Setting(containerEl)
        .setName(tool.label)
        .setDesc(`${tool.name} · ${t(mutating ? "settings.mutating" : "settings.readOnly")}`)
        .addDropdown((dropdown) => {
          dropdown
            .addOption("default", t("settings.default"))
            .addOption("allow", t("common.allow"))
            .addOption("ask", t("common.ask"))
            .addOption("deny", t("common.deny"))
            .setValue(settings.approval.perTool[tool.name] ?? "default")
            .onChange(async (value) => {
              setPerToolApproval(settings.approval, tool.name, value as ApprovalPolicy | "default");
              await this.save();
            });
        });
    }
  }

  /**
   * Working directories (C1/S2): an allow-list working set. When any are granted, tool
   * calls inside auto-run and calls outside route through the gate (ask) — even reads.
   */
  private renderWorkingDirs(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl)
      .setName(t("settings.workingDirs"))
      .setDesc(t("settings.workingDirsDesc"))
      .setClass("agentic-chat-setting-heading-wrap")
      .setHeading()
      .addButton((button) =>
        button.setButtonText(t("settings.addFolder")).onClick(() => {
          new FolderSuggestModal(this.app, (folder) => {
            const result = addWorkingDir(settings.approval.workingDirs, folder.path);
            if (result === "added") {
              this.refresh();
            } else if (result === "invalid") {
              new Notice(t("workingDir.invalid", { path: folder.path }));
            }
          }).open();
        }),
      );

    if (settings.approval.workingDirs.length === 0) {
      containerEl.createDiv({
        cls: "setting-item-description",
        text: t("settings.noWorkingDirs"),
      });
      return;
    }
    for (const dir of settings.approval.workingDirs) {
      new Setting(containerEl)
        .setName(dir === "" ? t("folder.vaultRoot") : dir)
        .setDesc(t("settings.autoRunScope"))
        .addButton((button) =>
          button
            .setButtonText(t("common.remove"))
            .setClass("mod-warning")
            .onClick(async () => {
              if (removeWorkingDir(settings.approval.workingDirs, dir)) {
                await this.save();
                this.redraw();
              }
            }),
        );
    }
  }

  private renderWebAccess(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.webAccess")).setHeading();

    const warning = containerEl.createDiv({ cls: "agentic-chat-settings-warning" });
    warning.createSpan({ cls: "agentic-chat-settings-warning-icon", text: "⚠" });
    warning.createSpan({ text: t("settings.webWarning") });

    new Setting(containerEl)
      .setName(t("settings.enableWeb"))
      .setDesc(t("settings.enableWebDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.web.enabled).onChange(async (value) => {
          settings.web.enabled = value;
          await this.save();
          this.redraw();
        }),
      );

    if (!settings.web.enabled) return;

    new Setting(containerEl)
      .setName(t("settings.searchProvider"))
      .setDesc(t("settings.searchProviderDesc"))
      .addDropdown((dropdown) => {
        for (const provider of WEB_SEARCH_PROVIDERS) {
          dropdown.addOption(provider, WEB_SEARCH_PROVIDER_LABELS[provider]);
        }
        dropdown.setValue(settings.web.searchProvider).onChange(async (value) => {
          settings.web.searchProvider = value as WebSearchProvider;
          await this.save();
          this.redraw();
        });
      });

    if (settings.web.searchProvider === "searxng") {
      new Setting(containerEl)
        .setName(t("settings.searxngUrl"))
        .setDesc(t("settings.searxngUrlDesc"))
        .addText((text) =>
          text
            .setPlaceholder("https://searx.example.com")
            .setValue(settings.web.searxngUrl)
            .onChange(async (value) => {
              settings.web.searxngUrl = value.trim();
              await this.save();
            }),
        );
    } else {
      this.renderSecretInput(containerEl, {
        name: t("settings.searchApiKey"),
        desc: t(settings.web.searchProvider === "tavily" ? "settings.tavilyKeyDesc" : "settings.braveKeyDesc"),
        placeholder: settings.web.searchProvider === "tavily" ? "tvly-..." : "BSA...",
        hasValue: Boolean(settings.web.searchApiKey),
        onSet: async (value) => {
          settings.web.searchApiKey = value;
          await this.save();
        },
        onForget: async () => {
          settings.web.searchApiKey = "";
          await this.save();
        },
      });
    }

    new Setting(containerEl)
      .setName(t("settings.searchResults"))
      .setDesc(t("settings.searchResultsDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(settings.web.maxResults)
          .onChange(async (value) => {
            settings.web.maxResults = value;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.fetchLimit"))
      .setDesc(t("settings.fetchLimitDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "500");
        text.setValue(String(settings.web.fetchCharLimit)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.web.fetchCharLimit =
            Number.isFinite(parsed) && parsed >= 500 ? parsed : DEFAULT_SETTINGS.web.fetchCharLimit;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.allowedHosts"))
      .setDesc(t("settings.allowedHostsDesc"))
      .addText((text) =>
        text
          .setPlaceholder("example.com, *.wikipedia.org")
          .setValue(settings.web.allowedHosts)
          .onChange(async (value) => {
            settings.web.allowedHosts = normalizeAllowedHosts(value);
            await this.save();
            // Update the field to the canonical (lower-cased, deduped) value so typos like `Example.COM` are visible immediately.
            text.setValue(settings.web.allowedHosts);
          }),
      );
  }

  private renderMcp(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.mcpTools")).setHeading();

    const warning = containerEl.createDiv({ cls: "agentic-chat-settings-warning" });
    warning.createSpan({ cls: "agentic-chat-settings-warning-icon", text: "⚠" });
    warning.createSpan({ text: t("settings.mcpWarning") });

    new Setting(containerEl)
      .setName(t("settings.enableMcp"))
      .setDesc(t("settings.enableMcpDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.mcp.enabled).onChange(async (value) => {
          settings.mcp.enabled = value;
          await this.save();
          this.redraw();
        }),
      );

    if (!settings.mcp.enabled) return;

    this.renderProxySettingRows(containerEl, settings.mcp, {
      proxyDesc: t("settings.mcpProxyDesc"),
      noProxyDesc: t("settings.mcpNoProxyDesc"),
    }, async (update) => {
      Object.assign(settings.mcp, update);
      await this.save();
    });

    this.ensurePluginsLoaded();

    {
      const heading = containerEl.createDiv({ cls: "agentic-chat-mcp-heading" });
      heading.createDiv({ text: t("settings.addMcpServer"), cls: "agentic-chat-mcp-heading-title" });
      heading.createDiv({ text: t("settings.mcpCreateDesc"), cls: "setting-item-description" });
    }

    new Setting(containerEl)
      .setClass("agentic-chat-mcp-add")
      .addText((text) =>
        text
          .setPlaceholder(t("settings.serverName"))
          .setValue(this.pendingMcpServerName)
          .onChange((value) => {
            this.pendingMcpServerName = value;
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("https://mcp.example.com/mcp")
          .setValue(this.pendingMcpServerUrl)
          .onChange((value) => {
            this.pendingMcpServerUrl = value;
          }),
      )
      .addButton((button) =>
        button.setButtonText(t("settings.addMcpServer")).onClick(async () => {
          const url = this.pendingMcpServerUrl.trim();
          const name = this.pendingMcpServerName.trim();
          if (!name || !url) {
            new Notice(t("settings.mcpNeedNameUrl"));
            return;
          }
          try {
            if (validateMcpUrl(url) !== null) throw new Error("only HTTPS (or loopback HTTP) endpoints are supported");
            // Package creation can fail mid-write (stale file tree, an
            // externally synced folder of the same name, interrupted writes);
            // surface it instead of dropping the rejection on the floor.
            const result = await this.plugin.pluginService.generateMcpServerPackage({ serverName: name, url });
            this.pendingMcpServerName = "";
            this.pendingMcpServerUrl = "";
            // The package is new; drop the once-only load guard so the next
            // redraw picks it up from the vault.
            this.pluginsLoadedOnce = false;
            new Notice(t("settings.mcpCreated", { path: result.rootPath }));
            this.redraw();
          } catch (error) {
            new Notice(
              t("settings.mcpError", { message: error instanceof Error ? error.message : String(error) }),
            );
          }
        }),
      );

    const displayServers = this.mcpDisplayServers(settings);
    if (displayServers.length === 0) {
      containerEl.createDiv({
        cls: "setting-item-description",
        text: t("settings.noMcpServers"),
      });
      return;
    }

    for (const server of displayServers) {
      this.renderMcpServer(containerEl, settings, server);
    }
  }

  private renderObservability(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.observabilityExport")).setHeading();

    const warning = containerEl.createDiv({ cls: "agentic-chat-settings-warning" });
    warning.createSpan({ cls: "agentic-chat-settings-warning-icon", text: "i" });
    warning.createSpan({ text: t("settings.observabilityWarning") });

    new Setting(containerEl)
      .setName(t("settings.enableObservability"))
      .setDesc(t("settings.enableObservabilityDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.observability.enabled).onChange(async (value) => {
          settings.observability.enabled = value;
          await this.save();
          this.redraw();
        }),
      );

    if (!settings.observability.enabled) return;

    new Setting(containerEl)
      .setName(t("settings.backend"))
      .setDesc(t("settings.backendDesc"))
      .addDropdown((dropdown) => {
        for (const backend of Object.keys(OBSERVABILITY_BACKEND_LABELS) as ObservabilityBackend[]) {
          dropdown.addOption(backend, OBSERVABILITY_BACKEND_LABELS[backend]);
        }
        dropdown.setValue(settings.observability.backend).onChange(async (value) => {
          settings.observability.backend = value as ObservabilityBackend;
          await this.save();
          this.redraw();
        });
      });

    new Setting(containerEl)
      .setName(t(settings.observability.backend === "langfuse" ? "settings.langfuseBaseUrl" : "settings.otlpEndpoint"))
      .setDesc(
        t(settings.observability.backend === "langfuse" ? "settings.langfuseEndpointDesc" : "settings.otlpEndpointDesc"),
      )
      .addText((text) =>
        text
          .setPlaceholder(settings.observability.backend === "langfuse" ? "https://langfuse.example.com" : "https://otel.example.com/v1/traces")
          .setValue(settings.observability.endpoint)
          .onChange(async (value) => {
            settings.observability.endpoint = value.trim();
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.payloadDetail"))
      .setDesc(t("settings.payloadDetailDesc"))
      .addDropdown((dropdown) => {
        for (const mode of Object.keys(OBSERVABILITY_PAYLOAD_LABELS) as ObservabilityPayloadMode[]) {
          dropdown.addOption(mode, OBSERVABILITY_PAYLOAD_LABELS[mode]);
        }
        dropdown.setValue(settings.observability.payloadMode).onChange(async (value) => {
          settings.observability.payloadMode = value as ObservabilityPayloadMode;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.sampleRate"))
      .setDesc(t("settings.sampleRateDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(settings.observability.sampleRate)
          .onChange(async (value) => {
            settings.observability.sampleRate = value;
            await this.save();
          }),
      );

    this.renderProxySettingRows(containerEl, settings.observability, {
      proxyDesc: t("settings.observabilityProxyDesc"),
      noProxyDesc: t("settings.observabilityNoProxyDesc"),
    }, async (update) => {
      Object.assign(settings.observability, update);
      await this.save();
    });

    if (settings.observability.backend === "langfuse") {
      this.renderSecretInput(containerEl, {
        name: t("settings.langfusePublicKey"),
        desc: t("settings.langfusePublicKeyDesc"),
        placeholder: "pk-lf-...",
        hasValue: Boolean(settings.observability.langfusePublicKey),
        onSet: async (value) => {
          settings.observability.langfusePublicKey = value;
          await this.save();
        },
        onForget: async () => {
          settings.observability.langfusePublicKey = "";
          await this.save();
        },
      });
      this.renderSecretInput(containerEl, {
        name: t("settings.langfuseSecretKey"),
        desc: t("settings.langfuseSecretKeyDesc"),
        placeholder: "sk-lf-...",
        hasValue: Boolean(settings.observability.langfuseSecretKey),
        onSet: async (value) => {
          settings.observability.langfuseSecretKey = value;
          await this.save();
        },
        onForget: async () => {
          settings.observability.langfuseSecretKey = "";
          await this.save();
        },
      });
      return;
    }

    new Setting(containerEl)
      .setName(t("settings.authHeaderName"))
      .setDesc(t("settings.authHeaderNameDesc"))
      .addText((text) =>
        text
          .setPlaceholder("Authorization")
          .setValue(settings.observability.authHeaderName)
          .onChange(async (value) => {
            settings.observability.authHeaderName = value.trim();
            await this.save();
          }),
      );

    this.renderSecretInput(containerEl, {
      name: t("settings.authHeaderValue"),
      desc: t("settings.authHeaderValueDesc"),
      placeholder: "Bearer ...",
      hasValue: Boolean(settings.observability.authHeaderValue),
      onSet: async (value) => {
        settings.observability.authHeaderValue = value;
        await this.save();
      },
      onForget: async () => {
        settings.observability.authHeaderValue = "";
        await this.save();
      },
    });
  }

  private renderMcpServer(
    containerEl: HTMLElement,
    settings: AgenticChatSettings,
    server: McpServerSettings,
  ): void {
    const pluginManaged = server.source === "plugin";
    const endpointProblem = mcpEndpointProblem(server.url);
    let testButton: ButtonComponent | undefined;
    const syncTestButton = (): void => {
      if (!testButton) return;
      const state = mcpTestButtonState(server);
      testButton.setButtonText(state.label).setDisabled(Boolean(state.problem));
    };
    const header = new Setting(containerEl)
      .setName(server.name || server.id)
      .setDesc(
        formatMcpServerSummary(server, endpointProblem) +
          (pluginManaged ? t("settings.mcpManagedBy", { path: server.pluginRoot ?? "" }) : ""),
      )
      .setClass("agentic-chat-mcp-server-header")
      .setClass("agentic-chat-setting-heading-wrap")
      .setHeading()
      .addToggle((toggle) =>
        toggle.setValue(server.enabled).onChange(async (value) => {
          server.enabled = value;
          this.syncMcpServerToState(server);
          await this.save();
        }),
      )
      .addButton((button) => {
        testButton = button;
        syncTestButton();
        return button
          .onClick(async () => {
            const state = mcpTestButtonState(server);
            if (state.problem) {
              new Notice(state.problem);
              syncTestButton();
              return;
            }
            await this.runMcpButtonAction(
              button,
              state.label,
              state.busyLabel,
              () => state.needsOAuthSignIn ? this.authenticateAndProbeMcpServer(server) : this.testMcpServer(server),
            );
            syncTestButton();
          });
      });

    // Show banner when server advertised OAuth via 401 but authType is still none/bearer/header
    if (server.pendingOAuthChallenge && server.pendingOAuthResourceUrl) {
      const banner = containerEl.createDiv({ cls: "setting-item-description agentic-chat-oauth-banner" });
      const isNone = server.authType === "none";
      banner.createSpan({
        text: isNone
          ? `This server requires OAuth (resource: ${server.pendingOAuthResourceUrl}). Click Authenticate & test to sign in — no need to change the Authentication dropdown manually.`
          : `This server advertises OAuth (resource: ${server.pendingOAuthResourceUrl}) but is set to ${server.authType}. `,
      });
      if (!isNone) {
        const switchBtn = banner.createEl("button", { text: t("settings.switchOAuth"), cls: "mod-cta" });
        switchBtn.addEventListener("click", () => {
          void (async () => {
            server.authType = "oauth";
            server.pendingOAuthChallenge = undefined;
            server.pendingOAuthResourceUrl = undefined;
            this.syncMcpServerToState(server);
            await this.save();
            this.redraw();
          })();
        });
      }
    }

    if (server.authType === "oauth") {
      header.addButton((button) =>
        button
          .setButtonText(t("settings.reauthenticate"))
          .setDisabled(Boolean(endpointProblem))
          .onClick(async () => {
            if (endpointProblem) {
              new Notice(endpointProblem);
              return;
            }
            await this.runMcpButtonAction(button, t("settings.reauthenticate"), t("settings.reauthenticating"), () =>
              this.authenticateAndProbeMcpServer(server),
            );
          }),
      );
    }

    header.addButton((button) =>
      button
        .setButtonText(t("common.remove"))
        .setClass("mod-warning")
        .setDisabled(pluginManaged)
        .onClick(async () => {
          this.deleteMcpPerToolApprovals(settings, server.id);
          this.clearMcpSecretSlots(server);
          settings.mcp.servers = settings.mcp.servers.filter((entry) => entry !== server);
          await this.save();
          this.redraw();
        }),
    );

    if (pluginManaged) {
      containerEl.createDiv({
        cls: "setting-item-description",
        text: t("settings.pluginManagedDesc", { path: server.pluginRoot ?? "" }),
      });
    }

    new Setting(containerEl)
      .setName(t("settings.name"))
      .setDesc(t("settings.nameDesc"))
      .addText((text) =>
        text
          .setDisabled(pluginManaged)
          .setValue(server.name)
          .onChange(async (value) => {
            server.name = value.trim() || server.id;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.serverId"))
      .setDesc(t("settings.serverIdDesc"))
      .addText((text) =>
        text
          .setDisabled(pluginManaged)
          .setValue(server.id)
          .onChange(async (value) => {
            const next = normalizeMcpServerId(value);
            this.renameMcpServer(settings, server, this.nextMcpServerId(settings, next, server));
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.httpsEndpoint"))
      .setDesc(endpointProblem || t("settings.httpsEndpointDesc"))
      .addText((text) =>
        text
          .setDisabled(pluginManaged)
          .setPlaceholder("https://mcp.example.com/mcp")
          .setValue(server.url)
          .onChange(async (value) => {
            const result = this.updateMcpServerEndpoint(settings, server, value);
            await this.save();
            if (result.clearedCredentials) new Notice(`${server.name}: cleared MCP credentials for the changed endpoint.`);
            if (result.shouldDisplay) this.redraw();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.approval"))
      .setDesc(t("settings.approvalDesc"))
      .addDropdown((dropdown) =>
        dropdown
        .addOption("ask", t("settings.askEachTime"))
        .addOption("allow", t("settings.allowAutomatically"))
        .addOption("deny", t("common.deny"))
          .setValue(server.approval)
          .onChange(async (value) => {
            server.approval = value as ApprovalPolicy;
            this.syncMcpServerToState(server);
            await this.save();
          }),
      );

    this.renderMcpSetupGuide(containerEl, server);
    this.renderMcpAuthentication(containerEl, server, syncTestButton);
    this.renderMcpToolFilters(containerEl, server);
    this.renderMcpToolApprovals(containerEl, settings, server);
  }

  private renderMcpToolFilters(containerEl: HTMLElement, server: McpServerSettings): void {
    new Setting(containerEl).setName(t("settings.toolFiltering")).setHeading();
    containerEl.createDiv({
      cls: "setting-item-description",
      text: t("settings.toolFilteringDetail"),
    });
    new Setting(containerEl)
      .setName(t("settings.enabledTools"))
      .setDesc(t("settings.enabledToolsDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.inputEl.addClass("agentic-chat-system-prompt");
        text.setPlaceholder("*\nread_*\n*_safe").setValue((server.enabledTools ?? []).join("\n")).onChange(async (value) => {
          const patterns = healMcpToolGlobs(
            value
              .split(/\r?\n/)
              .map((line) => line.normalize("NFC").trim())
              .filter((line) => line.length > 0 && !line.startsWith("#")),
          );
          server.enabledTools = patterns;
          this.syncMcpServerToState(server);
          await this.save();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.disabledTools"))
      .setDesc(t("settings.disabledToolsDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.inputEl.addClass("agentic-chat-system-prompt");
        text.setPlaceholder("*_danger\nwrite_*\nsecret_*").setValue((server.disabledTools ?? []).join("\n")).onChange(async (value) => {
          const patterns = healMcpToolGlobs(
            value
              .split(/\r?\n/)
              .map((line) => line.normalize("NFC").trim())
              .filter((line) => line.length > 0 && !line.startsWith("#")),
          );
          server.disabledTools = patterns;
          this.syncMcpServerToState(server);
          await this.save();
        });
      });
  }

  private renderMcpToolApprovals(
    containerEl: HTMLElement,
    settings: AgenticChatSettings,
    server: McpServerSettings,
  ): void {
    new Setting(containerEl)
      .setName(t("settings.toolApprovals"))
      .setDesc(t("settings.toolApprovalsDesc"))
      .setClass("agentic-chat-setting-heading-wrap")
      .setHeading()
      .addButton((button) =>
        button.setButtonText(t("settings.refreshTools")).onClick(async () => {
          await this.refreshMcpKnownTools(server, button);
        }),
      );

    if (server.knownTools.length === 0) {
      containerEl.createDiv({
        cls: "setting-item-description",
        text: t("settings.noToolsCached"),
      });
      return;
    }

    for (const tool of [...server.knownTools].sort((a, b) => a.name.localeCompare(b.name))) {
      const localName = mcpKnownToolLocalName(server, tool);
      const title = tool.title && tool.title !== tool.name ? `${tool.title} (${tool.name})` : tool.name;
      new Setting(containerEl)
        .setName(title)
        .setDesc(formatMcpToolApprovalDescription(localName, tool))
        .addDropdown((dropdown) =>
          dropdown
            .addOption(
              "default",
              t("settings.defaultWith", {
                value: t(
                  server.approval === "allow"
                    ? "common.allow"
                    : server.approval === "deny"
                      ? "common.deny"
                      : "common.ask",
                ),
              }),
            )
            .addOption("allow", t("common.allow"))
            .addOption("ask", t("common.ask"))
            .addOption("deny", t("common.deny"))
            .setValue(settings.approval.perTool[localName] ?? "default")
            .onChange(async (value) => {
              setPerToolApproval(settings.approval, localName, value as ApprovalPolicy | "default");
              await this.save();
            }),
        );
    }
  }

  private renderMcpAuthentication(
    containerEl: HTMLElement,
    server: McpServerSettings,
    onAuthChanged: () => void,
  ): void {
    const authProblem = mcpAuthProblem(server);
    new Setting(containerEl)
      .setName(t("settings.authentication"))
      .setDesc(authProblem || t("settings.authenticationDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", t("settings.noAuth"))
          .addOption("bearer", t("settings.bearerToken"))
          .addOption("header", t("settings.staticHeader"))
          .addOption("oauth", t("settings.oauth"))
          .setValue(server.authType)
          .onChange(async (value) => {
            server.authType = value as McpAuthType;
            if (server.authType === "bearer") server.authHeaderName = "";
            this.syncMcpServerToState(server);
            await this.save();
            this.redraw();
          }),
      );

    if (server.authType === "oauth") {
      this.renderMcpOAuth(containerEl, server);
      return;
    }

    if (server.authType === "bearer") {
      this.renderSecretInput(containerEl, {
        name: t("settings.bearerTokenName"),
        desc: t("settings.bearerTokenDesc"),
        placeholder: "token",
        hasValue: Boolean(server.authHeaderValue),
        onSet: async (value) => {
          server.authHeaderValue = value;
          this.syncMcpServerToState(server);
          await this.save();
          onAuthChanged();
        },
        onForget: async () => {
          server.authHeaderValue = "";
          this.syncMcpServerToState(server);
          await this.save();
          onAuthChanged();
        },
      });
      return;
    }

    if (server.authType !== "header") return;

    new Setting(containerEl)
      .setName(t("settings.authHeader"))
      .setDesc(t("settings.authHeaderDesc"))
      .addText((text) =>
        text
          .setPlaceholder("X-API-Key")
          .setValue(server.authHeaderName)
          .onChange(async (value) => {
            server.authHeaderName = value.trim();
            this.syncMcpServerToState(server);
            await this.save();
            onAuthChanged();
          }),
      );

    this.renderSecretInput(containerEl, {
      name: t("settings.authValue"),
      desc: t("settings.authValueDesc"),
      placeholder: "secret header value",
      hasValue: Boolean(server.authHeaderValue),
      onSet: async (value) => {
        server.authHeaderValue = value;
        this.syncMcpServerToState(server);
        await this.save();
        onAuthChanged();
      },
      onForget: async () => {
        server.authHeaderValue = "";
        this.syncMcpServerToState(server);
        await this.save();
        onAuthChanged();
      },
    });
  }

  private renderMcpOAuth(containerEl: HTMLElement, server: McpServerSettings): void {
    const authenticated = hasMcpOAuthAccess(server);
    const scopePart = server.oauth.scope ? t("settings.oauthScopes", { scopes: server.oauth.scope }) : "";
    new Setting(containerEl)
      .setName(t("settings.oauthStatus"))
      .setDesc(
        authenticated ? t("settings.oauthAuthenticated", { scope: scopePart }) : t("settings.oauthNotAuthenticated"),
      )
      .addButton((button) =>
        button
          .setButtonText(t("settings.forgetToken"))
          .setDisabled(!server.oauth.accessToken && !server.oauth.refreshToken)
          .onClick(async () => {
            forgetMcpOAuthTokens(server);
            server.knownTools = [];
            this.syncMcpServerToState(server);
            await this.save();
            this.redraw();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.oauthDesktopRedirect"))
      .setDesc(t("settings.oauthDesktopRedirectDesc"))
      .addText((text) => text.setValue(DEFAULT_MCP_OAUTH_REDIRECT_URI).setDisabled(true))
      .addButton((button) =>
        button.setButtonText(t("common.copy")).onClick(async () => {
          if (await this.copyToClipboard(DEFAULT_MCP_OAUTH_REDIRECT_URI)) {
            new Notice(t("settings.oauthUriCopied"));
          } else {
            new Notice(`MCP OAuth redirect URI: ${DEFAULT_MCP_OAUTH_REDIRECT_URI}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.oauthMobileRedirect"))
      .setDesc(t("settings.oauthMobileRedirectDesc"))
      .addText((text) => text.setValue(MCP_OAUTH_OBSIDIAN_REDIRECT_URI).setDisabled(true))
      .addButton((button) =>
        button.setButtonText(t("common.copy")).onClick(async () => {
          if (await this.copyToClipboard(MCP_OAUTH_OBSIDIAN_REDIRECT_URI)) {
            new Notice(t("settings.oauthMobileUriCopied"));
          } else {
            new Notice(`MCP OAuth mobile redirect URI: ${MCP_OAUTH_OBSIDIAN_REDIRECT_URI}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.oauthClientId"))
      .setDesc(t("settings.oauthClientIdDesc"))
      .addText((text) =>
        text.setValue(server.oauth.clientId).onChange(async (value) => {
          server.oauth.clientId = value.trim();
          server.oauth.dynamicClientRegistration = false;
          server.oauth.registeredRedirectUri = "";
          this.syncMcpServerToState(server);
          await this.save();
        }),
      );

    this.renderSecretInput(containerEl, {
      name: t("settings.oauthClientSecret"),
      desc: t("settings.oauthClientSecretDesc"),
      placeholder: "client secret",
      hasValue: Boolean(server.oauth.clientSecret),
      onSet: async (value) => {
        server.oauth.clientSecret = value;
        server.oauth.dynamicClientRegistration = false;
        server.oauth.registeredRedirectUri = "";
        this.syncMcpServerToState(server);
        await this.save();
      },
      onForget: async () => {
        server.oauth.clientSecret = "";
        server.oauth.dynamicClientRegistration = false;
        server.oauth.registeredRedirectUri = "";
        this.syncMcpServerToState(server);
        await this.save();
      },
    });
  }

  private async refreshMcpKnownTools(server: McpServerSettings, button?: ButtonComponent): Promise<void> {
    button?.setDisabled(true);
    try {
      const result = await this.probeAndCacheMcpTools(server);
      const sample = formatMcpToolSample(result.toolNames);
      new Notice(
        `${server.name}: refreshed ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}${sample}.`,
      );
      this.redraw();
    } catch (error) {
      new Notice(`Agentic chat: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      button?.setDisabled(false);
    }
  }

  private async probeAndCacheMcpTools(server: McpServerSettings): Promise<Awaited<ReturnType<typeof probeMcpServer>>> {
    const endpointProblem = mcpEndpointProblem(server.url);
    if (endpointProblem) throw new Error(endpointProblem);
    const result = await probeMcpServer(server, createMcpFetcher(this.effectiveMcpProxySettings()), {
      onServerChanged: async (changed) => {
        this.syncMcpServerToState(changed);
        await this.save();
      },
    });
    server.knownTools = result.tools;
    server.enabled = true;
    this.syncMcpServerToState(server);
    await this.save();
    return result;
  }

  private async testMcpServer(server: McpServerSettings): Promise<void> {
    const result = await this.probeAndCacheMcpTools(server);
    const sample = formatMcpToolSample(result.toolNames);
    new Notice(
      `${server.name}: connected; discovered ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}${sample}.`,
    );
    this.redraw();
  }

  private async authenticateAndProbeMcpServer(server: McpServerSettings): Promise<void> {
    const fetcher = createMcpFetcher(this.effectiveMcpProxySettings());
    await authenticateMcpServer(server, fetcher, {
      callbackReceiver: Platform.isMobileApp ? this.plugin.createMcpOAuthCallbackReceiver() : undefined,
      onProgress: (event) => this.handleMcpOAuthProgress(server, event),
    });
    this.syncMcpServerToState(server);
    const result = await probeMcpServer(server, fetcher, {
      onServerChanged: async (changed) => {
        this.syncMcpServerToState(changed);
        await this.save();
      },
    });
    server.knownTools = result.tools;
    this.syncMcpServerToState(server);
    await this.save();
    const sample = formatMcpToolSample(result.toolNames);
    new Notice(
      `Authenticated ${server.name}; discovered ${result.toolCount} tool${
        result.toolCount === 1 ? "" : "s"
      }${sample}.`,
    );
    this.redraw();
  }

  private effectiveMcpProxySettings(): NetworkSettings {
    const { network, mcp } = this.plugin.settings;
    return effectiveProxy(mcp, network);
  }

  /**
   * The HTTP-proxy + no-proxy row pair shared by the network, MCP, and
   * observability tabs. Only the descriptions differ per tab; persistence is
   * delegated so each tab writes its own settings slice.
   */
  private renderProxySettingRows(
    containerEl: HTMLElement,
    values: ProxySettings,
    copy: { proxyDesc: string; noProxyDesc: string },
    onWrite: (update: Partial<ProxySettings>) => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(t("settings.httpProxy"))
      .setDesc(copy.proxyDesc)
      .addText((text) =>
        text
          .setPlaceholder(PROXY_URL_EXAMPLE)
          .setValue(values.proxyUrl)
          .onChange(async (value) => {
            await onWrite({ proxyUrl: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.noProxy"))
      .setDesc(copy.noProxyDesc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_PROXY_SETTINGS.noProxy)
          .setValue(values.noProxy)
          .onChange(async (value) => {
            await onWrite({ noProxy: value.trim() });
          }),
      );
  }

  private handleMcpOAuthProgress(server: McpServerSettings, event: McpOAuthProgressEvent): void {
    if (event.stage === "authorization-url") {
      const authorizationUrl = event.detail ?? "";
      console.warn(
        `Agentic Chat MCP OAuth: authorization URL for ${server.name}; copy this into a browser if no tab opens: ${authorizationUrl}`,
      );
      if (authorizationUrl) {
        void this.copyToClipboard(authorizationUrl).then((copied) => {
          if (copied) {
            new Notice(`${server.name}: OAuth authorization URL copied. Use it if the browser does not open.`);
          } else {
            new Notice(`${server.name}: OAuth authorization URL: ${authorizationUrl}`, 0);
          }
        });
      }
      return;
    }
    if (
      event.stage === "discovery" ||
      event.stage === "registration" ||
      event.stage === "browser-open" ||
      event.stage === "callback-wait"
    ) {
      new Notice(`${server.name}: ${event.message}`);
    }
  }

  private async runMcpButtonAction(
    button: ButtonComponent,
    label: string,
    busyLabel: string,
    action: () => Promise<void>,
  ): Promise<void> {
    button.setDisabled(true);
    button.setButtonText(busyLabel);
    try {
      await action();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // For OAuth-required (authType none/bearer/header but server advertises resource_metadata), the client already set
      // pendingOAuthChallenge on the server. Show a banner + redraw so Authenticate & test appears without manual dropdown.
      if (msg.includes("requires OAuth") || (error as { resourceUrl?: string })?.resourceUrl) {
        new Notice(`Agentic Chat MCP: ${msg} — check the OAuth banner below.`);
        this.redraw();
      } else {
        new Notice(`Agentic Chat MCP: ${msg}`);
      }
    } finally {
      button.setButtonText(label);
      button.setDisabled(false);
    }
  }

  private async copyToClipboard(value: string): Promise<boolean> {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return false;
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  private nextMcpServerId(
    settings: AgenticChatSettings,
    base: string,
    current?: McpServerSettings,
  ): string {
    const used = new Set([
      ...settings.mcp.servers.filter((entry) => entry !== current).map((entry) => entry.id),
      ...Object.keys(settings.plugins.mcpState).filter((id) => id !== current?.id),
    ]);
    return nextUniqueMcpServerId(base, used);
  }

  private updateMcpServerEndpoint(
    settings: AgenticChatSettings,
    server: McpServerSettings,
    value: string,
  ): { clearedCredentials: boolean; shouldDisplay: boolean } {
    const previousUrl = server.url;
    const previousId = server.id;
    const previousEndpointProblem = mcpEndpointProblem(previousUrl);
    const wasEnabled = server.enabled;
    server.url = value.trim();
    const suggestedId = serverIdFromMcpUrl(server.url);
    if (suggestedId && previousId === "mcp" && (!previousUrl || previousUrl === "https://")) {
      this.renameMcpServer(settings, server, this.nextMcpServerId(settings, suggestedId, server));
    }
    let clearedCredentials = false;
    if (previousUrl.trim() !== server.url.trim()) {
      this.clearMcpKnownToolsAndApprovals(settings, server);
      if (mcpCredentialResourceChanged(previousUrl, server.url)) {
        resetMcpCredentials(server);
        clearedCredentials = true;
      }
    }
    if (!mcpEndpointProblem(server.url)) server.enabled = true;
    this.syncMcpServerToState(server);
    return {
      clearedCredentials,
      shouldDisplay:
        Boolean(previousEndpointProblem) !== Boolean(mcpEndpointProblem(server.url)) ||
        wasEnabled !== server.enabled ||
        previousId !== server.id,
    };
  }

  private renameMcpServer(settings: AgenticChatSettings, server: McpServerSettings, nextId: string): void {
    const previousId = server.id;
    if (previousId === nextId) return;
    const previousSecretIds = mcpSecretIds(server);
    const previousApprovals = this.deleteMcpPerToolApprovals(settings, previousId);
    const previousLocalNames = server.knownTools.map((tool) => mcpKnownToolLocalName(server, tool));
    const previousState = settings.plugins.mcpState[previousId];
    server.id = nextId;
    resetMcpServerSecretRefs(server);
    if (previousState && server.source === "plugin") {
      settings.plugins.mcpState[nextId] = previousState;
      // Re-key secret ids inside the moved state
      previousState.authHeaderValueSecretId = server.authHeaderValueSecretId;
      previousState.oauth.clientSecretSecretId = server.oauth.clientSecretSecretId;
      previousState.oauth.accessTokenSecretId = server.oauth.accessTokenSecretId;
      previousState.oauth.refreshTokenSecretId = server.oauth.refreshTokenSecretId;
      delete settings.plugins.mcpState[previousId];
    }
    this.clearSecretIds(previousSecretIds.filter((id) => !mcpSecretIds(server).includes(id)));
    this.rebaseMcpKnownToolLocalNames(server);
    for (let index = 0; index < server.knownTools.length; index += 1) {
      const policy = previousApprovals[previousLocalNames[index]];
      const nextLocalName = mcpKnownToolLocalName(server, server.knownTools[index]);
      if (policy) setPerToolApproval(settings.approval, nextLocalName, policy);
    }
    this.syncMcpServerToState(server);
  }

  private clearMcpKnownToolsAndApprovals(settings: AgenticChatSettings, server: McpServerSettings): void {
    this.deleteMcpPerToolApprovals(settings, server.id);
    server.knownTools = [];
    this.syncMcpServerToState(server);
  }

  private clearMcpSecretSlots(server: McpServerSettings): void {
    this.clearSecretIds(mcpSecretIds(server));
  }

  private clearSecretIds(secretIds: string[]): void {
    const app = (this as { app?: App & { secretStorage?: { setSecret?: (id: string, value: string) => void } } }).app;
    const secretStorage = app?.secretStorage;
    if (!secretStorage?.setSecret) return;
    for (const id of secretIds) {
      try {
        secretStorage.setSecret(id, "");
      } catch (error) {
        console.warn(`Agentic Chat: failed to clear secret ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private deleteMcpPerToolApprovals(settings: AgenticChatSettings, serverId: string): Record<string, ApprovalPolicy> {
    return clearMcpPerToolApprovals(settings.approval, serverId);
  }

  private rebaseMcpKnownToolLocalNames(server: McpServerSettings): void {
    const localNames = localMcpToolNames(server.id, server.knownTools.map((tool) => tool.name));
    for (let index = 0; index < server.knownTools.length; index += 1) {
      server.knownTools[index].localName = localNames[index];
    }
  }

  private renderMcpSetupGuide(containerEl: HTMLElement, server: McpServerSettings): void {
    const description = mcpServerSetupSteps(server)
      .map((step) => `${step.label}: ${step.status === "complete" ? "done" : step.status} - ${step.message}`)
      .join(" ");
    new Setting(containerEl)
      .setName(t("settings.setupGuide"))
      .setDesc(description)
      .addButton((button) =>
        button.setButtonText(t("settings.copyConfig")).onClick(async () => {
          const copied = await this.copyToClipboard(JSON.stringify(exportMcpServerConfig(server), null, 2));
          new Notice(copied ? `${server.name}: MCP config copied without secrets.` : `${server.name}: could not copy MCP config.`);
        }),
      );
  }

  private renderSecretInput(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      placeholder: string;
      hasValue: boolean;
      onSet: (value: string) => Promise<void>;
      onForget: () => Promise<void>;
    },
  ): void {
    const status = t(options.hasValue ? "settings.secretStored" : "settings.secretEmpty");
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(`${options.desc} ${status}`)
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(options.placeholder).setValue("").onChange(async (value) => {
          const trimmed = value.trim();
          if (!trimmed) return;
          await options.onSet(trimmed);
        });
      })
      .addButton((button) =>
        button
          .setButtonText(t("settings.forget"))
          .setDisabled(!options.hasValue)
          .onClick(async () => {
            button.setDisabled(true);
            await options.onForget();
            this.redraw();
          }),
      );
  }

  /** Explain how secrets are persisted for provider and tool credentials. */
  private renderApiKeyWarning(containerEl: HTMLElement): void {
    const warning = containerEl.createDiv({ cls: "agentic-chat-settings-warning" });
    warning.createSpan({ cls: "agentic-chat-settings-warning-icon", text: "i" });
    warning.createSpan({ text: t("settings.secretWarning") });
  }

  private renderNotifications(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.tabs.notifications")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.backgroundNotifications"))
      .setDesc(t("settings.backgroundNotificationsDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.notifications.enabled).onChange(async (value) => {
          settings.notifications.enabled = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.costAlert"))
      .setDesc(t("settings.costAlertDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "0");
        text.inputEl.setAttribute("step", "any");
        text.setValue(String(settings.notifications.costAlertUsd)).onChange(async (value) => {
          const parsed = Number.parseFloat(value);
          settings.notifications.costAlertUsd = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          await this.save();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.costCap"))
      .setDesc(t("settings.costCapDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "0");
        text.inputEl.setAttribute("step", "any");
        text.setValue(String(settings.notifications.costCapUsd)).onChange(async (value) => {
          const parsed = Number.parseFloat(value);
          settings.notifications.costCapUsd = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          await this.save();
        });
      });
  }

  private renderResources(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    new Setting(containerEl).setName(t("settings.agentPlugins")).setHeading();

    const desc = containerEl.createDiv({ cls: "setting-item-description" });
    desc.createSpan({ text: t("settings.agentPluginsDesc") });

    new Setting(containerEl)
      .setName(t("settings.import"))
      .setClass("agentic-chat-plugins-import")
      .addButton((button) =>
        button
          .setButtonText(t("settings.installPlugin"))
          .setCta()
          .onClick(() => this.openInstallModal()),
      )
      .addButton((button) =>
        button.setButtonText(t("settings.newSkill")).onClick(() => {
          new NewSkillModal(this.app, this.plugin.pluginService, (result) => {
            noticeInstallResult(result);
            this.pluginsLoadedOnce = false;
            void this.save().then(() => this.redraw());
          }).open();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(t("settings.repairBuiltins"))
          .setDisabled(!this.builtinsPackageExists(settings))
          .onClick(async () => {
            await this.plugin.pluginService.repairBuiltins();
            new Notice(t("settings.builtinsRecreated"));
            this.pluginsLoadedOnce = false;
            await this.save();
            this.redraw();
          }),
      );

    this.folderSetting(
      containerEl,
      t("settings.pluginsFolder"),
      t("settings.pluginsFolderDesc"),
      settings.plugins.folder,
      async (value) => {
        settings.plugins.folder = value;
        this.plugin.pluginService.invalidate();
        this.pluginsLoadedOnce = false;
        await this.save();
        this.redraw();
      },
    );

    this.renderPluginsList(containerEl, settings);

    new Setting(containerEl).setName(t("settings.subagents")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.subagentTimeout"))
      .setDesc(t("settings.subagentTimeoutDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.subagentDisabled"))
          .setValue(settings.subagentTimeoutSeconds > 0 ? String(settings.subagentTimeoutSeconds) : "")
          .onChange(async (value) => {
            // Same heal path as load: whole seconds clamped to [0, 24h].
            settings.subagentTimeoutSeconds = healSubagentTimeout(Number(value));
            await this.save();
          }),
      );

    new Setting(containerEl).setName(t("settings.semanticRetrieval")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.embeddings"))
      .setDesc(t("settings.embeddingsDesc"))
      .addToggle((toggle) =>
        toggle.setValue(settings.embeddings.enabled).onChange(async (value) => {
          settings.embeddings.enabled = value;
          await this.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settings.embeddingProvider"))
      .setDesc(t("settings.embeddingProviderDesc"))
      .addDropdown((dropdown) => {
        const options: Record<EmbeddingProviderId, string> = {
          openrouter: t("provider.openRouter"),
          ollama: t("provider.ollama"),
          "openai-compatible": t("provider.openaiCompatible"),
        };
        for (const [value, label] of Object.entries(options)) dropdown.addOption(value, label);
        dropdown.setValue(settings.embeddings.provider).onChange(async (value) => {
          settings.embeddings.provider = value as EmbeddingProviderId;
          await this.save();
          this.redraw();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.embeddingModel"))
      .setDesc(t("settings.embeddingModelDesc", { model: activeEmbeddingModel(settings.embeddings) || t("settings.noneConfigured") }))
      .addText((text) =>
        text
          .setPlaceholder(embeddingModelPlaceholder(settings.embeddings.provider))
          .setValue(activeEmbeddingModel(settings.embeddings))
          .onChange(async (value) => {
            this.setEmbeddingModel(settings, value);
            await this.save();
          }),
      );
    new Setting(containerEl)
      .setName(t("settings.vectorDimensions"))
      .setDesc(t("settings.vectorDimensionsDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "16");
        text.inputEl.setAttribute("max", "16384");
        text.setValue(String(settings.embeddings.dimensions)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.embeddings.dimensions = Number.isFinite(parsed)
            ? Math.min(16_384, Math.max(16, parsed))
            : DEFAULT_EMBEDDING_SETTINGS.dimensions;
          await this.save();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.languageCoverage"))
      .setDesc(t("settings.languageCoverageDesc"))
      .addDropdown((dropdown) =>
        dropdown
        .addOption("multilingual", t("settings.multilingual"))
        .addOption("monolingual", t("settings.monolingual"))
        .addOption("unknown", t("settings.unknown"))
          .setValue(settings.embeddings.languageCoverage)
          .onChange(async (value) => {
            settings.embeddings.languageCoverage = value as EmbeddingSettings["languageCoverage"];
            await this.save();
          }),
      );
    new Setting(containerEl)
      .setName(t("settings.batchSize"))
      .setDesc(t("settings.batchSizeDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "1");
        text.inputEl.setAttribute("max", "256");
        text.setValue(String(settings.embeddings.batchSize)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.embeddings.batchSize = Number.isFinite(parsed)
            ? Math.min(256, Math.max(1, parsed))
            : DEFAULT_EMBEDDING_SETTINGS.batchSize;
          await this.save();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.maxIndexedChars"))
      .setDesc(t("settings.maxIndexedCharsDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.setAttribute("min", "500");
        text.inputEl.setAttribute("max", "200000");
        text.setValue(String(settings.embeddings.maxDocumentChars)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.embeddings.maxDocumentChars = Number.isFinite(parsed)
            ? Math.min(200_000, Math.max(500, parsed))
            : DEFAULT_EMBEDDING_SETTINGS.maxDocumentChars;
          await this.save();
        });
      });

    new Setting(containerEl).setName(t("settings.ignoredFiles")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.ignoreList"))
      .setDesc(t("settings.ignoreListDesc"))
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.addClass("agentic-chat-system-prompt");
        text.setPlaceholder("Private/\n*.secret.md").setValue(settings.ignoredGlobs).onChange(async (value) => {
          settings.ignoredGlobs = value;
          await this.save();
        });
      });
  }

  private renderPluginsList(containerEl: HTMLElement, settings: AgenticChatSettings): void {
    this.ensurePluginsLoaded();
    const plugins = this.plugin.pluginService.getLoaded();
    const deleted = this.externallyDeletedPlugins;
    if (plugins.length === 0 && deleted.length === 0) {
      containerEl.createDiv({ cls: "setting-item-description", text: t("settings.noPlugins") });
      return;
    }

    if (plugins.length > 0) {
    new Setting(containerEl).setName(t("settings.installedPlugins")).setHeading();
      for (const plugin of plugins) {
        this.renderPluginRow(containerEl, settings, plugin);
      }
    }
    if (deleted.length > 0) {
    new Setting(containerEl).setName(t("settings.deletedOnDisk")).setHeading();
      containerEl.createDiv({
        cls: "setting-item-description",
        text: t("settings.deletedPluginsDesc"),
      });
      for (const plugin of deleted) {
        this.renderDeletedPluginRow(containerEl, settings, plugin);
      }
      new Setting(containerEl).addButton((button) =>
        button.setButtonText(t("common.close")).onClick(() => {
          this.externallyDeletedPlugins = [];
          this.redraw();
        }),
      );
    }
  }

  private renderPluginRow(containerEl: HTMLElement, settings: AgenticChatSettings, plugin: LoadedPlugin): void {
    const row = containerEl.createDiv({ cls: "agentic-chat-plugin-row" });

    const main = row.createDiv({ cls: "agentic-chat-plugin-main" });
    main.createDiv({ cls: "agentic-chat-plugin-name", text: plugin.name });

    const status = plugin.enabled ? plugin.auditStatus : "disabled";
    const typeCounts =
      `${plugin.skills.length} skill${plugin.skills.length === 1 ? "" : "s"}, ` +
      `${plugin.mcpServers.length} MCP server${plugin.mcpServers.length === 1 ? "" : "s"}`;
    const meta = main.createDiv({ cls: "agentic-chat-plugin-meta" });
    meta.createSpan({ text: `${plugin.rootPath} — ${status}, ${typeCounts}` });
    const extra: string[] = [];
    if (plugin.version) extra.push(`v${plugin.version}`);
    if (plugin.manifestProblem) extra.push(plugin.manifestProblem);
    if (plugin.reports.length > 0) extra.push(plugin.reports.map((report) => report.message).join("; "));
    const source = settings.plugins.sources?.[plugin.name];
    if (source) extra.push(`Source: ${source}`);
    if (extra.length > 0) {
      const tail = meta.createSpan({ cls: "agentic-chat-plugin-meta-extra" });
      tail.createSpan({ text: ` — ${extra.join(" · ")}` });
    }

    const controls = row.createDiv({ cls: "agentic-chat-plugin-controls" });
    new ToggleComponent(controls)
      .setValue(plugin.enabled)
      .setTooltip(`Enable ${plugin.name}`)
      .onChange(async (value) => {
        const enabled = { ...settings.plugins.enabled };
        if (value) delete enabled[plugin.name];
        else enabled[plugin.name] = false;
        settings.plugins.enabled = enabled;
        this.plugin.pluginService.invalidate();
        this.pluginsLoadedOnce = false;
        await this.save();
        this.redraw();
      });
    new ButtonComponent(controls)
      .setButtonText(t("settings.openFolder"))
      .onClick(() => this.openInVault(plugin.rootPath));
    new ButtonComponent(controls)
      .setButtonText(t("common.remove"))
      // Keep setWarning for minAppVersion 1.11.4 — setDestructive() needs 1.13.0 (obsidianmd/no-unsupported-api)
      .setWarning()
      .onClick(async () => {
        const existed = await this.plugin.pluginService.removePackage(plugin.name, plugin.rootPath);
        if (existed) new Notice(t("settings.pluginRemoved", { name: plugin.name }));
        else new Notice(t("settings.pluginAlreadyDeleted", { name: plugin.name }));
        this.pluginsLoadedOnce = false;
        await this.save();
        this.redraw();
      });
  }

  private renderDeletedPluginRow(containerEl: HTMLElement, settings: AgenticChatSettings, plugin: LoadedPlugin): void {
    const row = containerEl.createDiv({ cls: "agentic-chat-plugin-row agentic-chat-plugin-deleted" });
    const main = row.createDiv({ cls: "agentic-chat-plugin-main" });
    main.createDiv({ cls: "agentic-chat-plugin-name", text: plugin.name });
    const meta = main.createDiv({ cls: "agentic-chat-plugin-meta" });
    meta.createSpan({ text: `${plugin.rootPath} — deleted on disk` });
    const source = settings.plugins.sources?.[plugin.name];
    if (source) {
      const tail = meta.createSpan({ cls: "agentic-chat-plugin-meta-extra" });
      tail.createSpan({ text: ` — Source: ${source}` });
    }
    const controls = row.createDiv({ cls: "agentic-chat-plugin-controls" });
    new ButtonComponent(controls)
      .setButtonText(t("common.close"))
      .onClick(async () => {
        // Guard the TOCTOU: if the folder was recreated since the transient was shown, don't delete it.
        let shouldRemove: boolean;
        try {
          shouldRemove = !(await this.app.vault.adapter.exists(plugin.rootPath));
        } catch {
          shouldRemove = false;
        }
        if (shouldRemove) await this.plugin.pluginService.removePackage(plugin.name, plugin.rootPath);
        this.externallyDeletedPlugins = this.externallyDeletedPlugins.filter((entry) => entry.rootPath !== plugin.rootPath);
        this.redraw();
      });
  }

  private openInstallModal(): void {
    new InstallPluginModal(this.app, this.plugin.pluginService, (result) => {
      noticeInstallResult(result);
      this.pluginsLoadedOnce = false;
      void this.save().then(() => this.redraw());
    }).open();
  }

  private builtinsPackageExists(settings: AgenticChatSettings): boolean {
    const folder = settings.plugins.folder.trim() || DEFAULT_PLUGINS_FOLDER;
    const entry = this.app.vault.getAbstractFileByPath(`${folder}/builtins`);
    return entry instanceof TFolder;
  }

  private openInVault(path: string): void {
    const entry = this.app.vault.getAbstractFileByPath(path);
    if (!entry) {
      new Notice(t("settings.pathMissing", { path }));
      return;
    }
    const vault = this.app.vault as unknown as { open?: (path: string) => Promise<void> };
    if (entry instanceof TFolder) {
      // WorkspaceLeaf.openFile only accepts files; folders get revealed in
      // the File Explorer view when one exists.
      const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
      const view = fileExplorer?.view as { revealInFolder?: (folder: TFolder) => void } | undefined;
      if (fileExplorer && view?.revealInFolder) {
        void this.app.workspace.revealLeaf(fileExplorer);
        view.revealInFolder(entry);
        return;
      }
      if (vault.open) void vault.open(`/${path}`);
      return;
    }
    if (!(entry instanceof TFile)) return;
    const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
    if (fileExplorer) {
      void fileExplorer.openFile(entry);
      return;
    }
    if (vault.open) void vault.open(`/${path}`);
  }

  private setEmbeddingModel(settings: AgenticChatSettings, value: string): void {
    const model = value.trim();
    if (settings.embeddings.provider === "ollama") settings.embeddings.ollamaModel = model;
    else if (settings.embeddings.provider === "openai-compatible") settings.embeddings.openaiCompatibleModel = model;
    else settings.embeddings.openrouterModel = model;
  }

  private folderSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    value: string,
    onChange: (value: string) => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setPlaceholder("(none)").setValue(value).onChange((next) => void onChange(next.trim()));
        text.inputEl.addClass("agentic-chat-folder-input");
        this.folderInputs.set(name, text.inputEl);
      })
      .addButton((button) =>
        button.setButtonText(t("common.browse")).onClick(() => {
          new FolderSuggestModal(this.app, (folder) => {
            const path = folder.path === "/" ? "" : folder.path;
            void onChange(path);
            const input = this.folderInputs.get(name);
            if (input) input.value = path;
          }).open();
        }),
      );
  }

  private readonly folderInputs = new Map<string, HTMLInputElement>();
}
