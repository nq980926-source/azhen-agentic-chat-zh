import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AssistantMessage, Model, TranscriptContext } from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { AgentService } from "../src/agent/agent-service";
import { AzhenMemoryClient, AzhenMemoryError } from "../src/integrations/azhen-memory";
import { ObsidianSessionManager } from "../src/session/session-manager";
import { DEFAULT_SETTINGS, type AgenticChatSettings } from "../src/settings";
import { MemoryAdapter } from "./helpers/memory-adapter";

const MEMORY_DATA_PATH = ".obsidian/plugins/azhen-memory/data.json";

function memoryApp(adapter = new MemoryAdapter()): {
  app: App;
  adapter: MemoryAdapter;
} {
  const app = {
    vault: {
      adapter: adapter.asDataAdapter(),
      configDir: ".obsidian",
      on: () => ({}),
      offref: () => {},
    },
    workspace: {},
    secretStorage: {
      getSecret: (id: string) => (id === "test-memory-bearer" ? "fixture-token" : ""),
    },
  } as unknown as App;
  return { app, adapter };
}

async function writeMemoryConfig(adapter: MemoryAdapter): Promise<void> {
  await adapter.write(
    MEMORY_DATA_PATH,
    JSON.stringify({
      serviceBaseUrl: "https://127.0.0.1:8443",
      assistantId: "fixture-assistant",
      bearerSecretId: "test-memory-bearer",
    }),
  );
}

function scriptedStreamFn(
  turns: Array<{ content: AssistantMessage["content"]; stopReason: "stop" | "toolUse" }>,
  onCall?: (context: TranscriptContext) => void,
): StreamFn {
  let index = 0;
  return ((model: Model<"openai-completions">, context: TranscriptContext) => {
    onCall?.(context);
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    const stream = createAssistantMessageEventStream();
    const message = {
      role: "assistant" as const,
      content: turn?.content ?? [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: turn?.stopReason ?? ("stop" as const),
      timestamp: Date.now(),
    };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: { ...message, content: [] } });
      stream.push({ type: "done", reason: message.stopReason, message });
      stream.end(message);
    });
    return stream;
  }) as unknown as StreamFn;
}

function serviceFor(app: App, streamFn: StreamFn, azhenMemoryFetch?: typeof fetch): {
  service: AgentService;
  settings: AgenticChatSettings;
} {
  const settings: AgenticChatSettings = {
    ...DEFAULT_SETTINGS,
    openrouterApiKey: "test-key",
  };
  const adapter = app.vault.adapter;
  return {
    settings,
    service: new AgentService({
      app,
      getSettings: () => settings,
      sessionManager: new ObsidianSessionManager(adapter, "sessions", "vault:test"),
      confirmToolCall: async () => ({ approved: true, remember: false }),
      streamFn,
      azhenMemoryFetch,
    }),
  };
}

class FakeMemoryBackend {
  profile = "# 基本身份\n\n用户希望回答保持简洁。";
  supplement = "";
  events: Array<Record<string, unknown>> = [];
  pending: Array<Record<string, unknown>> = [];
  proposals: Array<Record<string, unknown>> = [];
  readonly requests: Array<{ action: string; body: Record<string, unknown>; init?: RequestInit }> = [];
  private sources = new Map<string, string>();
  failNextAction: "sources" | "propose" | "propose_correction" | null = null;

