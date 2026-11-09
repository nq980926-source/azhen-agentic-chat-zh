import type { App } from "obsidian";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

const MEMORY_PLUGIN_DATA_PATH = "plugins/azhen-memory/data.json";
const MEMORY_OPERATIONS_PATH = "/operations/azhen-memory/v1";
const MEMORY_SCHEMA = 1;
const MAX_CONTEXT_CHARS = 48_000;
const READ_TIMEOUT_MS = 15_000;

export interface AzhenMemoryTurnContext {
  sessionId?: string;
  messages: readonly AgentMessage[];
}

export interface AzhenMemoryClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

interface MemoryBinding {
  serviceBaseUrl: string;
  assistantId: string;
  bearerSecretId: string;
}

interface MemoryFile {
  path: "/profile.md" | "/recent.md";
  content: string;
  version: string;
}

interface MemoryReadResponse {
  files: MemoryFile[];
  verifiedAt: number | null;
}

interface MemoryOperationResponse {
  status?: string;
  duplicate?: boolean;
  message?: string;
  proposal?: {
    id?: string;
    status?: string;
  };
}

export class AzhenMemoryError extends Error {
  constructor(
    readonly category:
      | "not_configured"
      | "configuration"
      | "authentication"
      | "network"
      | "redirect"
      | "timeout"
      | "server"
      | "protocol"
      | "context",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AzhenMemoryError";
  }
}

