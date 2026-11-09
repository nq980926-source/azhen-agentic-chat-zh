import { App, Modal } from "obsidian";
import { t } from "../i18n";
import { diffLines, diffStat, diffTooLarge } from "../vault/diff";
import { buildQuickAskProposal, type QuickAskProposal, type QuickAskTarget } from "./quick-ask";

const MAX_DIFF_DISPLAY_LINES = 400;

export class QuickAskModal extends Modal {
  private proposal: QuickAskProposal | null = null;

  constructor(
    app: App,
    private readonly target: QuickAskTarget,
    private readonly onAccept: (proposal: QuickAskProposal) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(t("quickAsk.title"));
    contentEl.addClass("agentic-chat-quick-ask");

    contentEl.createEl("p", {
      cls: "agentic-chat-quick-ask-target",
      text: buildQuickAskTargetText(this.target),
    });

    const input = contentEl.createEl("textarea", {
      cls: "agentic-chat-quick-ask-instruction",
      attr: { rows: "3", placeholder: t("quickAsk.instruction") },
    });
    const preview = contentEl.createDiv({ cls: "agentic-chat-quick-ask-preview" });
    const actions = contentEl.createDiv({ cls: "agentic-chat-quick-ask-actions" });
    const reject = actions.createEl("button", { text: t("quickAsk.reject"), cls: "agentic-chat-quick-ask-reject" });
    const accept = actions.createEl("button", { text: t("quickAsk.accept"), cls: "agentic-chat-quick-ask-accept mod-cta" });
    accept.disabled = true;

    const update = (): void => {
      this.proposal = buildQuickAskProposal(this.target, input.value);
      preview.empty();
      if (!this.proposal) {
        accept.disabled = true;
        preview.createEl("p", { cls: "agentic-chat-quick-ask-empty", text: t("quickAsk.none") });
        return;
      }
      accept.disabled = false;
      preview.createEl("p", { cls: "agentic-chat-quick-ask-summary", text: this.proposal.summary });
      renderQuickAskDiff(preview, this.target.text, this.proposal.replacement);
    };

    input.addEventListener("input", update);
    reject.addEventListener("click", () => this.close());
    accept.addEventListener("click", () => {
      if (!this.proposal) return;
      this.onAccept(this.proposal);
      this.close();
    });
    this.scope.register([], "Enter", (event) => {
      if (event.shiftKey || !this.proposal) return;
      event.preventDefault();
      this.onAccept(this.proposal);
      this.close();
      return false;
    });
    update();
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function buildQuickAskTargetText(target: QuickAskTarget): string {
  const kindLabel = t(target.kind === "selection" ? "quickAsk.selection" : "quickAsk.line");
  if (!target.path) return kindLabel;
  return t("quickAsk.inPath", { kind: kindLabel, path: target.path });
}

function diffPrefix(op: string): string {
  if (op === "add") return "+";
  if (op === "remove") return "-";
  return " ";
}

function renderQuickAskDiff(container: HTMLElement, before: string, after: string): void {
  if (diffTooLarge(before, after)) {
    const beforeLines = before ? before.split("\n").length : 0;
    const afterLines = after ? after.split("\n").length : 0;
    container.createEl("p", {
      cls: "agentic-chat-quick-ask-summary",
      text: t("quickAsk.large", { before: beforeLines, after: afterLines }),
    });
    return;
  }
  const lines = diffLines(before, after);
  const stat = diffStat(lines);
  container.createEl("p", {
    cls: "agentic-chat-quick-ask-summary",
    text: `+${stat.added} -${stat.removed}`,
  });
  const pre = container.createEl("pre", { cls: "agentic-chat-diff" });
  const shown = lines.slice(0, MAX_DIFF_DISPLAY_LINES);
  for (const line of shown) {
    const prefix = diffPrefix(line.op);
    pre.createDiv({ cls: `agentic-chat-diff-line is-${line.op}`, text: `${prefix} ${line.text}` });
  }
  if (lines.length > shown.length) {
    pre.createDiv({
      cls: "agentic-chat-diff-line is-context",
      text: t("quickAsk.moreLines", { count: lines.length - shown.length }),
    });
  }
}
