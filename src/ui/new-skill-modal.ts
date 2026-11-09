import { App, Modal, Notice, Setting } from "obsidian";
import { t } from "../i18n";
import type { PluginService } from "../plugins/service";
import type { InstallResult } from "../plugins/import/install";
import { slugifyPluginName } from "../plugins/manifest";

const SKILL_TEMPLATE = `# {{name}}

Describe what this skill does and when to consult it.

## Steps

1. First step.
2. Second step.

## Constraints

- Stay within the user's question.
- Do not invent facts; verify before claiming.`;

/**
 * The New skill wizard: scaffold a single-skill Agent Plugins package with a
 * spec-valid plugin.json and a SKILL.md template, ready for editing.
 */
export class NewSkillModal extends Modal {
  constructor(
    app: App,
    private readonly pluginService: PluginService,
    private readonly onInstalled: (result: InstallResult) => void,
  ) {
    super(app);
    this.setTitle(t("skill.newTitle"));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    let nameInput: HTMLInputElement | null = null;
    let descriptionInput: HTMLInputElement | null = null;
    let bodyInput: HTMLTextAreaElement | null = null;
    let bodyTouched = false;

    new Setting(contentEl)
      .setName(t("skill.name"))
      .setDesc(t("skill.nameDesc"))
      .addText((text) => {
        nameInput = text.inputEl;
        text.setPlaceholder(t("skill.namePlaceholder"));
        text.inputEl.addEventListener("input", () => {
          // Keep the template heading in sync while the user renames before
          // they have edited the body; once the body is touched, never clobber it.
          const slug = slugifyPluginName(nameInput?.value ?? "");
          if (bodyInput && !bodyTouched) {
            bodyInput.value = SKILL_TEMPLATE.replace("{{name}}", slug || "my-skill");
          }
        });
      });
    new Setting(contentEl)
      .setName(t("skill.description"))
      .setDesc(t("skill.descriptionDesc"))
      .addText((text) => {
        descriptionInput = text.inputEl;
      });
    new Setting(contentEl)
      .setName(t("skill.body"))
      .setDesc(t("skill.bodyDesc"))
      .addTextArea((text) => {
        bodyInput = text.inputEl;
        bodyInput.rows = 14;
        bodyInput.addClass("agentic-chat-skill-body");
        text.setValue(SKILL_TEMPLATE.replace("{{name}}", "my-skill"));
        bodyInput.addEventListener("input", () => {
          bodyTouched = true;
        });
      });

    new Setting(contentEl).addButton((button) => {
      button.setButtonText(t("skill.create")).setCta().onClick(async () => {
        const name = (nameInput?.value ?? "").trim();
        if (!name) {
          new Notice(t("skill.nameRequired"));
          return;
        }
        const description = (descriptionInput?.value ?? "").trim();
        const body = (bodyInput?.value ?? SKILL_TEMPLATE).trim();
        try {
          const existing = await this.pluginService.packageExists(slugifyPluginName(name));
        if (
          existing &&
          !confirm(t("skill.existsConfirm", { name: slugifyPluginName(name) }))
        ) {
            return;
          }
          // The user confirmed via the dialog above, so opt into overwrite explicitly.
          const result = await this.pluginService.scaffoldSkill({ name, description, body }, { allowOverwrite: true });
          this.onInstalled(result);
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