  readonly fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const action = url.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    this.requests.push({ action, body, init });
    if (this.failNextAction === action) {
      this.failNextAction = null;
      return new Response(JSON.stringify({ status: "failed" }), { status: 503 });
    }
    if (action === "read") {
      return this.response({
        schema: 1,
        files: [
          { path: "/profile.md", content: this.profile, version: "a".repeat(64) },
          ...(this.supplement
            ? [{ path: "/recent.md", content: this.supplement, version: "b".repeat(64) }]
            : []),
        ],
        pending: this.pending,
        events: this.events,
        capabilities: { correction_proposals: 1 },
        verified_at: 1,
        unprocessed_sources: 0,
        supplement_available: true,
      });
    }
    if (action === "sources") {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      for (const item of messages) {
        if (
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).text === "string"
        ) {
          this.sources.set(
            (item as Record<string, string>).id,
            (item as Record<string, string>).text,
          );
        }
      }
      return this.response({ status: "confirmed" });
    }
    if (action === "propose") {
      const sourceId = String(body.source_id ?? "");
      const quote = String(body.quote ?? "");
      const text = String(body.text ?? "");
      if (!this.sources.get(sourceId)?.includes(quote)) {
        return new Response(JSON.stringify({ status: "failed" }), { status: 409 });
      }
      const existing = this.proposals.find((proposal) => proposal.text === text);
      if (existing) return this.response({ status: existing.status, duplicate: true, proposal: existing });
      const proposal = {
        id: `proposal-${this.proposals.length + 1}`,
        text,
        quote,
        status: "pending",
      };
      this.proposals.push(proposal);
      return this.response({ status: "pending", proposal });
    }
    if (action === "propose_correction") {
      const sourceId = String(body.source_id ?? "");
      const quote = String(body.quote ?? "");
      const before = String(body.before ?? "");
      if (
        !this.sources.get(sourceId)?.includes(quote) ||
        this.profile.split(before).length !== 2 ||
        body.expected_hash !== "a".repeat(64)
      ) {
        return new Response(JSON.stringify({ status: "failed" }), { status: 409 });
      }
      const proposal = {
        id: `correction-${this.proposals.length + 1}`,
        action: "correct",
        before,
        after: body.after,
        status: "pending",
      };
      this.proposals.push(proposal);
      return this.response({ status: "pending", proposal });
    }
    return new Response(JSON.stringify({ status: "failed" }), { status: 404 });
  });

  private response(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

describe("Azhen cloud memory chat integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads confirmed cloud memory into the actual AgentService prompt and excludes pending facts", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    backend.pending = [
      {
        id: "pending-only",
        target: "profile",
        text: "这是尚未确认的候选事实",
        status: "pending",
      },
    ];
    backend.events = [
      {
        id: "old-event",
        action: "correct",
        target: "profile",
        before: "这是已纠正的旧事实",
        after: "用户希望回答保持简洁。",
        time: 1,
        source: {},
      },
    ];

    let seenPrompt = "";
    let seenTools: string[] = [];
    const { service } = serviceFor(
      app,
      (() => {
        const base = scriptedStreamFn(
          [{ content: [{ type: "text", text: "好的。" }], stopReason: "stop" }],
          (context) => {
            seenPrompt = getCurrentSystemPrompt(context.messages);
            seenTools = getCurrentTools(context.messages).map((tool) => tool.name);
          },
        );
        return base;
      })(),
      backend.fetch,
    );

    await service.sendPrompt("请按我的沟通习惯回答");

    expect(backend.fetch).toHaveBeenCalledTimes(1);
    expect(seenPrompt).toContain("用户希望回答保持简洁。");
    expect(seenPrompt).not.toContain("这是尚未确认的候选事实");
    expect(seenPrompt).not.toContain("这是已纠正的旧事实");
    const init = backend.fetch.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
    });
    expect(seenTools).toContain("azhen_memory_propose");
    expect(seenTools).toContain("azhen_memory_propose_correction");
    expect(seenTools).not.toContain("search_memory");
  });

  it("creates a pending fact through the real agent tool loop without confirming it", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    const { service } = serviceFor(
      app,
      scriptedStreamFn([
        {
          content: [
            {
              type: "toolCall",
              id: "proposal-1",
              name: "azhen_memory_propose",
              arguments: {
                kind: "preference",
                text: "用户周末喜欢徒步。",
                quote: "我周末喜欢徒步",
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: [{ type: "text", text: "我已创建待审核候选。" }], stopReason: "stop" },
      ]),
      backend.fetch,
    );

    await service.sendPrompt("我周末喜欢徒步，请记住这个长期偏好。");

    expect(backend.proposals).toHaveLength(1);
    expect(backend.requests.map((request) => request.action)).toEqual(["read", "sources", "propose"]);
    expect(backend.requests.some((request) => request.action === "confirm")).toBe(false);
    const toolResult = service.getMessages().find(
      (message) => message.role === "toolResult" && message.toolName === "azhen_memory_propose",
    );
    expect(toolResult).toMatchObject({ isError: false });
    expect(JSON.stringify(toolResult)).toContain("审核");
    expect(JSON.stringify(toolResult)).not.toContain("已写入正式记忆");
  });

  it("creates a correction candidate with the current expected_hash and exact before text", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    backend.profile = "# 个人偏好\n\n用户喜欢早晨跑步。";
    const { service } = serviceFor(
      app,
      scriptedStreamFn([
        {
          content: [
            {
              type: "toolCall",
              id: "correction-1",
              name: "azhen_memory_propose_correction",
              arguments: {
                target: "profile",
                before: "用户喜欢早晨跑步。",
                after: "用户改在傍晚跑步。",
                quote: "改在傍晚跑步了",
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: [{ type: "text", text: "已提交纠正候选。" }], stopReason: "stop" },
      ]),
      backend.fetch,
    );

    await service.sendPrompt("我以前早晨跑步，但现在改在傍晚跑步了。");

    const actions = backend.requests.map((request) => request.action);
    expect(actions).toEqual(["read", "read", "sources", "propose_correction"]);
    const correction = backend.requests.find((request) => request.action === "propose_correction");
    expect(correction?.body).toMatchObject({
      target: "profile",
      before: "用户喜欢早晨跑步。",
      after: "用户改在傍晚跑步。",
      expected_hash: "a".repeat(64),
    });
    expect(backend.proposals).toHaveLength(1);
    expect(JSON.stringify(service.getMessages())).not.toContain('"action":"confirm"');
  });

  it("does not create a candidate for casual chat", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    const { service } = serviceFor(
      app,
      scriptedStreamFn([{ content: [{ type: "text", text: "你好，今天想聊什么？" }], stopReason: "stop" }]),
      backend.fetch,
    );

    await service.sendPrompt("你好");

    expect(backend.proposals).toHaveLength(0);
    expect(backend.requests.map((request) => request.action)).toEqual(["read"]);
  });

  it("uses backend deduplication when the same fact is proposed twice", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    const { service } = serviceFor(
      app,
      scriptedStreamFn([
        {
          content: [
            {
              type: "toolCall",
              id: "proposal-a",
              name: "azhen_memory_propose",
              arguments: {
                kind: "fact",
                text: "用户住在杭州。",
                quote: "我住在杭州",
              },
            },
          ],
          stopReason: "toolUse",
        },
        {
          content: [
            {
              type: "toolCall",
              id: "proposal-b",
              name: "azhen_memory_propose",
              arguments: {
                kind: "fact",
                text: "用户住在杭州。",
                quote: "我住在杭州",
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: [{ type: "text", text: "已处理。" }], stopReason: "stop" },
      ]),
      backend.fetch,
    );

    await service.sendPrompt("我住在杭州。");

    expect(backend.proposals).toHaveLength(1);
    const toolResults = service
      .getMessages()
      .filter((message) => message.role === "toolResult");
    expect(toolResults).toHaveLength(2);
    expect(JSON.stringify(toolResults[1])).toContain("没有重复提交");
  });

  it("rejects a proposal whose quote is not in the current user message", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    const { service } = serviceFor(
      app,
      scriptedStreamFn([
        {
          content: [
            {
              type: "toolCall",
              id: "bad-quote",
              name: "azhen_memory_propose",
              arguments: {
                kind: "fact",
                text: "用户住在北京。",
                quote: "我住在北京",
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: [{ type: "text", text: "没有创建候选。" }], stopReason: "stop" },
      ]),
      backend.fetch,
    );

    await service.sendPrompt("我住在杭州。");

    expect(backend.proposals).toHaveLength(0);
    expect(backend.requests.some((request) => request.action === "propose")).toBe(false);
    const toolResult = service.getMessages().find((message) => message.role === "toolResult");
    expect(toolResult).toMatchObject({ isError: true });
    expect(JSON.stringify(toolResult)).toContain("逐字");
  });

  it("degrades explicitly and exposes no memory tools when the read fails", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    const rejectingFetch = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit): Promise<Response> => {
      throw new TypeError("network blocked");
    }) as unknown as typeof fetch;
    let seenPrompt = "";
    let seenTools: string[] = [];
    const { service } = serviceFor(
      app,
      scriptedStreamFn([{ content: [{ type: "text", text: "长期记忆当前不可用。" }], stopReason: "stop" }], (context) => {
        seenPrompt = getCurrentSystemPrompt(context.messages);
        seenTools = getCurrentTools(context.messages).map((tool) => tool.name);
      }),
      rejectingFetch,
    );

    await service.sendPrompt("请参考我的长期记忆。");

    expect(backend.proposals).toHaveLength(0);
    expect(seenPrompt).toContain("读取失败");
    expect(seenPrompt).toContain("不得声称已读取");
    expect(seenPrompt).not.toContain("用户希望回答保持简洁。");
    expect(seenTools).not.toContain("azhen_memory_propose");
    expect(seenTools).not.toContain("search_memory");
  });

  it("leaves candidates unchanged when the proposal request fails", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const backend = new FakeMemoryBackend();
    backend.failNextAction = "propose";
    const { service } = serviceFor(
      app,
      scriptedStreamFn([
        {
          content: [
            {
              type: "toolCall",
              id: "failed-write",
              name: "azhen_memory_propose",
              arguments: {
                kind: "fact",
                text: "用户养了一只猫。",
                quote: "我养了一只猫",
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: [{ type: "text", text: "候选未提交。" }], stopReason: "stop" },
      ]),
      backend.fetch,
    );

    await service.sendPrompt("我养了一只猫。");

    expect(backend.proposals).toHaveLength(0);
    const toolResult = service.getMessages().find((message) => message.role === "toolResult");
    expect(toolResult).toMatchObject({ isError: true });
    expect(JSON.stringify(toolResult)).toContain("HTTP 503");
  });

  it("fails closed on redirects and timeouts without following or writing", async () => {
    const { app, adapter } = memoryApp();
    await writeMemoryConfig(adapter);
    const redirectFetch = vi.fn(
      async (_input: URL | RequestInfo, _init?: RequestInit): Promise<Response> =>
        new Response("", { status: 307, headers: { location: "https://unexpected.example/" } }),
    );
    const redirected = new AzhenMemoryClient(app, { fetch: redirectFetch });
    await expect(redirected.readCurrent()).rejects.toMatchObject({
      name: "AzhenMemoryError",
      category: "redirect",
      status: 307,
    });
    expect(redirectFetch).toHaveBeenCalledTimes(1);

    const timeoutFetch = vi.fn(
      (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const timedOut = new AzhenMemoryClient(app, { fetch: timeoutFetch, timeoutMs: 15 });
    await expect(timedOut.readCurrent()).rejects.toBeInstanceOf(AzhenMemoryError);
    await expect(timedOut.readCurrent()).rejects.toMatchObject({ category: "timeout" });
  });

  it.skipIf(!process.env.AZHEN_MEMORY_E2E_URL)(
    "runs the actual AgentService tool loop against the isolated Python Memory backend",
    async () => {
      const { readFileSync } = await import("node:fs");
      const { Agent, fetch: undiciFetch } = await import("undici");
      const certificate = readFileSync(process.env.AZHEN_MEMORY_E2E_CA!, "utf8");
      const dispatcher = new Agent({ connect: { ca: certificate } });
      const memoryFetch = ((input: URL | RequestInfo, init?: RequestInit) =>
        undiciFetch(
          input as Parameters<typeof undiciFetch>[0],
          { ...(init as RequestInit), dispatcher } as Parameters<typeof undiciFetch>[1],
        )) as unknown as typeof fetch;
      const adapter = new MemoryAdapter();
      await adapter.write(
        MEMORY_DATA_PATH,
        JSON.stringify({
          serviceBaseUrl: process.env.AZHEN_MEMORY_E2E_URL,
          assistantId: "fixture-assistant",
          bearerSecretId: "test-memory-bearer",
        }),
      );
      const app = {
        vault: {
          adapter: adapter.asDataAdapter(),
          configDir: ".obsidian",
          on: () => ({}),
          offref: () => {},
        },
        workspace: {},
        secretStorage: {
          getSecret: (id: string) => (id === "test-memory-bearer" ? `fixture_${"x".repeat(64)}` : ""),
        },
      } as unknown as App;
      const prompts: string[] = [];
      const { service } = serviceFor(
        app,
        scriptedStreamFn(
          [
            {
              content: [
                {
                  type: "toolCall",
                  id: "live-propose",
                  name: "azhen_memory_propose",
                  arguments: {
                    kind: "preference",
                    text: "Fixture user prefers tea.",
                    quote: "I prefer tea",
                  },
                },
              ],
              stopReason: "toolUse",
            },
            { content: [{ type: "text", text: "Candidate created." }], stopReason: "stop" },
            {
              content: [
                {
                  type: "toolCall",
                  id: "live-correct",
                  name: "azhen_memory_propose_correction",
                  arguments: {
                    target: "profile",
                    before: "# Fixture user",
                    after: "# Fixture user updated",
                    quote: "Use updated fixture identity",
                  },
                },
              ],
              stopReason: "toolUse",
            },
            { content: [{ type: "text", text: "Correction candidate created." }], stopReason: "stop" },
            {
              content: [
                {
                  type: "toolCall",
                  id: "live-duplicate",
                  name: "azhen_memory_propose",
                  arguments: {
                    kind: "preference",
                    text: "Fixture user prefers tea.",
                    quote: "I prefer tea",
                  },
                },
              ],
              stopReason: "toolUse",
            },
            { content: [{ type: "text", text: "Duplicate handled." }], stopReason: "stop" },
            {
              content: [
                {
                  type: "toolCall",
                  id: "live-rejectable",
                  name: "azhen_memory_propose",
                  arguments: {
                    kind: "preference",
                    text: "Fixture user prefers coffee.",
                    quote: "I prefer coffee",
                  },
                },
              ],
              stopReason: "toolUse",
            },
            { content: [{ type: "text", text: "Rejectable candidate created." }], stopReason: "stop" },
          ],
          (context) => prompts.push(getCurrentSystemPrompt(context.messages)),
        ),
        memoryFetch,
      );

      await service.sendPrompt("I prefer tea for the isolated fixture.");
      await service.sendPrompt("Use updated fixture identity in the isolated fixture.");
      await service.sendPrompt("I prefer tea, repeated for the isolated fixture.");
      await service.sendPrompt("I prefer coffee in the isolated fixture, for a reject test.");

      const toolResults = service
        .getMessages()
        .filter((message) => message.role === "toolResult");
      expect(toolResults).toHaveLength(4);
      expect(toolResults.every((message) => message.isError === false)).toBe(true);
      expect(prompts[2]).toContain("# Fixture user");
      expect(prompts[2]).not.toContain("Fixture user prefers tea.");

      const client = new AzhenMemoryClient(app, { fetch: memoryFetch });
      const memory = await client.readCurrent();
      expect(memory.files.find((file) => file.path === "/profile.md")?.content.replace(/\r\n/g, "\n")).toBe(
        "# Fixture user\n",
      );

      const { readFile } = await import("node:fs/promises");
      const journal = JSON.parse(
        await readFile(`${process.env.AZHEN_MEMORY_E2E_DIR}/kb/.记忆维护记录.json`, "utf8"),
      ) as { proposals: Record<string, { status: string }> };
      expect(Object.values(journal.proposals).filter((proposal) => proposal.status === "pending")).toHaveLength(3);
    },
  );
});