export class AzhenMemoryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private lastRevision = 0;

  constructor(
    private readonly app: App,
    options: AzhenMemoryClientOptions = {},
  ) {
    this.fetchImpl =
      options.fetch ??
      ((input, init) => {
        if (typeof window.fetch !== "function") {
          return Promise.reject(new AzhenMemoryError("network", "当前运行时没有原生 fetch。"));
        }
        return window.fetch(input, init);
      });
    this.timeoutMs = Math.max(10, options.timeoutMs ?? READ_TIMEOUT_MS);
    this.now = options.now ?? (() => Date.now());
  }

  async readCurrent(): Promise<MemoryReadResponse> {
    const value = await this.request("read", { include_supplement: true });
    return parseReadResponse(value);
  }

  async syncSources(turn: Required<Pick<AzhenMemoryTurnContext, "sessionId" | "messages">>): Promise<void> {
    const userMessages = userTextMessages(turn.messages);
    if (userMessages.length === 0) {
      throw new AzhenMemoryError("context", "当前回合没有可验证的用户消息。");
    }
    const conversationId = await idForSession(turn.sessionId);
    const messages = await Promise.all(
      userMessages.map(async (message, index) => ({
        id: await idForUserMessage(turn.sessionId, message.timestamp, index, message.text),
        text: message.text,
      })),
    );
    this.lastRevision = Math.max(this.lastRevision + 1, Math.trunc(this.now()));
    await this.request("sources", {
      conversation_id: conversationId,
      revision: this.lastRevision,
      messages,
      active_ids: messages.map((message) => message.id),
    });
  }

  async propose(
    turn: Required<Pick<AzhenMemoryTurnContext, "sessionId" | "messages">>,
    input: { kind: string; text: string; quote: string },
  ): Promise<MemoryOperationResponse> {
    const current = latestUserMessage(turn.messages);
    const kind = parseKind(input.kind);
    const text = input.text.trim();
    const quote = input.quote;
    if (!quote.trim() || !current.text.includes(quote)) {
      throw new AzhenMemoryError("context", "候选引文必须逐字出现在当前用户消息中。");
    }
    await this.syncSources(turn);
    const sourceId = await idForLatestUserMessage(turn);
    const conversationId = await idForSession(turn.sessionId);
    const result = parseOperationResponse(
      await this.request("propose", {
        conversation_id: conversationId,
        source_id: sourceId,
        kind,
        text,
        quote,
      }),
    );
    return result;
  }

  async proposeCorrection(
    turn: Required<Pick<AzhenMemoryTurnContext, "sessionId" | "messages">>,
    input: { target: string; before: string; after: string; quote: string },
  ): Promise<MemoryOperationResponse> {
    const current = latestUserMessage(turn.messages);
    const target = input.target.trim();
    const before = input.before;
    const after = input.after.trim();
    const quote = input.quote;
    if (target !== "profile" && target !== "supplement") {
      throw new AzhenMemoryError("context", "纠正目标必须是 profile 或 supplement。");
    }
    if (!quote.trim() || !current.text.includes(quote)) {
      throw new AzhenMemoryError("context", "纠正引文必须逐字出现在当前用户消息中。");
    }
    const currentMemory = await this.readCurrent();
    const file = currentMemory.files.find((item) =>
      target === "profile" ? item.path === "/profile.md" : item.path === "/recent.md",
    );
    if (!file) {
      throw new AzhenMemoryError("protocol", `当前 Memory 缺少 ${target} 文档。`);
    }
    if (!before || countOccurrences(file.content, before) !== 1) {
      throw new AzhenMemoryError(
        "context",
        "待纠正片段必须逐字出现在当前有效记忆中且只能出现一次；未创建候选。",
      );
    }

    await this.syncSources(turn);
    const sourceId = await idForLatestUserMessage(turn);
    const conversationId = await idForSession(turn.sessionId);
    return parseOperationResponse(
      await this.request("propose_correction", {
        conversation_id: conversationId,
        source_id: sourceId,
        target,
        before,
        after,
        quote,
        expected_hash: file.version,
      }),
    );
  }

  private async request(action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const binding = await this.loadBinding();
    const token = this.getToken(binding.bearerSecretId);
    const endpoint = memoryEndpoint(binding.serviceBaseUrl, action);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          assistant_id: binding.assistantId,
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AzhenMemoryError("timeout", "Memory 请求超时。");
      }
      if (error instanceof AzhenMemoryError) throw error;
      throw new AzhenMemoryError(
        "network",
        "Memory 请求未完成；可能是网络、TLS、CORS 或重定向被安全策略拦截。",
      );
    } finally {
      window.clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new AzhenMemoryError("redirect", "Memory 服务返回重定向，认证请求已停止。", response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AzhenMemoryError("authentication", "Memory 认证失败。", response.status);
    }
    if (!response.ok) {
      throw new AzhenMemoryError("server", `Memory 服务返回 HTTP ${response.status}。`, response.status);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new AzhenMemoryError("protocol", "Memory 服务返回了无法解析的 JSON。");
    }
    if (!isRecord(parsed)) {
      throw new AzhenMemoryError("protocol", "Memory 响应不是 JSON 对象。");
    }
    return parsed;
  }

  private async loadBinding(): Promise<MemoryBinding> {
    const configDir = (this.app.vault as unknown as { configDir?: string }).configDir;
    if (!configDir) {
      throw new AzhenMemoryError("configuration", "无法确定 Obsidian 配置目录。");
    }
    const path = `${configDir}/${MEMORY_PLUGIN_DATA_PATH}`;
    let raw: string;
    try {
      raw = await this.app.vault.adapter.read(path);
    } catch {
      throw new AzhenMemoryError(
        "not_configured",
        "未找到阿斟 Memory 插件配置；请先在 Memory 插件设置中完成连接配置。",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AzhenMemoryError("configuration", "阿斟 Memory 插件配置不是有效 JSON。");
    }
    if (!isRecord(value)) {
      throw new AzhenMemoryError("configuration", "阿斟 Memory 插件配置结构无效。");
    }
    const serviceBaseUrl = typeof value.serviceBaseUrl === "string" ? value.serviceBaseUrl.trim() : "";
    const assistantId = typeof value.assistantId === "string" ? value.assistantId.replace(/\s+/g, "") : "";
    const bearerSecretId = typeof value.bearerSecretId === "string" ? value.bearerSecretId.trim() : "";
    if (!serviceBaseUrl || !assistantId || !bearerSecretId) {
      throw new AzhenMemoryError("not_configured", "阿斟 Memory 的连接地址、Assistant ID 或密钥引用尚未配置。");
    }
    memoryEndpoint(serviceBaseUrl, "read");
    return { serviceBaseUrl, assistantId, bearerSecretId };
  }

  private getToken(secretId: string): string {
    const storage = (this.app as unknown as {
      secretStorage?: { getSecret?: (id: string) => string | null };
    }).secretStorage;
    const token = storage?.getSecret?.(secretId)?.trim() ?? "";
    if (!token) {
      throw new AzhenMemoryError("authentication", "Obsidian SecretStorage 中未找到 Memory Bearer Token。");
    }
    return token;
  }
}

