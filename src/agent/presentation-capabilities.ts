import { MarkdownPreviewRenderer, type App } from "obsidian";

export interface PresentationCapabilities {
  chart: boolean;
  advancedChart: boolean;
}

/** Read-only compatibility boundary: Obsidian exposes no public handler lookup.
 * Unknown registry shapes fail closed. Never register handlers or render probes.
 */
export function readPresentationCapabilities(app: App): PresentationCapabilities {
  const unavailable = { chart: false, advancedChart: false };
  try {
    const host = (app as App & {plugins?: {
      enabledPlugins?: Set<string>;
      plugins?: Record<string, {_loaded?: boolean}>;
    }}).plugins;
    const plugin = host?.plugins?.["obsidian-charts"];
    if (!host?.enabledPlugins?.has("obsidian-charts") || !plugin || plugin._loaded === false) return unavailable;
    const registry = (MarkdownPreviewRenderer as unknown as {
      codeBlockPostProcessors?: Record<string, unknown>;
    }).codeBlockPostProcessors;
    if (!registry || typeof registry !== "object" || Array.isArray(registry)) return unavailable;
    const registered = (language: string) => Object.prototype.hasOwnProperty.call(registry, language) && typeof registry[language] === "function";
    return {chart: registered("chart"), advancedChart: registered("advanced-chart")};
  } catch {
    return unavailable;
  }
}

/** One bounded environment contract, not user settings or a business router. */
export function presentationOverlay(capabilities: PresentationCapabilities): string {
  const parts = [
    "## Available presentation capabilities",
    "Choose the presentation that helps the question; ordinary advice and discussion need no chart. Markdown text, lists, tables, emphasized numbers and text progress indicators are available without Charts. Use percentages only with a known completed value and target.",
    "When useful: line for reliable time trends; bar (indexAxis: y for horizontal) for comparisons; pie/doughnut for a clearly defined whole; tables for detail. A missing generic drawing tool does not prevent Markdown chart rendering. No native progress/card components or calendar heatmap are advertised; do not rely on arbitrary HTML.",
    "Use only supplied or actually retrieved data with matching period, units, categories and coverage. Missing dates are not zero; unknown targets give no completion percentage; do not invent trends. For finance, reuse azhen_finance_query's FinanceFact-derived text and chart unchanged, not a separate model calculation. General records have no guaranteed deterministic aggregation. Keep prose and chart values consistent; use zero-based bars and explicit denominators for proportions.",
  ];
  const formats = [capabilities.chart ? "chart YAML" : "", capabilities.advancedChart ? "advanced-chart JSON" : ""].filter(Boolean);
  if (!formats.length) {
    parts.push("Charts rendering is unavailable or unconfirmed in this environment. Use the available Markdown forms; do not claim Charts output will render.");
  } else {
    parts.push(`Available Charts formats: ${formats.join("; ")}. Output fenced code blocks with the exact language name; the existing Markdown renderer handles them. Use inline datasets, not file/id references. The following are syntax examples only, never factual data.`);
    if (capabilities.chart) parts.push('```chart\ntype: bar\nlabels: [A, B]\nseries:\n  - title: Count\n    data: [1, 2]\nbeginAtZero: true\n```');
    if (capabilities.advancedChart) parts.push('```advanced-chart\n{"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Count","data":[1,2],"backgroundColor":"#4e79a7"}]},"options":{"scales":{"y":{"beginAtZero":true}}}}\n```');
  }
  return parts.join("\n\n");
}
