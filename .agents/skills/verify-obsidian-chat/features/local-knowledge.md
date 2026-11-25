# Local knowledge mode

## Sub-features

Independent local/cloud location; safe legacy migration; registration and execution
isolation; file versions and atomic edits; current-device paths; trash safety;
all-tab transition; runtime business-Skill storage compatibility.

## How to get to it (user view)

Agentic Chat settings, Agent tab, 知识库工作模式. New installs default local;
existing Knowledge users retain cloud until they select local. Files never migrate.

## Driving it with the probe harness

Run `node --import tsx scripts/run-e2e.ts --spec test/e2e/specs/local-knowledge.e2e.ts`
with a freshly built plugin in the standard throwaway Vault. The suite uses no
model credentials or production Knowledge/Memory endpoints.

## Proof

| entry point | source | proof | status |
|---|---|---|---|
| Knowledge settings dropdown | `src/settings.ts:622` | `test/e2e/specs/local-knowledge.e2e.ts:10` | `covered` |
| All-tab transition / send lock | `src/main.ts:331` | `test/local-knowledge-isolation.test.ts:112` | `partial` |
| Cloud tools, old calls, finance and Web isolation | `src/agent/knowledge-mode.ts:24` | `test/local-knowledge-isolation.test.ts:30` | `partial` |
| Current-device atomic Vault writes | `src/tools/vault-tools.ts:367` | `test/local-knowledge-files.test.ts:20` | `partial` |
| Native Obsidian Vault conflict integration | `src/agent/runtime-resources.ts:256` | `test/e2e/specs/local-knowledge.e2e.ts:40` | `covered` |

## Gotchas

Baseline c071cd7 witness: 8 failed, 3 passed after correcting its FakeVault adapter
fixture. Candidate witness and broader regression results are recorded in the
release verification report. A desktop phone viewport is not Android acceptance.
Memory injection stays cloud-based; local deterministic finance is unavailable.
Independent business-Skills repository files are never installed or overwritten:
the runtime adapts only storage guidance, preserving source business rules.

Verified 2026-11-21: real Obsidian 1.15.0 Windows 4/4; emulate-mobile 4/4. Real Android acceptance remains pending.
