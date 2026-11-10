import { browser, expect, $ } from "@wdio/globals";
import { after, before, describe, it } from "mocha";

type ScriptedTurn = {
  label?: string;
  content: Array<Record<string, unknown>>;
  stopReason?: "stop" | "length" | "toolUse";
  delayMs?: number;
};

type ChartType = "doughnut" | "bar" | "line";

function chartMarkdown(type: ChartType): string {
  const datasets = type === "line"
    ? [
        { label: "支出", data: [0.1, 0.2] },
        { label: "收入", data: [0, 0] },
      ]
    : [{ label: "支出", data: [0.1, 0.2] }];
  return [
    "统计范围：2026-11-01 至 2026-11-30。",
    "共 2 笔；支出 0.30 CNY；收入 0.00 CNY。",
    "数据覆盖完整。",
    "",
    "```advanced-chart",
    JSON.stringify(
      {
        type,
        data: {
          labels: ["早餐", "午餐"],
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
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

async function chartResults(): Promise<Array<{
  text: string;
  width: number;
  height: number;
  blockWidth: number;
  blockHeight: number;
  drawnPixels: boolean;
  rawChartCodeVisible: boolean;
}>> {
  return await browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".agentic-chat-assistant")].map((turn) => {
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
      return {
        text: turn.textContent ?? "",
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        blockWidth: blockRect?.width ?? 0,
        blockHeight: blockRect?.height ?? 0,
        drawnPixels,
        rawChartCodeVisible: !!turn.querySelector("pre > code.language-advanced-chart"),
      };
    }),
  );
}

describe("finance Charts rendering", function () {
  before(async function () {
    const state = await configurePlugin();
    expect(state.chartsLoaded).toBe(true);
    expect(state.chartsVersion).toBe("3.9.0");
    await installScriptedTurns([
      {
        label: "finance doughnut final",
        stopReason: "stop",
        content: [{ type: "text", text: chartMarkdown("doughnut") }],
      },
      {
        label: "finance bar final",
        stopReason: "stop",
        content: [{ type: "text", text: chartMarkdown("bar") }],
      },
      {
        label: "finance line final",
        stopReason: "stop",
        content: [{ type: "text", text: chartMarkdown("line") }],
      },
    ]);
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

  it("renders doughnut, bar, and line canvases and restores them after reopening", async function () {
    await sendChartPrompt("用饼图看看本月钱花在哪里", 1);
    await sendChartPrompt("用柱状图比较这些支出", 2);
    await sendChartPrompt("用折线图看看收支变化", 3);

    const rendered = await chartResults();
    expect(rendered).toHaveLength(3);
    for (const result of rendered) {
      expect(result.text).toContain("支出 0.30 CNY");
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.blockWidth).toBeGreaterThan(0);
      expect(result.blockHeight).toBeGreaterThanOrEqual(220);
      expect(result.drawnPixels).toBe(true);
      expect(result.rawChartCodeVisible).toBe(false);
    }

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
          () => document.querySelectorAll(".agentic-chat-text canvas").length === 3,
        ),
      { timeout: 10_000, timeoutMsg: "Charts did not restore after reopening chat" },
    );

    const restored = await chartResults();
    expect(restored).toHaveLength(3);
    for (const result of restored) {
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.blockHeight).toBeGreaterThanOrEqual(220);
      expect(result.drawnPixels).toBe(true);
      expect(result.rawChartCodeVisible).toBe(false);
    }
  });
});
