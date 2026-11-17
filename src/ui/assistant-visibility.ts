/** Presentation only: retain hidden activity DOM and all underlying messages. */
export function syncAssistantVisibility(el: HTMLElement): void {
  const visible = (node: Element): boolean => {
    const has = (name: string) => node.classList.contains(name);
    if (has("is-activity-collapsed") || has("is-group-collapsed")) return false;
    if (has("agentic-chat-text")) return !has("is-empty");
    if (has("agentic-chat-reasoning") || has("agentic-chat-step-row") || has("agentic-chat-tool-summary")) return true;
    if (has("agentic-chat-error") || has("agentic-chat-sources") || has("agentic-chat-usage")) return true;
    if (has("agentic-chat-actions")) return node.children.length > 0;
    return Array.from(node.children).some(visible);
  };
  el.toggleClass("is-visual-empty", !Array.from(el.children).some(visible));
}
