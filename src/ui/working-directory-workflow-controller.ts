import type { Menu } from "obsidian";
import { t } from "../i18n";
import { normalizeFolderPath } from "../vault/path";
import { addWorkingDir, removeWorkingDir } from "../agent/working-dir";
import type { WorkflowRenderer } from "./workflow-renderer";

export interface WorkingDirectoryWorkflowControllerOptions {
  workingDirs: () => string[];
  folderExists: (path: string) => boolean;
  activeFolder?: () => string | null | undefined;
  vaultBasePath?: () => string | null | undefined;
  saveSettings: () => Promise<void>;
  afterChange: () => void;
  pickWorkingDir: () => void;
  pickFolderAttachment: () => void;
  renderer: WorkflowRenderer;
}

export class WorkingDirectoryWorkflowController {
  constructor(private readonly options: WorkingDirectoryWorkflowControllerOptions) {}

  showFolderMenu(): void {
    this.options.renderer.clear();
    this.options.renderer.actionList(
      t("workingDir.menuHeading"),
      t("workingDir.menuDesc"),
      [
        {
          label: t("workingDir.add"),
          detail: t("workingDir.addDetail"),
          icon: "folder-check",
          onClick: () => this.options.pickWorkingDir(),
        },
        {
          label: t("workingDir.attach"),
          detail: t("workingDir.attachDetail"),
          icon: "folder",
          onClick: () => this.options.pickFolderAttachment(),
        },
      ],
    );
  }

  /**
   * Populate an Obsidian Menu (popover) with the same two folder actions, so the
   * folder pill can surface them as a dropdown anchored at the button instead of
   * as a chat action card. Titles lead with the benefit for discoverability.
   */
  attachFolderMenuItems(menu: Menu): void {
    menu.addItem((item) =>
      item
        .setTitle(t("workingDir.addTitle"))
        .setIcon("folder-check")
        .onClick(() => this.options.pickWorkingDir()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("workingDir.attachTitle"))
        .setIcon("folder")
        .onClick(() => this.options.pickFolderAttachment()),
    );
  }

  showWorkingDirs(): void {
    this.options.renderer.clear();
    const dirs = this.options.workingDirs();
    this.options.renderer.actionList(
      t("workingDir.listTitle"),
      formatDirectoryListSubtitle(dirs.length),
      [
        {
          label: t("workingDir.add"),
          detail: t("workingDir.grant"),
          icon: "folder-plus",
          onClick: () => this.options.pickWorkingDir(),
        },
        ...dirs.map((dir) => ({
          label: formatWorkingDirLabel(dir),
          detail: t("workingDir.granted"),
          icon: "folder-check",
          onClick: () => void this.remove(dir),
        })),
      ],
    );
  }

  async runAddDir(arg: string): Promise<void> {
    this.options.renderer.clear();
    if (!arg) {
      this.options.pickWorkingDir();
      return;
    }
    await this.add(arg);
  }

  async add(path: string): Promise<void> {
    const resolved = this.resolveInput(path);
    if (resolved === null) return;

    const normalized = resolved.path;
    if (normalized !== "" && !this.options.folderExists(normalized)) {
      this.options.renderer.error(t("workingDir.notFolder", { path: normalized }));
      return;
    }
    const dirs = this.options.workingDirs();
    const addResult = addWorkingDir(dirs, normalized);
    if (addResult === "duplicate") {
      this.options.renderer.info(t("workingDir.infoTitle"), [
        [formatWorkingDirLabel(normalized), t("workingDir.already")],
      ]);
      return;
    }
    if (addResult === "invalid") {
      this.options.renderer.error(t("workingDir.invalid", { path: normalized }));
      return;
    }
    await this.options.saveSettings();
    this.options.afterChange();
    this.options.renderer.info(t("workingDir.infoTitle"), [
      [
        formatWorkingDirLabel(normalized),
        t("workingDir.grantedInfo"),
      ],
    ]);
  }

