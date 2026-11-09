import { $, browser, expect } from "@wdio/globals";
import { after, before, describe, it } from "mocha";
import { openAgenticChatSettings, closeAgenticChatSettings, selectSettingsTab, waitForSetting } from "../support/settings-ui";

const VIEW_TYPE_AGENT_CHAT = "agentic-chat-chat-view";
const MOBILE_WIDTH = Number(process.env.AGENTIC_CHAT_E2E_VIEWPORT_WIDTH || 390);
const MOBILE_HEIGHT = Number(process.env.AGENTIC_CHAT_E2E_VIEWPORT_HEIGHT || 844);
const MOBILE_WRITE_PATH = "Mobile/E2E-Mobile-Approval.md";
const MOBILE_WRITE_BODY = "mobile approval write ok";

type ScriptedTurn = {
  label?: string;
  content: Array<Record<string, unknown>>;
  stopReason?: "stop" | "length" | "toolUse";
};

function toolTurn(label: string, id: string, name: string, args: Record<string, unknown>): ScriptedTurn {
  return {
    label,
    stopReason: "toolUse",
    content: [{ type: "toolCall", id, name, arguments: args }],
  };
}

function textTurn(label: string, text: string): ScriptedTurn {
  return {
    label,
    stopReason: "stop",
    content: [{ type: "text", text }],
  };
}

async function setMobileViewport(): Promise<void> {
  const cdpBrowser = browser as typeof browser & {
    cdp?: (domain: string, command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  if (cdpBrowser.cdp) {
    await cdpBrowser.cdp("Emulation", "setDeviceMetricsOverride", {
      width: MOBILE_WIDTH,
      height: MOBILE_HEIGHT,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdpBrowser.cdp("Emulation", "setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  await browser.waitUntil(
    async () => {
      const width = await browser.execute(() => window.innerWidth);
      return width <= MOBILE_WIDTH + 80;
    },
    {
      timeout: 5_000,
      timeoutMsg: `Browser did not enter a phone-sized viewport (wanted ${MOBILE_WIDTH}px, got ${await browser.execute(() => window.innerWidth)}px)`,
    },
  );
}

async function openChat(): Promise<void> {
  await browser.executeObsidianCommand("agentic-chat:open-chat");
  await $(".agentic-chat-view").waitForExist();
}

async function assertChatUsesRootWorkspace(): Promise<void> {
  const metrics = await browser.executeObsidian(({ app }, viewType) => {
    const leaf = app.workspace.getLeavesOfType(viewType)[0];
    if (!leaf) return null;
    const view = document.querySelector<HTMLElement>(".agentic-chat-view");
    const viewportWidth = window.innerWidth;
    return {
      inRoot: leaf.getRoot() === app.workspace.rootSplit,
      leafWidth: Math.round(view?.getBoundingClientRect().width ?? 0),
      viewportWidth,
    };
  }, VIEW_TYPE_AGENT_CHAT);

  expect(metrics).not.toBeNull();
  expect(metrics?.inRoot).toBe(true);
  expect(metrics?.leafWidth).toBeGreaterThanOrEqual((metrics?.viewportWidth ?? 0) * 0.8);
}

async function measureMobileComposer(): Promise<{
  viewportHeight: number;
  root: { top: number; right: number; bottom: number; height: number; overflowY: string; padding: string };
  messages: { top: number; bottom: number; height: number; scrollHeight: number };
  composer: { top: number; bottom: number; height: number };
  field: { top: number; bottom: number; height: number };
  input: { top: number; bottom: number; height: number; scrollHeight: number; scrollable: boolean };
  toolbar: { top: number; bottom: number; height: number };
  mobileNavbar: { top: number; bottom: number; height: number } | null;
}> {
  return await browser.execute(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    };
    const rootElement = document.querySelector<HTMLElement>(".agentic-chat-view");
    const messagesElement = document.querySelector<HTMLElement>(".agentic-chat-messages");
    const inputElement = document.querySelector<HTMLTextAreaElement>(".agentic-chat-input");
    const root = box(".agentic-chat-view");
    const messages = box(".agentic-chat-messages");
    const composer = box(".agentic-chat-composer");
    const field = box(".agentic-chat-field");
    const input = box(".agentic-chat-input");
    const toolbar = box(".agentic-chat-toolbar");
    if (!root || !messages || !composer || !field || !input || !toolbar) {
      throw new Error("mobile composer layout is incomplete");
    }
    const rootStyle = rootElement ? getComputedStyle(rootElement) : null;
    return {
      viewportHeight: window.innerHeight,
      root: {
        ...root,
        overflowY: rootStyle?.overflowY ?? "",
        padding: rootStyle?.padding ?? "",
      },
      messages: {
        ...messages,
        scrollHeight: messagesElement?.scrollHeight ?? 0,
      },
      composer,
      field,
      input: {
        ...input,
        scrollHeight: inputElement?.scrollHeight ?? 0,
        scrollable: inputElement?.classList.contains("is-scrollable") ?? false,
      },
      toolbar,
      mobileNavbar: box(".mobile-navbar"),
    };
  });
}

async function sendPrompt(prompt: string): Promise<void> {
  const input = await $(".agentic-chat-input");
  await input.click();
  await input.setValue(prompt);
  await $(".agentic-chat-send").click();
}

async function setComposerDraft(value: string): Promise<void> {
  await browser.execute((nextValue) => {
    const input = document.querySelector<HTMLTextAreaElement>(".agentic-chat-input");
    if (!input) throw new Error("composer textarea not found");
    input.focus();
    input.value = nextValue;
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: nextValue,
    }));
  }, value);
}

