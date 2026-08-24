import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTickerFlowShortEvidence,
  calculateInvestorFlowWindows,
  calculateRatioPctDeterministic,
  calculateReportableNetShortPositionRatio,
  calculateSecuritiesLendingBalanceRatio,
  finalDatum,
  missingDatum,
  type FlowShortDatum,
  type InstitutionCategory,
  type TickerFlowShortDataset,
} from "./tickerFlowShort";
import {
  FLOW_SHORT_DEMO_SYMBOLS,
  FLOW_SHORT_FIXED_TRADING_DATES,
  FLOW_SHORT_FIXTURE_AS_OF,
  FLOW_SHORT_FIXTURE_PUBLICATION_DATE,
  getTickerFlowShortDemoDataset,
  resolveFlowShortDemoSymbol,
} from "./tickerFlowShortFixture";

function sumAvailable(data: Array<FlowShortDatum<number>>) {
  return data.reduce((sum, datum) => {
    assert.ok(datum.status === "final" || datum.status === "provisional");
    return sum + datum.value;
  }, 0);
}

function institutionSourceTotal(dataset: TickerFlowShortDataset, start: number) {
  return sumAvailable(dataset.investorFlows.slice(start).map((row) => row.institution.totalNetBuyKrw));
}

function assertAllRatiosFailClosed(evidence: ReturnType<typeof buildTickerFlowShortEvidence>) {
  assert.equal(evidence.status, "blocked");
  for (const ratio of [
    evidence.shortSaleTrading,
    evidence.reportableNetShortPosition,
    evidence.securitiesLending,
  ]) {
    assert.equal(ratio.status, "unavailable");
    assert.equal(ratio.ratioPct, null);
    assert.equal(ratio.numerator, null);
    assert.equal(ratio.denominator, null);
    assert.equal(ratio.sourceReportedRatioPct, null);
  }
}

describe("수급·공매도 교육용 데이터 계약", () => {
  it("세 데모 종목과 고정 기준일·공표일·출처 상태를 명시한다", () => {
    assert.deepEqual(FLOW_SHORT_DEMO_SYMBOLS, ["DEMO-HIGH", "DEMO-NEAR", "DEMO-SHORT"]);
    assert.equal(FLOW_SHORT_FIXED_TRADING_DATES.length, 20);
    assert.equal(FLOW_SHORT_FIXED_TRADING_DATES.at(-1), FLOW_SHORT_FIXTURE_AS_OF);

    for (const symbol of FLOW_SHORT_DEMO_SYMBOLS) {
      const dataset = getTickerFlowShortDemoDataset(symbol);
      assert.equal(dataset.metadata.label, "교육용 데모 데이터");
      assert.equal(dataset.metadata.dataMode, "demo");
      assert.equal(dataset.metadata.asOfTradeDate, FLOW_SHORT_FIXTURE_AS_OF);
      assert.equal(dataset.metadata.publicationDate, FLOW_SHORT_FIXTURE_PUBLICATION_DATE);
      assert.equal(dataset.metadata.sourceUrl, null);
      assert.equal(dataset.metadata.freshness, "fixture");
      assert.deepEqual(dataset.tradingCalendar, [...FLOW_SHORT_FIXED_TRADING_DATES]);
      for (const metric of [
        dataset.shortSaleTrading,
        dataset.reportableNetShortPosition,
        dataset.securitiesLending,
      ]) {
        assert.match(metric.source, /^local-fixture:ticker-flow-short-education:/);
        assert.equal(metric.publicationDate, FLOW_SHORT_FIXTURE_PUBLICATION_DATE);
        assert.equal(metric.publicationStatus, "not_applicable");
        assert.equal(metric.freshness, "fixture");
      }
    }
  });

  it("별칭은 알려진 데모 종목만 해석한다", () => {
    assert.equal(resolveFlowShortDemoSymbol("demo-high"), "DEMO-HIGH");
    assert.equal(resolveFlowShortDemoSymbol("데모 근접"), "DEMO-NEAR");
    assert.equal(resolveFlowShortDemoSymbol("DEMO-SHORT"), "DEMO-SHORT");
    assert.equal(resolveFlowShortDemoSymbol("005930"), null);
  });

  it("fixture 반환값은 깊은 복사라 호출 사이에 상태가 혼입되지 않는다", () => {
    const first = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const second = getTickerFlowShortDemoDataset("DEMO-HIGH");
    first.displayName = "변경됨";
    first.investorFlows[0].individualNetBuyKrw = finalDatum(1);
    assert.notEqual(second.displayName, "변경됨");
    assert.notDeepEqual(first.investorFlows[0], second.investorFlows[0]);
  });
});

