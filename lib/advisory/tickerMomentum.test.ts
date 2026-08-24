import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessMomentumFreshness,
  buildTickerMomentumEvidence,
  buildUnavailableTickerMomentum,
  MOMENTUM_NEAR_THRESHOLD_PCT,
  normalizeMomentumBars,
} from "./tickerMomentum";
import { getMomentumDemoDataset } from "./tickerMomentumFixture";
import type { TickerMomentumDataset, TickerMomentumOhlcvBar } from "./types";

function businessDates(endDate: string, count: number) {
  const dates: string[] = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.unshift(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function bars(count = 253): TickerMomentumOhlcvBar[] {
  return businessDates("2026-08-21", count).map((sessionDate, index) => {
    const close = 100 + index * 0.01;
    return {
      sessionDate,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000,
    };
  });
}

function dataset(
  inputBars: TickerMomentumOhlcvBar[],
  overrides: Partial<TickerMomentumDataset> = {},
): TickerMomentumDataset {
  return {
    dataMode: "demo",
    approvalStatus: "not_applicable",
    datasetId: "test-momentum",
    version: "test.v1",
    label: "교육용 데모 데이터",
    asOf: "2026-08-21T06:30:00.000Z",
    source: "test-fixture",
    adjustmentStatus: "split_adjusted",
    adjustmentBasis: "테스트용 수정 OHLC",
    volumeBasis: "테스트용 정규장 거래량",
    sessionCompleteness: "complete",
    bars: inputBars,
    ...overrides,
  };
}

describe("52주 신고가·모멘텀 결정론 계산", () => {
  it("오늘 수정고가가 직전 252거래일 수정고가 최댓값과 같아도 실제 신고가다", () => {
    const input = bars();
    const priorHigh = Math.max(...input.slice(0, -1).map((bar) => bar.high));
    const latest = input.at(-1)!;
    latest.open = priorHigh - 0.5;
    latest.close = priorHigh - 0.2;
    latest.high = priorHigh;
    latest.low = priorHigh - 1;

    const result = buildTickerMomentumEvidence(dataset(input));
    assert.equal(result.previousWindowCount, 252);
    assert.equal(result.prior252High, Number(priorHigh.toFixed(4)));
    assert.equal(result.isNewHigh, true);
    assert.equal(result.proximityState, "new_high");
  });

  it("현재 수정종가의 직전 고가 대비 정확한 거리로 신고가 근접과 하회를 분리한다", () => {
    const atThreshold = bars();
    const priorHigh = Math.max(...atThreshold.slice(0, -1).map((bar) => bar.high));
    Object.assign(atThreshold.at(-1)!, {
      open: priorHigh * 0.975,
      close: priorHigh * (1 - MOMENTUM_NEAR_THRESHOLD_PCT / 100),
      high: priorHigh * 0.995,
      low: priorHigh * 0.965,
    });
    const near = buildTickerMomentumEvidence(dataset(atThreshold));
    assert.equal(near.isNewHigh, false);
    assert.equal(near.distanceToPriorHighPct, -3);
    assert.equal(near.proximityState, "near_high");

    const belowThreshold = bars();
    Object.assign(belowThreshold.at(-1)!, {
      open: priorHigh * 0.97,
      close: priorHigh * 0.9698,
      high: priorHigh * 0.99,
      low: priorHigh * 0.96,
    });
    const below = buildTickerMomentumEvidence(dataset(belowThreshold));
    assert.equal(below.isNewHigh, false);
    assert.equal(below.distanceToPriorHighPct, -3.02);
    assert.equal(below.proximityState, "below_high");
  });

  it("252개 이하 일봉은 실제 신고가와 252일 수익률을 비운다", () => {
    const result = buildTickerMomentumEvidence(dataset(bars(252)));
    assert.equal(result.status, "warning");
    assert.equal(result.previousWindowCount, 251);
    assert.equal(result.prior252High, null);
    assert.equal(result.isNewHigh, null);
    assert.equal(result.returnsPct.d252, null);
    assert.match(result.warnings.join(" "), /252거래일/);
  });

  it("수익률·이동평균·거래량 배수는 오늘을 포함/제외하는 계약대로 계산한다", () => {
    const input = businessDates("2026-08-21", 253).map((sessionDate, index) => {
      const close = index + 1;
      return {
        sessionDate,
        open: close,
        high: close + 0.5,
        low: Math.max(0.25, close - 0.5),
        close,
        volume: index === 252 ? 200 : 100,
      } satisfies TickerMomentumOhlcvBar;
    });
    const result = buildTickerMomentumEvidence(dataset(input));
    assert.equal(result.returnsPct.d20, Number(((253 / 233 - 1) * 100).toFixed(2)));
    assert.equal(result.returnsPct.d60, Number(((253 / 193 - 1) * 100).toFixed(2)));
    assert.equal(result.returnsPct.d120, Number(((253 / 133 - 1) * 100).toFixed(2)));
    assert.equal(result.returnsPct.d252, 25_200);
    assert.equal(result.movingAverages.sma20, 243.5);
    assert.equal(result.movingAverages.sma60, 223.5);
    assert.equal(result.movingAverages.sma120, 193.5);
    assert.equal(result.volumeRatio20, 2);
  });

  it("액면분할 전 원시가격이 높아도 계산은 연속된 수정 OHLC만 사용한다", () => {
    const input = bars();
    input.forEach((bar, index) => {
      bar.open = 99;
      bar.high = 100;
      bar.low = 98;
      bar.close = 99;
      bar.rawHigh = index < 130 ? 200 : 100;
      bar.rawClose = index < 130 ? 198 : 99;
    });
    Object.assign(input.at(-1)!, { open: 100, close: 100.5, high: 101, low: 99, rawHigh: 101, rawClose: 100.5 });
    const result = buildTickerMomentumEvidence(dataset(input));
    assert.equal(Math.max(...input.slice(0, -1).map((bar) => bar.rawHigh ?? 0)), 200);
    assert.equal(result.prior252High, 100);
    assert.equal(result.currentAdjustedHigh, 101);
    assert.equal(result.isNewHigh, true);
  });

  it("주말 공백은 보간하지 않고 완전히 같은 중복 일자만 한 번 사용한다", () => {
    const input = bars();
    const duplicate = { ...input[100] };
    const normalized = normalizeMomentumBars([input.at(-1)!, ...input.slice(0, -1), duplicate]);
    assert.equal(normalized.error, null);
    assert.equal(normalized.duplicateDatesRemoved, 1);
    assert.equal(normalized.bars.length, 253);
    assert.ok(normalized.bars.some((bar, index) => {
      const next = normalized.bars[index + 1];
      if (!next) return false;
      return (new Date(`${next.sessionDate}T00:00:00Z`).getTime()
        - new Date(`${bar.sessionDate}T00:00:00Z`).getTime()) > 86_400_000;
    }), "주말 공백이 거래일 수열에 그대로 있어야 한다");
  });

  it("평일 휴장일 공백도 가격을 만들지 않고 실제 관측 일봉 개수만 센다", () => {
    const input = bars(254);
    const removed = input.splice(100, 1)[0];
    const before = new Date(`${input[99].sessionDate}T00:00:00Z`).getTime();
    const after = new Date(`${input[100].sessionDate}T00:00:00Z`).getTime();
    assert.ok(after - before >= 2 * 86_400_000, `제거한 휴장일 ${removed.sessionDate}의 공백이 남아야 한다`);
    const result = buildTickerMomentumEvidence(dataset(input));
    assert.equal(result.observationCount, 253);
    assert.equal(result.previousWindowCount, 252);
  });

  it("같은 날짜에 서로 다른 값이 있으면 fail-closed로 차단한다", () => {
    const input = bars();
    input.push({ ...input[50], close: input[50].close + 0.1 });
    const result = buildTickerMomentumEvidence(dataset(input));
    assert.equal(result.status, "blocked");
    assert.equal(result.currentAdjustedHigh, null);
    assert.match(result.warnings[0], /서로 다른 중복 일봉/);
  });

  it("존재하지 않는 달력 일자와 미래 실데이터 기준일은 차단한다", () => {
    const impossibleDate = bars();
    impossibleDate[10].sessionDate = "2026-02-30";
    assert.equal(buildTickerMomentumEvidence(dataset(impossibleDate)).status, "blocked");

    const future = buildTickerMomentumEvidence(dataset(bars(), {
      dataMode: "live",
      approvalStatus: "approved",
      asOf: "2026-08-24T06:30:00.000Z",
    }), "2026-08-21T09:00:00.000Z");
    assert.equal(future.status, "blocked");
    assert.match(future.warnings[0], /미래/);
  });

  it("현재 또는 직전 20거래일 거래량 누락을 0으로 치환하지 않는다", () => {
    const currentMissing = bars();
    currentMissing.at(-1)!.volume = null;
    const result = buildTickerMomentumEvidence(dataset(currentMissing));
    assert.equal(result.volumeRatio20, null);
    assert.equal(result.missingVolumeCount, 1);
    assert.match(result.warnings.join(" "), /거래량이 누락/);

    const priorMissing = bars();
    priorMissing.at(-10)!.volume = null;
    assert.equal(buildTickerMomentumEvidence(dataset(priorMissing)).volumeRatio20, null);
  });

  it("승인되지 않은 실데이터·수정 여부 불명·부분 일봉은 모두 차단한다", () => {
    const input = bars();
    const unapproved = buildTickerMomentumEvidence(dataset(input, {
      dataMode: "live",
      approvalStatus: "not_approved",
    }));
    assert.equal(unapproved.status, "blocked");
    assert.match(unapproved.warnings[0], /승인/);

    const unknownAdjustment = buildTickerMomentumEvidence(dataset(input, { adjustmentStatus: "unknown" }));
    assert.equal(unknownAdjustment.status, "blocked");

    const partial = buildTickerMomentumEvidence(dataset(input, { sessionCompleteness: "partial" }));
    assert.equal(partial.status, "blocked");
  });

  it("승인된 실데이터는 평일 기준 지연을 계산하고 API 실패 상태는 수치 없이 표시한다", () => {
    assert.equal(assessMomentumFreshness("2026-08-14", "2026-08-21", "live"), "stale");
    const stale = buildTickerMomentumEvidence(dataset(bars(), {
      dataMode: "live",
      approvalStatus: "approved",
      asOf: "2026-08-14T06:30:00.000Z",
    }), "2026-08-21T09:00:00.000Z");
    assert.equal(stale.freshness, "stale");
    assert.match(stale.warnings.join(" "), /오래된 데이터/);

    const failed = buildUnavailableTickerMomentum({ reason: "승인된 데이터 API 조회 실패" });
    assert.equal(failed.status, "unavailable");
    assert.equal(failed.currentAdjustedHigh, null);
    assert.match(failed.warnings[0], /API 조회 실패/);
  });

  it("명시적 교육용 fixture는 실제 신고가·근접·자료부족을 서로 다르게 재현한다", () => {
    const high = buildTickerMomentumEvidence(getMomentumDemoDataset("DEMO-HIGH"));
    const near = buildTickerMomentumEvidence(getMomentumDemoDataset("DEMO-NEAR"));
    const short = buildTickerMomentumEvidence(getMomentumDemoDataset("DEMO-SHORT"));
    assert.equal(high.label, "교육용 데모 데이터");
    assert.equal(high.freshness, "fixture");
    assert.equal(high.proximityState, "new_high");
    assert.equal(near.proximityState, "near_high");
    assert.equal(short.proximityState, "unavailable");
    assert.equal(short.status, "warning");
  });
});