async function runSlashCommand(command: string): Promise<void> {
  await sendPrompt(command);
}

async function closeOpenModals(): Promise<void> {
  await browser.execute(() => {
    for (const close of Array.from(document.querySelectorAll<HTMLElement>(".modal-close-button"))) close.click();
    for (const backdrop of Array.from(document.querySelectorAll<HTMLElement>(".modal-bg"))) backdrop.click();
  });
}

async function installScriptedTurns(turns: ScriptedTurn[]): Promise<void> {
  await browser.execute((scriptedTurns) => {
    const target = window as typeof window & {
      __AGENTIC_CHAT_E2E_TURNS__?: ScriptedTurn[];
      __AGENTIC_CHAT_E2E_CALLS__?: number;
      __AGENTIC_CHAT_E2E_CALL_LOG__?: unknown[];
    };
    target.__AGENTIC_CHAT_E2E_TURNS__ = scriptedTurns;
    target.__AGENTIC_CHAT_E2E_CALLS__ = 0;
    target.__AGENTIC_CHAT_E2E_CALL_LOG__ = [];
  }, turns);
}

async function seedMobileState(): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, writePath) => {
    const plugin = (app as unknown as {
      plugins?: {
        plugins?: Record<string, { settings?: Record<string, unknown>; saveSettings?: () => Promise<void> }>;
      };
      secretStorage?: { setSecret?: (id: string, value: string) => void };
    }).plugins?.plugins?.["agentic-chat"];
    if (!plugin?.settings) throw new Error("agentic-chat plugin not found");

    const settings = plugin.settings as {
      provider: string;
      openrouterApiKey: string;
      openrouterModel: string;
      mode: string;
      approval: { mutating: string; perTool: Record<string, string>; workingDirs: string[] };
      web: { enabled: boolean };
      mcp: { enabled: boolean; proxyUrl: string; noProxy: string; servers: unknown[] };
      network: { proxyUrl: string; noProxy: string };
    };
    settings.provider = "openrouter";
    settings.openrouterApiKey = "e2e-mobile-scripted-key";
    settings.openrouterModel = "openai/gpt-4o-mini";
    settings.mode = "safe";
    settings.approval = { mutating: "ask", perTool: {}, workingDirs: [] };
    settings.web.enabled = false;
    settings.mcp = {
      enabled: true,
      proxyUrl: "",
      noProxy: "localhost,127.0.0.1,::1",
      servers: [{
        id: "mobile-demo",
        name: "Mobile MCP Demo",
        url: "https://mcp.example.com/mcp",
        // Disabled so later scripted chat turns never contact the endpoint;
        // the settings header still renders.
        enabled: false,
        authType: "none",
        authHeaderName: "",
        authHeaderValueSecretId: "",
        authHeaderValue: "",
        oauth: {
          clientId: "",
          clientSecretSecretId: "",
          clientSecret: "",
          dynamicClientRegistration: false,
          registeredRedirectUri: "",
          authorizationServer: "",
          authorizationEndpoint: "",
          tokenEndpoint: "",
          registrationEndpoint: "",
          resourceMetadataUrl: "",
          accessTokenSecretId: "",
          accessToken: "",
          refreshTokenSecretId: "",
          refreshToken: "",
          expiresAt: 0,
          scope: "",
        },
        approval: "ask",
        knownTools: [],
        headers: {},
        source: "user",
        enabledTools: [],
        disabledTools: [],
      }],
    };
    settings.network = { proxyUrl: "", noProxy: "localhost,127.0.0.1,::1" };
    app.secretStorage?.setSecret?.("agentic-chat-openrouter-api-key", "e2e-mobile-scripted-key");
    await plugin.saveSettings?.();

    const existingMobileFolder = app.vault.getAbstractFileByPath("Mobile");
    if (!existingMobileFolder) await app.vault.createFolder("Mobile");
    const existingWrite = app.vault.getAbstractFileByPath(writePath);
    if (existingWrite instanceof obsidian.TFile) await app.vault.trash(existingWrite, true);

    const adapter = app.vault.adapter as unknown as {
      list: (path: string) => Promise<{ files: string[]; folders: string[] }>;
      mkdir: (path: string) => Promise<void>;
      exists: (path: string) => Promise<boolean>;
      remove: (path: string) => Promise<void>;
      write: (path: string, data: string) => Promise<void>;
    };
    const sessionsDir = `${app.vault.configDir}/plugins/agentic-chat/sessions`;
    try {
      const listing = await adapter.list(sessionsDir);
      await Promise.all(listing.files.filter((file) => file.endsWith(".jsonl")).map((file) => adapter.remove(file)));
    } catch {
      await adapter.mkdir(sessionsDir);
    }

    const cwd = `obsidian-vault:${app.vault.getName()}`;
    const session = (id: string, name: string, prompt: string, answer: string, timestamp: string) =>
      `${[
        { type: "session", version: 1, id, timestamp, cwd },
        { type: "message", id: `${id}-user`, parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: prompt }], timestamp: 1 } },
        { type: "message", id: `${id}-assistant`, parentId: `${id}-user`, timestamp, message: { role: "assistant", content: [{ type: "text", text: answer }], provider: "openrouter", model: "openai/gpt-4o-mini", timestamp: 1 } },
        { type: "session_info", id: `${id}-info`, parentId: `${id}-assistant`, timestamp, name },
      ].map((entry) => JSON.stringify(entry)).join("\n")}\n`;

    await adapter.write(
      `${sessionsDir}/2026-06-25T00-00-00-000Z_mobile-alpha.jsonl`,
      session("mobile-alpha", "Mobile Alpha", "alpha prompt", "alpha answer", "2026-06-25T00:00:00.000Z"),
    );
    await adapter.write(
      `${sessionsDir}/2026-06-25T00-01-00-000Z_mobile-beta.jsonl`,
      session("mobile-beta", "Mobile Beta", "beta prompt", "beta answer", "2026-06-25T00:01:00.000Z"),
    );

    // Seed one agent plugin package so the Resources tab renders a real
    // installed-plugin row and the narrow-viewport row layout is exercised.
    const pluginRoot = ".agentic-plugins/mobile-demo";
    const ensureDirs = async (rel: string[]) => {
      let current = "";
      for (const segment of rel) {
        current = current ? `${current}/${segment}` : segment;
        if (!(await adapter.exists(current))) await adapter.mkdir(current);
      }
    };
    await ensureDirs(pluginRoot.split("/"));
    const pluginFiles = [
      ["plugin.json", JSON.stringify({
        $schema: "https://agent-plugins.dev/schema/v1.0.0/plugin.schema.json",
        name: "mobile-demo",
        version: "1.0.0",
        description: "Mobile viewport row-layout sample",
      }, null, 2) + "\n"],
      ["skills/hello/SKILL.md", "---\nname: hello\ndescription: Sample skill for the mobile demo package.\n---\n# Hello\n\nA tiny sample skill.\n"],
    ];
    const skillParent = `${pluginRoot}/skills/hello`;
    await ensureDirs(skillParent.split("/"));
    for (const [rel, content] of pluginFiles) {
      await adapter.write(`${pluginRoot}/${rel}`, content);
    }
  }, MOBILE_WRITE_PATH);
}

