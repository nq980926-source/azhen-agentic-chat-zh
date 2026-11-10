import { browser, expect, $ } from "@wdio/globals";
import { after, before, describe, it } from "mocha";

type ScriptedTurn = {
  label?: string;
  content: Array<Record<string, unknown>>;
  stopReason?: "stop" | "length" | "toolUse";
  delayMs?: number;
};

const chartMarkdown = [
  "统计范围：2026-11-01 至 2026-11-30。",
  "共 2 笔；支出 0.30 CNY；收入 0.00 CNY。",
  "数据覆盖完整。",
  "",
  "```advanced-chart",
  JSON.stringify(
    {
      type: "doughnut",
      data: {
        labels: ["早餐", "午餐"],
        datasets: [{ label: "支出", data: [0.1, 0.2] }],
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

describe("finance Charts rendering", function () {
  before(async function () {
    const state = await configurePlugin();
    expect(state.chartsLoaded).toBe(true);
    expect(state.chartsVersion).toBe("3.9.0");
    await installScriptedTurns([
      {
        label: "finance chart final",
        stopReason: "stop",
        content: [{ type: "text", text: chartMarkdown }],
      },
    ]);
    await browser.executeObsidianCommand("agentic-chat:open-chat");
    await $(".agentic-chat-view").waitForExist();
  });

  after(async function () {
    const open = await $(".agentic-chat-stop");
    if (await open.isExisting()) await open.click();
  });

  it("renders a real Charts canvas inside the assistant message", async function () {
    const input = await $(".agentic-chat-input");
    await input.click();
    await input.setValue("用饼图看看本月钱花在哪里");
    await $(".agentic-chat-send").click();

    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(".agentic-chat-text canvas");
          return !!canvas && canvas.width > 0 && canvas.height > 0;
        }),
      { timeout: 10_000, timeoutMsg: "Obsidian Charts did not render a canvas in the chat" },
    );

    const result = await browser.execute(() => {
      const turn = document.querySelector(".agentic-chat-assistant");
      const canvas = turn?.querySelector<HTMLCanvasElement>(".agentic-chat-text canvas");
      const block = turn?.querySelector<HTMLElement>(".agentic-chat-text .block-language-advanced-chart");
      const blockRect = block?.getBoundingClientRect();
      return {
        text: turn?.textContent ?? "",
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        blockWidth: blockRect?.width ?? 0,
        blockHeight: blockRect?.height ?? 0,
        rawChartCodeVisible: !!turn?.querySelector("pre > code.language-advanced-chart"),
      };
    });
    expect(result.text).toContain("支出 0.30 CNY");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.blockWidth).toBeGreaterThan(0);
    expect(result.blockHeight).toBeGreaterThanOrEqual(220);
    expect(result.rawChartCodeVisible).toBe(false);
  });
});
