# Finance and Charts

## Sub-features

- Read the existing Azhen monthly ledgers through Knowledge MCP.
- Parse the current full-width `日期｜用途｜金额｜来源` format.
- Compute income, expense, transfer, repayment, raw purpose and time-series totals.
- Build one `FinanceFact` shared by prose and Charts data.
- Render `advanced-chart` Markdown through the installed Obsidian Charts plugin.

## How to get to it (user view)

Ask naturally for spending totals, category composition, period comparisons, or
trends. For example: “本月钱都花在哪里” or “最近几个月花销对比”. The finance
skill selects `doughnut`, `bar`, `line`, or no chart. The user never supplies a
ledger path, header, or calculation rule.

## Driving it with the probe harness

The normal E2E suite does not install Charts. Run the dedicated config:

```bash
WDIO_CONFIG=./wdio.finance-charts.conf.mts npm run test:e2e
```

The service installs and enables the official `obsidian-charts` 3.9.0 plugin in
the throwaway vault. The spec sends a scripted assistant response containing the
same Markdown shape produced by `azhen_finance_query`.

## Proof

| entry point | source | proof | status |
|---|---|---|---|
| Exact ledger parsing and `FinanceFact` | `src/finance/azhen-finance.ts:239`; `src/finance/azhen-finance.ts:311` | `test/azhen-finance.test.ts:90`; 22-purpose fallback at `test/azhen-finance.test.ts:225` | `covered` |
| Finance query tool and chart payload | `src/tools/azhen-finance-tools.ts:67`; `src/tools/azhen-finance-tools.ts:87` | `test/azhen-finance-tools.test.ts:74`; crowded-chart fallback at `test/azhen-finance-tools.test.ts:293` | `covered` |
| Charts Markdown in chat | `src/ui/assistant-bubble.ts:717` | `test/e2e/specs/finance-charts.e2e.ts:231` | `covered` |

## Gotchas

- Charts must be installed and enabled before the finance query tool emits a
  chart block.
- `advanced-chart` takes Chart.js JSON, not YAML.
- `advanced-chart` bypasses Charts' YAML color preparation, so finance datasets must carry explicit background and border colors.
- The ledger provides raw purposes, not a verified category mapping; more than eight purposes fall back from doughnut to a horizontal bar.
- Missing ledger months produce partial coverage and no chart.
- Large MCP receipts are read back through the existing artifact store.
- Mermaid is not a fallback for this flow.

## Runtime presentation discovery (candidate, 2026-11-13)

Entry points: ordinary parent-chat requests and native shortcut new conversations.
`src/agent/presentation-capabilities.ts` reads enabled/loaded Charts and each
registered language through one guarded, read-only compatibility boundary.
`runtime-resource-state.ts` supplies the bounded contract through the existing
system overlay composition. No new tools, rendering, statistics or permissions.

Proof: `test/presentation-capabilities.test.ts`, `test/runtime-resource-state.test.ts`;
Windows native `test/native-presentation-probe.cjs` (isolated test plugin supplies
app, Agentic Chat instance and Obsidian module): 3/3 passed with Charts 3.9.0-zh.1.
One live A–G set is recorded in CANDIDATE_PRESENTATION.md, including partial
progress-bar consistency and financial coverage limitations. Android is unverified;
this is not an autonomous-choice reliability guarantee or release approval.

## Native progress extension (Windows candidate, 2026-11-13)

Entry points: normal messages, shortcut conversations and restored history through
an `agentic-progress` YAML Markdown processor registered by Agentic Chat.
Witness: `test/progress-block.test.ts`; native probe must check actual progress
values, invalid input, text-only labels, theme/width and persisted history.
Finance complete-coverage proof continues to use the existing exact ledger fixture
and original finance tool; no production financial calculation changes.

Verified: 160 related tests passed (one pre-existing optional Memory online test
skipped); Windows native assertions 8/8. Source probes are
`test/native-progress-probe.cjs` and `test/native-presentation-probe.cjs`.
`test/finance-presentation.test.ts` verifies the original tool's complete-coverage
fixture: prose, chart values/categories, period and currency all share FinanceFact.
One live five-scenario set selected native progress, a trend chart, and the original
finance chart; ordinary advice and insufficient-data questions stayed non-graphical.
See CANDIDATE_NATIVE_PROGRESS.md for fixture boundaries, rounding limits and costs.
Android is unverified; no release or version change is authorized by this report.
