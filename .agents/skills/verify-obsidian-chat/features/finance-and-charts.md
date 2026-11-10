# Finance and Charts

## Sub-features

- Read the existing Azhen monthly ledgers through Knowledge MCP.
- Parse the current full-width `日期｜用途｜金额｜来源` format.
- Compute income, expense, transfer, repayment, category and time-series totals.
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
| Exact ledger parsing and `FinanceFact` | `src/finance/azhen-finance.ts:208`; `src/finance/azhen-finance.ts:274` | `test/azhen-finance.test.ts:38` (unit only; live-vault shape checked separately) | `partial` |
| Finance query tool and chart payload | `src/tools/azhen-finance-tools.ts:67`; `src/tools/azhen-finance-tools.ts:87` | `test/azhen-finance-tools.test.ts:75` (unit only) | `partial` |
| Charts Markdown in chat | `src/ui/assistant-bubble.ts:717` | `test/e2e/specs/finance-charts.e2e.ts:176` | `covered` |

## Gotchas

- Charts must be installed and enabled before the finance query tool emits a
  chart block.
- `advanced-chart` takes Chart.js JSON, not YAML.
- Missing ledger months produce partial coverage and no chart.
- Large MCP receipts are read back through the existing artifact store.
- Mermaid is not a fallback for this flow.
