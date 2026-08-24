import type { TickerFlowShortEvidence } from "@/lib/advisory/tickerFlowShort";

type FlowWindow = TickerFlowShortEvidence["windows"]["d1"];
type ParticipantMetrics = FlowWindow["individual"];
type RatioEvidence = TickerFlowShortEvidence["shortSaleTrading"];

const WINDOW_KEYS = ["d1", "d5", "d20"] as const;

function formatKrw(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "자료 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원`;
}

function formatNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "자료 없음";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}

function formatPercent(value: number | null, signed = false) {
  if (value == null || !Number.isFinite(value)) return "자료 없음";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: 3 })}%`;
}

function metricStateLabel(status: string) {
  if (status === "final") return "확정";
  if (status === "provisional") return "잠정";
  if (status === "missing") return "자료 누락";
  if (status === "unavailable") return "확인 필요";
  return "확인 필요";
}

function isAvailableStatus(status: string) {
  return status === "final" || status === "provisional";
}

function publicationStateLabel(status: string) {
  if (status === "final") return "확정";
  if (status === "provisional") return "잠정";
  return "해당 없음 (교육용)";
}

function freshnessLabel(freshness: string) {
  if (freshness === "fixture") return "고정 fixture · 실시간 아님";
  if (freshness === "delayed" || freshness === "stale") return "지연 자료";
  if (freshness === "current") return "기준일 현재";
  return "시점 확인 필요";
}

function countMissingItems(evidence: TickerFlowShortEvidence) {
  let count = 0;
  for (const key of WINDOW_KEYS) {
    const window = evidence.windows[key];
    for (const participant of [window.individual, window.foreign, window.institution]) {
      if (!isAvailableStatus(participant.netBuyKrw.status)) count += 1;
      if (!isAvailableStatus(participant.shareOfTurnoverPct.status)) count += 1;
    }
  }
  for (const ratio of [evidence.shortSaleTrading, evidence.reportableNetShortPosition, evidence.securitiesLending]) {
    if (!isAvailableStatus(ratio.status)) count += 1;
  }
  return count;
}

function WindowMetric({ window, metrics }: { window: FlowWindow; metrics: ParticipantMetrics }) {
  const missingDates = Array.from(new Set([
    ...metrics.netBuyKrw.missingDates,
    ...metrics.shareOfTurnoverPct.missingDates,
  ]));
  const isComplete = isAvailableStatus(metrics.netBuyKrw.status)
    && isAvailableStatus(metrics.shareOfTurnoverPct.status);

  return (
    <div className="min-w-0 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-bold text-[#1428A0]">{window.days}거래일</p>
        <span className="rounded-full border border-[#DCE4F5] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#526079]">
          {isComplete ? "누락 없음" : "누락 확인"}
        </span>
      </div>
      <dl className="mt-3 space-y-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-medium text-[#526079]">누적 순매수금액</dt>
          <dd className="mt-0.5 break-words text-sm font-bold text-[#0F172A]">
            {formatKrw(metrics.netBuyKrw.value)}
          </dd>
          {!isAvailableStatus(metrics.netBuyKrw.status) ? (
            <dd className="mt-1 break-words text-[10px] leading-relaxed text-[#526079]">
              {metricStateLabel(metrics.netBuyKrw.status)}
              {metrics.netBuyKrw.reason ? ` · ${metrics.netBuyKrw.reason}` : ""}
            </dd>
          ) : null}
        </div>
        <div className="min-w-0 border-t border-[#DCE4F5] pt-2">
          <dt className="text-[11px] font-medium text-[#526079]">전체 거래대금 대비</dt>
          <dd className="mt-0.5 break-words text-sm font-bold text-[#0F172A]">
            {formatPercent(metrics.shareOfTurnoverPct.value, true)}
          </dd>
          {!isAvailableStatus(metrics.shareOfTurnoverPct.status) ? (
            <dd className="mt-1 break-words text-[10px] leading-relaxed text-[#526079]">
              {metricStateLabel(metrics.shareOfTurnoverPct.status)}
              {metrics.shareOfTurnoverPct.reason ? ` · ${metrics.shareOfTurnoverPct.reason}` : ""}
            </dd>
          ) : null}
        </div>
      </dl>
      <p className="mt-3 break-words text-[10px] leading-relaxed text-[#526079]">
        {window.startDate ?? "자료 없음"}~{window.endDate ?? "자료 없음"} · 기대 거래일 {window.expectedDates.length}일
        {missingDates.length ? ` · 누락 ${missingDates.join(", ")}` : ""}
      </p>
    </div>
  );
}

function ParticipantCard({
  evidence,
  participant,
  title,
}: {
  evidence: TickerFlowShortEvidence;
  participant: "individual" | "foreign" | "institution";
  title: string;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-[#DCE4F5] bg-white p-4">
      <h4 className="text-sm font-bold text-[#0F172A]">{title}</h4>
      <p className="mt-1 text-[11px] leading-relaxed text-[#526079]">
        동일 기간의 순매수금액과 전체 거래대금 대비 비율입니다.
      </p>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
        {WINDOW_KEYS.map((key) => (
          <WindowMetric key={key} metrics={evidence.windows[key][participant]} window={evidence.windows[key]} />
        ))}
      </div>
    </article>
  );
}

function RatioSeriesCard({ ratio, id }: { ratio: RatioEvidence; id: string }) {
  const value = isAvailableStatus(ratio.status) && ratio.ratioPct != null && Number.isFinite(ratio.ratioPct)
    ? ratio.ratioPct
    : null;
  const barWidth = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <article aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border border-[#DCE4F5] bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-sm font-bold text-[#0F172A]" id={`${id}-title`}>
          {ratio.label}
        </h4>
        <span className="rounded-full border border-[#DCE4F5] bg-[#F0F3FA] px-2 py-0.5 text-[10px] font-semibold text-[#526079]">
          {metricStateLabel(ratio.status)}
        </span>
      </div>

      <p className="mt-3 break-words text-2xl font-black tracking-tight text-[#1428A0]">
        {formatPercent(value)}
      </p>
      <div className="mt-3" aria-describedby={`${id}-scale-note`}>
        <div
          aria-label={`${ratio.label} ${formatPercent(value)}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={value == null ? undefined : Math.max(0, Math.min(100, value))}
          className="h-2 w-full overflow-hidden rounded-full bg-[#F0F3FA]"
          role={value == null ? undefined : "progressbar"}
        >
          <div className="h-full rounded-full bg-[#2C3EE8]" style={{ width: `${barWidth}%` }} />
        </div>
        <p className="mt-1 text-[10px] text-[#526079]" id={`${id}-scale-note`}>
          0~100% 고정 눈금 · 수치 비교용 표시
        </p>
      </div>

      <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-2">
          <dt className="font-medium text-[#526079]">기준 거래일</dt>
          <dd className="mt-0.5 break-words font-semibold text-[#0F172A]">{ratio.basisDate || "자료 없음"}</dd>
        </div>
        <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-2">
          <dt className="font-medium text-[#526079]">공표일·상태</dt>
          <dd className="mt-0.5 break-words font-semibold text-[#0F172A]">
            {ratio.publicationDate || "자료 없음"} · {publicationStateLabel(ratio.publicationStatus)}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-2">
          <dt className="font-medium text-[#526079]">지연 상태</dt>
          <dd className="mt-0.5 break-words font-semibold text-[#0F172A]">
            {freshnessLabel(ratio.freshness)}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-2">
          <dt className="font-medium text-[#526079]">원문 보고 비율</dt>
          <dd className="mt-0.5 break-words font-semibold text-[#0F172A]">{formatPercent(ratio.sourceReportedRatioPct)}</dd>
        </div>
      </dl>

      <p className="mt-3 break-words text-[11px] leading-relaxed text-[#526079]">출처: {ratio.source}</p>

      <p className="mt-3 break-words text-[11px] leading-relaxed text-[#526079]">{ratio.coverageNote}</p>
      {!isAvailableStatus(ratio.status) ? (
        <p className="mt-2 text-xs font-semibold text-[#526079]">자료 없음 · 누락값을 0으로 바꾸지 않았습니다.</p>
      ) : null}
      <details className="mt-3 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] p-3">
        <summary className="cursor-pointer text-xs font-bold text-[#1428A0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]">
          산식과 분자·분모 보기
        </summary>
        <dl className="mt-2 space-y-2 text-xs">
          <div className="min-w-0">
            <dt className="font-medium text-[#526079]">산식</dt>
            <dd className="break-words text-[#0F172A]">{ratio.formula || "자료 없음"}</dd>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-medium text-[#526079]">분자</dt>
              <dd className="break-words text-[#0F172A]">{formatNumber(ratio.numerator)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-[#526079]">분모</dt>
              <dd className="break-words text-[#0F172A]">{formatNumber(ratio.denominator)}</dd>
            </div>
          </div>
        </dl>
      </details>
    </article>
  );
}

export default function TickerFlowShortPanel({ evidence }: { evidence: TickerFlowShortEvidence }) {
  const missingCount = countMissingItems(evidence);

  return (
    <section
      aria-labelledby="ticker-flow-short-heading"
      className="min-w-0 space-y-4 rounded-xl border border-[#DCE4F5] bg-[#F5F7FC] p-3 text-[#0F172A] sm:p-4"
      data-testid="ticker-flow-short-panel"
    >
      <header className="min-w-0 rounded-xl border border-[#DCE4F5] bg-white p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#1428A0]">수급·공매도</p>
            <h3 className="mt-1 break-words text-lg font-bold text-[#0F172A]" id="ticker-flow-short-heading">
              {evidence.displayName} · {evidence.symbol}
            </h3>
            <p className="mt-1 break-words text-xs leading-relaxed text-[#526079]">
              공개 지표의 정의를 분리해 보여주는 결정론 요약입니다. AI가 숫자를 만들거나 바꾸지 않습니다.
            </p>
          </div>
          <div className="flex max-w-full flex-wrap gap-2">
            <span className="rounded-full border border-[#B8C5F2] bg-[#EEF1FF] px-2.5 py-1 text-xs font-bold text-[#1428A0]">
              교육용 데모 데이터
            </span>
            <span className="rounded-full border border-[#DCE4F5] bg-[#F0F3FA] px-2.5 py-1 text-xs font-semibold text-[#526079]">
              {freshnessLabel(evidence.metadata.freshness)}
            </span>
          </div>
        </div>

        <dl className="mt-4 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-3">
            <dt className="font-medium text-[#526079]">기준 거래일</dt>
            <dd className="mt-1 break-words font-bold text-[#0F172A]">{evidence.metadata.asOfTradeDate}</dd>
          </div>
          <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-3">
            <dt className="font-medium text-[#526079]">공표일</dt>
            <dd className="mt-1 break-words font-bold text-[#0F172A]">{evidence.metadata.publicationDate}</dd>
          </div>
          <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-3">
            <dt className="font-medium text-[#526079]">잠정·확정</dt>
            <dd className="mt-1 break-words font-bold text-[#0F172A]">
              {publicationStateLabel(evidence.metadata.publicationStatus)}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg bg-[#F0F3FA] p-3">
            <dt className="font-medium text-[#526079]">지연·누락 상태</dt>
            <dd className="mt-1 break-words font-bold text-[#0F172A]">
              {freshnessLabel(evidence.metadata.freshness)} · 누락 항목 {missingCount}개
            </dd>
          </div>
        </dl>
        <p className="mt-3 break-words text-[11px] leading-relaxed text-[#526079]">
          출처: {evidence.metadata.source} · {evidence.metadata.datasetId} · {evidence.metadata.version}
        </p>
      </header>

      {evidence.status === "blocked" ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4" role="alert">
          <p className="text-xs font-bold text-red-700">표시 차단</p>
          <p className="mt-1 text-sm font-semibold text-red-800">
            자료 상태를 검증하지 못해 수치를 표시하지 않습니다.
          </p>
        </div>
      ) : null}

      {evidence.status !== "blocked" ? (
        <>
          <section aria-labelledby="ticker-flow-investor-heading" className="min-w-0 space-y-3">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#0F172A]" id="ticker-flow-investor-heading">투자자별 매매동향</h3>
              <p className="mt-1 break-words text-xs leading-relaxed text-[#526079]">
                기관계는 제공처의 기관계 값만 사용하며 기관 하위 분류와 중복 합산하지 않습니다.
              </p>
            </div>
            <ParticipantCard evidence={evidence} participant="individual" title="개인" />
            <ParticipantCard evidence={evidence} participant="foreign" title="외국인" />
            <ParticipantCard evidence={evidence} participant="institution" title="기관계" />
          </section>

          <section aria-labelledby="ticker-flow-three-evidence-heading" className="min-w-0">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#0F172A]" id="ticker-flow-three-evidence-heading">
                공매도 거래·순보유잔고·증권대차
              </h3>
              <p className="mt-1 break-words text-xs leading-relaxed text-[#526079]">
                서로 정의와 공표 시점이 다른 세 지표를 합치지 않고 각각 표시합니다.
              </p>
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
              <RatioSeriesCard id="short-sale-trading" ratio={evidence.shortSaleTrading} />
              <RatioSeriesCard id="reportable-short-position" ratio={evidence.reportableNetShortPosition} />
              <RatioSeriesCard id="securities-lending" ratio={evidence.securitiesLending} />
            </div>
          </section>
        </>
      ) : null}

      {evidence.warnings.length ? (
        <aside className="rounded-xl border border-[#DCE4F5] bg-white p-4" aria-labelledby="ticker-flow-warning-heading">
          <h3 className="text-sm font-bold text-[#0F172A]" id="ticker-flow-warning-heading">자료 상태 안내</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-[#526079]">
            {evidence.warnings.map((warning) => <li className="break-words" key={warning}>{warning}</li>)}
          </ul>
          {evidence.duplicateDatesRemoved > 0 ? (
            <p className="mt-2 text-xs text-[#526079]">동일 중복 일자 제거 {evidence.duplicateDatesRemoved}건</p>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
