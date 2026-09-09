import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  calcAumWeightedReturn,
  calcPortfolioUnrealizedReturn,
  lossTagFromReturn,
  type AumWeightedReturnResult,
} from "./portfolioReturn";
import {
  buildIpsPurchasePlan,
  floorToIncrement,
  weightedAveragePrice,
} from "./ipsPurchasePlan";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";
import PBDashboard from "@/components/PBDashboard";
import type { Client } from "@/lib/types";

describe("lossTagFromReturn thresholds", () => {
  it("maps -4.99 / -5 / -9.99 / -10 / -10.01 correctly", () => {
    assert.equal(lossTagFromReturn(-4.99), null);
    assert.equal(lossTagFromReturn(-5), "손실중");
    assert.equal(lossTagFromReturn(-9.99), "손실중");
    assert.equal(lossTagFromReturn(-10), "관리필요");
    assert.equal(lossTagFromReturn(-10.01), "관리필요");
    assert.equal(lossTagFromReturn(0), null);
    assert.equal(lossTagFromReturn(null), null);
  });
});

describe("calcPortfolioUnrealizedReturn", () => {
  it("uses KRW sum formula, not average of percents", () => {
    const result = calcPortfolioUnrealizedReturn(
      [
        { quantity: 100, avgPrice: 10_000, lastPrice: 9_000, currency: "KRW" }, // -10%
        { quantity: 100, avgPrice: 10_000, lastPrice: 10_000, currency: "KRW" }, // 0%
      ],
      1350,
    );
    // (900k+1000k - 1000k-1000k) / 2000k = -5%
    assert.equal(result.status, "ok");
    assert.ok(result.returnPct != null);
    assert.ok(Math.abs(result.returnPct! - -5) < 1e-9);
    assert.equal(result.lossTag, "손실중");
  });

  it("marks incomplete when any quote is missing", () => {
    const result = calcPortfolioUnrealizedReturn(
      [
        { quantity: 1, avgPrice: 100, lastPrice: 90, currency: "KRW" },
        { quantity: 1, avgPrice: 100, lastPrice: null, currency: "KRW" },
      ],
      1350,
    );
    assert.equal(result.status, "incomplete");
    assert.equal(result.returnPct, null);
    assert.equal(result.lossTag, null);
  });

  it("marks unavailable when acquisition cost is zero", () => {
    const result = calcPortfolioUnrealizedReturn(
      [{ quantity: 1, avgPrice: null, lastPrice: 100, currency: "KRW" }],
      1350,
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.lossTag, null);
  });
});