export class AzhenMemoryRuntime {
  private contextOverlay = unavailableOverlay("尚未读取云端长期记忆。");
  private ready = false;
  private configured = false;

  constructor(private readonly client: AzhenMemoryClient) {
  }

  async refreshContext(): Promise<void> {
    try {
      const response = await this.client.readCurrent();
      this.contextOverlay = formatReadOverlay(response);
      this.ready = true;
      this.configured = true;
    } catch (error) {
      const reason = error instanceof AzhenMemoryError ? error.message : "未知读取错误。";
      this.contextOverlay = unavailableOverlay(reason);
      this.ready = false;
      this.configured = !(error instanceof AzhenMemoryError && error.category === "not_configured");
    }
  }

  composeSystemOverlay(): string {
    return [
      "## 阿斟云端长期记忆",
      "本轮会话已尝试自动读取云端长期记忆。",
      "Knowledge Memory 是唯一长期记忆权威。只把下方当前有效正文当作已确认事实；待审核候选、历史事件和已纠正/已遗忘的旧内容不得冒充当前事实。",
      "当用户明确陈述值得长期保留的事实、偏好或关系时，可以调用 `azhen_memory_propose` 生成待审核候选。若新信息明确改变现有记忆，应调用 `azhen_memory_propose_correction`，其中 `before` 必须逐字复制当前记忆中的唯一片段。不要记录普通闲聊、临时问题、猜测、AI 自己生成的内容或敏感凭据。不要调用工具确认、拒绝、纠正、遗忘或撤销；最终只能由用户在阿斟 Memory 0.2.1 中审核。",
      "如果用户要求确认、拒绝、编辑、遗忘或撤销记忆，告知其在阿斟 Memory 管理页面操作；不要声称聊天工具已经完成这些管理操作。",
      "若本轮记忆读取失败，必须明确承认无法使用云端记忆，不得编造或声称已读取。",
      this.contextOverlay,
    ].join("\n\n");
  }

  createTools(getTurnContext: () => AzhenMemoryTurnContext): AgentTool[] {
    return this.ready ? createAzhenMemoryTools(this.client, getTurnContext) : [];
  }

  isConfigured(): boolean {
    return this.configured;
  }
}

export function createAzhenMemoryTools(
  client: AzhenMemoryClient,
  getTurnContext: () => AzhenMemoryTurnContext,
): AgentTool[] {
  return [createProposeTool(client, getTurnContext), createCorrectionTool(client, getTurnContext)];
}

const ProposeParameters = Type.Object({
  kind: Type.String({
    description: "One of fact, preference, relationship, ongoing.",
  }),
  text: Type.String({
    description: "One concise, plain-text fact or preference. Never include credentials or multiple facts.",
  }),
  quote: Type.String({
    description: "An exact quote copied from the current USER message that proves the fact.",
  }),
});

const CorrectionParameters = Type.Object({
  target: Type.String({ description: "profile or supplement." }),
  before: Type.String({
    description: "Exact unique fragment copied from the current confirmed memory.",
  }),
  after: Type.String({
    description: "One concise replacement fact. Never include credentials.",
  }),
  quote: Type.String({
    description: "An exact quote copied from the current USER message that proves the change.",
  }),
});

function createProposeTool(
  client: AzhenMemoryClient,
  getTurnContext: () => AzhenMemoryTurnContext,
): AgentTool<typeof ProposeParameters> {
  return {
    name: "azhen_memory_propose",
    label: "Propose cloud memory",
    description:
      "Create a pending candidate in the user's existing Azhen cloud Memory. Use only for an explicit durable fact, preference, relationship, or ongoing context stated by the user. This never confirms or saves the fact.",
    parameters: ProposeParameters,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const turn = requireTurnContext(getTurnContext());
      const result = await client.propose(turn, {
        kind: params.kind,
        text: params.text,
        quote: params.quote,
      });
      return operationResult(result, "新增");
    },
  };
}

