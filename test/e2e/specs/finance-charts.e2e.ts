import { browser, expect, $ } from "@wdio/globals";
import { after, before, describe, it } from "mocha";
import {
  buildFinanceFact,
  financeFactMarkdown,
  formatMinor,
} from "../../../src/finance/azhen-finance";

type ScriptedTurn = {
  label?: string;
  content: Array<Record<string, unknown>>;
  stopReason?: "stop" | "length" | "toolUse";
  delayMs?: number;
};

type ChartType = "doughnut" | "bar" | "line";

type ChartFixture = {
  markdown: string;
  colors: string[];
  totalText: string;
};

function chartFixture(type: ChartType, purposeCount = 2): ChartFixture {
  const ledger = [
    "日期｜用途｜金额｜来源",
    ...Array.from(
      { length: purposeCount },
      (_, index) =>
        `2026-11-${String((index % 9) + 1).padStart(2, "0")}｜用途${String(index + 1).padStart(2, "0")}｜${index + 1}.00｜每日额度`,
    ),
  ].join("\n");
  const fact = buildFinanceFact({
    ledgerText: ledger,
    from: "2026-11-01",
    to: "2026-11-30",
    sourcePath: "生活/记账/账本/2026-11.md",
    sourceHash: "a".repeat(64),
    coverage: "complete",
  });
  const rendered = financeFactMarkdown(fact, type, "category");
  if (!rendered.chart) throw new Error("finance fixture did not produce a chart");
  const colors = rendered.chart.data.datasets.flatMap((dataset) => {
    const visibleColor = rendered.chart?.type === "line"
      ? dataset.borderColor
      : dataset.backgroundColor;
    return typeof visibleColor === "string" ? [visibleColor] : visibleColor;
  });
  return {
    markdown: rendered.markdown,
    colors,
    totalText: `支出 ${formatMinor(fact.expenseMinor)} CNY`,
  };
}

async function installScriptedTurns(turns: ScriptedTurn[]): Promise<void> {
  await browser.execute((scriptedTurns) => {
    const target = window as typeof window & {
      __AGENTIC_CHAT_E2E_TURNS__?: ScriptedTurn[];
      __AGENTIC_CHAT_E2E_CALLS__?: number;
      __AGENTIC_CHAT_E2E_CALL_LOG__?: unknown[];
      __AGENTIC_CHAT_E2E_RELEASE__?: boolean;
    };
    target.__AGENTIC_CHAT_E2E_TURNS__ = scriptedTurns;
    target.__AGENTIC_CHAT_E2E_CALLS__ = 0;
    target.__AGENTIC_CHAT_E2E_CALL_LOG__ = [];
    target.__AGENTIC_CHAT_E2E_RELEASE__ = true;
  }, turns);
}

async function configurePlugin(): Promise<{ chartsLoaded: boolean; chartsVersion: string }> {
  return await browser.executeObsidian(async ({ app }) => {
    const pluginHost = (app as unknown as {
      plugins?: {
        enabledPlugins?: Set<string>;
        manifests?: Record<string, { version?: string }>;
        plugins?: Record<string, { settings?: Record<string, unknown>; saveSettings?: () => Promise<void> }>;
      };
    }).plugins;
    const plugin = pluginHost?.plugins?.["agentic-chat"];
    if (!plugin?.settings) throw new Error("agentic-chat plugin not found");
    plugin.settings.provider = "openrouter";
    plugin.settings.openrouterApiKey = "e2e-scripted-key";
    plugin.settings.mode = "safe";
    plugin.settings.autoOpenOnMobile = true;
    await plugin.saveSettings?.();
    return {
      chartsLoaded: pluginHost?.enabledPlugins?.has("obsidian-charts") === true,
      chartsVersion: pluginHost?.manifests?.["obsidian-charts"]?.version ?? "",
    };
  });
}