describe("투자자별 1·5·20거래일 결정론 계산", () => {
  it("고정 거래 달력의 마지막 1·5·20일만 사용한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const result = calculateInvestorFlowWindows(dataset);

    assert.deepEqual(result.windows.d1.expectedDates, [...FLOW_SHORT_FIXED_TRADING_DATES].slice(-1));
    assert.deepEqual(result.windows.d5.expectedDates, [...FLOW_SHORT_FIXED_TRADING_DATES].slice(-5));
    assert.deepEqual(result.windows.d20.expectedDates, [...FLOW_SHORT_FIXED_TRADING_DATES]);
    assert.equal(result.windows.d1.startDate, FLOW_SHORT_FIXTURE_AS_OF);
    assert.equal(result.windows.d20.endDate, FLOW_SHORT_FIXTURE_AS_OF);
  });

  it("누적 순매수는 기간 합계이고 비율은 sum(net) / sum(turnover)이다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const result = calculateInvestorFlowWindows(dataset);
    const lastFive = dataset.investorFlows.slice(-5);
    const net = sumAvailable(lastFive.map((row) => row.foreignNetBuyKrw));
    const turnover = sumAvailable(lastFive.map((row) => row.totalTradingValueKrw));
    const expectedRatio = calculateRatioPctDeterministic(net, turnover);
    const dailyRatioAverage = lastFive.reduce((sum, row) => {
      assert.equal(row.foreignNetBuyKrw.status, "final");
      assert.equal(row.totalTradingValueKrw.status, "final");
      return sum + row.foreignNetBuyKrw.value / row.totalTradingValueKrw.value * 100;
    }, 0) / lastFive.length;

    assert.equal(result.windows.d5.foreign.netBuyKrw.value, net);
    assert.equal(result.windows.d5.foreign.shareOfTurnoverPct.value, expectedRatio);
    assert.notEqual(expectedRatio, Number(dailyRatioAverage.toFixed(4)));
  });

  it("개인·외국인·기관계 각 1·5·20일 합계를 독립적으로 계산한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const result = calculateInvestorFlowWindows(dataset);

    for (const [key, days] of [["d1", 1], ["d5", 5], ["d20", 20]] as const) {
      const rows = dataset.investorFlows.slice(-days);
      assert.equal(result.windows[key].individual.netBuyKrw.value, sumAvailable(rows.map((row) => row.individualNetBuyKrw)));
      assert.equal(result.windows[key].foreign.netBuyKrw.value, sumAvailable(rows.map((row) => row.foreignNetBuyKrw)));
      assert.equal(result.windows[key].institution.netBuyKrw.value, institutionSourceTotal(dataset, -days));
    }
  });

  it("기관계 원천 총계가 있으면 하위분류를 다시 더하지 않는다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const last = dataset.investorFlows.at(-1)!;
    last.institution.totalNetBuyKrw = finalDatum(100);
    last.institution.breakdownNetBuyKrw = {
      securities: finalDatum(60),
      private_fund: finalDatum(40),
    };
    last.institution.aggregation = {
      mode: "source-total",
      includedChildren: [],
      exhaustive: false,
      mutuallyExclusive: false,
    };

    const result = calculateInvestorFlowWindows(dataset);
    assert.equal(result.windows.d1.institution.netBuyKrw.value, 100);
  });

  it("기관 하위분류는 완전포괄·상호배타·고유 목록일 때만 합산한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const last = dataset.investorFlows.at(-1)!;
    const children: InstitutionCategory[] = ["securities", "private_fund"];
    last.institution.totalNetBuyKrw = missingDatum("원천 기관계 총계 없음");
    last.institution.breakdownNetBuyKrw = {
      securities: finalDatum(60),
      private_fund: finalDatum(40),
    };
    last.institution.aggregation = {
      mode: "sum-children",
      includedChildren: children,
      exhaustive: true,
      mutuallyExclusive: true,
    };
    assert.equal(calculateInvestorFlowWindows(dataset).windows.d1.institution.netBuyKrw.value, 100);

    last.institution.aggregation.mutuallyExclusive = false;
    const blocked = buildTickerFlowShortEvidence(dataset);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.windows.d1.institution.netBuyKrw.value, null);
  });

  it("누락은 0으로 바꾸거나 더 오래된 날로 보충하지 않는다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const missingDate = dataset.investorFlows.at(-3)!.tradeDate;
    dataset.investorFlows.at(-3)!.foreignNetBuyKrw = missingDatum("교육용 의도적 누락");
    const result = calculateInvestorFlowWindows(dataset);

    assert.equal(result.windows.d5.foreign.netBuyKrw.status, "missing");
    assert.equal(result.windows.d5.foreign.netBuyKrw.value, null);
    assert.deepEqual(result.windows.d5.foreign.netBuyKrw.missingDates, [missingDate]);
    assert.deepEqual(result.windows.d5.expectedDates, [...FLOW_SHORT_FIXED_TRADING_DATES].slice(-5));
    assert.notEqual(result.windows.d5.individual.netBuyKrw.value, null);
  });

  it("관측된 0은 누락과 달리 실제 0으로 유지한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const last = dataset.investorFlows.at(-1)!;
    last.individualNetBuyKrw = finalDatum(0);
    const result = calculateInvestorFlowWindows(dataset);
    assert.equal(result.windows.d1.individual.netBuyKrw.value, 0);
    assert.equal(result.windows.d1.individual.shareOfTurnoverPct.value, 0);
    assert.equal(result.windows.d1.individual.netBuyKrw.status, "final");
  });

  it("완전히 동일한 중복 날짜는 한 번만 쓰고 서로 다른 중복은 fail-closed 한다", () => {
    const identical = getTickerFlowShortDemoDataset("DEMO-HIGH");
    identical.investorFlows.push(JSON.parse(JSON.stringify(identical.investorFlows.at(-1)!)));
    const deduped = buildTickerFlowShortEvidence(identical);
    assert.equal(deduped.duplicateDatesRemoved, 1);
    assert.equal(deduped.status, "warning");

    const conflicting = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const duplicate = JSON.parse(JSON.stringify(conflicting.investorFlows.at(-1)!));
    duplicate.foreignNetBuyKrw = finalDatum(123);
    conflicting.investorFlows.push(duplicate);
    const blocked = buildTickerFlowShortEvidence(conflicting);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.windows.d1.foreign.netBuyKrw.value, null);
    assert.ok(blocked.warnings.some((warning) => warning.includes("서로 다른 투자자별 수급")));
  });

  it("입력 행 순서가 달라도 고정 달력 기준 결과가 같다", () => {
    const ordered = getTickerFlowShortDemoDataset("DEMO-HIGH");
    const reversed = getTickerFlowShortDemoDataset("DEMO-HIGH");
    reversed.investorFlows.reverse();
    assert.deepEqual(
      calculateInvestorFlowWindows(reversed).windows,
      calculateInvestorFlowWindows(ordered).windows,
    );
  });

  it("안전한 정수 범위를 벗어난 금액은 계산을 차단한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.investorFlows.at(-1)!.foreignNetBuyKrw = finalDatum(Number.MAX_SAFE_INTEGER + 1);
    const result = buildTickerFlowShortEvidence(dataset);
    assert.equal(result.status, "blocked");
    assert.equal(result.windows.d1.foreign.netBuyKrw.value, null);
  });
});

