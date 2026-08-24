import { periodReturnPct, round, sma } from "./indicators";
import type {
  TickerMomentumDataset,
  TickerMomentumEvidence,
  TickerMomentumOhlcvBar,
} from "./types";

export const MOMENTUM_NEAR_THRESHOLD_PCT = 3;
const REQUIRED_PREVIOUS_SESSIONS = 252;
const MAX_MISSED_BUSINESS_DAYS = 2;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface NormalizedBarsResult {
  bars: TickerMomentumOhlcvBar[];
  duplicateDatesRemoved: number;
  error: string | null;
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function sameBar(a: TickerMomentumOhlcvBar, b: TickerMomentumOhlcvBar) {
  return a.open === b.open
    && a.high === b.high
    && a.low === b.low
    && a.close === b.close
    && a.volume === b.volume
    && a.rawHigh === b.rawHigh
    && a.rawClose === b.rawClose;
}

function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateBar(bar: TickerMomentumOhlcvBar): string | null {
  if (!isValidIsoDate(bar.sessionDate)) {
    return `거래일 형식 오류: ${bar.sessionDate || "(빈 값)"}`;
  }
  if (![bar.open, bar.high, bar.low, bar.close].every(finitePositive)) {
    return `${bar.sessionDate} OHLC에 0·음수·비정상 값이 있습니다.`;
  }
  if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) {
    return `${bar.sessionDate} 고가·저가 범위가 OHLC와 모순됩니다.`;
  }
  if (bar.volume != null && (!Number.isFinite(bar.volume) || bar.volume < 0)) {
    return `${bar.sessionDate} 거래량이 비정상입니다.`;
  }
  return null;
}

export function normalizeMomentumBars(input: TickerMomentumOhlcvBar[]): NormalizedBarsResult {
  const byDate = new Map<string, TickerMomentumOhlcvBar>();
  let duplicateDatesRemoved = 0;

  for (const bar of input) {
    const validationError = validateBar(bar);
    if (validationError) return { bars: [], duplicateDatesRemoved, error: validationError };
    const existing = byDate.get(bar.sessionDate);
    if (!existing) {
      byDate.set(bar.sessionDate, { ...bar });
      continue;
    }
    if (!sameBar(existing, bar)) {
      return {
        bars: [],
        duplicateDatesRemoved,
        error: `${bar.sessionDate}에 서로 다른 중복 일봉이 있어 계산을 차단했습니다.`,
      };
    }
    duplicateDatesRemoved += 1;
  }

  return {
    bars: Array.from(byDate.values()).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)),
    duplicateDatesRemoved,
    error: null,
  };
}

function businessDaysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function assessMomentumFreshness(
  asOf: string,
  referenceAsOf: string,
  dataMode: TickerMomentumDataset["dataMode"],
): TickerMomentumEvidence["freshness"] {
  if (dataMode === "demo") return "fixture";
  if (!asOf || !referenceAsOf) return "unknown";
  return businessDaysBetween(asOf, referenceAsOf) > MAX_MISSED_BUSINESS_DAYS ? "stale" : "current";
}

function roundNullable(value: number | null, digits = 2) {
  return value == null || !Number.isFinite(value) ? null : round(value, digits);
}

function unavailableEvidence(input: {
  asOf?: string;
  source?: string;
  reason: string;
}): TickerMomentumEvidence {
  return {
    status: "unavailable",
    dataMode: "unavailable",
    approvalStatus: "unknown",
    datasetId: null,
    version: null,
    label: "데이터 승인 필요",
    asOf: input.asOf ?? "",
    source: input.source ?? "승인된 OHLCV 데이터 없음",
    adjustmentStatus: "unknown",
    adjustmentBasis: "확인되지 않음",
    volumeBasis: "확인되지 않음",
    sessionCompleteness: "unknown",
    freshness: "unknown",
    observationCount: 0,
    previousWindowCount: 0,
    duplicateDatesRemoved: 0,
    missingVolumeCount: 0,
    currentAdjustedClose: null,
    currentAdjustedHigh: null,
    prior252High: null,
    distanceToPriorHighPct: null,
    isNewHigh: null,
    proximityState: "unavailable",
    nearThresholdPct: MOMENTUM_NEAR_THRESHOLD_PCT,
    returnsPct: { d20: null, d60: null, d120: null, d252: null },
    movingAverages: { sma20: null, sma60: null, sma120: null },
    volumeRatio20: null,
    warnings: [input.reason],
  };
}

