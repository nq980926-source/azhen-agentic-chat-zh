export const FINANCE_LEDGER_PREFIX = "生活/记账/账本";
export const FINANCE_STATUS_PREFIX = "生活/记账/记账状态";

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const LEDGER_HEADER = ["日期", "用途", "金额", "来源"] as const;

export type FinanceSource =
  | "每日额度"
  | "积蓄池"
  | "每月额度"
  | "存款"
  | "存款（意外）"
  | "存款（还款）"
  | "新增入账"
  | "信用卡"
  | "月度池→存款";

export type FinanceRowKind =
  | "expense"
  | "credit_expense"
  | "income"
  | "transfer"
  | "repayment"
  | "unknown";

export interface FinanceLedgerRow {
  date: string;
  purpose: string;
  amountMinor: bigint;
  source: string;
  kind: FinanceRowKind;
  line: number;
}

export interface ParsedFinanceLedger {
  rows: FinanceLedgerRow[];
  malformed: string[];
  hasHeader: boolean;
}

export interface FinanceFactSource {
  path: string;
  sha256: string;
}

export interface FinancePurposeTotal {
  purpose: string;
  amountMinor: bigint;
}

export interface FinanceTimePoint {
  date: string;
  expenseMinor: bigint;
  incomeMinor: bigint;
}

export interface FinanceMonthPoint {
  month: string;
  amountMinor: bigint;
}

export interface FinanceFact {
  from: string;
  to: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  transferMinor: bigint;
  repaymentMinor: bigint;
  transactionCount: number;
  purposes: FinancePurposeTotal[];
  timeSeries: FinanceTimePoint[];
  monthSeries: FinanceMonthPoint[];
  unit: "CNY";
  precision: 2;
  coverage: "complete" | "partial";
  sources: FinanceFactSource[];
  contentHash: string;
}

export interface FinanceChartConfig {
  type: "pie" | "doughnut" | "bar" | "line";
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor: string | string[];
      borderColor: string | string[];
      borderWidth: number;
      hoverOffset?: number;
      tension?: number;
      pointBackgroundColor?: string | string[];
      pointBorderColor?: string | string[];
      pointRadius?: number;
    }>;
  };
  options: {
    responsive: true;
    maintainAspectRatio: false;
    indexAxis?: "x" | "y";
    plugins?: {
      legend?: {
        position?: "top" | "bottom" | "left" | "right";
        labels?: {
          usePointStyle?: boolean;
          boxWidth?: number;
          boxHeight?: number;
          padding?: number;
        };
      };
      title?: {
        display: true;
        text: string;
      };
    };
    scales?: Record<string, unknown>;
  };
}

const MAX_DOUGHNUT_SEGMENTS = 8;
const DOUGHNUT_COLORS = [
  "#e45756",
  "#4c78a8",
  "#eeca3b",
  "#59a14f",
  "#b07aa1",
  "#f28e2b",
  "#76b7b2",
  "#9c755f",
] as const;
const BAR_COLOR = "#4c78a8";
const BAR_BORDER_COLOR = "#2f5d8a";
const EXPENSE_LINE_COLOR = "#e45756";
const INCOME_LINE_COLOR = "#59a14f";

export interface FinanceCalendarTargets {
  iso: string;
  ledgerPath: string;
  statusPath: string;
}

