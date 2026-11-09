import { describe, expect, it, vi } from "vitest";
import { InstallPluginModal } from "../src/ui/install-plugin-modal";
import { zipSync } from "../src/vendor/fflate";

type FakeInput = {
  attached: boolean;
  accept: string;
  files: File[] | null;
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addEventListener: (name: string, handler: () => void) => void;
  onchange: ((event: Event) => Promise<void>) | null;
};

function modalHarness(clickError?: Error) {
  const listeners = new Map<string, () => void>();
  const input: FakeInput = {
    attached: false,
    accept: "",
    files: null,
    click: vi.fn(() => {
      if (clickError) throw clickError;
      expect(input.attached).toBe(true);
    }),
    remove: vi.fn(() => {
      input.attached = false;
    }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    onchange: null,
  };
  const status = {
    className: "",
    empty: vi.fn(),
    createSpan: vi.fn(),
    textContent: "",
  };
  const contentEl = {
    createEl: vi.fn(() => {
      input.attached = true;
      return input;
    }),
  };
  const installFromTree = vi.fn(async () => ({
    rootPath: ".agentic-plugins/demo",
    name: "demo",
    updated: false,
    skills: 1,
    mcpServers: 0,
    files: 2,
    warnings: [],
  }));
  const installed = vi.fn();
  const close = vi.fn();
  const modal = Object.create(InstallPluginModal.prototype) as unknown as {
    pickArchive: () => void;
  };
  Object.assign(modal, {
    contentEl,
    status,
    pluginService: { installFromTree },
    onInstalled: installed,
    close,
  });
  return { modal, input, listeners, status, installFromTree, installed, close };
}

describe("InstallPluginModal archive picker", () => {
  it("mounts the hidden input in the active modal before opening the picker", () => {
    const harness = modalHarness();
    harness.modal.pickArchive();

    expect(harness.input.attached).toBe(true);
    expect(harness.input.accept).toBe(".zip,.tar.gz,.tgz");
    expect(harness.input.click).toHaveBeenCalledTimes(1);
  });

  it("exits quietly when the user cancels", () => {
    const harness = modalHarness();
    harness.modal.pickArchive();
    harness.listeners.get("cancel")?.();

    expect(harness.input.attached).toBe(false);
    expect(harness.installed).not.toHaveBeenCalled();
    expect(harness.status.className).toBe("");
  });

  it("shows an explicit error when opening the picker throws", () => {
    const harness = modalHarness(new Error("picker blocked"));
    harness.modal.pickArchive();

    expect(harness.input.attached).toBe(false);
    expect(harness.status.className).toBe("agentic-chat-install-status is-error");
  });

  it("passes the selected ZIP through the existing install pipeline", async () => {
    const harness = modalHarness();
    harness.modal.pickArchive();
    const encoder = new TextEncoder();
    const bytes = zipSync({
      "plugin.json": encoder.encode(JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "demo",
        version: "1.0.0",
        description: "Demo",
      })),
      "skills/demo/SKILL.md": encoder.encode("---\nname: demo\ndescription: Demo skill\n---\n# Demo\n"),
    });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    harness.input.files = [new File([body], "demo.zip", { type: "application/zip" })];

    await harness.input.onchange?.(new Event("change"));

    expect(harness.installFromTree).toHaveBeenCalledTimes(1);
    expect(harness.installed).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});
