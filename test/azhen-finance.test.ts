import { describe, expect, it } from "vitest";
import {
  buildFinanceChart,
  buildFinanceFact,
  financeMonthsInRange,
  formatMinor,
  normalizeFinanceDate,
  parseAmountToMinor,
  parseFinanceLedger,
} from "../src/finance/azhen-finance";

const ledger = [
  "# 2026年11月账本",
  "",
  "日期｜用途｜金额｜来源",
  ...Array.from({ length: 22 }, (_, index) =>
    `2026-11-${String((index % 9) + 1).padStart(2, "0")}｜日常${index + 1}｜${(index + 1)}.${String(index).padStart(2, "0")}｜每日额度`,
  ),
  "2026-11-03｜衣物｜10.00｜积蓄池",
  "2026-11-04｜大件｜20.00｜每月额度",
  "2026-11-04｜意外｜30.00｜存款（意外）",
  "2026-11-04｜电话｜40.00｜信用卡",
  "2026-11-05｜还款｜50.00｜存款（还款）",
  "2026-11-05｜入账｜100.00｜新增入账",
  "2026-11-07｜回填｜60.00｜月度池→存款",
  "2026-11-07｜餐费｜70.00｜存款",
  "2026-11-08｜交通｜80.00｜每日额度",
  "2026-11-08｜娱乐｜90.00｜积蓄池",
  "2026-11-09｜日用｜11.00｜每月额度",
  "2026-11-09｜会员｜12.00｜信用卡",
  "2026-11-10｜早午餐｜13.00｜每日额度",
  "2026-11-10｜API｜14.00｜积蓄池",
  "2026-11-10｜药费｜15.00｜存款（意外）",
  "",
].join("\n");

