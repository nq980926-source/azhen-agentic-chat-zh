# Shortcuts candidate test release — 2026-11-12

This is a pre-release for user acceptance, not a stable release. No business Skill, production record, stable tag, or default branch is changed.

## Windows verification
- Workspace: 67/67 automated tests passed; build passed.
- Agentic Chat: 84/84 selected automated tests passed; build and release/mobile checks passed.
- Existing isolated native Windows assertions: 15/15 passed (synthetic model provider).
- Additional isolated Windows real-service integration: 8/8 checks passed using the actual configured model. A workspace board created a fresh native session and submitted the exact preset; the model loaded the installed Skill and successfully read Knowledge MCP data. Original Memory context initialization, native Charts canvas, same-session follow-up, native ask_user response, and JSONL history persistence passed.
- Native tool approval was exercised: 6 non-writing approvals; no writing tool approved. Test-only permission settings were confined to the isolated vault.
- Actual cloud browse/read succeeded; changing local board configuration preserved an unsaved editor draft. No cloud save or production business-record write was attempted. Save/conflict behavior is covered by the existing workspace regression tests, not a live cloud-write acceptance.

## Delivery and compatibility
Agentic Chat 0.51.24-shortcuts-test.1 exposes shortcutApiVersion=1 and openShortcut(). Workspace 0.1.15-shortcuts-test.1 requires this capability and reports its absence; no private API or DOM-send fallback.

Update Agentic Chat first, then workspace. BRAT 2.2.0 supports selecting a specific pre-release tag. Existing tracked entries are pinned to older versions, so a plain update check will not move them: edit the existing BRAT entry and select the exact test tag, then update. No reinstall or manual plugin-file copying is required. The private workspace repository continues to use the existing authenticated BRAT connection.

Rollback through the same BRAT entries to Agentic Chat 0.51.23 and workspace 0.1.14. Stable releases remain Latest. Old branches and candidate commits remain available.

## Unaccepted / limits
Android physical-device acceptance is pending the user's feedback. Static/mobile checks do not establish Android runtime acceptance. Please test board creation/edit/delete/reorder, nested navigation, icons/themes, new-chat empty/nonempty presets, three-tab FIFO and protected-tab refusal, history, keyboard/back/background recovery, and cloud files.

The three-tab limit applies to the native ChatView used by shortcuts, not all manually created Obsidian leaves globally. A protected oldest tab refuses rotation rather than aborting a task. No automatic retry after uncertain send results.

Private live evidence and encrypted test profile are kept outside both repositories; no private Skill text, business records, tokens, sessions, or model configuration are release assets.