describe("calcAumWeightedReturn", () => {
  it("returns about +8.181818% for 100억 +10% and 10억 -10%", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 10_000_000_000, returnStatus: "ok", returnPct: 10 },
      { clientId: "b", aumKrw: 1_000_000_000, returnStatus: "ok", returnPct: -10 },
    ]);
    assert.equal(result.status, "ok");
    assert.ok(result.returnPct != null);
    assert.ok(Math.abs(result.returnPct - 8.1818181818) < 1e-9);
    assert.equal(result.totalAumKrw, 11_000_000_000);
    assert.equal(result.totalPnlKrw, 900_000_000);
    assert.equal(result.coveragePct, 100);
  });

  it("returns 0% for equal AUM +10% and -10%", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 5_000_000_000, returnStatus: "ok", returnPct: 10 },
      { clientId: "b", aumKrw: 5_000_000_000, returnStatus: "ok", returnPct: -10 },
    ]);
    assert.equal(result.status, "ok");
    assert.equal(result.returnPct, 0);
    assert.equal(result.totalPnlKrw, 0);
  });

  it("preserves a genuine 0% return as valid", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 3_000_000_000, returnStatus: "ok", returnPct: 0 },
    ]);
    assert.equal(result.status, "ok");
    assert.equal(result.returnPct, 0);
    assert.equal(result.totalPnlKrw, 0);
  });

  it("marks missing return data as incomplete instead of 0%", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 3_000_000_000, returnStatus: "ok", returnPct: 2 },
      { clientId: "b", aumKrw: 2_000_000_000, returnStatus: "incomplete", returnPct: null },
    ]);
    assert.equal(result.status, "incomplete");
    assert.equal(result.returnPct, null);
    assert.equal(result.totalPnlKrw, null);
    assert.equal(result.coveredAumKrw, 3_000_000_000);
    assert.ok(Math.abs(result.coveragePct - 60) < 1e-9);
    assert.equal(result.missingClientCount, 1);
  });

  it("returns unavailable when total positive AUM is zero", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 0, returnStatus: "ok", returnPct: 10 },
      { clientId: "b", aumKrw: -10, returnStatus: "ok", returnPct: -10 },
    ]);
    assert.equal(result.status, "unavailable");
    assert.equal(result.returnPct, null);
    assert.equal(result.totalAumKrw, 0);
  });

  it("handles negative returns with correct pnl and pct", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 2_000_000_000, returnStatus: "ok", returnPct: -5 },
      { clientId: "b", aumKrw: 3_000_000_000, returnStatus: "ok", returnPct: -10 },
    ]);
    assert.equal(result.status, "ok");
    assert.ok(result.returnPct != null);
    assert.ok(Math.abs(result.returnPct - -8) < 1e-9);
    assert.equal(result.totalPnlKrw, -400_000_000);
  });

  it("is invariant to customer ordering", () => {
    const forward = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 2_000_000_000, returnStatus: "ok", returnPct: 7 },
      { clientId: "b", aumKrw: 1_000_000_000, returnStatus: "ok", returnPct: -2 },
      { clientId: "c", aumKrw: 4_000_000_000, returnStatus: "ok", returnPct: 1 },
    ]);
    const reversed = calcAumWeightedReturn([
      { clientId: "c", aumKrw: 4_000_000_000, returnStatus: "ok", returnPct: 1 },
      { clientId: "b", aumKrw: 1_000_000_000, returnStatus: "ok", returnPct: -2 },
      { clientId: "a", aumKrw: 2_000_000_000, returnStatus: "ok", returnPct: 7 },
    ]);
    assert.deepEqual(reversed, forward);
  });

  it("calculates AUM coverage using only positive-AUM clients", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 5_000_000_000, returnStatus: "ok", returnPct: 1 },
      { clientId: "b", aumKrw: 3_000_000_000, returnStatus: "unavailable", returnPct: null },
      { clientId: "c", aumKrw: 0, returnStatus: "unavailable", returnPct: null },
    ]);
    assert.equal(result.status, "incomplete");
    assert.equal(result.totalAumKrw, 8_000_000_000);
    assert.equal(result.coveredAumKrw, 5_000_000_000);
    assert.ok(Math.abs(result.coveragePct - 62.5) < 1e-9);
  });

  it("never leaks NaN or Infinity", () => {
    const result = calcAumWeightedReturn([
      { clientId: "a", aumKrw: Number.POSITIVE_INFINITY, returnStatus: "ok", returnPct: 5 },
      { clientId: "b", aumKrw: 1_000_000_000, returnStatus: "ok", returnPct: Number.NaN },
    ]);
    assert.equal(result.status, "incomplete");
    assert.equal(result.returnPct, null);
    assert.equal(result.totalPnlKrw, null);
    assert.equal(result.totalAumKrw, 1_000_000_000);
    assert.equal(result.missingClientCount, 1);
  });
});

describe("PBDashboard AUM-weighted return card", () => {
  const clients: Client[] = [];

  function render(summary: AumWeightedReturnResult, investableAum = 11_000_000_000) {
    return renderToStaticMarkup(
      <PBDashboard clients={clients} investableAum={investableAum} aumWeightedReturn={summary} />,
    );
  }

  it("renders 총 AUM 수익률 and never 평균 상담시간", () => {
    const ok = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 10_000_000_000, returnStatus: "ok", returnPct: 10 },
      { clientId: "b", aumKrw: 1_000_000_000, returnStatus: "ok", returnPct: -10 },
    ]);
    const html = render(ok);
    assert.ok(html.includes("총 AUM 수익률"));
    assert.ok(html.includes("+8.2%"));
    assert.ok(html.includes("평가손익 +9억원"));
    assert.ok(html.includes("110억원 기준"));
    assert.equal(html.includes("평균 상담시간"), false);
    assert.equal(html.includes("formatDurationKo"), false);
  });

  it("renders incomplete and unavailable states honestly", () => {
    const incomplete = calcAumWeightedReturn([
      { clientId: "a", aumKrw: 7_240_000_000, returnStatus: "ok", returnPct: 2 },
      { clientId: "b", aumKrw: 2_760_000_000, returnStatus: "incomplete", returnPct: null },
    ]);
    const incompleteHtml = render(incomplete);
    assert.ok(incompleteHtml.includes("산출 불가"));
    assert.ok(incompleteHtml.includes("시세 확인 필요 · AUM 커버리지 72.4%"));
    assert.equal(incompleteHtml.includes("+2.0%"), false);

    const unavailable = calcAumWeightedReturn([]);
    const unavailableHtml = render(unavailable, 0);
    assert.ok(unavailableHtml.includes("—"));
    assert.ok(unavailableHtml.includes("평가 가능한 운용자산 없음"));
    assert.ok(unavailableHtml.includes("총 AUM 수익률"));
    assert.equal(unavailableHtml.includes("평균 상담시간"), false);
  });
});