async function assertFits(rootSelector: string, label: string): Promise<void> {
  const result = await browser.execute((selector) => {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) return { missing: selector, offenders: [] as string[], root: null };
    const rootRect = root.getBoundingClientRect();
    const offenders: string[] = [];
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.display === "none" || style.visibility === "hidden") continue;
      if (rect.left < rootRect.left - 2 || rect.right > rootRect.right + 2) {
        offenders.push(`${element.className || element.tagName} ${Math.round(rect.width)}w scroll=${element.scrollWidth}/${element.clientWidth}`);
      }
    }
    return {
      missing: "",
      offenders: offenders.slice(0, 8),
      root: {
        width: Math.round(rootRect.width),
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      },
    };
  }, rootSelector);

  if (result.missing) throw new Error(`${label} root ${result.missing} was not found`);
  if (result.root && result.root.scrollWidth > result.root.clientWidth + 2) {
    throw new Error(`${label} root overflows horizontally: ${JSON.stringify(result.root)}`);
  }
  if (result.offenders.length > 0) throw new Error(`${label} has horizontal overflow: ${result.offenders.join("; ")}`);
}

type HeadingRowMetrics = {
  missing: boolean;
  isPhone: boolean;
  hasClass: boolean;
  headerWidth: number;
  headerRight: number;
  infoWidth: number;
  nameWidth: number;
  nameHeight: number;
  controlWidth: number;
  controlRight: number;
  controlCenters: number[];
  buttonWidths: number[];
  bodyOverflow: boolean;
};