describe("공매도 거래·순보유잔고·증권대차 분리", () => {
  it("세 지표는 별도 분자·분모·라벨·정의로 계산한다", () => {
    const evidence = buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset("DEMO-HIGH"));
    assert.equal(evidence.shortSaleTrading.label, "공매도 거래대금비중");
    assert.equal(evidence.reportableNetShortPosition.label, "신고·공시 기준 공매도 순보유잔고 비율");
    assert.equal(evidence.securitiesLending.label, "증권대차 잔고비중");
    assert.match(evidence.shortSaleTrading.formula, /거래대금/);
    assert.match(evidence.reportableNetShortPosition.formula, /순보유잔고 수량/);
    assert.match(evidence.securitiesLending.formula, /대차잔고 주식수/);
    assert.notEqual(evidence.shortSaleTrading.numerator, evidence.reportableNetShortPosition.numerator);
    assert.notEqual(evidence.reportableNetShortPosition.numerator, evidence.securitiesLending.numerator);
  });

  it("신고·공시 순보유잔고 누락은 0이 아니라 null이다", () => {
    const evidence = buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset("DEMO-NEAR"));
    assert.equal(evidence.reportableNetShortPosition.status, "missing");
    assert.equal(evidence.reportableNetShortPosition.ratioPct, null);
    assert.equal(evidence.reportableNetShortPosition.numerator, null);
    assert.match(evidence.reportableNetShortPosition.coverageNote, /누락/);
  });

  it("공매도 거래 잠정값은 잠정 상태로 전파한다", () => {
    const evidence = buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset("DEMO-SHORT"));
    assert.equal(evidence.shortSaleTrading.status, "provisional");
    assert.equal(evidence.status, "warning");
    assert.ok(evidence.warnings.some((warning) => warning.includes("잠정")));
  });

  it("잔고 비율의 분자와 상장주식수 기준일이 다르면 계산하지 않는다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.reportableNetShortPosition.denominator.referenceDate = "2026-08-20";
    dataset.securitiesLending.denominator.referenceDate = "2026-08-20";

    const shortPosition = calculateReportableNetShortPositionRatio(dataset.reportableNetShortPosition);
    const lending = calculateSecuritiesLendingBalanceRatio(dataset.securitiesLending);
    assert.equal(shortPosition.status, "unavailable");
    assert.equal(shortPosition.ratioPct, null);
    assert.equal(lending.status, "unavailable");
    assert.equal(lending.ratioPct, null);
  });

  it("분모가 0이면 비율은 unavailable이며 0%로 표시하지 않는다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.securitiesLending.denominator.quantity = finalDatum(0);
    const ratio = calculateSecuritiesLendingBalanceRatio(dataset.securitiesLending);
    assert.equal(ratio.status, "unavailable");
    assert.equal(ratio.ratioPct, null);
  });

  it("원천 표시 비율과 재계산값 차이가 0.01%p를 넘으면 경고한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.shortSaleTrading.sourceReportedRatioPct = finalDatum(99);
    const evidence = buildTickerFlowShortEvidence(dataset);
    assert.ok(evidence.warnings.some((warning) => warning.includes("0.01%p 넘게")));
  });

  it("공시 범위는 시장 전체 포지션이라고 단정하지 않는다", () => {
    const evidence = buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset("DEMO-HIGH"));
    assert.match(evidence.reportableNetShortPosition.coverageNote, /신고·공시 대상 범위/);
    assert.match(evidence.reportableNetShortPosition.coverageNote, /시장 전체 포지션과 동일하다고 단정할 수 없습니다/);
  });

  it("세 비율 근거는 각 지표의 출처·공표일·공표상태·최신성을 보존한다", () => {
    const evidence = buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset("DEMO-HIGH"));
    assert.match(evidence.shortSaleTrading.source, /short-sale-trading$/);
    assert.match(evidence.reportableNetShortPosition.source, /reportable-net-short-position$/);
    assert.match(evidence.securitiesLending.source, /securities-lending$/);
    for (const ratio of [
      evidence.shortSaleTrading,
      evidence.reportableNetShortPosition,
      evidence.securitiesLending,
    ]) {
      assert.equal(ratio.publicationDate, FLOW_SHORT_FIXTURE_PUBLICATION_DATE);
      assert.equal(ratio.publicationStatus, "not_applicable");
      assert.equal(ratio.freshness, "fixture");
    }
  });
});