describe("purchase plan helpers", () => {
  it("floors to whole shares and averages cost", () => {
    assert.equal(floorToIncrement(10.9, 1), 10);
    assert.equal(weightedAveragePrice(10, 100, 10, 200), 150);
  });

  it("builds purchase lines from KIS price snapshots (ignores designatedPrice)", () => {
    const draft: ManualPortfolioDraft = {
      allocation: {
        domesticEquity: 100,
        globalEquity: 0,
        domesticBond: 0,
        globalBond: 0,
        alternatives: 0,
        cash: 0,
      },
      selected: [
        {
          symbol: "005930",
          name: "삼성전자",
          assetClass: "domesticEquity",
          weightWithinClass: 100,
          designatedPrice: 99_999, // ignored
          plannedQuantity: 1, // ignored
          currency: "KRW",
          exchange: "KRX",
          kind: "stock",
          quotationKind: "share",
          quantityIncrement: 1,
        },
      ],
    };
    const plan = buildIpsPurchasePlan(draft, {
      availableFundsWon: 350_000_000,
      fxUsdKrw: 1350,
      priceSnapshots: [
        {
          symbol: "005930",
          providerSymbol: "005930",
          price: 70_000,
          currency: "KRW",
          source: "kis",
          fetchedAt: "2026-09-08T00:00:00.000Z",
          quoteTime: "15:30:00",
          isLive: false,
        },
      ],
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.lines.length, 1);
    assert.equal(plan.lines[0].quantity, 5000); // 350e6 / 70000
    assert.ok(plan.lines[0].remainderKrw < 70_000);
  });

  it("treats zero available funds as valid empty plan (no AUM fallback)", () => {
    const draft: ManualPortfolioDraft = {
      allocation: {
        domesticEquity: 100,
        globalEquity: 0,
        domesticBond: 0,
        globalBond: 0,
        alternatives: 0,
        cash: 0,
      },
      selected: [
        {
          symbol: "005930",
          name: "삼성전자",
          assetClass: "domesticEquity",
          weightWithinClass: 100,
          currency: "KRW",
          quotationKind: "share",
        },
      ],
    };
    const plan = buildIpsPurchasePlan(draft, {
      availableFundsWon: 0,
      fxUsdKrw: 1350,
      priceSnapshots: [],
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.lines.length, 0);
  });

  it("resolves .KS snapshot symbols to bare holdings codes in plan input", () => {
    const draft: ManualPortfolioDraft = {
      allocation: {
        domesticEquity: 100,
        globalEquity: 0,
        domesticBond: 0,
        globalBond: 0,
        alternatives: 0,
        cash: 0,
      },
      selected: [
        {
          symbol: "207940.KS",
          name: "삼성바이오로직스",
          assetClass: "domesticEquity",
          weightWithinClass: 100,
          currency: "KRW",
          quotationKind: "share",
        },
      ],
    };
    const plan = buildIpsPurchasePlan(draft, {
      availableFundsWon: 1_000_000,
      fxUsdKrw: 1350,
      priceSnapshots: [
        {
          symbol: "207940",
          providerSymbol: "207940",
          price: 500_000,
          currency: "KRW",
          source: "kis",
          fetchedAt: "2026-09-08T00:00:00.000Z",
          quoteTime: null,
          isLive: false,
        },
      ],
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.lines[0].quantity, 2);
  });
});
