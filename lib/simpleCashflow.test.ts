import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcSimpleNetCash,
  loadSimpleCashflowRows,
  nextSimpleCashflowPeriod,
  simpleRowsToCashFlows,
  summarizeSimpleCashflowRows,
} from "./simpleCashflow";
import { PERIOD_CASHFLOW_CATEGORY_PREFIX } from "./periodCashflow";
import {
  formatCashflowPeriodLabel,
  normalizeCashflowPeriodKey,
  nextCashflowPeriodKey,
} from "./cashflowPeriod";

describe("simpleCashflow", () => {
  it("calculates net cash as 총유입 - 총유출 - 총세금", () => {
    assert.equal(calcSimpleNetCash({ netInflow: 3_000_000, netOutflowExTax: 2_000_000, totalTax: 500_000 }), 500_000);
    assert.equal(calcSimpleNetCash({ netInflow: 3_000_000, netOutflowExTax: 4_000_000, totalTax: 500_000 }), -1_500_000);
  });

  it("round-trips simplified period rows with periodType meta", () => {
    const rows = [
      {
        id: "1",
        period: "2026-09",
        netInflow: 5_000_000,
        netOutflowExTax: 1_000_000,
        totalTax: 500_000,
      },
    ];
    const flows = simpleRowsToCashFlows(rows, [], "monthly");
    assert.equal(flows[0]?.accountType, "periodType:monthly");
    const loaded = loadSimpleCashflowRows(flows);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].netInflow, 5_000_000);
    assert.equal(loaded[0].netOutflowExTax, 1_000_000);
    assert.equal(loaded[0].totalTax, 500_000);
    assert.equal(
      summarizeSimpleCashflowRows(loaded).netCash,
      calcSimpleNetCash(rows[0]),
    );
  });

  it("keeps legacy detailed flows when saving simplified rows", () => {
    const legacy = [
      {
        id: "legacy-1",
        label: "급여",
        amount: 3_000_000,
        date: "2026-09",
        recurring: true,
        category: "급여",
      },
    ];
    const rows = [
      {
        id: "1",
        period: "2026-10",
        netInflow: 2_000_000,
        netOutflowExTax: 0,
        totalTax: 0,
      },
    ];
    const merged = simpleRowsToCashFlows(rows, legacy, "monthly");
    assert.equal(merged.some((flow) => flow.id === "legacy-1"), true);
    assert.equal(
      merged.some((flow) => String(flow.category).startsWith(PERIOD_CASHFLOW_CATEGORY_PREFIX)),
      true,
    );
  });

  it("supports quarterly period keys without monthly conversion", () => {
    const rows = [
      {
        id: "q",
        period: "2026-Q3",
        netInflow: 9_000_000,
        netOutflowExTax: 3_000_000,
        totalTax: 1_000_000,
      },
    ];
    const flows = simpleRowsToCashFlows(rows, [], "quarterly");
    assert.equal(flows[0]?.date, "2026-Q3");
    const loaded = loadSimpleCashflowRows(flows);
    assert.equal(loaded[0]?.period, "2026-Q3");
    assert.equal(loaded[0]?.netInflow, 9_000_000);
    assert.equal(formatCashflowPeriodLabel("2026-Q3", "quarterly"), "2026년 3분기");
    assert.equal(nextCashflowPeriodKey("2026-Q3", "quarterly"), "2026-Q4");
    assert.equal(nextSimpleCashflowPeriod(rows, "quarterly"), "2026-Q4");
  });

  it("formats half-year and yearly labels", () => {
    assert.equal(normalizeCashflowPeriodKey("2026년 하반기"), "2026-H2");
    assert.equal(formatCashflowPeriodLabel("2026-H2", "semiAnnual"), "2026년 하반기");
    assert.equal(formatCashflowPeriodLabel("2026", "yearly"), "2026년");
    assert.equal(formatCashflowPeriodLabel("2026-09", "monthly"), "2026년 9월");
  });
});
