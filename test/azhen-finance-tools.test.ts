import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createMcpServerState } from "../src/mcp/settings";
import { AZHEN_FINANCE_QUERY_TOOL, createAzhenFinanceTools } from "../src/tools/azhen-finance-tools";
import { sha256Hex } from "../src/finance/azhen-finance";
import { FakeApp } from "./helpers/fake-vault";

const SERVER_ID = "plugin_plugin_mcp_4b3828edfaf8";
const ENDPOINT = "https://106.55.92.40/mcp";

function settings() {
  return {
    ...DEFAULT_SETTINGS,
    mcp: { ...DEFAULT_SETTINGS.mcp, enabled: true, servers: [] },
    plugins: {
      ...DEFAULT_SETTINGS.plugins,
      mcpState: {
        [SERVER_ID]: createMcpServerState(SERVER_ID, {
          enabled: true,
          lastUrl: ENDPOINT,
        }),
      },
    },
  } as typeof DEFAULT_SETTINGS;
}

function readTool(files: Map<string, string>): AgentTool {
  const execute = async (_id: string, input: unknown) => {
    const path = String((input as { relative_path?: unknown }).relative_path ?? "");
    const content = files.get(path);
    const envelope = content == null
      ? { status: "failed", operation: "read_file", path, result: null, error: "文件不存在" }
      : { status: "success", operation: "read_file", path, result: { content, sha256: await sha256Hex(content) } };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      details: { structuredContent: envelope },
    };
  };
  return {
    name: `mcp__${SERVER_ID}__read_file`,
    label: "Knowledge: read_file",
    description: "fixture",
    parameters: {},
    execute,
  } as unknown as AgentTool;
}

function context(text: string) {
  return {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: 1,
      },
    ],
  } as never;
}