async function sendChartPrompt(prompt: string, expectedCharts: number): Promise<void> {
  const input = await $(".agentic-chat-input");
  await input.click();
  await input.setValue(prompt);
  await $(".agentic-chat-send").click();
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (count) => document.querySelectorAll(".agentic-chat-text canvas").length >= count,
        expectedCharts,
      ),
    {
      timeout: 10_000,
      timeoutMsg: `Obsidian Charts did not render ${expectedCharts} canvas element(s) in chat`,
    },
  );
}

async function chartResults(expectedCharts: Array<{ colors: string[]; totalText: string }>): Promise<Array<{
  text: string;
  width: number;
  height: number;
  blockWidth: number;
  blockHeight: number;
  drawnPixels: boolean;
  rawChartCodeVisible: boolean;
  matchedColors: string[];
  expectedColorCount: number;
}>> {
  return await browser.execute((expected) =>
    [...document.querySelectorAll<HTMLElement>(".agentic-chat-assistant")].map((turn, renderedIndex) => {
      const canvas = turn.querySelector<HTMLCanvasElement>(".agentic-chat-text canvas");
      const block = turn.querySelector<HTMLElement>(".agentic-chat-text .block-language-advanced-chart");
      const blockRect = block?.getBoundingClientRect();
      const context = canvas?.getContext("2d");
      const pixels = context && canvas
        ? context.getImageData(0, 0, canvas.width, canvas.height).data
        : null;
      let drawnPixels = false;
      if (pixels) {
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) {
            drawnPixels = true;
            break;
          }
        }
      }
      const expectedColors = expected[renderedIndex]?.colors ?? [];
      const matchedColors = expectedColors.filter((hex: string) => {
        const match = /^#([0-9a-f]{6})$/i.exec(hex);
        if (!match) return false;
        const value = Number.parseInt(match[1], 16);
        const expectedRgb = [value >> 16, (value >> 8) & 0xff, value & 0xff];
        if (!pixels) return false;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 200) continue;
          if (
            Math.abs(pixels[index] - expectedRgb[0]) <= 3 &&
            Math.abs(pixels[index + 1] - expectedRgb[1]) <= 3 &&
            Math.abs(pixels[index + 2] - expectedRgb[2]) <= 3
          ) return true;
        }
        return false;
      });
      return {
        text: turn.textContent ?? "",
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        blockWidth: blockRect?.width ?? 0,
        blockHeight: blockRect?.height ?? 0,
        drawnPixels,
        rawChartCodeVisible: !!turn.querySelector("pre > code.language-advanced-chart"),
        matchedColors,
        expectedColorCount: expectedColors.length,
      };
    }),
  expectedCharts);
}

