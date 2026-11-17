# 0.51.26-ui-test.1 validation report

Base: 0.51.25 / f00ee7c97ad8a9691c5555e6f44b84891f3f42fc.
Scope: image composer receipt timing and collapsed assistant visual shells only.

## Causes and changes

- Local images awaited the entire agent run before cleaning the composer. AgentService now offers an internal receipt callback bound by identity to the submitted UserMessage at message_end. The listener is scoped to that run and removed on completion/rejection. The public message schema is unchanged.
- ChatView snapshots image bytes, text, tab and composer revision. Receipt removes only submitted images and clears only the unchanged original draft, including saved inactive-tab state. Later run completion, abort and model error do not clear another draft. Reuse user message rendering; no post-send full transcript repaint. Existing text queue and image queue rejection remain intact.
- Activity collapse hid children but retained padded, colored assistant parents and list gaps. Scoped visual visibility now follows meaningful text, uncollapsed activity/summary entry points, errors, source chips and actions. Original nodes and records remain available when expanded. Existing usage stays in the bottom bar. Empty eager status shells disappear when settled; an active shell or shared summary provides compact processing status.
- Scroll pinning code is unchanged. No virtual list, protocol, Knowledge MCP, Memory or permission changes.

## Evidence (2026-11-17, Windows)

- Before implementation: local image regressions failed (3 failed / 14 passed); collapsed-shell regression failed (1 failed / 11 passed). Separate test commits precede fixes.
- Focused tests: 107 passed across local-images, agent-service, tool-call-group, chat-view-lifecycle and assistant-bubble-rendering.
- Full suite: 6 files remain failing with 9 failed assertions; the same 6 files / 9 assertions fail on untouched 0.51.25 in this environment. These are check-feature-map, check-review-gate, witness-from-pr, provider-cache-live, worktree-script (script SyntaxErrors) and plugin-sweep-recovery (mock Plugin.register missing). No unrelated repairs included.
- Regression run excluding only those known baseline files: 188 files passed, 1892 tests passed, 1 existing skipped. Full suite is NOT claimed green.
- Typecheck, production build, release bundle validation and mobile compatibility validation passed. ESLint of changed source/tests passed.
- Scripted real Obsidian 1.15.1 DOM probe: 13 checks passed at desktop and 390x844 viewport. It tests real plugin DOM/CSS and a deferred service stub for composer timing; service identity receipt is separately covered using the real AgentService and controlled stream in unit tests.
- Baseline real Obsidian: 30 collapsed reasoning records plus answer retained 31 visible assistant shells (29 empty shells each 18px). Fixed build retains only summary and answer (2); folded shells measure 0px. Expansion restores original records. Error, sources, actions, history and nested tool expansion checks pass.
- Committed probe: test/e2e/ui-receipt-layout.cdp.mjs. The probe uses an isolated validation vault and never invokes a live provider.

## Limits and manual acceptance

This is a pre-release; no Android device acceptance or live model recognition claim. Phone viewport simulation is not Android WebView or keyboard validation. No formal release is authorized.

On Android and Windows use BRAT to select 0.51.26-ui-test.1. Test text, text+one image, text+multiple images, immediately retyping the same text, switching tabs during preparation, preparation rejection, model error after receipt, stopping generation, retry and existing text queue behavior. Verify attachments arrive exactly once and new drafts survive. In long histories test folded thinking/tools, nested expansion, errors/sources/actions, history reopen, scrolling while reading older content, image loading and bottom pinning. Android additionally needs native image picker, IME/soft keyboard and WebView scroll acceptance.

Rollback: select preserved 0.51.25 in BRAT. Latest must remain 0.51.25. Shared Windows/Android package keeps plugin id agentic-chat and isDesktopOnly=false.
