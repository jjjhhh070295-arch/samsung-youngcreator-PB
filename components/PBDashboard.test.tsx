import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PBDashboard from "./PBDashboard";
import { calcAumWeightedReturn, type AumWeightedReturnResult } from "@/lib/advisory/portfolioReturn";
import type { Client } from "@/lib/types";

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
