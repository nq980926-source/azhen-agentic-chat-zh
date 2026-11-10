import type { App } from "obsidian";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AgenticChatSettings } from "../settings";
import type { ToolArtifactStoreLike } from "../artifacts/tool-artifact-store";
import {
  buildFinanceFactFromSources,
  financeFactMarkdown,
  financeMonthsInRange,
  normalizeFinanceDate,
  sealFinanceFact,
  sha256Hex,
  type FinanceFact,
} from "../finance/azhen-finance";
import {
  hasEnabledAzhenKnowledgeMcp,
  isAzhenKnowledgeMcpEndpoint,
} from "../agent/azhen-knowledge-policy";
import { unwrapToolOutput } from "./tool-output-wrapper";

export const AZHEN_FINANCE_QUERY_TOOL = "azhen_finance_query";

const PROFILE_PATH = "生活/记账/用户财务档案.md";
const CHART_TYPES = ["auto", "doughnut", "bar", "line", "none"] as const;

const QuerySchema = Type.Object({
  from: Type.String({ description: "Inclusive start date YYYY-MM-DD." }),
  to: Type.String({ description: "Inclusive end date YYYY-MM-DD." }),
  chart: Type.Union(
    CHART_TYPES.map((value) => Type.Literal(value)),
    {
      description:
        "Pick from the user's intent: doughnut for spending composition, bar for comparisons, line for trends, none for a single lookup.",
    },
  ),
});

export interface AzhenFinanceTurnContext {
  messages: AgentMessage[];
}

export interface AzhenFinanceToolOptions {
  app: App;
  getSettings: () => AgenticChatSettings;
  getMcpTools: () => AgentTool[];
  getTurnContext: () => AzhenFinanceTurnContext;
  artifactStore?: ToolArtifactStoreLike;
}

interface McpEnvelope {
  status: string;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

interface ReadReceipt {
  path: string;
  content: string;
  sha256: string;
}

/**
 * Adds a read-only finance query tool. It never writes knowledge, never creates
 * a second MCP client, and never accepts model-supplied totals.
 */
export function createAzhenFinanceTools(options: AzhenFinanceToolOptions): AgentTool[] {
  if (!hasEnabledAzhenKnowledgeMcp(options.getSettings())) return [];
  const runtime = new AzhenFinanceRuntime(options);
  const query: AgentTool<typeof QuerySchema> = {
    name: AZHEN_FINANCE_QUERY_TOOL,
    label: "核验财务统计",
    description:
      "Read the actual Azhen monthly ledger through the configured Knowledge MCP and compute one exact FinanceFact. " +
      "Use for income, spending, category, date-range and trend questions. Return the provided Markdown verbatim. " +
      "Never calculate totals yourself and never supply chart values.",
    parameters: QuerySchema,
    executionMode: "sequential",
    execute: async (_id, params, signal) => runtime.query(params, signal),
  };
  return [query];
}

export class AzhenFinanceRuntime {
  constructor(private readonly options: AzhenFinanceToolOptions) {}

