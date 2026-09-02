import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcSimpleNetCash,
  loadSimpleCashflowRows,
  simpleRowsToCashFlows,
  summarizeSimpleCashflowRows,
} from "./simpleCashflow";
import { PERIOD_CASHFLOW_CATEGORY_PREFIX } from "./periodCashflow";

describe("simpleCashflow", () => {
  it("calculates net cash as inflow minus outflow minus tax", () => {
    assert.equal(calcSimpleNetCash({ netInflow: 100, netOutflowExTax: 30, totalTax: 10 }), 60);
  });

  it("round-trips simplified period rows", () => {
    const rows = [
      {
        id: "1",
        period: "2026-09",
        netInflow: 5_000_000,
        netOutflowExTax: 1_000_000,
        totalTax: 500_000,
      },
    ];
    const flows = simpleRowsToCashFlows(rows, []);
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
    const merged = simpleRowsToCashFlows(rows, legacy);
    assert.equal(merged.some((flow) => flow.id === "legacy-1"), true);
    assert.equal(
      merged.some((flow) => String(flow.category).startsWith(PERIOD_CASHFLOW_CATEGORY_PREFIX)),
      true,
    );
  });
});
