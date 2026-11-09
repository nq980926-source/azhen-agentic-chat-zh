import { t } from "../i18n";

/**
 * Single source of truth for slash commands: drives the autocomplete menu, the
 * `/help` listing, and command routing in `ChatView`. Keep this list and the
 * `handleSlashCommand` switch in sync — the switch resolves names via `resolveCommand`.
 */
export interface SlashCommand {
  /** Canonical command word (no leading slash). */
  name: string;
  /** Argument hint shown after the name in menus, e.g. "[name] [args]". */
  args?: string;
  description: string;
  /** Hidden from the autocomplete menu and `/help`, but still routable. */
  hidden?: boolean;
  /** Takes a skill name as its first argument; drives `/skill`-style autocomplete. */
  takesSkillArg?: boolean;
  /** Alternate words that route to this command. */
  aliases?: string[];
}

export interface ParsedSlashInput {
  raw: string;
  word: string;
  argString: string;
  args: readonly string[];
  command?: SlashCommand;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "new", description: t("command.new") },
  { name: "sessions", args: "[clear --confirm]", description: t("command.sessions"), aliases: ["history"] },
  { name: "model", description: t("command.model") },
  { name: "status", description: t("command.status") },
  { name: "memory", args: "[add|review|manage|export|clear]", description: t("command.memory") },
  { name: "semantic-index", args: "[status|estimate|start|cancel]", description: t("command.semanticIndex"), aliases: ["semindex"] },
  { name: "doctor", description: t("command.doctor") },
  { name: "config", description: t("command.config"), aliases: ["mode"] },
  { name: "add-dir", args: "[folder]", description: t("command.addDir"), aliases: ["adddir"] },
  { name: "dirs", description: t("command.dirs"), aliases: ["working-dirs"] },
  { name: "plan", description: t("command.plan") },
  { name: "todo", args: "[add|set|test|commit]", description: t("command.todo"), aliases: ["todos"] },
  { name: "steer", args: "[text]", description: t("command.steer") },
  { name: "follow-up", args: "[text]", description: t("command.followUp"), aliases: ["followup"] },
  { name: "redirect", args: "[text]", description: t("command.redirect") },
  { name: "style", args: "[name]", description: t("command.style") },
  { name: "effort", args: "[level]", description: t("command.effort"), aliases: ["thinking"] },
  { name: "usage", description: t("command.usage") },
  { name: "compact", args: "[instructions]", description: t("command.compact") },
  { name: "export", description: t("command.export") },
  { name: "undo", description: t("command.undo") },
  { name: "skill", args: "[name] [args]", description: t("command.skill"), takesSkillArg: true },
  { name: "agent", args: "[name] [task]", description: t("command.agent") },
  { name: "init", args: "[instructions]", description: t("command.init") },
  // Retired with the projects feature. Kept routable (hidden) so muscle memory
  // gets a redirect hint instead of the literal text leaking to the model.
  { name: "project", aliases: ["projects"], description: t("command.project"), hidden: true },
  { name: "help", description: t("command.help") },
];

/** Commands shown in menus and `/help` (deprecated/internal ones excluded). */
export function visibleCommands(): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => !command.hidden);
}

/** Resolve a typed word (canonical name or alias) to its command, case-insensitively. */
export function resolveCommand(word: string): SlashCommand | undefined {
  const lower = word.toLowerCase();
  return SLASH_COMMANDS.find(
    (command) => command.name === lower || command.aliases?.includes(lower),
  );
}

/** Parse a slash command while preserving the full trimmed argument tail. */
export function parseSlashInput(raw: string): ParsedSlashInput {
  const body = raw.startsWith("/") ? raw.slice(1) : raw;
  const match = /^(\S*)([\s\S]*)$/.exec(body);
  const word = match?.[1] ?? "";
  const argString = (match?.[2] ?? "").trim();
  return {
    raw,
    word,
    argString,
    args: argString ? argString.split(/\s+/) : [],
    command: resolveCommand(word),
  };
}

/** Return the command argument tail after the first positional argument. */
export function slashInputTailAfterFirst(input: ParsedSlashInput): string {
  const first = input.args[0];
  return first ? input.argString.slice(first.length).trim() : "";
}