  async query(
    input: { from: string; to: string; chart: (typeof CHART_TYPES)[number] },
    signal?: AbortSignal,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
  }> {
    try {
      const from = normalizeFinanceDate(input.from).iso;
      const to = normalizeFinanceDate(input.to).iso;
      if (to < from) throw new Error("结束日期不能早于开始日期。");
      const read = this.readTool();

      const profile = await this.read(read, PROFILE_PATH, signal);
      if (!profile.content.includes("项目制已取消")) {
        throw new Error("用户财务档案未确认项目制已取消，不能按现行规则统计。");
      }

      const sources: Array<{ path: string; sha256: string; content: string }> = [];
      let coverage: "complete" | "partial" = "complete";
      const missing: string[] = [];
      for (const month of financeMonthsInRange(from, to)) {
        const path = `生活/记账/账本/${month}.md`;
        try {
          const receipt = await this.read(read, path, signal);
          sources.push({ path, sha256: receipt.sha256, content: receipt.content });
        } catch (error) {
          if (!isMissingRead(error)) throw error;
          coverage = "partial";
          missing.push(path);
          sources.push({ path, sha256: "", content: "" });
        }
      }

      const fact = await sealFinanceFact(
        buildFinanceFactFromSources({ sources, from, to, coverage }),
      );
      const request = latestUserText(this.options.getTurnContext());
      const requested = chooseChart(input.chart, fact, request);
      const chartAvailable = requested !== "none" && chartsPluginEnabled(this.options.app);
      const barDimension = wantsMonthComparison(request) ? "month" : "category";
      const rendered = financeFactMarkdown(
        fact,
        chartAvailable ? requested : "bar",
        barDimension,
      );
      const chartRendered = chartAvailable && rendered.chart !== null;
      const markdown = chartRendered
        ? rendered.markdown
        : requested === "none"
          ? stripChartBlock(rendered.markdown)
          : chartAvailable
            ? `${stripChartBlock(rendered.markdown)}\n\n本次未生成图表：数据超出可安全绘制的数值范围。`
            : `${stripChartBlock(rendered.markdown)}\n\n本次未生成图表：Obsidian Charts 插件未安装或未启用。`;
      return {
        content: [{ type: "text", text: markdown }],
        details: {
          kind: "azhen-finance-fact",
          fact: publicFact(fact),
          chartType: chartRendered ? requested : "none",
          chartRequested: requested,
          chartAvailable,
          missing,
          markdown,
        },
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `财务数据无法可靠核实：${errorMessage(error)}` }],
        details: { kind: "azhen-finance-error", error: errorMessage(error) },
        isError: true,
      };
    }
  }

  private readTool(): AgentTool {
    if (!hasEnabledAzhenKnowledgeMcp(this.options.getSettings())) {
      throw new Error("Knowledge MCP 未配置或未启用。");
    }
    const settings = this.options.getSettings();
    const mcpTools = this.options.getMcpTools();
    const serverIds = new Set<string>();
    for (const [serverId, state] of Object.entries(settings.plugins.mcpState)) {
      if (state.enabled && isAzhenKnowledgeMcpEndpoint(state.lastUrl)) serverIds.add(serverId);
    }
    for (const server of settings.mcp.servers) {
      if (server.enabled && isAzhenKnowledgeMcpEndpoint(server.url)) serverIds.add(server.id);
    }
    const candidates = [...serverIds]
      .map((serverId) => mcpTools.find((tool) => tool.name === `mcp__${serverId}__read_file`))
      .filter((tool): tool is AgentTool => Boolean(tool));
    if (candidates.length !== 1) {
      throw new Error("无法唯一定位 Knowledge MCP 的 read_file 工具。");
    }
    return candidates[0];
  }

  private async read(tool: AgentTool, path: string, signal?: AbortSignal): Promise<ReadReceipt> {
    const result = await tool.execute(
      `finance-read-${Date.now()}-${Math.random()}`,
      { relative_path: path },
      signal,
    );
    const details = result.details as {
      artifactId?: unknown;
      structuredContent?: unknown;
    } | undefined;
    let envelope: McpEnvelope;
    if (details?.structuredContent && typeof details.structuredContent === "object") {
      envelope = details.structuredContent as McpEnvelope;
    } else if (typeof details?.artifactId === "string") {
      if (!this.options.artifactStore) {
        throw new Error(`读取 ${path} 返回了分段回执，但当前没有可用的 Artifact 存储。`);
      }
      const artifact = await this.options.artifactStore.readArtifact(details.artifactId);
      envelope = parseMcpEnvelope(artifact.text);
    } else {
      const text = result.content.find(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )?.text;
      if (!text) throw new Error(`读取 ${path} 没有回执。`);
      envelope = parseMcpEnvelope(unwrapToolOutput(text));
    }
    if (envelope.status !== "success") {
      throw new FinanceReadError(path, envelope.error ?? envelope.status);
    }
    const payload = envelope.result as { content?: unknown; sha256?: unknown } | undefined;
    if (
      !payload ||
      typeof payload.content !== "string" ||
      typeof payload.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.sha256)
    ) {
      throw new Error(`读取 ${path} 的回执缺少正文或 SHA-256。`);
    }
    if ((await sha256Hex(payload.content)) !== payload.sha256) {
      throw new Error(`读取 ${path} 的正文与 SHA-256 不一致。`);
    }
    return { path, content: payload.content, sha256: payload.sha256 };
  }
}

function parseMcpEnvelope(text: string): McpEnvelope {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("MCP 读取回执不是 JSON 对象。");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(text.slice(start, index + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("MCP 读取回执不是 JSON 对象。");
        }
        return parsed as McpEnvelope;
      }
    }
  }
  throw new Error("MCP 读取回执 JSON 不完整。");
}

class FinanceReadError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

function chooseChart(
  requested: (typeof CHART_TYPES)[number],
  fact: FinanceFact,
  request: string,
): "doughnut" | "bar" | "line" | "none" {
  if (fact.coverage !== "complete" || fact.expenseMinor <= 0n) return "none";
  if (requested !== "auto") return requested;
  if (/趋势|变化/.test(request)) return "line";
  if (/对比|比较|各月|月份/.test(request)) return "bar";
  if (/哪里|分布|占比|分类/.test(request) && fact.categories.length > 1) return "doughnut";
  return "none";
}

function wantsMonthComparison(request: string): boolean {
  return /(?:最近|近|前|过去)\s*[零一二两三四五六七八九十百\d]*\s*(?:个)?月(?:份)?|(?:各|不同|多个|几)月(?:份)?|月度|每月|按月/.test(request);
}

function chartsPluginEnabled(app: App): boolean {
  const internal = app as unknown as {
    plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> };
  };
  return internal.plugins?.enabledPlugins?.has("obsidian-charts") === true ||
    internal.plugins?.plugins?.["obsidian-charts"] != null;
}

function stripChartBlock(markdown: string): string {
  return markdown.replace(/\n*```advanced-chart[\s\S]*?```\s*$/u, "").trimEnd();
}

function latestUserText(context: AzhenFinanceTurnContext): string {
  const message = [...context.messages].reverse().find((candidate) => candidate.role === "user");
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function publicFact(fact: FinanceFact): Record<string, unknown> {
  return {
    from: fact.from,
    to: fact.to,
    unit: fact.unit,
    precision: fact.precision,
    coverage: fact.coverage,
    transactionCount: fact.transactionCount,
    income: fact.incomeMinor.toString(),
    expense: fact.expenseMinor.toString(),
    transfer: fact.transferMinor.toString(),
    repayment: fact.repaymentMinor.toString(),
    categories: fact.categories.map((item) => ({
      category: item.category,
      amount: item.amountMinor.toString(),
    })),
    timeSeries: fact.timeSeries.map((item) => ({
      date: item.date,
      expense: item.expenseMinor.toString(),
      income: item.incomeMinor.toString(),
    })),
    monthSeries: fact.monthSeries.map((item) => ({
      month: item.month,
      amount: item.amountMinor.toString(),
    })),
    sources: fact.sources,
    factId: fact.contentHash,
  };
}

function isMissingRead(error: unknown): boolean {
  if (error instanceof FinanceReadError) return /不存在|not found|no such file/i.test(error.message);
  return /不存在|not found|no such file/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