/** Measure the rendered geometry of a named settings heading row. */
async function measureHeadingRow(name: string): Promise<HeadingRowMetrics> {
  return await browser.execute((rowName) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".agentic-chat-settings-tabbody .setting-item"));
    const header = rows.find(
      (row) => row.querySelector<HTMLElement>(".setting-item-name")?.innerText.trim() === rowName,
    );
    const body = document.querySelector<HTMLElement>(".agentic-chat-settings-tabbody");
    if (!header) {
      return {
        missing: true,
        isPhone: document.body.classList.contains("is-phone"),
        hasClass: false,
        headerWidth: 0,
        headerRight: 0,
        infoWidth: 0,
        nameWidth: 0,
        nameHeight: 0,
        controlWidth: 0,
        controlRight: 0,
        controlCenters: [],
        buttonWidths: [],
        bodyOverflow: false,
      };
    }

    const box = (element: Element | null): DOMRect | null => element?.getBoundingClientRect() ?? null;
    const info = box(header.querySelector(".setting-item-info"));
    const nameEl = box(header.querySelector(".setting-item-name"));
    const control = header.querySelector<HTMLElement>(".setting-item-control");
    const controlBox = box(control);
    const headerBox = box(header);
    return {
      missing: false,
      isPhone: document.body.classList.contains("is-phone"),
      hasClass: header.classList.contains("agentic-chat-setting-heading-wrap"),
      headerWidth: Math.round(headerBox?.width ?? 0),
      headerRight: Math.round(headerBox?.right ?? 0),
      infoWidth: Math.round(info?.width ?? 0),
      nameWidth: Math.round(nameEl?.width ?? 0),
      nameHeight: Math.round(nameEl?.height ?? 0),
      controlWidth: Math.round(controlBox?.width ?? 0),
      controlRight: Math.round(controlBox?.right ?? 0),
      controlCenters: Array.from(control?.children ?? []).map((child) => {
        const rect = child.getBoundingClientRect();
        return Math.round(rect.top + rect.height / 2);
      }),
      buttonWidths: Array.from(control?.querySelectorAll<HTMLButtonElement>("button") ?? []).map((button) =>
        Math.round(button.getBoundingClientRect().width),
      ),
      bodyOverflow: body ? body.scrollWidth > body.clientWidth + 2 : false,
    };
  }, name);
}

/** Assert a heading row keeps its text readable and its controls aligned and contained. */
function assertHeadingRowReadable(metrics: HeadingRowMetrics, label: string): void {
  if (metrics.missing) throw new Error(`${label} did not render`);
  expect(metrics.isPhone).toBe(true);
  expect(metrics.hasClass).toBe(true);
  expect(metrics.headerWidth).toBeGreaterThan(250);
  // Before the wrap fix the info column collapsed to a few pixels and the name
  // wrapped one character per line.
  expect(metrics.infoWidth).toBeGreaterThanOrEqual(Math.round(metrics.headerWidth * 0.5));
  expect(metrics.nameWidth).toBeGreaterThanOrEqual(Math.round(metrics.headerWidth * 0.35));
  expect(metrics.nameHeight).toBeLessThan(48);
  expect(metrics.controlRight).toBeLessThanOrEqual(metrics.headerRight + 1);
  expect(metrics.bodyOverflow).toBe(false);
  // The phone override must keep buttons at their natural width instead of
  // stretching each one to the full control width.
  expect(metrics.buttonWidths.length).toBeGreaterThanOrEqual(1);
  for (const width of metrics.buttonWidths) {
    expect(width).toBeLessThanOrEqual(Math.round(metrics.headerWidth * 0.6));
  }
  // Toggle and buttons share one row when they fit.
  if (metrics.controlCenters.length > 1) {
    expect(Math.max(...metrics.controlCenters) - Math.min(...metrics.controlCenters)).toBeLessThanOrEqual(2);
  }
}