function createCorrectionTool(
  client: AzhenMemoryClient,
  getTurnContext: () => AzhenMemoryTurnContext,
): AgentTool<typeof CorrectionParameters> {
  return {
    name: "azhen_memory_propose_correction",
    label: "Propose cloud memory correction",
    description:
      "Create a pending correction candidate when the user explicitly replaces a fact in current Azhen cloud Memory. `before` must be an exact unique fragment from current memory. This never confirms the correction.",
    parameters: CorrectionParameters,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const turn = requireTurnContext(getTurnContext());
      const result = await client.proposeCorrection(turn, {
        target: params.target,
        before: params.before,
        after: params.after,
        quote: params.quote,
      });
      return operationResult(result, "纠正");
    },
  };
}

function operationResult(result: MemoryOperationResponse, action: "新增" | "纠正") {
  const status = result.status ?? "unknown";
  const proposalId = result.proposal?.id;
  let text: string;
  if (status === "pending" && result.duplicate) {
    text = `已存在相同的${action}候选；没有重复提交，仍等待用户在阿斟 Memory 中审核。`;
  } else if (status === "pending") {
    text = `已创建${action}候选；尚未写入正式记忆，等待用户在阿斟 Memory 中审核。`;
  } else if (status === "already_present") {
    text = "当前正式记忆已经包含该事实；未创建重复候选。";
  } else if (status === "confirmed" && result.duplicate) {
    text = "该事实已经存在于当前正式记忆中；未创建重复候选。";
  } else if (status === "historical_only") {
    text = "该事实曾在历史中出现，但当前正式记忆已不含它；未把它当作当前事实，也未创建新候选。";
  } else {
    text = result.message ?? `Memory 返回候选状态：${status}。`;
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {
      kind: "azhen_memory_candidate",
      status,
      duplicate: result.duplicate === true,
      proposalId,
    },
  };
}

function requireTurnContext(context: AzhenMemoryTurnContext): Required<AzhenMemoryTurnContext> {
  if (!context.sessionId) {
    throw new AzhenMemoryError("context", "缺少当前会话标识，未创建 Memory 候选。");
  }
  if (userTextMessages(context.messages).length === 0) {
    throw new AzhenMemoryError("context", "缺少当前用户消息，未创建 Memory 候选。");
  }
  return { sessionId: context.sessionId, messages: context.messages };
}

function parseReadResponse(value: Record<string, unknown>): MemoryReadResponse {
  if (value.schema !== MEMORY_SCHEMA) {
    throw new AzhenMemoryError("protocol", "Memory 接口版本不受支持；仅接受 schema=1。");
  }
  if (!Array.isArray(value.files)) {
    throw new AzhenMemoryError("protocol", "Memory 响应缺少 files 数组。");
  }
  const files: MemoryFile[] = [];
  const seen = new Set<string>();
  for (const item of value.files) {
    if (!isRecord(item)) {
      throw new AzhenMemoryError("protocol", "Memory 文档结构无效。");
    }
    if (item.path !== "/profile.md" && item.path !== "/recent.md") {
      throw new AzhenMemoryError("protocol", "Memory 响应包含未知文档路径。");
    }
    if (seen.has(item.path)) {
      throw new AzhenMemoryError("protocol", "Memory 响应包含重复文档。");
    }
    if (typeof item.content !== "string" || typeof item.version !== "string" || !/^[a-f0-9]{64}$/.test(item.version)) {
      throw new AzhenMemoryError("protocol", "Memory 文档字段或版本哈希无效。");
    }
    seen.add(item.path);
    files.push({ path: item.path, content: item.content, version: item.version });
  }
  if (!seen.has("/profile.md")) {
    throw new AzhenMemoryError("protocol", "Memory 响应缺少 /profile.md。");
  }
  return {
    files,
    verifiedAt: typeof value.verified_at === "number" && Number.isFinite(value.verified_at) ? value.verified_at : null,
  };
}

function parseOperationResponse(value: Record<string, unknown>): MemoryOperationResponse {
  const proposal = isRecord(value.proposal)
    ? {
        id: typeof value.proposal.id === "string" ? value.proposal.id : undefined,
        status: typeof value.proposal.status === "string" ? value.proposal.status : undefined,
      }
    : undefined;
  return {
    status: typeof value.status === "string" ? value.status : undefined,
    duplicate: value.duplicate === true,
    message: typeof value.message === "string" ? value.message : undefined,
    proposal,
  };
}

