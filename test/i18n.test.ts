import { describe, expect, it } from "vitest";
import { isSimplifiedChinese, translate } from "../src/i18n";
import { messages } from "../src/i18n/zh-cn";

describe("i18n", () => {
  it("recognizes Simplified Chinese Obsidian locales", () => {
    expect(isSimplifiedChinese("zh")).toBe(true);
    expect(isSimplifiedChinese("zh-CN")).toBe(true);
    expect(isSimplifiedChinese("zh_Hans")).toBe(true);
    expect(isSimplifiedChinese("en")).toBe(false);
    expect(isSimplifiedChinese("zh-TW")).toBe(false);
  });

  it("uses Chinese only for Simplified Chinese and falls back to English elsewhere", () => {
    expect(translate("common.send", "zh-CN")).toBe("发送");
    expect(translate("common.send", "en")).toBe("Send");
  });

  it("interpolates named values without changing format tokens", () => {
    expect(translate("usage.cache", "zh-CN", { percent: 42 })).toBe("缓存命中 42%");
    expect(translate("chat.status.costAlert", "zh-CN", { cost: "0.12", cap: "0.10" })).toContain("$0.12");
  });

  it("has a non-empty English and Chinese value for every stable key", () => {
    for (const [key, value] of Object.entries(messages)) {
      expect(value.en.trim(), `${key} English`).not.toBe("");
      expect(value.zh.trim(), `${key} Chinese`).not.toBe("");
    }
  });
});
