import type { Usage } from "@earendil-works/pi-ai";
import type { RequestCostEstimate } from "../agent/cost";
import type { ToolBudgetSnapshot } from "../agent/tool-budget";
import { t } from "../i18n";
import { cacheHitPercent, formatCost, formatTokenInteger, formatUsage, shortModelLabel } from "./format";

export interface ModelPillState {
  providerLabel: string;
  fullModel: string;
  shortModel: string;
  title: string;
  isOverride: boolean;
}

export function modelProviderLabel(provider: string): string {
  if (provider === "ollama") return t("provider.ollamaShort");
  if (provider === "openai-compatible") return t("provider.openaiCompatible");
  return t("provider.openRouter");
}

export function buildModelPillState(input: {
  provider: string;
  activeModelId: string;
  overrideModelId?: string | null;
}): ModelPillState {
  const isOverride = !!input.overrideModelId;
  const providerLabel = isOverride ? t("chrome.nextOnly") : modelProviderLabel(input.provider);
  const fullModel = input.overrideModelId ?? input.activeModelId;
  return {
    providerLabel,
    fullModel,
    shortModel: shortModelLabel(fullModel),
    title: `${providerLabel} · ${fullModel}`,
    isOverride,
  };
}

export function formatChromeUsageText(usage: Usage, nextEstimate?: RequestCostEstimate, sessionCostUnknown = false): string {
  const parts: string[] = [];
  if (usage.totalTokens > 0) {
    parts.push(formatUsage(usage));
    const cost = usage.cost?.total;
    if (!(typeof cost === "number" && cost > 0) && sessionCostUnknown) parts.push("$?");
  }
  if (nextEstimate !== undefined) {
    if (nextEstimate.isUnknown) {
      parts.push(t("usage.nextUnknown"));
    } else if (nextEstimate.usd > 0) {
      parts.push(t("usage.next", { cost: formatCost(nextEstimate.usd) }));
    }
  }
  return parts.join(" · ");
}

/** Color tone for a cache-hit percentage: red under 50%, amber under 75%, green at/above. */
export function cacheHitTone(hit: number): "is-low" | "is-mid" | "is-high" {
  if (hit < 50) return "is-low";
  if (hit < 75) return "is-mid";
  return "is-high";
}

/**
 * Bottom-usage line parts for the CURRENT turn only (Claude Code style): tokens ·
 * cache% [colored] · cost, shown collapsed — the full detail lives in a hover
 * tooltip. Session-wide cumulative totals are intentionally NOT shown here.
 */
export function buildTurnUsageChromeParts(usage: Usage): UsageChromePart[] {
  const parts: UsageChromePart[] = [];
  if (usage.totalTokens > 0) {
    parts.push({ text: t("usage.tokens", { count: formatTokenInteger(usage.totalTokens) }) });
    const hit = cacheHitPercent(usage);
    if (hit !== null) parts.push({ text: t("usage.cache", { percent: hit }), cls: `agentic-chat-cache ${cacheHitTone(hit)}` });
    const cost = usage.cost?.total;
    if (typeof cost === "number" && cost > 0) parts.push({ text: formatCost(cost) });
  }
  return parts;
}

export interface UsageChromePart {
  text: string;
  /** Space-separated class names (e.g. the cache color tone). */
  cls?: string;
  /** Tooltip (used for the next-cost projection). */
  title?: string;
}

/**
 * Structured bottom-usage line parts (tokens · cache% [colored] · cost · next ~$X
 * [tooltip]), so the view can render each piece as its own styled span instead of
 * one opaque string. Returns [] when there is nothing to show.
 */
export function buildUsageChromeParts(usage: Usage, nextEstimate?: RequestCostEstimate, sessionCostUnknown = false): UsageChromePart[] {
  const parts: UsageChromePart[] = [];
  if (usage.totalTokens > 0) {
    parts.push({ text: t("usage.tokens", { count: formatTokenInteger(usage.totalTokens) }) });
    const hit = cacheHitPercent(usage);
    if (hit !== null) parts.push({ text: t("usage.cache", { percent: hit }), cls: `agentic-chat-cache ${cacheHitTone(hit)}` });
    const cost = usage.cost?.total;
    if (typeof cost === "number" && cost > 0) {
      parts.push({ text: formatCost(cost) });
    } else if (sessionCostUnknown) {
      parts.push({
        text: "$?",
        title: t("usage.pricingUnavailable"),
      });
    }
  }
  if (nextEstimate !== undefined) {
    if (nextEstimate.isUnknown) {
      parts.push({
        text: t("usage.nextUnknown"),
        cls: "agentic-chat-next-cost",
        title: t("usage.pricingUnavailable"),
      });
    } else if (nextEstimate.usd > 0) {
      parts.push({
        text: t("usage.next", { cost: formatCost(nextEstimate.usd) }),
        cls: "agentic-chat-next-cost",
        title: t("usage.nextProjection"),
      });
    }
  }
  return parts;
}

export function folderButtonAriaLabel(scopeCount: number): string {
  if (scopeCount === 0) return t("usage.folders");
  return t(scopeCount === 1 ? "usage.foldersGrantedOne" : "usage.foldersGrantedMany", { count: scopeCount });
}

export function toolBudgetNotificationKey(toolBudget: ToolBudgetSnapshot): string | null {
  if (!toolBudget.active || toolBudget.droppedTools.length === 0) return null;
  return toolBudget.droppedTools.map((tool) => tool.name).join(",");
}