  async remove(dir: string): Promise<void> {
    const dirs = this.options.workingDirs();
    if (!removeWorkingDir(dirs, dir)) return;
    await this.options.saveSettings();
    this.options.afterChange();
  }

  private resolveInput(path: string): { path: string } | null {
    const resolved = resolveWorkingDirectoryInput(path, {
      activeFolder: this.options.activeFolder?.() ?? "",
      vaultBasePath: this.options.vaultBasePath?.() ?? null,
    });
    if ("error" in resolved) {
      this.options.renderer.error(resolved.error);
      return null;
    }
    return resolved;
  }
}

export function formatWorkingDirLabel(dir: string): string {
  return dir === "" ? t("folder.vaultRoot") : dir;
}

function formatDirectoryListSubtitle(workingDirCount: number): string {
  if (workingDirCount > 0) return t("workingDir.autoRun");
  return t("workingDir.none");
}

export interface WorkingDirectoryPathContext {
  /** Vault-relative folder used as the base for shell-style `./` and `../` input. */
  activeFolder?: string | null;
  /** Desktop filesystem path to the vault root, when Obsidian exposes it. */
  vaultBasePath?: string | null;
}

export type ResolvedWorkingDirectoryInput = { path: string } | { error: string };

export function resolveWorkingDirectoryInput(
  input: string,
  context: WorkingDirectoryPathContext = {},
): ResolvedWorkingDirectoryInput {
  const raw = input.trim();
  if (!raw || raw === "/") return { path: "" };

  if (isAbsoluteFilesystemPath(raw)) {
    return resolveAbsoluteFolderInput(raw, context.vaultBasePath);
  }

  const base = isActiveFolderRelative(raw) ? context.activeFolder ?? "" : "";
  const resolved = resolveVaultFolderSegments(raw, base);
  if (resolved === null) {
    return { error: t("workingDir.outside", { path: input }) };
  }
  return normalizeResolvedVaultFolder(resolved, input);
}

function resolveAbsoluteFolderInput(input: string, vaultBasePath: string | null | undefined): ResolvedWorkingDirectoryInput {
  if (!vaultBasePath) {
    return { error: t("workingDir.absolute", { path: input }) };
  }

  const relative = relativePathInsideBase(input, vaultBasePath);
  if (relative === null) {
    return {
      error: t("workingDir.outsideBase", { path: input, base: displayFsPath(vaultBasePath) }),
    };
  }
  return normalizeResolvedVaultFolder(relative, input);
}

function normalizeResolvedVaultFolder(path: string, original: string): ResolvedWorkingDirectoryInput {
  try {
    return { path: normalizeFolderPath(path) };
  } catch {
    return { error: t("workingDir.invalid", { path: original }) };
  }
}

function resolveVaultFolderSegments(input: string, baseFolder: string): string | null {
  const segments = pathSegments(baseFolder);
  for (const segment of input.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function pathSegments(path: string | null | undefined): string[] {
  return (path ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
}

function isActiveFolderRelative(path: string): boolean {
  return path === "." || path === ".." || path.startsWith("./") || path.startsWith("../");
}

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function relativePathInsideBase(path: string, basePath: string): string | null {
  const absolute = normalizeFilesystemPath(path);
  const base = normalizeFilesystemPath(basePath);
  const caseInsensitive = /^[A-Za-z]:\//.test(absolute) || /^[A-Za-z]:\//.test(base);
  const comparableAbsolute = caseInsensitive ? absolute.toLowerCase() : absolute;
  const comparableBase = caseInsensitive ? base.toLowerCase() : base;

  if (comparableAbsolute === comparableBase) return "";
  if (!comparableAbsolute.startsWith(`${comparableBase}/`)) return null;
  return absolute.slice(base.length + 1);
}

function normalizeFilesystemPath(path: string): string {
  let normalized = path.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/") && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function displayFsPath(path: string): string {
  return normalizeFilesystemPath(path);
}
