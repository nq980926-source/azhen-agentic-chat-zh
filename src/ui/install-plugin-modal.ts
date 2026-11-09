import { App, Modal, Notice, Platform, Setting } from "obsidian";
import { t } from "../i18n";
import type { PluginService } from "../plugins/service";
import type { InstallResult } from "../plugins/import/install";
import { extractArchive, looksGzip, looksZip, safeArchivePath, type FileTree } from "../plugins/import/archive";
import { reRootTree } from "../plugins/import/shared";
import { stripSingleTopLevelDir } from "../plugins/import/url-source";
import { sniffSource, type MarketplaceSourceEntry } from "../plugins/import/sniff";

/**
 * The Install plugin modal: install from a GitHub/archive URL, a vault folder
 * (desktop), or an archive file, plus marketplace catalogs offered as pick
 * lists. Re-importing a same-named plugin replaces it in place; imported MCP
 * servers start disabled.
 */
export class InstallPluginModal extends Modal {
  private status!: HTMLElement;

  constructor(
    app: App,
    private readonly pluginService: PluginService,
    private readonly onInstalled: (result: InstallResult) => void,
  ) {
    super(app);
    this.setTitle(t("plugin.installTitle"));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const warning = contentEl.createDiv({ cls: "setting-item-description" });
    warning.createSpan({ text: t("plugin.warning") });

    this.renderSourceFields(contentEl);
    this.status = contentEl.createDiv({ cls: "agentic-chat-install-status" });
  }

  private renderSourceFields(containerEl: HTMLElement): void {
    let urlInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName(t("plugin.sourceUrl"))
      .setDesc(t("plugin.sourceExamples"))
      .addText((text) => {
        urlInput = text.inputEl;
        urlInput.placeholder = t("plugin.urlPlaceholder");
        urlInput.addClass("agentic-chat-install-url");
        urlInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") void this.installFromUrl(urlInput?.value ?? "");
        });
      })
      .addButton((button) =>
        button
          .setButtonText(t("common.install"))
          .setCta()
          .onClick(() => void this.installFromUrl(urlInput?.value ?? "")),
      );

    containerEl.createDiv({ cls: "setting-item-description", text: t("plugin.pickSource") }).addClass("agentic-chat-install-hint");

    const actions = new Setting(containerEl);
    actions.addButton((button) =>
      button.setButtonText(t("plugin.vaultFolder")).setCta().onClick(() => this.pickFolder()).setDisabled(Platform.isMobile),
    );
    actions.addButton((button) => button.setButtonText(t("plugin.archiveFile")).setCta().onClick(() => this.pickArchive()));
    if (Platform.isMobile) {
      actions.setDesc(t("plugin.desktopFolder"));
    }
  }

  private async installFromUrl(value: string): Promise<void> {
    const url = value.trim();
    if (!url) {
      this.setStatus(t("plugin.urlRequired"), "error");
      return;
    }
    this.setStatus(t("plugin.resolving", { url }), "working");
    try {
      const result = await this.pluginService.installFromSource(url);
      this.onInstalled(result);
      this.close();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Desktop-only: webkitdirectory folder picker read into a tree, then sniff + install. */
  private pickFolder(): void {
    const input = document.createEl("input", { type: "file" });
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.accept = "";
    input.onchange = async () => {
      const entries = input.files ? Array.from(input.files) : [];
      if (entries.length === 0) return;
      this.setStatus(t("plugin.readingFiles", { count: entries.length }), "working");
      const tree: FileTree = new Map();
      for (const file of entries) {
        const relative = file.webkitRelativePath ?? file.name;
        // Normalize through the same guard used for archive paths so the
        // install pipeline never sees `.`/`..`/reserved segments.
        const safe = safeArchivePath(relative);
        if (!safe) continue;
        tree.set(safe, new Uint8Array(await file.arrayBuffer()));
      }
      await this.installTree(tree, t("plugin.localFolder"));
    };
    input.click();
  }

  /** Archive file picker: extract in-memory, then sniff + install. */
  private pickArchive(): void {
    const input = document.createEl("input", { type: "file" });
    input.type = "file";
    input.accept = ".zip,.tar.gz,.tgz";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.setStatus(t("plugin.extracting", { name: file.name }), "working");
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const kind = looksZip(bytes) ? "zip" : looksGzip(bytes) ? "tar.gz" : null;
        if (!kind) {
          this.setStatus(t("plugin.invalidArchive", { name: file.name }), "error");
          return;
        }
        const tree = stripSingleTopLevelDir(extractArchive(bytes, kind));
        await this.installTree(tree, file.name);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    };
    input.click();
  }

  /** Sniff the tree; offer marketplace picks when the source is a catalog. */
  private async installTree(tree: FileTree, label: string): Promise<void> {
    const sniffed = sniffSource(tree);
    if (sniffed.kind === "marketplace") {
      this.renderMarketplace(tree, sniffed.name, sniffed.sources);
      return;
    }
    try {
      const result = await this.pluginService.installFromTree(tree, label);
      this.onInstalled(result);
      this.close();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Show `./`-relative catalog entries as an install pick list. */
  private renderMarketplace(tree: FileTree, name: string, sources: MarketplaceSourceEntry[]): void {
    this.status.empty();
    const header = this.contentEl.createDiv({ cls: "setting-item-description" });
    header.createSpan({ text: t("plugin.marketplace", { name }) });

    for (const entry of sources) {
      if (entry.kind === "local" && entry.folder) {
        const folder = entry.folder;
        new Setting(this.contentEl)
          .setName(entry.name)
          .setDesc(`./${folder}`)
          .addButton((button) =>
            button.setButtonText(t("common.install")).setCta().onClick(() => {
              void this.installTree(reRootTree(tree, folder), `marketplace:${name}/${folder}`);
            }),
          );
      } else {
        new Setting(this.contentEl)
          .setName(entry.name)
          .setDesc(t("plugin.notAutoInstallable", { source: entry.source ?? t("common.noSource") }));
      }
    }
  }

  private setStatus(message: string, kind: "working" | "error"): void {
    this.status.empty();
    this.status.createSpan({ text: message });
    this.status.className = `agentic-chat-install-status is-${kind}`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Report an install to the user and close the modal. */
export function noticeInstallResult(result: InstallResult): void {
  const parts = [
    t(result.updated ? "plugin.updated" : "plugin.installed", { name: result.name }),
    t(result.skills === 1 ? "plugin.skillCount" : "plugin.skillCountMany", { count: result.skills }),
    t(result.mcpServers === 1 ? "plugin.serverCount" : "plugin.serverCountMany", { count: result.mcpServers }),
    t("plugin.fileCount", { count: result.files }),
  ];
  new Notice(
    `${parts.join(" · ")}${result.warnings.length > 0 ? ` · ${t("plugin.resourcesReport")}` : ""}`,
    6000,
  );
}