describe("azhen finance query tool", () => {
  const ledger = [
    "# 2026年11月账本",
    "",
    "日期｜用途｜金额｜来源",
    "2026-11-01｜早餐｜0.10｜每日额度",
    "2026-11-01｜午餐｜0.20｜每日额度",
    "2026-11-02｜工资｜100.00｜新增入账",
    "2026-11-03｜还款｜50.00｜存款（还款）",
    "2026-11-04｜回填｜30.00｜月度池→存款",
    "",
  ].join("\n");

  it("returns exact text and one chart payload from the same FinanceFact", async () => {
    const app = new FakeApp();
    (app.vault as unknown as { configDir: string }).configDir = ".obsidian";
    (app as unknown as { plugins: unknown }).plugins = {
      enabledPlugins: new Set(["obsidian-charts"]),
      plugins: { "obsidian-charts": {} },
    };
    const files = new Map([
      ["生活/记账/用户财务档案.md", "# 财务档案\n\n- 项目制已取消\n"],
      ["生活/记账/账本/2026-11.md", ledger],
    ]);
    const tool = createAzhenFinanceTools({
      app: app as never,
      getSettings: settings,
      getMcpTools: () => [readTool(files)],
      getTurnContext: () => context("本月钱都花在哪里？"),
    }).find((candidate) => candidate.name === AZHEN_FINANCE_QUERY_TOOL)!;

    const result = await tool.execute("query", {
      from: "2026-11-01",
      to: "2026-11-30",
      chart: "auto",
    });
    const output = result.content[0] as { type: "text"; text: string };
    expect(output.text).toContain("支出 0.30 CNY");
    expect(output.text).toContain("收入 100.00 CNY");
    expect(output.text).toContain("```advanced-chart");

    const chartJson = /```advanced-chart\n([\s\S]*?)\n```/.exec(output.text)?.[1];
    expect(chartJson).toBeTruthy();
    const chart = JSON.parse(chartJson!);
    const chartTotal = chart.data.datasets[0].data.reduce(
      (sum: number, value: number) => sum + Math.round(value * 100),
      0,
    );
    const details = result.details as {
      fact: { expense: string; categories: Array<{ amount: string }> };
    };
    expect(chartTotal).toBe(Number(details.fact.expense));
    expect(
      details.fact.categories.reduce((sum, item) => sum + BigInt(item.amount), 0n),
    ).toBe(BigInt(details.fact.expense));
  });

  it("does not render a chart when Charts is unavailable", async () => {
    const app = new FakeApp();
    (app.vault as unknown as { configDir: string }).configDir = ".obsidian";
    const files = new Map([
      ["生活/记账/用户财务档案.md", "# 财务档案\n\n- 项目制已取消\n"],
      ["生活/记账/账本/2026-11.md", ledger],
    ]);
    const tool = createAzhenFinanceTools({
      app: app as never,
      getSettings: settings,
      getMcpTools: () => [readTool(files)],
      getTurnContext: () => context("看看本月分类占比"),
    }).find((candidate) => candidate.name === AZHEN_FINANCE_QUERY_TOOL)!;

    const result = await tool.execute("query", {
      from: "2026-11-01",
      to: "2026-11-30",
      chart: "doughnut",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("```advanced-chart");
    expect(text).toContain("Obsidian Charts 插件未安装或未启用");
    expect(result.details?.chartType).toBe("none");
  });

  it("uses monthly totals for a recent-months comparison", async () => {
    const app = new FakeApp();
    (app.vault as unknown as { configDir: string }).configDir = ".obsidian";
    (app as unknown as { plugins: unknown }).plugins = {
      enabledPlugins: new Set(["obsidian-charts"]),
      plugins: { "obsidian-charts": {} },
    };
    const october = [
      "日期｜用途｜金额｜来源",
      "2026-10-01｜早餐｜1.25｜每日额度",
    ].join("\n");
    const november = [
      "日期｜用途｜金额｜来源",
      "2026-11-01｜早餐｜2.50｜每日额度",
      "2026-11-02｜交通｜3.75｜每日额度",
    ].join("\n");
    const files = new Map([
      ["生活/记账/用户财务档案.md", "# 财务档案\n\n- 项目制已取消\n"],
      ["生活/记账/账本/2026-10.md", october],
      ["生活/记账/账本/2026-11.md", november],
    ]);
    const tool = createAzhenFinanceTools({
      app: app as never,
      getSettings: settings,
      getMcpTools: () => [readTool(files)],
      getTurnContext: () => context("对比一下最近两个月的支出"),
    }).find((candidate) => candidate.name === AZHEN_FINANCE_QUERY_TOOL)!;

    const result = await tool.execute("query", {
      from: "2026-10-01",
      to: "2026-11-30",
      chart: "auto",
    });
    const output = result.content[0] as { text: string };
    expect(output.text).toContain("支出 7.50 CNY");
    expect(output.text).toContain("2026-10：1.25 CNY");
    expect(output.text).toContain("2026-11：6.25 CNY");
    const chartJson = /```advanced-chart\n([\s\S]*?)\n```/.exec(output.text)?.[1];
    const chart = JSON.parse(chartJson!);
    expect(chart.data.labels).toEqual(["2026-10", "2026-11"]);
    expect(chart.data.datasets[0]).toEqual({
      label: "月度支出",
      data: [1.25, 6.25],
    });
    const details = result.details as {
      fact: { monthSeries: Array<{ month: string; amount: string }> };
    };
    expect(details.fact.monthSeries).toEqual([
      { month: "2026-10", amount: "125" },
      { month: "2026-11", amount: "625" },
    ]);
  });

  it("marks a missing month as partial and never presents a chart as complete", async () => {
    const app = new FakeApp();
    (app.vault as unknown as { configDir: string }).configDir = ".obsidian";
    (app as unknown as { plugins: unknown }).plugins = {
      enabledPlugins: new Set(["obsidian-charts"]),
      plugins: { "obsidian-charts": {} },
    };
    const files = new Map([
      ["生活/记账/用户财务档案.md", "# 财务档案\n\n- 项目制已取消\n"],
      ["生活/记账/账本/2026-11.md", ledger],
    ]);
    const tool = createAzhenFinanceTools({
      app: app as never,
      getSettings: settings,
      getMcpTools: () => [readTool(files)],
      getTurnContext: () => context("十月和十一月的消费趋势"),
    }).find((candidate) => candidate.name === AZHEN_FINANCE_QUERY_TOOL)!;

    const result = await tool.execute("query", {
      from: "2026-10-01",
      to: "2026-11-30",
      chart: "line",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("账本覆盖不完整");
    expect(text).not.toContain("```advanced-chart");
    expect(result.details?.missing).toEqual(["生活/记账/账本/2026-10.md"]);
  });

  it("rejects a mismatched read hash instead of returning a trusted total", async () => {
    const app = new FakeApp();
    (app.vault as unknown as { configDir: string }).configDir = ".obsidian";
    const files = new Map([
      ["生活/记账/用户财务档案.md", "# 财务档案\n\n- 项目制已取消\n"],
      ["生活/记账/账本/2026-11.md", ledger],
    ]);
    const valid = readTool(files);
    const badRead = {
      ...valid,
      execute: async () => ({
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "success",
            result: { content: ledger, sha256: "0".repeat(64) },
          }),
        }],
        details: {},
      }),
    } as AgentTool;
    const tool = createAzhenFinanceTools({
      app: app as never,
      getSettings: settings,
      getMcpTools: () => [badRead],
      getTurnContext: () => context("本月花了多少"),
    }).find((candidate) => candidate.name === AZHEN_FINANCE_QUERY_TOOL)!;

    const result = await tool.execute("query", {
      from: "2026-11-01",
      to: "2026-11-30",
      chart: "none",
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("无法可靠核实");
  });
});