async function allowApproval(): Promise<void> {
  const modal = await $(".agentic-chat-approval");
  await modal.waitForExist({ timeout: 10_000 });
  await expect(modal.$("button=Allow")).toBeDisplayed();
  await expect(modal.$("button=Deny")).toBeDisplayed();
  await assertFits(".modal-container .modal", "approval modal");
  await modal.$("button=Allow").click();
  await modal.waitForExist({ reverse: true, timeout: 5_000 });
}

async function noteExists(path: string): Promise<boolean> {
  return await browser.executeObsidian(async ({ app }, notePath) => app.vault.getAbstractFileByPath(notePath) != null, path);
}

describe("agentic-chat mobile viewport", function () {
  before(async function () {
    await setMobileViewport();
    await seedMobileState();
    await installScriptedTurns([
      toolTurn("mobile approval write", "mobile-write", "write", {
        path: MOBILE_WRITE_PATH,
        content: MOBILE_WRITE_BODY,
      }),
      textTurn("mobile approval final", "Wrote the mobile approval note."),
      textTurn(
        "mobile long response",
        [
          `MobileWrap ${Array.from({ length: 30 }, (_, index) => `long-mobile-response-token-${index + 1}`).join("-")}`,
          "",
          "| 项目 | 说明 | 状态 |",
          "| --- | --- | --- |",
          "| mobile-wide-table | 这是一段用于验证手机宽度下表格只在自身区域横向滚动的较长说明 | 通过 |",
        ].join("\n"),
      ),
    ]);
    await openChat();
  });

  after(async function () {
    await closeOpenModals();
  });

  it("keeps the chat composer and toolbar usable at phone width", async function () {
    await expect($(".agentic-chat-input")).toBeDisplayed();
    await expect($(".agentic-chat-send")).toBeDisplayed();
    await expect($(".agentic-chat-mode-toggle")).toBeDisplayed();
    await assertChatUsesRootWorkspace();
    await assertFits(".agentic-chat-view", "chat view");
    await assertFits(".agentic-chat-field", "composer field");
  });

  it("keeps the composer above native navigation with the transcript taking the remaining height", async function () {
    const metrics = await measureMobileComposer();
    expect(metrics.root.overflowY).toBe("hidden");
    expect(metrics.root.padding).toBe("0px");
    expect(metrics.messages.height).toBeGreaterThan(metrics.viewportHeight >= 600 ? 300 : 40);
    expect(Math.abs(metrics.messages.bottom - metrics.composer.top)).toBeLessThanOrEqual(2);
    if (metrics.mobileNavbar) {
      expect(metrics.field.bottom).toBeLessThanOrEqual(metrics.mobileNavbar.top + 1);
    }
    expect(metrics.toolbar.height).toBeLessThanOrEqual(40);
  });

  it("starts with a compact composer and grows for a multi-line draft", async function () {
    const compact = await browser.execute(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".agentic-chat-input");
      const field = document.querySelector<HTMLElement>(".agentic-chat-field");
      return {
        inputHeight: Math.round(input?.getBoundingClientRect().height ?? 0),
        fieldHeight: Math.round(field?.getBoundingClientRect().height ?? 0),
      };
    });
    expect(compact.inputHeight).toBeLessThanOrEqual(48);
    expect(compact.fieldHeight).toBeLessThanOrEqual(112);

    await setComposerDraft("line one\nline two\nline three\nline four");
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>(".agentic-chat-input");
          return (textarea?.getBoundingClientRect().height ?? 0) > 48;
        }),
      { timeout: 2_000, timeoutMsg: "multi-line draft did not grow the composer" },
    );
    await setComposerDraft(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"));
    await browser.waitUntil(
      async () => {
        const metrics = await measureMobileComposer();
        return metrics.input.scrollable && metrics.input.scrollHeight > metrics.input.height;
      },
      { timeout: 2_000, timeoutMsg: "long draft did not switch the textarea to internal scrolling" },
    );
    const longDraft = await measureMobileComposer();
    expect(longDraft.input.height).toBeLessThanOrEqual(112);
    expect(longDraft.field.height).toBeLessThanOrEqual(longDraft.viewportHeight >= 600 ? 170 : 130);
    expect(longDraft.messages.height).toBeGreaterThan(longDraft.viewportHeight >= 600 ? 250 : 24);
    await setComposerDraft("");
    await browser.waitUntil(
      async () => (await measureMobileComposer()).input.height <= 48,
      { timeout: 2_000, timeoutMsg: "composer did not collapse after clearing the draft" },
    );
  });

  it("keeps the settings tab UI usable at phone width", async function () {
    await openAgenticChatSettings();
    await selectSettingsTab("Models");
    await waitForSetting("Model provider");
    await selectSettingsTab("MCP");
    await waitForSetting("Enable MCP");
    await waitForSetting("Mobile MCP Demo");
    assertHeadingRowReadable(await measureHeadingRow("Mobile MCP Demo"), "MCP server header");
    await waitForSetting("Tool approvals");
    assertHeadingRowReadable(await measureHeadingRow("Tool approvals"), "Tool approvals heading");
    await assertFits(".agentic-chat-settings-tabbody", "MCP settings body");
    await selectSettingsTab("Approval");
    await waitForSetting("Working directories");
    assertHeadingRowReadable(await measureHeadingRow("Working directories"), "Working directories heading");
    await selectSettingsTab("Resources");
    await waitForSetting("Plugins folder");
    // The seeded agent plugin must render an installed-plugin row so the
    // narrow-viewport row layout (title + controls) is actually exercised.
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          document.querySelector(".agentic-chat-settings-tabbody")?.textContent?.includes("mobile-demo") ?? false,
        ),
      { timeout: 10_000, timeoutMsg: "seeded agent plugin row did not render in Resources at phone width" },
    );
    await assertFits(".agentic-chat-settings-tabs", "settings tabs");
    await assertFits(".agentic-chat-settings-tabbody", "settings body");
    await closeAgenticChatSettings();
    await openChat();
  });

  it("keeps approval modals visible and touchable at phone width", async function () {
    await sendPrompt("mobile approval write");
    await allowApproval();
    await browser.waitUntil(async () => await noteExists(MOBILE_WRITE_PATH), {
      timeout: 10_000,
      timeoutMsg: "mobile approval write did not create the note",
    });
  });

  it("keeps the session history modal usable at phone width", async function () {
    await runSlashCommand("/sessions");
    await $(".agentic-chat-session-list").waitForExist();
    await expect($(".agentic-chat-session-row")).toBeDisplayed();
    await assertFits(".modal-container .modal", "session modal");
    await assertFits(".agentic-chat-session-list", "session list");
    await closeOpenModals();
  });

  it("wraps long assistant output without horizontal overflow", async function () {
    await sendPrompt("mobile long response");
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const texts = Array.from(document.querySelectorAll<HTMLElement>(".agentic-chat-assistant .agentic-chat-text"));
          return texts.some((text) => text.innerText.includes("MobileWrap"));
        }),
      { timeout: 10_000, timeoutMsg: "mobile long response did not render" },
    );
    await assertFits(".agentic-chat-messages", "message list");
    const tableMetrics = await browser.execute(() => {
      const table = Array.from(document.querySelectorAll<HTMLTableElement>(".agentic-chat-text table"))
        .find((candidate) => candidate.textContent?.includes("mobile-wide-table"));
      const messages = document.querySelector<HTMLElement>(".agentic-chat-messages");
      return {
        found: Boolean(table),
        tableOverflowsLocally: table ? table.scrollWidth > table.clientWidth : false,
        messagesOverflow: messages ? messages.scrollWidth > messages.clientWidth + 2 : true,
      };
    });
    expect(tableMetrics.found).toBe(true);
    expect(tableMetrics.tableOverflowsLocally).toBe(true);
    expect(tableMetrics.messagesOverflow).toBe(false);
    await browser.executeObsidian(async ({ app }, viewType) => {
      const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
        service?: { abort?: () => void };
      };
      view?.service?.abort?.();
    }, VIEW_TYPE_AGENT_CHAT);
  });
});
