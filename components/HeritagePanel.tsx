"use client";

import { useEffect, useState } from "react";
import type { Client } from "@/lib/types";
import {
  listOwnershipRelationshipsBulk,
  listFamilyRelationshipsBulk,
  listRealEstateWithDebtBulk,
  listGiftEventsBulk,
  createHeritageMeetingRequest,
  listHeritageMeetingRequests,
} from "@/lib/store";
import { listBookHoldings } from "@/lib/advisory/holdingsStore";
import type { BookHolding } from "@/lib/advisory/types";
import {
  resolveHeritageInputsBulk,
  assessHeritage,
  computePaymentGap,
  flagBusinessSuccessionReview,
  eok,
} from "@/lib/heritage";
import type {
  HeritageAssessment,
  HeritageAssessmentInput,
  HeritagePaymentGapResult,
  HeritageUrgencyLevel,
  BusinessSuccessionFlag,
} from "@/lib/heritage";
import type { HeritageMeetingRequest } from "@/lib/types";
import { expertForHeritage } from "@/lib/wmExperts";
import { formatDate } from "@/lib/format";
import MeetingBookingModal from "./MeetingBookingModal";
import HeritageHandoffSummary from "./HeritageHandoffSummary";

interface Props {
  client: Client;
  allClients: Client[];
  pbId: string;
}

const URGENCY_BADGE_CLASS: Record<HeritageUrgencyLevel, string> = {
  "즉시": "badge-danger",
  "3개월 내": "badge-warning",
  "6개월 내": "badge-warning",
  "1년 내": "badge-success",
  "해당없음": "badge-muted",
};

