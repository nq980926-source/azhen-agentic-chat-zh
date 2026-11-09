import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { t } from "../i18n";
import { clampThinkingLevel, type ModelConfig, type ProviderId } from "../llm/models";

export type TurnSteeringMode = "steer" | "follow-up" | "redirect";

export interface PromptRunPreflight {
  isStreaming: boolean;
  hasApiKey: boolean;
  provider: ProviderId;
  spendCapUsd: number;
  sessionCostUsd: number;
}

export interface SpendCapEnforcementInput {
  isStreaming: boolean;
  spendCapUsd: number;
  sessionCostUsd: number;
}

export function promptRunBlockReason(input: PromptRunPreflight): string | undefined {
  if (input.isStreaming) return t("chat.preflight.alreadyResponding");
  if (!input.hasApiKey) return t("chat.preflight.apiKey", { provider: input.provider });
  if (input.spendCapUsd > 0 && input.sessionCostUsd >= input.spendCapUsd) {
    return t("chat.preflight.spendCap", { cap: input.spendCapUsd.toFixed(2) });
  }
  return undefined;
}

export function spendCapAbortReason(input: SpendCapEnforcementInput): string | undefined {
  if (input.spendCapUsd <= 0) return undefined;
  if (!input.isStreaming) return undefined;
  if (input.sessionCostUsd < input.spendCapUsd) return undefined;
  return t("chat.preflight.spendCapStopped", { cap: input.spendCapUsd.toFixed(2) });
}

export function normalizeSteeringText(text: string): string | null {
  return text.trim() || null;
}

export function steeringStatus(mode: TurnSteeringMode): string {
  switch (mode) {
    case "follow-up":
      return t("chat.steering.followUp");
    case "redirect":
      return t("chat.steering.redirect");
    case "steer":
      return t("chat.steering.steer");
  }
}

export function normalizeModelOverride(modelId: string | null): string | null {
  return modelId?.trim() || null;
}

export function visibleModelOverride(provider: ProviderId, modelOverride: string | null): string | null {
  return provider === "openrouter" || provider === "openai-compatible" ? modelOverride : null;
}

export function resolveModelConfigForTurn(config: ModelConfig, modelOverride: string | null): ModelConfig {
  if ((config.provider === "openrouter" || config.provider === "openai-compatible") && modelOverride) {
    return { ...config, modelId: modelOverride };
  }
  return config;
}

export function resolveThinkingLevelForTurn(
  defaultLevel: ThinkingLevel,
  supportedLevels: ThinkingLevel[],
): ThinkingLevel {
  return clampThinkingLevel(defaultLevel, supportedLevels);
}
