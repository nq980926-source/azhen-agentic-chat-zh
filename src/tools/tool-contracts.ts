import { t, type MessageKey } from "../i18n";

export const BUILTIN_TOOL_NAMES = [
  "read",
  "vault_inspect",
  "write",
  "edit",
  "ls",
  "search",
  "find",
  "grep",
  "get_active_note",
  "rename",
  "delete",
  "get_backlinks",
  "get_links",
  "local_graph",
  "get_properties",
  "set_properties",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export type ToolPathKind = "file" | "folder" | "file-or-folder" | "search-root" | "destination";
export type ToolExecutionMode = "default" | "sequential";
export type ToolPreviewKind = "none" | "diff" | "delete" | "rename";
export type ToolIgnoreBehavior =
  | "target-hidden"
  | "target-and-children-hidden"
  | "results-filtered"
  | "active-note-hidden"
  | "source-and-destination-hidden"
  | "target-and-linked-results-hidden";

export interface ToolPathArgument {
  name: "path" | "newPath";
  required: boolean;
  kind: ToolPathKind;
}

export interface ToolApprovalContract {
  description: string;
  preview: ToolPreviewKind;
  requiresContent: boolean;
}

export interface BuiltinToolContract {
  name: BuiltinToolName;
  label: string;
  /** Compatibility tools remain implemented but are not sent to the model by default. */
  defaultEnabled?: boolean;
  mutating: boolean;
  undoable: boolean;
  pathArgs: readonly ToolPathArgument[];
  ignoreBehavior: ToolIgnoreBehavior;
  approval: ToolApprovalContract;
  executionMode: ToolExecutionMode;
}

const TARGET_FILE: readonly ToolPathArgument[] = [{ name: "path", required: true, kind: "file" }];
const TARGET_FILE_OR_FOLDER: readonly ToolPathArgument[] = [{ name: "path", required: true, kind: "file-or-folder" }];
const OPTIONAL_FOLDER: readonly ToolPathArgument[] = [{ name: "path", required: false, kind: "folder" }];
const OPTIONAL_SEARCH_ROOT: readonly ToolPathArgument[] = [{ name: "path", required: false, kind: "search-root" }];
const RENAME_PATHS: readonly ToolPathArgument[] = [
  { name: "path", required: true, kind: "file" },
  { name: "newPath", required: true, kind: "destination" },
];

export const BUILTIN_TOOL_CONTRACTS: readonly BuiltinToolContract[] = [
  {
    name: "read",
    label: "Read file",
    mutating: false,
    undoable: false,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to read a vault file. Review the path before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "vault_inspect",
    label: "Inspect vault",
    mutating: false,
    undoable: false,
    pathArgs: OPTIONAL_SEARCH_ROOT,
    ignoreBehavior: "results-filtered",
    approval: {
      description: "The agent wants to inspect vault context. Review the target or query before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "write",
    label: "Write file",
    mutating: true,
    undoable: true,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to create or overwrite a vault file. Review the change before allowing it.",
      preview: "diff",
      requiresContent: true,
    },
    executionMode: "sequential",
  },
  {
    name: "edit",
    label: "Edit file",
    mutating: true,
    undoable: true,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to edit a vault file. Review the diff before allowing it.",
      preview: "diff",
      requiresContent: true,
    },
    executionMode: "sequential",
  },
  {
    name: "ls",
    label: "List folder",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: OPTIONAL_FOLDER,
    ignoreBehavior: "target-and-children-hidden",
    approval: {
      description: "The agent wants to list a vault folder. Review the folder path before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "search",
    label: "Search vault",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: OPTIONAL_SEARCH_ROOT,
    ignoreBehavior: "results-filtered",
    approval: {
      description: "The agent wants to search vault file names and text. Review the query before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "find",
    label: "Find files",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: [],
    ignoreBehavior: "results-filtered",
    approval: {
      description: "The agent wants to search vault file names. Review the pattern before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "grep",
    label: "Search file text",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: OPTIONAL_SEARCH_ROOT,
    ignoreBehavior: "results-filtered",
    approval: {
      description: "The agent wants to search vault file text. Review the query before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "get_active_note",
    label: "Get active note",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: [],
    ignoreBehavior: "active-note-hidden",
    approval: {
      description: "The agent wants to inspect the active note. Review the requested fields before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "rename",
    label: "Rename or move file",
    mutating: true,
    undoable: true,
    pathArgs: RENAME_PATHS,
    ignoreBehavior: "source-and-destination-hidden",
    approval: {
      description: "The agent wants to rename or move a vault file. Review the source and destination before allowing it.",
      preview: "rename",
      requiresContent: false,
    },
    executionMode: "sequential",
  },
  {
    name: "delete",
    label: "Delete file or folder",
    mutating: true,
    undoable: true,
    pathArgs: TARGET_FILE_OR_FOLDER,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to move a vault file or folder to trash. Non-empty folders need recursive:true, which always asks (even in YOLO) unless deletes are explicitly per-tool allowed — otherwise ask back first. Rare adapter fallback may bypass trash when system trash is unavailable. Review the deletion before allowing it.",
      preview: "delete",
      requiresContent: true,
    },
    executionMode: "sequential",
  },
  {
    name: "get_backlinks",
    label: "Get backlinks",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-and-linked-results-hidden",
    approval: {
      description: "The agent wants to list notes linking to a vault file. Review the target before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "get_links",
    label: "Get outbound links",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-and-linked-results-hidden",
    approval: {
      description: "The agent wants to list notes linked from a vault file. Review the target before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "local_graph",
    label: "Local graph",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-and-linked-results-hidden",
    approval: {
      description: "The agent wants to map a note's local graph. Review the target before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "get_properties",
    label: "Get note properties",
    defaultEnabled: false,
    mutating: false,
    undoable: false,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to read note properties. Review the target before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "default",
  },
  {
    name: "set_properties",
    label: "Set note properties",
    mutating: true,
    undoable: true,
    pathArgs: TARGET_FILE,
    ignoreBehavior: "target-hidden",
    approval: {
      description: "The agent wants to update note properties. Review the requested property changes before allowing it.",
      preview: "none",
      requiresContent: false,
    },
    executionMode: "sequential",
  },
];

export type BuiltinToolSurface = "default" | "compat";

export const DEFAULT_BUILTIN_TOOL_CONTRACTS: readonly BuiltinToolContract[] = BUILTIN_TOOL_CONTRACTS.filter(
  (contract) => contract.defaultEnabled !== false,
);

export const DEFAULT_BUILTIN_TOOL_NAMES: readonly BuiltinToolName[] = DEFAULT_BUILTIN_TOOL_CONTRACTS.map(
  (contract) => contract.name,
);

export function builtinToolContractsForSurface(
  surface: BuiltinToolSurface = "default",
): readonly BuiltinToolContract[] {
  return surface === "compat" ? BUILTIN_TOOL_CONTRACTS : DEFAULT_BUILTIN_TOOL_CONTRACTS;
}

const CONTRACT_BY_NAME = new Map<string, BuiltinToolContract>(
  BUILTIN_TOOL_CONTRACTS.map((contract) => [contract.name, contract]),
);

export const MUTATING_TOOLS: ReadonlySet<string> = new Set(
  BUILTIN_TOOL_CONTRACTS.filter((contract) => contract.mutating).map((contract) => contract.name),
);

export const UNDOABLE_TOOLS: ReadonlySet<string> = new Set(
  BUILTIN_TOOL_CONTRACTS.filter((contract) => contract.undoable).map((contract) => contract.name),
);

export function getBuiltinToolContract(name: string): BuiltinToolContract | undefined {
  return CONTRACT_BY_NAME.get(name);
}

export function builtinToolContract(name: BuiltinToolName): BuiltinToolContract {
  const contract = getBuiltinToolContract(name);
  if (!contract) throw new Error(`Missing built-in tool contract: ${name}`);
  return contract;
}

export function builtinToolLabel(name: BuiltinToolName): string {
  return t(TOOL_LABEL_KEYS[name]);
}

export function builtinToolExecutionMode(name: BuiltinToolName): "sequential" | undefined {
  return builtinToolContract(name).executionMode === "sequential" ? "sequential" : undefined;
}

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

export function isUndoableTool(name: string): boolean {
  return UNDOABLE_TOOLS.has(name);
}

export function approvalPreviewNeedsContent(name: string): boolean {
  return getBuiltinToolContract(name)?.approval.requiresContent ?? false;
}

export function toolApprovalDescription(name: string): string {
  const contract = getBuiltinToolContract(name);
  if (contract) return t(TOOL_APPROVAL_KEYS[name as BuiltinToolName]);
  if (name === "create_skill") {
    return t("tool.approval.createSkill");
  }
  return t("tool.approval.generic", { name });
}
const TOOL_LABEL_KEYS: Record<BuiltinToolName, MessageKey> = {
  read: "tool.label.read",
  vault_inspect: "tool.label.inspect",
  write: "tool.label.write",
  edit: "tool.label.edit",
  ls: "tool.label.list",
  search: "tool.label.search",
  find: "tool.label.find",
  grep: "tool.label.grep",
  get_active_note: "tool.label.activeNote",
  rename: "tool.label.rename",
  delete: "tool.label.delete",
  get_backlinks: "tool.label.backlinks",
  get_links: "tool.label.links",
  local_graph: "tool.label.graph",
  get_properties: "tool.label.properties",
  set_properties: "tool.label.setProperties",
};

const TOOL_APPROVAL_KEYS: Record<BuiltinToolName, MessageKey> = {
  read: "tool.approval.read",
  vault_inspect: "tool.approval.inspect",
  write: "tool.approval.write",
  edit: "tool.approval.edit",
  ls: "tool.approval.list",
  search: "tool.approval.search",
  find: "tool.approval.find",
  grep: "tool.approval.grep",
  get_active_note: "tool.approval.activeNote",
  rename: "tool.approval.rename",
  delete: "tool.approval.delete",
  get_backlinks: "tool.approval.backlinks",
  get_links: "tool.approval.links",
  local_graph: "tool.approval.graph",
  get_properties: "tool.approval.properties",
  set_properties: "tool.approval.setProperties",
};
