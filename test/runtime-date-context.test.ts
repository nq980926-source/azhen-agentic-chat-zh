import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  buildRuntimeDateContext,
  resolveRuntimeTimeZone,
} from "../src/agent/runtime-date-context";
import { composeAgentSystemPrompt, EMPTY_AGENT_RUNTIME_RESOURCES } from "../src/agent/runtime-resources";
import { AgentRuntimeResourceState } from "../src/agent/runtime-resource-state";
import { DEFAULT_SETTINGS } from "../src/settings";
import { AZHEN_KNOWLEDGE_PROMPT_OVERLAY } from "../src/agent/azhen-knowledge-policy";
import { createMcpServerState } from "../src/mcp/settings";
import { ReadMemo } from "../src/vault/read-memo";
import type { WebFetcher } from "../src/tools/web-fetch";
import { replayTextTurn } from "../src/agent/replay-stream";
import { runAgentReplay } from "./helpers/agent-replay";

afterEach(() => {
  vi.useRealTimers();
});

describe("runtime date context", () => {
  it("renders the local calendar, weekday, relative dates, and Monday-Sunday week ranges", () => {
    const context = buildRuntimeDateContext({
      now: new Date("2026-11-10T00:15:00.000Z"),
      timeZone: "Asia/Shanghai",
    });

    expect(context).toContain("Current local date and time: 2026-11-10 08:15");
    expect(context).toContain("Asia/Shanghai");
    expect(context).toContain("Today: 2026-11-10, 星期二 (Tuesday)");
    expect(context).toContain("Yesterday: 2026-11-09");
    expect(context).toContain("Tomorrow: 2026-11-11");
    expect(context).toContain("This week (Monday-Sunday): 2026-11-09 to 2026-11-15");
    expect(context).toContain("Previous week (Monday-Sunday): 2026-11-02 to 2026-11-08");
    expect(context).toContain("An explicit date supplied by the user takes priority");
  });

  it("uses the target time zone rather than the UTC calendar date", () => {
    const context = buildRuntimeDateContext({
      now: new Date("2026-11-10T23:30:00.000Z"),
      timeZone: "Asia/Shanghai",
    });

    expect(context).toContain("Today: 2026-11-11");
    expect(context).not.toContain("Today: 2026-11-10");
  });

  it("handles month-end, year-end, and leap-day boundaries", () => {
    const yearEnd = buildRuntimeDateContext({
      now: new Date("2026-12-31T23:30:00.000Z"),
      timeZone: "Asia/Shanghai",
    });
    expect(yearEnd).toContain("Today: 2027-01-01, 星期五 (Friday)");
    expect(yearEnd).toContain("Yesterday: 2026-12-31");
    expect(yearEnd).toContain("This week (Monday-Sunday): 2026-12-28 to 2027-01-03");

    const leapDay = buildRuntimeDateContext({
      now: new Date("2028-02-29T04:00:00.000Z"),
      timeZone: "Asia/Shanghai",
    });
    expect(leapDay).toContain("Today: 2028-02-29, 星期二 (Tuesday)");
    expect(leapDay).toContain("Yesterday: 2028-02-28");
    expect(leapDay).toContain("Tomorrow: 2028-03-01");
  });

  it("keeps calendar arithmetic stable across daylight-saving transitions", () => {
    const beforeSpring = buildRuntimeDateContext({
      now: new Date("2026-03-08T06:30:00.000Z"),
      timeZone: "America/New_York",
    });
    const afterSpring = buildRuntimeDateContext({
      now: new Date("2026-03-08T07:30:00.000Z"),
      timeZone: "America/New_York",
    });
    expect(beforeSpring).toContain("Current local date and time: 2026-03-08 01:30");
    expect(beforeSpring).toContain("GMT-05:00");
    expect(afterSpring).toContain("Current local date and time: 2026-03-08 03:30");
    expect(afterSpring).toContain("GMT-04:00");
    expect(beforeSpring).toContain("This week (Monday-Sunday): 2026-03-02 to 2026-03-08");
    expect(afterSpring).toContain("This week (Monday-Sunday): 2026-03-02 to 2026-03-08");

    const beforeFall = buildRuntimeDateContext({
      now: new Date("2026-11-01T05:30:00.000Z"),
      timeZone: "America/New_York",
    });
    const afterFall = buildRuntimeDateContext({
      now: new Date("2026-11-01T06:30:00.000Z"),
      timeZone: "America/New_York",
    });
    expect(beforeFall).toContain("2026-11-01 01:30");
    expect(beforeFall).toContain("GMT-04:00");
    expect(afterFall).toContain("2026-11-01 01:30");
    expect(afterFall).toContain("GMT-05:00");
  });

  it("updates the date when a later request crosses local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T23:59:50.000Z"));
    const before = buildRuntimeDateContext({ timeZone: "Asia/Shanghai" });
    vi.setSystemTime(new Date("2026-11-11T00:00:10.000Z"));
    const after = buildRuntimeDateContext({ timeZone: "Asia/Shanghai" });

    expect(before).toContain("Today: 2026-11-11");
    expect(after).toContain("Today: 2026-11-11");
    expect(after).toContain("Current local date and time: 2026-11-11 08:00");

    vi.setSystemTime(new Date("2026-11-11T15:59:50.000Z"));
    const boundaryBefore = buildRuntimeDateContext({ timeZone: "Asia/Shanghai" });
    vi.setSystemTime(new Date("2026-11-11T16:00:10.000Z"));
    const boundaryAfter = buildRuntimeDateContext({ timeZone: "Asia/Shanghai" });
    expect(boundaryBefore).toContain("Today: 2026-11-11");
    expect(boundaryAfter).toContain("Today: 2026-11-12");
  });

  it("recomputes the runtime date context for every system-prompt build", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
    const currentSettings = DEFAULT_SETTINGS;
    const noopFetcher: WebFetcher = async () => ({ status: 200, text: "", headers: {} });
    const state = new AgentRuntimeResourceState({
      app: { vault: {}, workspace: {} } as unknown as App,
      getSettings: () => currentSettings,
      readMemo: new ReadMemo(),
      webFetch: noopFetcher,
    });

    const first = state.composeSystemPrompt(currentSettings, "test/model");
    vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
    const second = state.composeSystemPrompt(currentSettings, "test/model");
    const firstDate = first.match(/Today: (\d{4}-\d{2}-\d{2})/)?.[1];
    const secondDate = second.match(/Today: (\d{4}-\d{2}-\d{2})/)?.[1];

    expect(firstDate).not.toBe(secondDate);
    expect(first).toContain("## Runtime date context (authoritative for relative dates)");
    expect(second).toContain("## Runtime date context (authoritative for relative dates)");
  });

  it("includes the date context in the real outgoing agent request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
    const result = await runAgentReplay({
      prompt: "今天什么安排？",
      turns: [replayTextTurn("已读取日期。", { label: "date-aware final" })],
    });

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.systemPrompt).toContain(
      "## Runtime date context (authoritative for relative dates)",
    );
    expect(result.calls[0]?.systemPrompt).toContain("Current local date and time:");
    expect(result.calls[0]?.systemPrompt).toContain("Previous week (Monday-Sunday):");
    expect(result.sessionText).not.toContain("## Runtime date context");
  });

  it("keeps an explicitly requested historical date in the user message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
    const prompt = "帮我看看 2026-09-18 的日记，不要当作今天。";
    const result = await runAgentReplay({
      prompt,
      turns: [replayTextTurn("已按 2026-09-18 查询。", { label: "historical date" })],
    });
    const user = result.messages.find((message) => message.role === "user");

    expect(JSON.stringify(user)).toContain("2026-09-18");
    expect(result.calls[0]?.systemPrompt).toContain(
      "An explicit date supplied by the user takes priority for that request.",
    );
  });

  it("degrades explicitly when the instant or IANA time zone is unavailable", () => {
    expect(buildRuntimeDateContext({ now: new Date(Number.NaN), timeZone: "Asia/Shanghai" })).toContain(
      "Runtime date context unavailable",
    );
    expect(buildRuntimeDateContext({ now: new Date(), timeZone: "Not/A-Time-Zone" })).toContain(
      "Runtime date context unavailable",
    );
  });

  it("adds the date block without replacing custom prompts, Skills, or Knowledge policy", () => {
    const context = buildRuntimeDateContext({
      now: new Date("2026-11-10T00:15:00.000Z"),
      timeZone: "Asia/Shanghai",
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      systemPrompt: "My custom system prompt.",
      mcp: { ...DEFAULT_SETTINGS.mcp, enabled: true },
      plugins: {
        ...DEFAULT_SETTINGS.plugins,
        mcpState: {
          plugin_plugin_mcp_4b3828edfaf8: createMcpServerState("plugin_plugin_mcp_4b3828edfaf8", {
            enabled: true,
            lastUrl: "https://106.55.92.40/mcp",
          }),
        },
      },
    } as never;
    const skillNames = [
      "阿斟财务",
      "阿斟个人训练",
      "阿斟技能维护",
      "阿斟教学",
      "阿斟今日日程",
      "阿斟练琴",
      "阿斟日记",
      "阿斟习惯复盘",
      "阿斟写作",
    ];
    const resources = {
      ...EMPTY_AGENT_RUNTIME_RESOURCES,
      skills: skillNames.map((name) => ({
        name,
        description: `${name} description`,
        content: "使用 Knowledge MCP。",
        filePath: `.agentic-plugins/azhen-business-skills/skills/${name}/SKILL.md`,
      })),
    };
    const prompt = composeAgentSystemPrompt(settings, resources, "", undefined, undefined, context);

    expect(prompt).toContain("My custom system prompt.");
    expect(prompt).toContain(context);
    for (const name of skillNames) expect(prompt).toContain(`<name>${name}</name>`);
    expect(prompt).toContain(AZHEN_KNOWLEDGE_PROMPT_OVERLAY);
  });

  it("resolves the runtime IANA time zone", () => {
    expect(resolveRuntimeTimeZone()).toEqual(expect.any(String));
    expect(resolveRuntimeTimeZone().length).toBeGreaterThan(0);
  });
});