describe("finance Charts rendering", function () {
  before(async function () {
    const state = await configurePlugin();
    expect(state.chartsLoaded).toBe(true);
    expect(state.chartsVersion.startsWith("3.9.0")).toBe(true);
    const doughnut = chartFixture("doughnut");
    const bar = chartFixture("bar");
    const line = chartFixture("line");
    const manyPurposes = chartFixture("doughnut", 22);
    await installScriptedTurns([
      {
        label: "finance doughnut final",
        stopReason: "stop",
        content: [{ type: "text", text: doughnut.markdown }],
      },
      {
        label: "finance bar final",
        stopReason: "stop",
        content: [{ type: "text", text: bar.markdown }],
      },
      {
        label: "finance line final",
        stopReason: "stop",
        content: [{ type: "text", text: line.markdown }],
      },
      {
        label: "finance 22 purposes dark final",
        stopReason: "stop",
        content: [{ type: "text", text: manyPurposes.markdown }],
      },
    ]);
    await browser.execute(() => {
      document.body.classList.remove("theme-light");
      document.body.classList.add("theme-dark");
      document.body.style.colorScheme = "dark";
      document.body.style.setProperty("--background-primary", "#1e1e1e");
      document.body.style.setProperty("--text-muted", "#b8b8b8");
    });
    const expectations = [doughnut, bar, line, manyPurposes].map(({ colors, totalText }) => ({
      colors,
      totalText,
    }));
    await browser.execute((expected) => {
      (window as typeof window & { __FINANCE_EXPECTATIONS__?: typeof expected })
        .__FINANCE_EXPECTATIONS__ = expected;
    }, expectations);
    await browser.executeObsidian(async ({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("agentic-chat-chat-view")) leaf.detach();
    });
    await browser.executeObsidianCommand("agentic-chat:open-chat");
    await $(".agentic-chat-view").waitForExist();
  });

  after(async function () {
    const open = await $(".agentic-chat-stop");
    if (await open.isExisting() && await open.isDisplayed()) await open.click();
  });

  it("renders colored doughnut, bar, line and 22-purpose charts in dark and light themes and restores them after reopening", async function () {
    await sendChartPrompt("用饼图看看本月钱花在哪里", 1);
    await sendChartPrompt("用柱状图比较这些支出", 2);
    await sendChartPrompt("用折线图看看收支变化", 3);
    await sendChartPrompt("按分类展示本月钱花在哪里", 4);

    const expectations = await browser.execute(
      () => (window as typeof window & {
        __FINANCE_EXPECTATIONS__?: Array<{ colors: string[]; totalText: string }>;
      }).__FINANCE_EXPECTATIONS__ ?? [],
    );
    const rendered = await chartResults(expectations);
    expect(rendered).toHaveLength(4);
    for (const [index, result] of rendered.entries()) {
      expect(result.text).toContain(expectations[index]!.totalText);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.blockWidth).toBeGreaterThan(0);
      expect(result.blockHeight).toBeGreaterThanOrEqual(220);
      expect(result.drawnPixels).toBe(true);
      expect(result.rawChartCodeVisible).toBe(false);
      expect(result.matchedColors).toHaveLength(result.expectedColorCount);
    }
    expect(rendered[3]?.text).toContain("账本未提供可核实的大类映射");
    expect(rendered[3]?.text).toContain("支出用途");

    await browser.executeObsidian(async ({ app }) => {
      const leaves = app.workspace.getLeavesOfType("agentic-chat-chat-view");
      if (leaves.length !== 1) throw new Error(`expected one chat leaf, got ${leaves.length}`);
      leaves[0]!.detach();
    });
    await browser.waitUntil(
      async () => await browser.execute(() => document.querySelector(".agentic-chat-view") == null),
      { timeout: 5_000, timeoutMsg: "chat view did not close" },
    );

    await browser.executeObsidianCommand("agentic-chat:open-chat");
    await $(".agentic-chat-view").waitForExist();
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () => document.querySelectorAll(".agentic-chat-text canvas").length === 4,
        ),
      { timeout: 10_000, timeoutMsg: "Charts did not restore after reopening chat" },
    );

    const restored = await chartResults(expectations);
    expect(restored).toHaveLength(4);
    for (const result of restored) {
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.blockHeight).toBeGreaterThanOrEqual(220);
      expect(result.drawnPixels).toBe(true);
      expect(result.rawChartCodeVisible).toBe(false);
      expect(result.matchedColors).toHaveLength(result.expectedColorCount);
    }

    await browser.executeObsidian(async ({ app }) => {
      document.body.classList.remove("theme-dark");
      document.body.classList.add("theme-light");
      document.body.style.colorScheme = "light";
      document.body.style.setProperty("--background-primary", "#ffffff");
      document.body.style.setProperty("--text-muted", "#555555");
      app.workspace.trigger("css-change");
    });
    await browser.pause(1_000);
    const light = await chartResults(expectations);
    expect(light).toHaveLength(4);
    for (const result of light) {
      expect(result.drawnPixels).toBe(true);
      expect(result.matchedColors).toHaveLength(result.expectedColorCount);
    }
  });
});
