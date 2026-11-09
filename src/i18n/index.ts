import { getLanguage } from "obsidian";
import { messages, type MessageKey } from "./zh-cn";

export type { MessageKey } from "./zh-cn";
export type TranslationParams = Record<string, string | number>;

export function isSimplifiedChinese(language = getLanguage()): boolean {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  return normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized.startsWith("zh-hans-");
}

export function translate(key: MessageKey, language = getLanguage(), params: TranslationParams = {}): string {
  const message = messages[key];
  const template = isSimplifiedChinese(language) ? message.zh : message.en;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function t(key: MessageKey, params: TranslationParams = {}): string {
  return translate(key, getLanguage(), params);
}
