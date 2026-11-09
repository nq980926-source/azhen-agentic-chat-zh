const MOBILE_INPUT_MAX_HEIGHT_PX = 112;
const MOBILE_INPUT_MIN_MAX_HEIGHT_PX = 64;
const MOBILE_INPUT_MAX_VIEWPORT_RATIO = 0.16;
const KEYBOARD_MIN_VIEWPORT_REDUCTION_PX = 80;

export interface AndroidVisualViewport {
  height: number;
  offsetTop: number;
}

/**
 * Height from the chat view's top to the bottom of the visible WebView region.
 * The calculation is absolute, so repeated resize/scroll events cannot compound
 * keyboard compensation.
 */
export function chatHeightForAndroidViewport(rootTop: number, viewport: AndroidVisualViewport): number {
  if (![rootTop, viewport.height, viewport.offsetTop].every(Number.isFinite)) return 0;
  const visibleBottom = viewport.offsetTop + viewport.height;
  return Math.max(0, Math.floor(visibleBottom - rootTop));
}

/**
 * Space the composer must leave below itself. When Obsidian's floating mobile
 * navbar is inside the visual viewport, reserve everything from its top edge to
 * the keyboard (or screen) boundary. A hidden navbar consumes no space.
 */
export function composerBottomClearance(
  viewportBottom: number,
  navbarTop: number,
  safeAreaBottom: number,
  keyboardOpen: boolean,
): number {
  if (Number.isFinite(viewportBottom) && Number.isFinite(navbarTop) && navbarTop < viewportBottom) {
    return Math.max(0, Math.floor(viewportBottom - navbarTop));
  }
  return keyboardOpen ? 0 : Math.max(0, Math.floor(safeAreaBottom));
}

export function isAndroidKeyboardOpen(innerHeight: number, visualViewportHeight: number): boolean {
  return innerHeight - visualViewportHeight >= KEYBOARD_MIN_VIEWPORT_REDUCTION_PX;
}

/** Keep the composer useful in short landscape/keyboard viewports. */
export function mobileInputMaxHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return MOBILE_INPUT_MIN_MAX_HEIGHT_PX;
  return Math.min(
    MOBILE_INPUT_MAX_HEIGHT_PX,
    Math.max(MOBILE_INPUT_MIN_MAX_HEIGHT_PX, Math.floor(viewportHeight * MOBILE_INPUT_MAX_VIEWPORT_RATIO)),
  );
}