/** Parse a non-negative amount string into integer fen without using Number. */
export function parseAmountToMinor(value: string): bigint {
  const normalized = String(value).trim();
  const match = AMOUNT_PATTERN.exec(normalized);
  if (!match) throw new Error("金额必须是正数，最多两位小数，且不能带正负号。");
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

/** Format integer fen for user-facing text. */
export function formatMinor(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function financeMonthBounds(date: string): { from: string; to: string; month: string } {
  const { iso } = normalizeFinanceDate(date);
  const month = iso.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function financeMonthsInRange(from: string, to: string): string[] {
  const start = normalizeFinanceDate(from).iso.slice(0, 7);
  const end = normalizeFinanceDate(to).iso.slice(0, 7);
  if (end < start) throw new Error("结束日期不能早于开始日期。");
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const months: string[] = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

/**
 * Validate a real Gregorian date and derive the current Azhen ledger paths.
 * Calendar arithmetic uses UTC solely after validating the local Y/M/D tuple.
 */
export function normalizeFinanceDate(value: string): FinanceCalendarTargets {
  const normalized = String(value).trim().replace(/[./]/g, "-");
  const match = DATE_PATTERN.exec(normalized);
  if (!match) throw new Error("日期必须明确为 YYYY-MM-DD。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("日期不存在。");
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const monthKey = iso.slice(0, 7);
  return {
    iso,
    ledgerPath: `${FINANCE_LEDGER_PREFIX}/${monthKey}.md`,
    statusPath: `${FINANCE_STATUS_PREFIX}/${monthKey}.md`,
  };
}

export function classifyFinanceSource(source: string, signedAmount = ""): FinanceRowKind {
  if (signedAmount.startsWith("+")) return "income";
  switch (source.trim()) {
    case "每日额度":
    case "积蓄池":
    case "每月额度":
    case "存款":
    case "存款（意外）":
      return "expense";
    case "信用卡":
      return "credit_expense";
    case "新增入账":
      return "income";
    case "存款（还款）":
      return "repayment";
    case "月度池→存款":
      return "transfer";
    default:
      return "unknown";
  }
}

/** Strictly parse the current full-width ledger format without inventing rows. */
export function parseFinanceLedger(text: string): ParsedFinanceLedger {
  let hasHeader = false;
  const rows: FinanceLedgerRow[] = [];
  const malformed: string[] = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.split("｜").map((part) => part.trim()).join("｜") === LEDGER_HEADER.join("｜")) {
      hasHeader = true;
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}｜/.test(line)) {
      const firstCell = line.split("｜", 1)[0]?.trim() ?? "";
      if (line.includes("｜") && /^\d{4}[-/.年]/u.test(firstCell)) {
        malformed.push(`第 ${index + 1} 行日期格式不是 YYYY-MM-DD`);
      }
      return;
    }
    const parts = line.split("｜").map((part) => part.trim());
    if (parts.length !== 4) {
      malformed.push(`第 ${index + 1} 行不是四列流水`);
      return;
    }
    try {
      const { iso } = normalizeFinanceDate(parts[0]);
      const amountText = parts[2];
      const amountMinor = parseAmountToMinor(amountText.startsWith("+") ? amountText.slice(1) : amountText);
      const kind = classifyFinanceSource(parts[3], amountText);
      if (kind === "unknown") malformed.push(`第 ${index + 1} 行来源未知：${parts[3]}`);
      rows.push({
        date: iso,
        purpose: parts[1],
        amountMinor,
        source: parts[3],
        kind,
        line: index + 1,
      });
    } catch (error) {
      malformed.push(`第 ${index + 1} 行：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (!hasHeader) malformed.push("缺少标准表头");
  return { rows, malformed, hasHeader };
}

/**
 * Build the one authoritative object used by both prose and charts.
 * Transfers and debt repayments are not counted as spending.
 */
export function buildFinanceFact(options: {
  ledgerText: string;
  from: string;
  to: string;
  sourcePath: string;
  sourceHash: string;
  coverage: "complete" | "partial";
}): FinanceFact {
  return buildFinanceFactFromSources({
    sources: [
      {
        path: options.sourcePath,
        sha256: options.sourceHash,
        content: options.ledgerText,
      },
    ],
    from: options.from,
    to: options.to,
    coverage: options.coverage,
  });
}

export function buildFinanceFactFromSources(options: {
  sources: Array<FinanceFactSource & { content: string }>;
  from: string;
  to: string;
  coverage: "complete" | "partial";
}): FinanceFact {
  const from = normalizeFinanceDate(options.from).iso;
  const to = normalizeFinanceDate(options.to).iso;
  if (to < from) throw new Error("结束日期不能早于开始日期。");

  let incomeMinor = 0n;
  let expenseMinor = 0n;
  let transferMinor = 0n;
  let repaymentMinor = 0n;
  let transactionCount = 0;
  const purposes = new Map<string, bigint>();
  const timeSeries = new Map<string, { expenseMinor: bigint; incomeMinor: bigint }>();
  const monthSeries = new Map(financeMonthsInRange(from, to).map((month) => [month, 0n]));
  let partial = options.coverage === "partial";

  for (const source of options.sources) {
    const parsed = parseFinanceLedger(source.content);
    if (!source.sha256.match(/^[a-f0-9]{64}$/) || parsed.malformed.length > 0) partial = true;
    for (const row of parsed.rows) {
      if (row.date < from || row.date > to) continue;
      transactionCount += 1;
      if (row.kind === "expense" || row.kind === "credit_expense") {
        expenseMinor += row.amountMinor;
        purposes.set(row.purpose, (purposes.get(row.purpose) ?? 0n) + row.amountMinor);
        const day = timeSeries.get(row.date) ?? { expenseMinor: 0n, incomeMinor: 0n };
        day.expenseMinor += row.amountMinor;
        timeSeries.set(row.date, day);
        const month = row.date.slice(0, 7);
        monthSeries.set(month, (monthSeries.get(month) ?? 0n) + row.amountMinor);
      } else if (row.kind === "income") {
        incomeMinor += row.amountMinor;
        const day = timeSeries.get(row.date) ?? { expenseMinor: 0n, incomeMinor: 0n };
        day.incomeMinor += row.amountMinor;
        timeSeries.set(row.date, day);
      } else if (row.kind === "transfer") {
        transferMinor += row.amountMinor;
      } else if (row.kind === "repayment") {
        repaymentMinor += row.amountMinor;
      } else {
        partial = true;
      }
    }
  }

  const purposeRows = [...purposes.entries()]
    .map(([purpose, amountMinor]) => ({ purpose, amountMinor }))
    .sort((a, b) => compareText(a.purpose, b.purpose));
  const timeRows = [...timeSeries.entries()]
    .map(([date, amounts]) => ({ date, ...amounts }))
    .sort((a, b) => compareText(a.date, b.date));
  const monthRows = [...monthSeries.entries()]
    .map(([month, amountMinor]) => ({ month, amountMinor }))
    .sort((a, b) => compareText(a.month, b.month));
  const sourceRows = options.sources
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((a, b) => compareText(a.path, b.path));
  const coverage = partial ? "partial" : "complete";
  return {
    from,
    to,
    incomeMinor,
    expenseMinor,
    transferMinor,
    repaymentMinor,
    transactionCount,
    purposes: purposeRows,
    timeSeries: timeRows,
    monthSeries: monthRows,
    unit: "CNY",
    precision: 2,
    coverage,
    sources: sourceRows,
    contentHash: "",
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Build a Chart.js-compatible advanced-chart payload from the same FinanceFact.
 * If coverage or category reconciliation is not complete, no chart is emitted.
 */
export function buildFinanceChart(
  fact: FinanceFact,
  requestedType: FinanceChartConfig["type"],
  barDimension: "month" | "category" = fact.monthSeries.length > 1 ? "month" : "category",
): FinanceChartConfig | null {
  if (fact.coverage !== "complete") return null;
  const type =
    (requestedType === "pie" || requestedType === "doughnut") &&
    fact.purposes.length > MAX_DOUGHNUT_SEGMENTS
      ? "bar"
      : requestedType;
  const numberFromMinor = (minor: bigint): number | null => {
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(minor) / 100;
  };

  if (type === "line") {
    if (fact.timeSeries.length === 0) return null;
    const expense = fact.timeSeries.map((item) => numberFromMinor(item.expenseMinor));
    const income = fact.timeSeries.map((item) => numberFromMinor(item.incomeMinor));
    if ([...expense, ...income].some((value) => value == null)) return null;
    return {
      type,
      data: {
        labels: fact.timeSeries.map((item) => item.date),
        datasets: [
          {
            label: "支出",
            data: expense as number[],
            backgroundColor: "rgba(228, 87, 86, 0.12)",
            borderColor: EXPENSE_LINE_COLOR,
            borderWidth: 2,
            tension: 0.25,
            pointBackgroundColor: EXPENSE_LINE_COLOR,
            pointBorderColor: EXPENSE_LINE_COLOR,
            pointRadius: 3,
          },
          {
            label: "收入",
            data: income as number[],
            backgroundColor: "rgba(89, 161, 79, 0.12)",
            borderColor: INCOME_LINE_COLOR,
            borderWidth: 2,
            tension: 0.25,
            pointBackgroundColor: INCOME_LINE_COLOR,
            pointBorderColor: INCOME_LINE_COLOR,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top" },
          title: { display: true, text: `${fact.from} 至 ${fact.to} 收支` },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "CNY" },
          },
        },
      },
    };
  }

  if (fact.expenseMinor <= 0n) return null;
  const purposeTotal = fact.purposes.reduce((sum, item) => sum + item.amountMinor, 0n);
  if (purposeTotal !== fact.expenseMinor) return null;
  const composition = barDimension === "category" || type === "pie" || type === "doughnut";
  const title = `${fact.from} 至 ${fact.to} 支出${composition ? "用途" : ""}`;

  if (type === "pie" || type === "doughnut") {
    const values = fact.purposes.map((item) => numberFromMinor(item.amountMinor));
    if (values.some((value) => value == null)) return null;
    const colors = fact.purposes.map((_, index) => DOUGHNUT_COLORS[index]!);
    return {
      type,
      data: {
        labels: fact.purposes.map((item) => item.purpose),
        datasets: [{
          label: "支出用途",
          data: values as number[],
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
              padding: 12,
            },
          },
          title: { display: true, text: title },
        },
      },
    };
  }

  const points = barDimension === "month" ? fact.monthSeries : fact.purposes;
  if (points.length === 0) return null;
  const values = points.map((item) => numberFromMinor(item.amountMinor));
  if (values.some((value) => value == null)) return null;
  const horizontal = barDimension === "category" && points.length > MAX_DOUGHNUT_SEGMENTS;
  return {
    type,
    data: {
      labels: points.map((item) =>
        "purpose" in item ? item.purpose : item.month,
      ),
      datasets: [{
        label: barDimension === "month" ? "月度支出" : "支出用途",
        data: values as number[],
        backgroundColor: BAR_COLOR,
        borderColor: BAR_BORDER_COLOR,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: { position: "top" },
        title: { display: true, text: title },
      },
      scales: horizontal
        ? {
            x: {
              beginAtZero: true,
              title: { display: true, text: "CNY" },
            },
          }
        : {
            y: {
              beginAtZero: true,
              title: { display: true, text: "CNY" },
            },
          },
    },
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sealFinanceFact(fact: FinanceFact): Promise<FinanceFact> {
  const payload = JSON.stringify({
    from: fact.from,
    to: fact.to,
    incomeMinor: fact.incomeMinor.toString(),
    expenseMinor: fact.expenseMinor.toString(),
    transferMinor: fact.transferMinor.toString(),
    repaymentMinor: fact.repaymentMinor.toString(),
    transactionCount: fact.transactionCount,
    purposes: fact.purposes.map((row) => [row.purpose, row.amountMinor.toString()]),
    timeSeries: fact.timeSeries.map((row) => [
      row.date,
      row.expenseMinor.toString(),
      row.incomeMinor.toString(),
    ]),
    monthSeries: fact.monthSeries.map((row) => [row.month, row.amountMinor.toString()]),
    coverage: fact.coverage,
    sources: fact.sources,
  });
  return { ...fact, contentHash: await sha256Hex(payload) };
}

export function financeFactMarkdown(
  fact: FinanceFact,
  chartType: FinanceChartConfig["type"],
  barDimension: "month" | "category" = fact.monthSeries.length > 1 ? "month" : "category",
): {
  markdown: string;
  chart: FinanceChartConfig | null;
} {
  const chart = buildFinanceChart(fact, chartType, barDimension);
  const scope = `${fact.from} 至 ${fact.to}`;
  const lines = [
    `统计范围：${scope}`,
    `共 ${fact.transactionCount} 笔；支出 ${formatMinor(fact.expenseMinor)} ${fact.unit}；收入 ${formatMinor(fact.incomeMinor)} ${fact.unit}。`,
  ];
  if (fact.transferMinor > 0n || fact.repaymentMinor > 0n) {
    lines.push(
      `内部转账 ${formatMinor(fact.transferMinor)} ${fact.unit}；信用卡还款 ${formatMinor(fact.repaymentMinor)} ${fact.unit}。`,
    );
  }
  if (fact.coverage !== "complete") {
    lines.push("账本覆盖不完整，以上只代表已核实已读记录，本次不生成图表。");
  } else {
    lines.push(`数据覆盖完整；来源版本 ${fact.contentHash.slice(0, 12)}。`);
  }
  if (fact.purposes.length > 0) {
    lines.push(
      "",
      "支出用途（账本未提供可核实的大类映射，以下按流水“用途”原字段汇总）：",
    );
    for (const purpose of fact.purposes) {
      lines.push(`- ${purpose.purpose}：${formatMinor(purpose.amountMinor)} ${fact.unit}`);
    }
  }
  if (fact.monthSeries.length > 1) {
    lines.push("", "按月支出：");
    for (const month of fact.monthSeries) {
      lines.push(`- ${month.month}：${formatMinor(month.amountMinor)} ${fact.unit}`);
    }
  }
  if (chart) {
    lines.push("", "```advanced-chart", JSON.stringify(chart, null, 2), "```");
  }
  return { markdown: lines.join("\n"), chart };
}