export default function HeritagePanel({ client, allClients, pbId }: Props) {
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<HeritageAssessmentInput | null>(null);
  const [assessment, setAssessment] = useState<HeritageAssessment | null>(null);
  const [gap, setGap] = useState<HeritagePaymentGapResult | null>(null);
  const [liquidAssetsWon, setLiquidAssetsWon] = useState(0);
  // 인계 요약의 종목별 표에 쓴다. 합계만으로는 세무사가 재산 목록을 못 만든다.
  const [clientHoldings, setClientHoldings] = useState<BookHolding[]>([]);
  // 채무 0원이 "무차입"인지 "미입력"인지 인계 요약이 구분할 수 있게 원자료 개수를 넘긴다.
  const [debtInfo, setDebtInfo] = useState<{ propertyCount: number; debtRecordCount: number }>({ propertyCount: 0, debtRecordCount: 0 });
  const [successionFlag, setSuccessionFlag] = useState<BusinessSuccessionFlag | null>(null);
  const [meetings, setMeetings] = useState<HeritageMeetingRequest[]>([]);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [ownershipRelationships, familyRelationships, realEstate, giftEvents, holdings, meetingList] =
          await Promise.all([
            listOwnershipRelationshipsBulk([client.id]),
            listFamilyRelationshipsBulk([client.id]),
            listRealEstateWithDebtBulk([client.id]),
            listGiftEventsBulk([client.id]),
            listBookHoldings([client.id]),
            listHeritageMeetingRequests(client.id),
          ]);
        if (cancelled) return;

        const { heritageInputs, successionSignals } = resolveHeritageInputsBulk({
          allClients,
          targetClientIds: [client.id],
          ownershipRelationships,
          familyRelationships,
          realEstate,
          giftEvents,
          asOf: new Date(),
        });

        const resolvedInput = heritageInputs.get(client.id) ?? null;
        setInput(resolvedInput);
        setMeetings(meetingList);

        if (!resolvedInput) {
          setAssessment(null);
          setGap(null);
          setSuccessionFlag(null);
          return;
        }

        const result = assessHeritage(resolvedInput);
        const mine = holdings.filter((h) => h.clientId === client.id);
        const liquid = mine.reduce((s, h) => s + h.evalAmount, 0);
        setClientHoldings(mine);
        const myProps = realEstate.properties.filter((p) => p.ownerPartyId === client.id);
        setDebtInfo({
          propertyCount: myProps.length,
          debtRecordCount: myProps.filter((p) => realEstate.debtByPropertyId.has(p.id)).length,
        });
        const gapResult = result.taxRange
          ? computePaymentGap({ liquidAssetsWon: liquid, minTaxWon: result.taxRange.minTaxWon, maxTaxWon: result.taxRange.maxTaxWon })
          : null;
        const signal = successionSignals.get(client.id);

        setAssessment(result);
        setLiquidAssetsWon(liquid);
        setGap(gapResult);
        setSuccessionFlag(signal ? flagBusinessSuccessionReview(signal) : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [client.id, allClients]);

  const expert = expertForHeritage();

  const handleConfirmBooking = async (label: string) => {
    await createHeritageMeetingRequest({
      clientId: client.id,
      pbId,
      expertId: expert.id,
      expertName: expert.name,
      requestedLabel: label,
    });
    setNotice(`예약 요청이 접수되었습니다. ${label}`);
    const updated = await listHeritageMeetingRequests(client.id);
    setMeetings(updated);
  };

  if (loading) {
    return <div className="console-panel p-5 text-sm text-fg-muted">헤리티지 판정을 불러오는 중…</div>;
  }

  if (client.clientType !== "individual" || !input) {
    return (
      <div className="decision-card">
        <p className="decision-kicker">헤리티지(신탁·상속·증여)</p>
        <p className="decision-copy mt-2">법인 고객은 상속·증여 개인 상담 트랙과 별도로 다룹니다.</p>
      </div>
    );
  }

  const { demand, urgency, taxRange, dataAssumptionsUsed } = assessment!;

  return (
    <div className="decision-section">
      {/* 가정 배지 — 화면 최상단, 절대 숨기지 않는다 */}
      {dataAssumptionsUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="badge-warning">가족 정보 미입력 — 추정치입니다</span>
          <p className="mt-2 text-xs text-amber-800">
            {demand.hasSpouseAssumed && "배우자 유무를 확인할 수 없어 '없음'으로 가정했습니다. "}
            {demand.childrenCountAssumed && `자녀 수를 확인할 수 없어 ${taxRange?.childrenCountUsed ?? 2}명으로 가정했습니다. `}
            관계 네트워크 탭에서 가족관계를 입력하면 더 정확한 판정을 받을 수 있습니다.
          </p>
        </div>
      )}

      {/* 1. 판정 결과와 긴급도 */}
      <section className="decision-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="decision-kicker">헤리티지(신탁·상속·증여) 판정</p>
            <h3 className="decision-title mt-1">{demand.hasNeed ? "상담 수요 있음" : "현재는 상담 수요 낮음"}</h3>
          </div>
          <span className={URGENCY_BADGE_CLASS[urgency.level]}>{urgency.level}</span>
        </div>
        {successionFlag?.flagged && (
          <p className="mt-3 rounded-lg bg-[#F2F5FF] px-3 py-2 text-xs font-semibold text-[#1428A0]">
            {successionFlag.reason}
          </p>
        )}
      </section>

      {/* 2. 판정 근거 문장들 */}
      <section className="decision-card">
        <p className="decision-kicker">판정 근거</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg">
          {demand.reasons.map((r, i) => <li key={`d-${i}`}>{r.text}</li>)}
        </ul>
        {urgency.reasons.length > 0 && (
          <>
            <p className="decision-kicker mt-4">긴급도 근거</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg">
              {urgency.reasons.map((r, i) => <li key={`u-${i}`}>{r.text}</li>)}
            </ul>
          </>
        )}
      </section>

      {/* 3. 예상 상속세 구간 + 공제 내역 분해 */}
      {taxRange && (
        <section className="decision-card">
          <p className="decision-kicker">예상 상속세 구간</p>
          <p className="metric-value mt-1">{eok(taxRange.minTaxWon)} ~ {eok(taxRange.maxTaxWon)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div className="console-metric"><p className="console-label">순자산</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.breakdown.netAssetWon)}</p></div>
            <div className="console-metric"><p className="console-label">10년 내 증여 합산</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.giftAddBackWon)}</p></div>
            <div className="console-metric"><p className="console-label">기초/일괄공제</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.breakdown.baseOrPersonalDeductionWon)} <span className="text-fg-muted">({taxRange.breakdown.usedBlanket ? "일괄" : "기초+인적"})</span></p></div>
            <div className="console-metric"><p className="console-label">배우자공제(상한)</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.breakdown.spouseDeductionForMaxTaxWon)}</p></div>
            <div className="console-metric"><p className="console-label">배우자공제(하한)</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.breakdown.spouseDeductionForMinTaxWon)}</p></div>
            <div className="console-metric"><p className="console-label">과세표준(하한~상한)</p><p className="mt-1 text-sm font-bold text-fg">{eok(taxRange.breakdown.minTaxBaseWon)} ~ {eok(taxRange.breakdown.maxTaxBaseWon)}</p></div>
          </div>
          {taxRange.reasons.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-fg-muted">
              {taxRange.reasons.map((r, i) => <li key={`t-${i}`}>{r.text}</li>)}
            </ul>
          )}
          {/* 절대 숨기거나 축소하지 않는다 */}
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">
            ⚠ {taxRange.disclaimer}
          </p>
        </section>
      )}

      {/* 4. 납부재원 갭 + 근거 문장 */}
      {gap && (
        <section className="decision-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="decision-kicker">납부재원 갭</p>
            <span className={gap.certainty === "sufficient" ? "badge-success" : gap.certainty === "uncertain" ? "badge-warning" : "badge-danger"}>
              {gap.certainty === "sufficient" ? "재원 충분" : gap.certainty === "uncertain" ? "확인 필요" : "재원 부족"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {/* "현금성 자산"이라고 부르던 값이다. 실제로는 listBookHoldings 가 돌려주는
                Σ(수량 × 평균매입단가) — client_holdings 에서 avg_price 만 읽고 lastPrice 를
                null 로 두기 때문에 evalAmount 가 취득원가로 떨어진다. 예금·보험은 애초에
                이 테이블에 없다. 갭 계산의 분모라 오해하면 납부재원 판단이 통째로 틀어진다. */}
            <div className="console-metric">
              <p className="console-label">보유종목 취득원가</p>
              <p className="mt-1 text-sm font-bold text-fg">{eok(gap.liquidAssetsWon)}</p>
              <p className="text-[10px] font-semibold text-amber-700">시가 아님 · 예금 미포함</p>
            </div>
            <div className="console-metric"><p className="console-label">갭(하한 기준)</p><p className="mt-1 text-sm font-bold text-fg">{eok(gap.minGapWon)}</p></div>
            <div className="console-metric"><p className="console-label">갭(상한 기준·최악)</p><p className="mt-1 text-sm font-bold text-fg">{eok(gap.maxGapWon)}</p></div>
          </div>
          <p className="mt-3 text-sm text-fg">{gap.reasons.find((r) => r.code.startsWith("payment_gap"))?.text}</p>
        </section>
      )}

      {/* 5. 전문가 핸드오프 */}
      <section className="decision-card">
        <p className="decision-kicker">전문가 연결</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-fg">{expert.name} · {expert.title}</p>
            <p className="mt-1 text-xs text-fg-muted">{expert.specialties.join(" · ")} · {expert.phone}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-outline text-sm" onClick={() => setSummaryOpen(true)}>세무사 인계 요약 보기</button>
            <button type="button" className="btn-primary text-sm" onClick={() => setBookingOpen(true)}>상담 예약</button>
          </div>
        </div>
        {notice && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p>}
        {meetings.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs">
                <span className="text-fg">{m.expertName} · {m.requestedLabel}</span>
                <span className="text-fg-muted">{formatDate(m.createdAt)} 요청</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MeetingBookingModal
        expert={bookingOpen ? expert : null}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onConfirm={handleConfirmBooking}
      />

      {assessment && (
        <HeritageHandoffSummary
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          client={client}
          input={input}
          assessment={assessment}
          gap={gap}
          liquidAssetsWon={liquidAssetsWon}
          holdings={clientHoldings}
          realEstateDebtInfo={debtInfo}
        />
      )}
    </div>
  );
}