function formatReadOverlay(response: MemoryReadResponse): string {
  const sections = response.files.map((file) => {
    const label = file.path === "/profile.md" ? "profile.md" : "recent.md";
    return `<memory_file name="${label}" version="${file.version}">\n${file.content.trim()}\n</memory_file>`;
  });
  const joined = sections.join("\n\n");
  let body = joined;
  if (body.length > MAX_CONTEXT_CHARS) {
    body = `${body.slice(0, MAX_CONTEXT_CHARS)}\n\n[当前记忆上下文因成本上限被截断；需要精确内容时应在 Memory 管理页查看。]`;
  }
  const verified = response.verifiedAt ? new Date(response.verifiedAt).toISOString() : "服务端未提供";
  return [
    `读取成功：已取得当前有效文档（服务端验证时间：${verified}）。以下内容不含待审核候选或历史事件。`,
    body || "（当前长期记忆正文为空。）",
  ].join("\n\n");
}

function unavailableOverlay(reason: string): string {
  return `读取失败：${reason}\n本轮不得声称已读取、记住或引用了云端长期记忆；可以正常聊天，但应明确说明长期记忆当前不可用。`;
}

function latestUserMessage(messages: readonly AgentMessage[]): { text: string; timestamp: number } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    return {
      text: messageText(message.content),
      timestamp: typeof message.timestamp === "number" ? message.timestamp : 0,
    };
  }
  throw new AzhenMemoryError("context", "当前回合没有用户消息。");
}

function userTextMessages(messages: readonly AgentMessage[]): Array<{ text: string; timestamp: number }> {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      text: messageText(message.content),
      timestamp: typeof message.timestamp === "number" ? message.timestamp : 0,
    }))
    .filter((message) => Boolean(message.text.trim()));
}

function messageText(content: unknown): string {
  if (typeof content === "string") return stripContextPreamble(content);
  if (!Array.isArray(content)) return "";
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
  return stripContextPreamble(text);
}

function stripContextPreamble(text: string): string {
  return text.replace(
    /^<context>[\s\S]*?<\/context>\r?\n\r?\n(?:Focus:[^\r\n]*\r?\n\r?\n)?/,
    "",
  );
}

async function idForLatestUserMessage(
  turn: Required<Pick<AzhenMemoryTurnContext, "sessionId" | "messages">>,
): Promise<string> {
  const all = userTextMessages(turn.messages);
  const current = latestUserMessage(turn.messages);
  return idForUserMessage(turn.sessionId, current.timestamp, Math.max(0, all.length - 1), current.text);
}

async function idForSession(sessionId: string): Promise<string> {
  const direct = sessionId.match(/^([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{12})$/i);
  if (direct) return [direct[1], direct[2], direct[3], direct[4], direct[5]].join("-").toLowerCase();
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)) {
    return sessionId.toLowerCase();
  }
  return asUuid(await sha256Hex(sessionId));
}

async function idForUserMessage(
  sessionId: string,
  timestamp: number,
  index: number,
  text: string,
): Promise<string> {
  return asUuid(await sha256Hex(`${sessionId}\u0000${timestamp}\u0000${index}\u0000${text}`));
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function parseKind(value: string): "fact" | "preference" | "relationship" | "ongoing" {
  const kind = value.trim();
  if (kind === "fact" || kind === "preference" || kind === "relationship" || kind === "ongoing") {
    return kind;
  }
  throw new AzhenMemoryError("context", "候选 kind 必须是 fact、preference、relationship 或 ongoing。");
}

function countOccurrences(content: string, fragment: string): number {
  if (!fragment) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= content.length) {
    const found = content.indexOf(fragment, offset);
    if (found < 0) break;
    count += 1;
    offset = found + fragment.length;
  }
  return count;
}

function memoryEndpoint(serviceBaseUrl: string, action: string): string {
  let url: URL;
  try {
    url = new URL(serviceBaseUrl);
  } catch {
    throw new AzhenMemoryError("configuration", "Memory 服务地址无效。");
  }
  if (url.protocol !== "https:") {
    throw new AzhenMemoryError("configuration", "Memory 服务地址必须使用 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AzhenMemoryError("configuration", "Memory 服务地址不得包含用户信息、查询参数或片段。");
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  if (basePath.endsWith(MEMORY_OPERATIONS_PATH)) {
    url.pathname = `${basePath}/${action}`;
  } else {
    url.pathname = `${basePath}${MEMORY_OPERATIONS_PATH}/${action}`.replace(/\/{2,}/g, "/");
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
