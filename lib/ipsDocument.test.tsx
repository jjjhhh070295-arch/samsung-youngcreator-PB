import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IpsA4Document, { paginateIpsInstruments } from "../components/ips/IpsA4Document";
import { ipsDocumentFixture } from "./ipsDocument.fixture";
import { HONESTY_LIMITS } from "./advisory/constants";

function render(client = ipsDocumentFixture()) {
  return renderToStaticMarkup(<IpsA4Document documentClient={client} documentPbDisplay="박담당" investableWon={3_000_000_000} dateStr="2026년 9월 8일" />);
}

describe("customer IPS document", () => {
  it("renders two sheets without cash-flow sections or internal revision IDs", () => {
    const html = render();
    assert.equal((html.match(/class="ips-sheet(?: |")/g) ?? []).length, 2);
    assert.ok(html.includes("자산배분 계획") && html.includes("편입 상품 명세"));
    assert.ok(!html.includes("현금흐름"));
    assert.ok(!html.includes("sample-private-revision"));
    assert.ok(!html.includes("fallback") && !html.includes("proxy"));
    assert.ok(html.includes("5.7%") && html.includes("9.3%"));
  });
  it("keeps every existing warning and both signature fields", () => {
    const html = render();
    for (const line of HONESTY_LIMITS) assert.ok(html.includes(line), line);
    assert.ok(html.includes("투자 권유가 아닙니다."));
    assert.equal((html.match(/class="ips-sign-line"/g) ?? []).length, 2);
  });
  it("paginates all holdings without mutating the approved data", () => {
    const client = ipsDocumentFixture(19);
    const before = JSON.stringify(client);
    const pages = paginateIpsInstruments(client.portfolios[0].instruments!);
    assert.deepEqual(pages.map((p) => p.length), [8, 7, 4]);
    assert.deepEqual(pages.flat(), client.portfolios[0].instruments);
    const html = render(client);
    assert.equal((html.match(/class="ips-sheet(?: |")/g) ?? []).length, 4);
    assert.ok(html.includes("추가 편입 상품 19"));
    assert.equal(JSON.stringify(client), before);
    assert.ok(html.indexOf("추가 편입 상품 19") < html.indexOf("투자 유의사항 및 확인"));
  });
  it("shows unavailable metrics honestly but preserves a genuine zero", () => {
    const client = ipsDocumentFixture();
    client.portfolios[0].metricsStatus = "unavailable";
    client.portfolios[0].expectedReturn = null;
    assert.ok(render(client).includes("산출 전"));
    client.portfolios[0].metricsStatus = "ok";
    client.portfolios[0].expectedReturn = 0;
    assert.ok(render(client).includes("0.0%"));
  });
  it("only shows tax estimates for approved portfolio preview with instruments", () => {
    const client = ipsDocumentFixture();
    // 기본 fixture: 포트폴리오 승인 + 종목 → preview 세전·세후 표시
    assert.ok(render(client).includes("세후 기말자산"));
    // 종목 없으면 숫자 미표시
    client.portfolios[0].instruments = [];
    assert.ok(!render(client).includes("세후 기말자산"));
    client.portfolios[0].instruments = ipsDocumentFixture().portfolios[0].instruments;
    // 포트폴리오 미승인 시 미표시
    client.stages = { ...client.stages, portfolio: false };
    assert.ok(!render(client).includes("세후 기말자산"));
  });
  it("keeps a usable document for missing portfolios and long customer inputs", () => {
    const client = ipsDocumentFixture();
    client.portfolios = [];
    client.ips.unique.value = "사용자가 입력한 긴 투자 제약 사항 ".repeat(30);
    const html = render(client);
    assert.ok(html.includes(client.ips.unique.value.trim()));
    assert.ok(html.includes("확정된 자산배분 계획이 없습니다."));
    assert.ok(html.includes(HONESTY_LIMITS[5]));
  });
});