describe("날짜·출처 검증과 blocked fail-closed", () => {
  it("dataset 기준일이 거래 달력 최신 적격 일자와 다르면 모든 비율 숫자를 제거한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.metadata.asOfTradeDate = "2026-08-20";
    const evidence = buildTickerFlowShortEvidence(dataset);
    assertAllRatiosFailClosed(evidence);
    assert.ok(evidence.warnings.some((warning) => warning.includes("최신 적격 일자")));
  });

  it("지표 공표일이 기준일보다 앞서면 모든 비율 숫자를 제거한다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.shortSaleTrading.publicationDate = "2026-08-20";
    const evidence = buildTickerFlowShortEvidence(dataset);
    assertAllRatiosFailClosed(evidence);
    assert.ok(evidence.warnings.some((warning) => warning.includes("공표일이 기준일보다 앞설 수 없습니다")));
  });

  it("음수여서는 안 되는 지표가 음수면 유효했던 다른 child 비율까지 노출하지 않는다", () => {
    const dataset = getTickerFlowShortDemoDataset("DEMO-HIGH");
    dataset.shortSaleTrading.shortSaleTradingValueKrw = finalDatum(-1);
    const evidence = buildTickerFlowShortEvidence(dataset);
    assertAllRatiosFailClosed(evidence);
    assert.ok(evidence.warnings.some((warning) => warning.includes("공매도 거래대금은 음수일 수 없습니다")));
  });
});

describe("결정론 비율 및 표현 안전성", () => {
  it("비율은 소수점 넷째 자리에서 결정론적으로 반올림한다", () => {
    assert.equal(calculateRatioPctDeterministic(1, 3), 33.3333);
    assert.equal(calculateRatioPctDeterministic(-1, 3), -33.3333);
    assert.equal(calculateRatioPctDeterministic(1, 32), 3.125);
    assert.equal(calculateRatioPctDeterministic(1, 0), null);
    assert.equal(calculateRatioPctDeterministic(1.5, 3), null);
  });

  it("출력 계약에는 투자 판단을 암시하는 금지 표현이 없다", () => {
    const serialized = FLOW_SHORT_DEMO_SYMBOLS
      .map((symbol) => JSON.stringify(buildTickerFlowShortEvidence(getTickerFlowShortDemoDataset(symbol))))
      .join("\n");
    for (const prohibited of ["수급 종합점수", "강한 매수", "상승확률", "하락예상", "비중 확대"]) {
      assert.equal(serialized.includes(prohibited), false, prohibited);
    }
  });
});
