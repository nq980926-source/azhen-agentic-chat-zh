import { App, SuggestModal } from "obsidian";
import { t } from "../i18n";
import { formatContextWindow } from "../llm/models";

export interface BrowsableModel {
  id: string;
  name: string;
  contextLength: number | null;
}

/**
 * Picker over provider models. Uses a plain
 * substring filter so results stay in the alphabetical order they arrive in —
 * a FuzzySuggestModal would reorder matches by fuzzy score.
 */
export class ModelSuggestModal extends SuggestModal<BrowsableModel> {
  constructor(
    app: App,
    private readonly models: BrowsableModel[],
    private readonly onChoose: (model: BrowsableModel, once: boolean) => void,
    label = t("model.generic"),
  ) {
    super(app);
    this.setPlaceholder(t("model.pick", { label }));
    this.setInstructions([
      { command: "↵", purpose: t("model.switch") },
      { command: "shift ↵ / shift-click", purpose: t("model.nextOnlyHint") },
    ]);
  }

  getSuggestions(query: string): BrowsableModel[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.models;
    return this.models.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) || (model.name?.toLowerCase().includes(needle) ?? false),
    );
  }

  renderSuggestion(model: BrowsableModel, el: HTMLElement): void {
    el.setText(itemText(model));
  }

  onChooseSuggestion(model: BrowsableModel, evt: MouseEvent | KeyboardEvent): void {
    // Shift picks the model for the next prompt only, leaving the saved default untouched.
    this.onChoose(model, evt.shiftKey);
  }
}

function itemText(model: BrowsableModel): string {
  const context = formatContextWindow(model.contextLength);
  const suffix = context ? ` · ${context} ctx` : "";
  // The filter also matches the friendly name, so surface it when it differs.
  const label = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
  return `${label}${suffix}`;
}
