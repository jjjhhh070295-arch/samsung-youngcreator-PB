import type { TickerMomentumEvidence } from "@/lib/advisory/types";

function number(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "계산 불가";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function percent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "계산 불가";
  return `${value > 0 ? "+" : ""}${number(value)}%`;
}

function stateLabel(evidence: TickerMomentumEvidence) {
  if (evidence.proximityState === "new_high") return "실제 52주 신고가";
  if (evidence.proximityState === "near_high") return `직전 고가 ${evidence.nearThresholdPct}% 이내 근접`;
  if (evidence.proximityState === "below_high") return "직전 52주 고가 아래";
  return "계산 불가";
}

function freshnessLabel(evidence: TickerMomentumEvidence) {
  if (evidence.freshness === "fixture") return "교육용 고정 자료";
  if (evidence.freshness === "current") return "평일 기준 최신";
  if (evidence.freshness === "stale") return "평일 기준 지연";
  return "시점 확인 필요";
}

function completenessLabel(evidence: TickerMomentumEvidence) {
  if (evidence.sessionCompleteness === "complete") return "정규장 완료 일봉";
  if (evidence.sessionCompleteness === "partial") return "장중 부분 일봉";
  return "완결 여부 확인 필요";
}

function MetricBox({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#DCE4F5] bg-white p-3">
      <p className="text-xs font-medium text-[#64748B]">{label}</p>
      <p className="mt-1 break-words text-base font-bold text-[#0F172A]">{value}</p>
      {note ? <p className="mt-1 break-words text-xs text-[#64748B]">{note}</p> : null}
    </div>
  );
}

export default function TickerMomentumEvidencePanel({ evidence }: { evidence: TickerMomentumEvidence }) {
  if (evidence.status === "unavailable" || evidence.status === "blocked") {
    return (
      <section
        aria-labelledby="ticker-momentum-heading"
        className="mt-5 rounded-xl border border-[#DCE4F5] bg-[#F0F3FA] p-4"
        data-testid="ticker-momentum-unavailable"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-[#1428A0]">가격·모멘텀 P0</p>
            <h3 id="ticker-momentum-heading" className="mt-1 text-base font-bold text-[#0F172A]">
              52주 신고가 근거
            </h3>
          </div>
          <span className="rounded-full border border-[#DCE4F5] bg-white px-2 py-1 text-xs font-semibold text-[#64748B]">
            데이터 승인 필요
          </span>
        </div>
        <p className="mt-3 text-sm font-semibold text-[#0F172A]">
          승인된 수정 OHLCV·거래량 자료가 없어 수치를 표시하지 않습니다.
        </p>
        <p className="mt-1 break-words text-xs leading-relaxed text-[#64748B]">{evidence.warnings[0]}</p>
        <p className="mt-2 break-words text-xs text-[#64748B]">현재 화면 출처: {evidence.source}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="ticker-momentum-heading"
      className="mt-5 rounded-xl border border-[#DCE4F5] bg-[#F0F3FA] p-4"
      data-testid="ticker-momentum-evidence"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1428A0]">가격·모멘텀 P0</p>
          <h3 id="ticker-momentum-heading" className="mt-1 text-base font-bold text-[#0F172A]">
            52주 신고가·거래량 근거
          </h3>
          <p className="mt-1 text-xs text-[#64748B]">미래 상승 예측이 아니라 과거 시계열의 결정론 계산입니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[#B8C5F2] bg-white px-2 py-1 text-xs font-bold text-[#1428A0]">
            {evidence.label}
          </span>
          <span className="rounded-full border border-[#DCE4F5] bg-white px-2 py-1 text-xs font-semibold text-[#64748B]">
            {evidence.dataMode === "demo"
              ? "고정 스냅샷 · 실시간 아님"
              : evidence.freshness === "stale"
                ? "지연 데이터"
                : "승인된 실데이터"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricBox
          label="52주 상태"
          value={stateLabel(evidence)}
          note={`현재 수정종가 기준 거리 ${percent(evidence.distanceToPriorHighPct)}`}
        />
        <MetricBox
          label="오늘 수정고가"
          value={number(evidence.currentAdjustedHigh, 4)}
          note={`직전 252일 최고 ${number(evidence.prior252High, 4)}`}
        />
        <MetricBox
          label="20일 평균 대비 거래량"
          value={evidence.volumeRatio20 == null ? "계산 불가" : `${number(evidence.volumeRatio20)}배`}
          note="오늘을 제외한 직전 20거래일 평균 기준"
        />
        <MetricBox
          label="관측 일봉"
          value={`${evidence.observationCount}개`}
          note={`신고가 비교 이전 구간 ${evidence.previousWindowCount}/252`}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MetricBox label="20거래일 수익률" value={percent(evidence.returnsPct.d20)} />
        <MetricBox label="60거래일 수익률" value={percent(evidence.returnsPct.d60)} />
        <MetricBox label="120거래일 수익률" value={percent(evidence.returnsPct.d120)} />
        <MetricBox label="252거래일 수익률" value={percent(evidence.returnsPct.d252)} />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricBox label="수정종가 SMA20" value={number(evidence.movingAverages.sma20, 4)} />
        <MetricBox label="수정종가 SMA60" value={number(evidence.movingAverages.sma60, 4)} />
        <MetricBox label="수정종가 SMA120" value={number(evidence.movingAverages.sma120, 4)} />
      </div>

      {evidence.warnings.length ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="status">
          <p className="text-xs font-bold text-amber-900">자료 상태 확인</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {evidence.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <details className="mt-3 rounded-lg border border-[#DCE4F5] bg-white p-3">
        <summary className="cursor-pointer text-xs font-bold text-[#1428A0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]">
          계산 기준과 데이터 근거 보기
        </summary>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">기준일</dt><dd className="break-words text-[#0F172A]">{evidence.asOf}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">출처</dt><dd className="break-words text-[#0F172A]">{evidence.source}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">데이터 세트</dt><dd className="break-words text-[#0F172A]">{evidence.datasetId} · {evidence.version}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">수정주가</dt><dd className="break-words text-[#0F172A]">{evidence.adjustmentStatus} · {evidence.adjustmentBasis}</dd></div>
          <div className="min-w-0 sm:col-span-2"><dt className="font-semibold text-[#64748B]">거래량 기준</dt><dd className="break-words text-[#0F172A]">{evidence.volumeBasis}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">자료 시점</dt><dd className="break-words text-[#0F172A]">{freshnessLabel(evidence)} · {completenessLabel(evidence)}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-[#64748B]">누락·중복</dt><dd className="break-words text-[#0F172A]">거래량 누락 {evidence.missingVolumeCount}건 · 동일 중복 제거 {evidence.duplicateDatesRemoved}건</dd></div>
        </dl>
      </details>
    </section>
  );
}
