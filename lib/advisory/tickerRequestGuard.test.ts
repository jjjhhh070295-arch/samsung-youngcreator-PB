import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTickerRequestGuard,
  tickerAnalysisHref,
  tickerClientScope,
  tickerContextClientId,
  tickerFlowScope,
  tickerLinkSymbol,
  tickerSelectionScope,
  tickerSubviewFromQuery,
} from "./tickerRequestGuard";

describe("ticker request state isolation", () => {
  it("느린 A 요청이 뒤에 시작한 B 요청을 덮지 못한다", () => {
    const guard = createTickerRequestGuard("global");
    const requestA = guard.begin();
    const requestB = guard.begin();
    assert.equal(guard.isCurrent(requestA), false);
    assert.equal(guard.isCurrent(requestB), true);
  });

  it("고객 scope 전환은 이전 고객의 최신 요청도 무효화한다", () => {
    const guard = createTickerRequestGuard("client-a");
    const clientA = guard.begin("client-a");
    const clientB = guard.invalidate("client-b");
    assert.equal(guard.isCurrent(clientA), false);
    assert.equal(guard.isCurrent(clientB), true);
    assert.equal(guard.current().scopeKey, "client-b");
  });

  it("수급 상태는 늦게 도착한 종목 A 응답 대신 최신 종목 B만 반영한다", () => {
    const guard = createTickerRequestGuard("client-a:");
    const requestA = guard.begin("client-a:DEMO-HIGH");
    const requestB = guard.begin("client-a:DEMO-NEAR");
    let committedFlowSymbol: string | null = null;

    if (guard.isCurrent(requestB)) committedFlowSymbol = "DEMO-NEAR";
    if (guard.isCurrent(requestA)) committedFlowSymbol = "DEMO-HIGH";

    assert.equal(committedFlowSymbol, "DEMO-NEAR");
    assert.equal(guard.current().scopeKey, "client-a:DEMO-NEAR");
  });

  it("고객 scope 무효화 뒤에는 이전 고객의 수급 응답을 반영하지 않는다", () => {
    const guard = createTickerRequestGuard("client-a:");
    const clientAFlow = guard.begin("client-a:DEMO-HIGH");
    const clientBReset = guard.invalidate("client-b:");
    let committedFlowSymbol: string | null = null;

    if (guard.isCurrent(clientAFlow)) committedFlowSymbol = "DEMO-HIGH";
    assert.equal(committedFlowSymbol, null);
    assert.equal(guard.isCurrent(clientBReset), true);

    const clientBFlow = guard.begin("client-b:DEMO-NEAR");
    if (guard.isCurrent(clientBFlow)) committedFlowSymbol = "DEMO-NEAR";

    assert.equal(committedFlowSymbol, "DEMO-NEAR");
    assert.equal(guard.current().scopeKey, "client-b:DEMO-NEAR");
  });

  it("실사용 scope는 clientId:symbol이며 빈 종목 전환이 진행 중 요청을 무효화한다", () => {
    assert.equal(tickerClientScope(" client-a "), "client-a");
    assert.equal(tickerFlowScope(" client-a ", " DEMO-HIGH "), "client-a:DEMO-HIGH");

    const parentGuard = createTickerRequestGuard(tickerClientScope("client-a"));
    const flowGuard = createTickerRequestGuard(tickerFlowScope("client-a"));
    const parentRequest = parentGuard.begin(tickerClientScope("client-a"));
    const flowRequest = flowGuard.begin(tickerFlowScope("client-a", "DEMO-HIGH"));

    parentGuard.invalidate(tickerClientScope("client-a"));
    flowGuard.invalidate(tickerFlowScope("client-a"));

    assert.equal(parentGuard.isCurrent(parentRequest), false);
    assert.equal(flowGuard.isCurrent(flowRequest), false);
    assert.equal(flowGuard.current().scopeKey, "client-a:");
  });

  it("고객 상세·IPS·포트폴리오·티커 쿼리에서 고객 범위 링크를 보존한다", () => {
    const detailContext = tickerContextClientId(" client-detail ", null);
    const tickerQueryContext = tickerContextClientId(undefined, " client-query ");

    assert.equal(detailContext, "client-detail");
    assert.equal(tickerQueryContext, "client-query");
    assert.equal(tickerAnalysisHref("pb-demo", detailContext), "/pb/pb-demo/ticker?clientId=client-detail");
    assert.equal(tickerAnalysisHref("pb-demo", tickerQueryContext), "/pb/pb-demo/ticker?clientId=client-query");
    assert.equal(tickerAnalysisHref("pb-demo"), "/pb/pb-demo/ticker");
  });

  it("수급·공매도 직접 열기 링크는 고객·종목 범위와 하위 보기를 함께 보존한다", () => {
    assert.equal(
      tickerAnalysisHref("pb demo", " client-a ", {
        symbol: " DEMO-HIGH ",
        subview: "flows",
      }),
      "/pb/pb%20demo/ticker?clientId=client-a&symbol=DEMO-HIGH&subview=flows",
    );
    assert.equal(tickerSubviewFromQuery("flows"), "flows");
    assert.equal(tickerSubviewFromQuery("flow-short"), "flows");
    assert.equal(tickerSubviewFromQuery("evidence"), "momentum");
    assert.equal(tickerSubviewFromQuery(null), "momentum");
  });

  it("초기 URL에 종목이 없어도 완료된 resolved symbol을 직접 열기 링크에 보존한다", () => {
    const scopeKey = tickerSelectionScope("client-a", "");
    const resolvedSymbol = tickerLinkSymbol(
      { scopeKey, symbol: " DEMO-HIGH " },
      "client-a",
      "",
    );

    assert.equal(resolvedSymbol, "DEMO-HIGH");
    assert.equal(
      tickerAnalysisHref("pb-demo", "client-a", { symbol: resolvedSymbol, subview: "flows" }),
      "/pb/pb-demo/ticker?clientId=client-a&symbol=DEMO-HIGH&subview=flows",
    );
  });

  it("URL 종목 A 뒤에 분석 완료된 B를 직접 열기 링크에 사용한다", () => {
    const scopeKey = tickerSelectionScope("client-a", "DEMO-A");
    const lastCompletedSymbol = tickerLinkSymbol(
      { scopeKey, symbol: "DEMO-A" },
      "client-a",
      "DEMO-A",
    );
    const resolvedSymbol = tickerLinkSymbol(
      { scopeKey, symbol: "DEMO-B" },
      "client-a",
      "DEMO-A",
    );
    const href = tickerAnalysisHref("pb-demo", "client-a", {
      symbol: resolvedSymbol,
      subview: "momentum",
    });

    assert.equal(lastCompletedSymbol, "DEMO-A");
    assert.equal(resolvedSymbol, "DEMO-B");
    assert.equal(
      href,
      "/pb/pb-demo/ticker?clientId=client-a&symbol=DEMO-B&subview=momentum",
    );
    assert.equal(href.includes("DEMO-A"), false);
  });

  it("고객 전환 시 이전 고객의 완료 종목을 버리고 새 고객 범위만 보존한다", () => {
    const previousSelection = {
      scopeKey: tickerSelectionScope("client-a", ""),
      symbol: "DEMO-HIGH",
    };
    const beforeClientBAnalysis = tickerLinkSymbol(previousSelection, "client-b", "");

    assert.equal(beforeClientBAnalysis, "");
    assert.equal(
      tickerAnalysisHref("pb-demo", "client-b", {
        symbol: beforeClientBAnalysis,
        subview: "flows",
      }),
      "/pb/pb-demo/ticker?clientId=client-b&subview=flows",
    );

    const clientBSelection = {
      scopeKey: tickerSelectionScope("client-b", ""),
      symbol: "DEMO-NEAR",
    };
    const resolvedSymbol = tickerLinkSymbol(clientBSelection, "client-b", "");
    const href = tickerAnalysisHref("pb-demo", "client-b", {
      symbol: resolvedSymbol,
      subview: "flows",
    });

    assert.equal(
      href,
      "/pb/pb-demo/ticker?clientId=client-b&symbol=DEMO-NEAR&subview=flows",
    );
    assert.equal(href.includes("client-a"), false);
    assert.equal(href.includes("DEMO-HIGH"), false);
  });
});