export function buildUnavailableTickerMomentum(input: {
  asOf?: string;
  source?: string;
  reason?: string;
} = {}): TickerMomentumEvidence {
  return unavailableEvidence({
    ...input,
    reason: input.reason ?? "승인된 수정 OHLCV 데이터가 없어 52주 신고가·거래량을 계산하지 않았습니다.",
  });
}

function blockedEvidence(dataset: TickerMomentumDataset, reason: string): TickerMomentumEvidence {
  return {
    ...unavailableEvidence({ asOf: dataset.asOf, source: dataset.source, reason }),
    status: "blocked",
    dataMode: dataset.dataMode,
    approvalStatus: dataset.approvalStatus,
    datasetId: dataset.datasetId,
    version: dataset.version,
    label: dataset.label,
    adjustmentStatus: dataset.adjustmentStatus,
    adjustmentBasis: dataset.adjustmentBasis,
    volumeBasis: dataset.volumeBasis,
    sessionCompleteness: dataset.sessionCompleteness,
    freshness: dataset.dataMode === "demo" ? "fixture" : "unknown",
  };
}

export function buildTickerMomentumEvidence(
  dataset: TickerMomentumDataset | null | undefined,
  referenceAsOf = new Date().toISOString(),
): TickerMomentumEvidence {
  if (!dataset) return buildUnavailableTickerMomentum();
  const datasetDate = dataset.asOf.slice(0, 10);
  const referenceDate = referenceAsOf.slice(0, 10);
  if (!isValidIsoDate(datasetDate) || Number.isNaN(Date.parse(dataset.asOf))) {
    return blockedEvidence(dataset, "dataset 기준일이 유효한 ISO 일시가 아니어서 계산을 차단했습니다.");
  }
  if (!isValidIsoDate(referenceDate) || Number.isNaN(Date.parse(referenceAsOf))) {
    return blockedEvidence(dataset, "비교 기준일이 유효한 ISO 일시가 아니어서 계산을 차단했습니다.");
  }
  if (datasetDate > referenceDate && dataset.dataMode === "live") {
    return blockedEvidence(dataset, "dataset 기준일이 비교 기준일보다 미래여서 계산을 차단했습니다.");
  }
  if (dataset.dataMode === "live" && dataset.approvalStatus !== "approved") {
    return blockedEvidence(dataset, "시장정보 이용 승인이 확인되지 않아 실데이터 계산을 차단했습니다.");
  }
  if (dataset.adjustmentStatus === "unadjusted" || dataset.adjustmentStatus === "unknown") {
    return blockedEvidence(dataset, "수정주가 여부가 확인되지 않아 52주 수정고가 계산을 차단했습니다.");
  }
  if (dataset.sessionCompleteness !== "complete") {
    return blockedEvidence(dataset, "정규장 완료 일봉이 아니어서 52주 모멘텀 계산을 차단했습니다.");
  }

  const normalized = normalizeMomentumBars(dataset.bars);
  if (normalized.error) return blockedEvidence(dataset, normalized.error);
  const bars = normalized.bars;
  if (!bars.length) return blockedEvidence(dataset, "유효한 OHLCV 일봉이 없습니다.");

  const latest = bars.at(-1)!;
  const closes = bars.map((bar) => bar.close);
  const previousWindow = bars.slice(-(REQUIRED_PREVIOUS_SESSIONS + 1), -1);
  const hasFullPreviousWindow = previousWindow.length === REQUIRED_PREVIOUS_SESSIONS;
  const prior252High = hasFullPreviousWindow
    ? Math.max(...previousWindow.map((bar) => bar.high))
    : null;
  const distanceToPriorHighPct = prior252High && prior252High > 0
    ? (latest.close / prior252High - 1) * 100
    : null;
  // 부동소수점 오차 때문에 정확히 -3%인 경계값이 -3.000…%로 밀리지 않게
  // 임계값 비교에만 충분한 정밀도로 정규화한다. 화면 표시는 아래에서 2자리다.
  const distanceForThreshold = roundNullable(distanceToPriorHighPct, 8);
  const isNewHigh = prior252High == null ? null : latest.high >= prior252High;
  const proximityState: TickerMomentumEvidence["proximityState"] = isNewHigh === true
    ? "new_high"
    : isNewHigh === false && distanceForThreshold != null && distanceForThreshold >= -MOMENTUM_NEAR_THRESHOLD_PCT
      ? "near_high"
      : isNewHigh === false
        ? "below_high"
        : "unavailable";

  const previous20Volumes = bars.slice(-21, -1).map((bar) => bar.volume);
  const currentVolume = latest.volume;
  const canCalculateVolume = currentVolume != null
    && previous20Volumes.length === 20
    && previous20Volumes.every((value): value is number => value != null && Number.isFinite(value));
  const priorVolumeMean = canCalculateVolume
    ? previous20Volumes.reduce((sum, value) => sum + value, 0) / previous20Volumes.length
    : null;
  const volumeRatio20 = currentVolume != null && priorVolumeMean != null && priorVolumeMean > 0
    ? currentVolume / priorVolumeMean
    : null;

  const freshness = assessMomentumFreshness(dataset.asOf, referenceAsOf, dataset.dataMode);
  const missingVolumeCount = bars.reduce((count, bar) => count + (bar.volume == null ? 1 : 0), 0);
  const warnings: string[] = [];
  if (!hasFullPreviousWindow) {
    warnings.push(`직전 252거래일이 필요하지만 ${previousWindow.length}개만 있어 신고가와 252일 수익률을 비웠습니다.`);
  }
  if (volumeRatio20 == null) {
    warnings.push("현재 또는 직전 20거래일 거래량이 누락되어 거래량 배수를 비웠습니다.");
  }
  if (normalized.duplicateDatesRemoved > 0) {
    warnings.push(`완전히 동일한 중복 거래일 ${normalized.duplicateDatesRemoved}건을 한 번만 사용했습니다.`);
  }
  if (dataset.asOf.slice(0, 10) !== latest.sessionDate) {
    warnings.push(`dataset 기준일(${dataset.asOf.slice(0, 10)})과 마지막 거래일(${latest.sessionDate})이 다릅니다.`);
  }
  if (freshness === "stale") {
    warnings.push("거래소 휴장일 달력을 반영하지 않은 평일 기준으로 2일 넘게 오래된 데이터입니다.");
  }

  return {
    status: warnings.length ? "warning" : "ok",
    dataMode: dataset.dataMode,
    approvalStatus: dataset.approvalStatus,
    datasetId: dataset.datasetId,
    version: dataset.version,
    label: dataset.label,
    asOf: dataset.asOf,
    source: dataset.source,
    adjustmentStatus: dataset.adjustmentStatus,
    adjustmentBasis: dataset.adjustmentBasis,
    volumeBasis: dataset.volumeBasis,
    sessionCompleteness: dataset.sessionCompleteness,
    freshness,
    observationCount: bars.length,
    previousWindowCount: previousWindow.length,
    duplicateDatesRemoved: normalized.duplicateDatesRemoved,
    missingVolumeCount,
    currentAdjustedClose: roundNullable(latest.close, 4),
    currentAdjustedHigh: roundNullable(latest.high, 4),
    prior252High: roundNullable(prior252High, 4),
    distanceToPriorHighPct: roundNullable(distanceToPriorHighPct),
    isNewHigh,
    proximityState,
    nearThresholdPct: MOMENTUM_NEAR_THRESHOLD_PCT,
    returnsPct: {
      d20: roundNullable(periodReturnPct(closes, 20)),
      d60: roundNullable(periodReturnPct(closes, 60)),
      d120: roundNullable(periodReturnPct(closes, 120)),
      d252: roundNullable(periodReturnPct(closes, 252)),
    },
    movingAverages: {
      sma20: roundNullable(sma(closes, 20), 4),
      sma60: roundNullable(sma(closes, 60), 4),
      sma120: roundNullable(sma(closes, 120), 4),
    },
    volumeRatio20: roundNullable(volumeRatio20),
    warnings,
  };
}