describe("Azhen finance deterministic core", () => {
  it("uses exact minor units and rejects signs or excess precision", () => {
    expect(parseAmountToMinor("0.10")).toBe(10n);
    expect(parseAmountToMinor("25")).toBe(2500n);
    expect(parseAmountToMinor("12.34")).toBe(1234n);
    expect(formatMinor(60n)).toBe("0.60");
    expect(formatMinor(-1234n)).toBe("-12.34");

    expect(() => parseAmountToMinor("-1")).toThrow();
    expect(() => parseAmountToMinor("+1")).toThrow();
    expect(() => parseAmountToMinor("1.234")).toThrow();
    expect(() => parseAmountToMinor("01.00")).toThrow();
  });

  it("validates real calendar dates and derives the current ledger path", () => {
    expect(normalizeFinanceDate("2026.1.2")).toEqual({
      iso: "2026-01-02",
      ledgerPath: "生活/记账/账本/2026-01.md",
      statusPath: "生活/记账/记账状态/2026-01.md",
    });
    expect(normalizeFinanceDate("2026/01/02").iso).toBe("2026-01-02");
    expect(normalizeFinanceDate("2026-01-02").iso).toBe("2026-01-02");

    expect(() => normalizeFinanceDate("2026-02-29")).toThrow();
    expect(() => normalizeFinanceDate("2026-13-01")).toThrow();
    expect(() => normalizeFinanceDate("not-a-date")).toThrow();
  });

  it("parses all 37 current-format rows and classifies transfers and repayments", () => {
    const parsed = parseFinanceLedger(ledger);
    expect(parsed.rows).toHaveLength(37);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.rows.find((row) => row.purpose === "回填")?.kind).toBe("transfer");
    expect(parsed.rows.find((row) => row.purpose === "还款")?.kind).toBe("repayment");
    expect(parsed.rows.find((row) => row.purpose === "电话")?.kind).toBe("credit_expense");
    expect(parsed.rows.find((row) => row.purpose === "入账")?.kind).toBe("income");
  });

  it("does not silently treat a malformed dated row as complete", () => {
    const parsed = parseFinanceLedger([
      "日期｜用途｜金额｜来源",
      "2026-11-01｜正常｜1.00｜每日额度",
      "2026-11-2｜漏写零｜2.00｜每日额度",
      "2026/11/03｜错误分隔符｜3.00｜每日额度",
    ].join("\n"));

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.malformed).toEqual([
      "第 3 行日期格式不是 YYYY-MM-DD",
      "第 4 行日期格式不是 YYYY-MM-DD",
    ]);
  });

  it("builds one FinanceFact whose category totals equal the expense total", () => {
    const fact = buildFinanceFact({
      ledgerText: ledger,
      from: "2026-11-01",
      to: "2026-11-30",
      sourcePath: "生活/记账/账本/2026-11.md",
      sourceHash: "a".repeat(64),
      coverage: "complete",
    });

    expect(fact.unit).toBe("CNY");
    expect(fact.precision).toBe(2);
    expect(fact.coverage).toBe("complete");
    expect(fact.transactionCount).toBe(37);
    expect(fact.expenseMinor).toBe(
      fact.categories.reduce((sum, category) => sum + category.amountMinor, 0n),
    );
    expect(fact.incomeMinor).toBe(10000n);
    expect(fact.transferMinor).toBe(6000n);
    expect(fact.repaymentMinor).toBe(5000n);
    expect(fact.monthSeries).toEqual([{ month: "2026-11", amountMinor: fact.expenseMinor }]);
    expect(fact.sources).toEqual([
      {
        path: "生活/记账/账本/2026-11.md",
        sha256: "a".repeat(64),
      },
    ]);
  });

  it("generates valid Charts JSON from the same fact and rejects incomplete coverage", () => {
    const fact = buildFinanceFact({
      ledgerText: ledger,
      from: "2026-11-01",
      to: "2026-11-30",
      sourcePath: "生活/记账/账本/2026-11.md",
      sourceHash: "b".repeat(64),
      coverage: "complete",
    });
    const doughnut = buildFinanceChart(fact, "doughnut");
    expect(doughnut?.type).toBe("doughnut");
    expect(doughnut?.data.labels).toEqual(fact.categories.map((item) => item.category));
    expect(doughnut?.data.datasets[0]?.data).toEqual(
      fact.categories.map((item) => Number(item.amountMinor) / 100),
    );

    const bar = buildFinanceChart(fact, "bar");
    expect(bar?.type).toBe("bar");
    expect(bar?.data.labels).toEqual(fact.categories.map((item) => item.category));
    const line = buildFinanceChart(fact, "line");
    expect(line?.type).toBe("line");
    expect(line?.data.datasets.map((dataset) => dataset.label)).toEqual(["支出", "收入"]);
    expect(
      line?.data.datasets[0]?.data.reduce(
        (sum, value) => sum + Math.round(value * 100),
        0,
      ),
    ).toBe(Number(fact.expenseMinor));
    expect(line?.data.datasets[1]?.data.reduce((sum, value) => sum + value, 0)).toBe(100);

    const incomplete = buildFinanceFact({
      ledgerText: ledger,
      from: "2026-10-01",
      to: "2026-11-30",
      sourcePath: "生活/记账/账本/2026-11.md",
      sourceHash: "c".repeat(64),
      coverage: "partial",
    });
    expect(buildFinanceChart(incomplete, "doughnut")).toBeNull();

    const oversized = buildFinanceFact({
      ledgerText: [
        "日期｜用途｜金额｜来源",
        "2026-11-01｜测试｜99999999999999999.99｜每日额度",
      ].join("\n"),
      from: "2026-11-01",
      to: "2026-11-30",
      sourcePath: "生活/记账/账本/2026-11.md",
      sourceHash: "e".repeat(64),
      coverage: "complete",
    });
    expect(buildFinanceChart(oversized, "doughnut")).toBeNull();
  });

  it("keeps every calendar month and groups multi-month bars by month", () => {
    expect(financeMonthsInRange("2026-11-15", "2027-02-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    const fact = buildFinanceFact({
      ledgerText: [
        "日期｜用途｜金额｜来源",
        "2026-11-30｜书｜10.00｜每日额度",
        "2027-01-02｜餐费｜20.00｜每日额度",
      ].join("\n"),
      from: "2026-11-01",
      to: "2027-02-28",
      sourcePath: "test/fixture.md",
      sourceHash: "d".repeat(64),
      coverage: "complete",
    });

    expect(fact.monthSeries).toEqual([
      { month: "2026-11", amountMinor: 1000n },
      { month: "2026-12", amountMinor: 0n },
      { month: "2027-01", amountMinor: 2000n },
      { month: "2027-02", amountMinor: 0n },
    ]);
    const bar = buildFinanceChart(fact, "bar", "month");
    expect(bar?.data.labels).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(bar?.data.datasets[0]).toEqual({
      label: "月度支出",
      data: [10, 0, 20, 0],
    });
    const categoryBar = buildFinanceChart(fact, "bar", "category");
    expect(categoryBar?.data.labels).toEqual(["书", "餐费"]);
    expect(categoryBar?.data.datasets[0]?.data).toEqual([10, 20]);
  });

});
