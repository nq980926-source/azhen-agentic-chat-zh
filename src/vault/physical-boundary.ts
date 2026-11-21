import { Platform, type App } from "obsidian";

/** Desktop-only real-path verification. Android uses Obsidian's scoped adapter;
 * never load Node modules on mobile. Existing outside symlinks/junctions are
 * rejected instead of letting a Vault-relative spelling escape the Vault. */
export async function assertPhysicalVaultPath(app: App, path: string): Promise<void> {
  if (Platform.isMobile) return;
  if (!Platform.isDesktopApp) return;
  const adapter = app.vault.adapter as unknown as { getBasePath?: () => string; getFullPath?: (path: string) => string };
  if (!adapter.getBasePath || !adapter.getFullPath) throw new Error("Unsupported desktop Vault adapter: cannot verify file boundary.");
  const requireFn = typeof require === "function" ? require : undefined;
  if (!requireFn) throw new Error("Desktop real-path verification unavailable; refusing file access.");
  const fs = requireFn("fs") as { promises: { realpath: (path: string) => Promise<string> } };
  if (!fs?.promises?.realpath) throw new Error("Desktop realpath unavailable; refusing file access.");
  const base = await fs.promises.realpath(adapter.getBasePath());
  let target = adapter.getFullPath(path);
  let resolved: string | undefined;
  for (;;) {
    try { resolved = await fs.promises.realpath(target); break; }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      const parent = target.replace(/[\\/][^\\/]+[\\/]?$/, "");
      if (parent === target || !parent) throw new Error("Cannot verify the Vault path.", { cause: error });
      target = parent;
    }
  }
  const canonical = (value: string): string => {
    const normalized = value.replaceAll("\\", "/").replace(/\/$/, "");
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const root = canonical(base);
  const actual = canonical(resolved);
  if (actual !== root && !actual.startsWith(`${root}/`)) throw new Error("Path resolves outside the current Vault (symlink/junction). Access refused.");
}
