import { describe, expect, it } from "vitest";
import {
  chatHeightForAndroidViewport,
  composerBottomClearance,
  isAndroidKeyboardOpen,
  mobileInputMaxHeight,
} from "../src/ui/android-keyboard-layout";

describe("Android chat viewport layout", () => {
  it("fits the chat above an overlay keyboard without adding keyboard height", () => {
    expect(chatHeightForAndroidViewport(111, { height: 500, offsetTop: 0 })).toBe(389);
  });

  it("uses absolute visual-viewport geometry when Android has panned the page", () => {
    expect(chatHeightForAndroidViewport(111, { height: 500, offsetTop: 200 })).toBe(589);
    expect(chatHeightForAndroidViewport(720, { height: 500, offsetTop: 200 })).toBe(0);
  });

  it("reserves the visible Obsidian navbar through the keyboard boundary", () => {
    expect(composerBottomClearance(844, 760, 34, false)).toBe(84);
    expect(composerBottomClearance(500, 448, 34, true)).toBe(52);
    expect(composerBottomClearance(500, 760, 34, true)).toBe(0);
    expect(composerBottomClearance(844, Number.NaN, 34, false)).toBe(34);
  });

  it("detects a keyboard-sized visual viewport reduction", () => {
    expect(isAndroidKeyboardOpen(844, 500)).toBe(true);
    expect(isAndroidKeyboardOpen(844, 776)).toBe(false);
    expect(isAndroidKeyboardOpen(390, 300)).toBe(true);
  });

  it("caps multiline growth by both pixels and available viewport height", () => {
    expect(mobileInputMaxHeight(844)).toBe(112);
    expect(mobileInputMaxHeight(500)).toBe(80);
    expect(mobileInputMaxHeight(390)).toBe(64);
    expect(mobileInputMaxHeight(200)).toBe(64);
    expect(mobileInputMaxHeight(Number.NaN)).toBe(64);
  });
});
