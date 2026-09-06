"use client";

// 세무 전문가 핸드오프 블록 — 세전·세후 탭 마지막에 붙는다.
//
// HeritagePanel 의 5번 섹션(전문가 연결)만 떼어낸 것이다. 판정 결과·판정 근거·세액 구간·
// 납부재원 갭 카드는 여기서 렌더하지 않는다 — 이 탭의 주제는 세금 계산이고, 이 블록의
// 역할은 "그래서 전문가에게 넘긴다" 하나로 좁힌다.
// 다만 [세무사 인계 요약]으로 여는 인쇄물(HeritageHandoffSummary)은 기존 문서를 그대로
// 재사용하므로 그 안에는 세액 구간·납부재원 갭이 계속 들어간다 — 세무사가 받아야 할
// 자료이기 때문이고, 화면 블록에 카드로 노출하지 않는다는 것과는 별개다.
//
// props 를 client 하나로 둔 이유: TaxProjectionPanel 은 팀원이 최근 2주 내 수정한 파일이라
// 접촉면을 최소로 해야 한다. allClients 는 listClients() 로, pbId 는 useParams() 로 이
// 컴포넌트가 직접 조달해서, 삽입 지점은 import 1줄 + JSX 1줄로 끝난다.
//
// 대상: 개인 고객만. 법인은 상속·증여 개인 상담 트랙과 별도라 아무것도 렌더하지 않는다.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Client } from "@/lib/types";
import type { HeritageMeetingRequest } from "@/lib/types";
import {
  listClients,
  listOwnershipRelationshipsBulk,
  listFamilyRelationshipsBulk,
  listRealEstateWithDebtBulk,
  listGiftEventsBulk,
  createHeritageMeetingRequest,
  listHeritageMeetingRequests,
} from "@/lib/store";
import { listBookHoldings } from "@/lib/advisory/holdingsStore";
import type { BookHolding } from "@/lib/advisory/types";
import { resolveHeritageInputsBulk, assessHeritage, computePaymentGap } from "@/lib/heritage";
import type { HeritageAssessment, HeritageAssessmentInput, HeritagePaymentGapResult } from "@/lib/heritage";
import { expertForHeritage } from "@/lib/wmExperts";
import { formatDate } from "@/lib/format";
import MeetingBookingModal from "./MeetingBookingModal";
import HeritageHandoffSummary from "./HeritageHandoffSummary";

export default function HeritageHandoffBlock({ client }: { client: Client }) {
  const params = useParams();
  const pbId = (params?.pbId as string | undefined) ?? "";

  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<HeritageAssessmentInput | null>(null);
  const [assessment, setAssessment] = useState<HeritageAssessment | null>(null);
  const [gap, setGap] = useState<HeritagePaymentGapResult | null>(null);
  const [liquidAssetsWon, setLiquidAssetsWon] = useState(0);
  // 인계 요약의 종목별 표에 쓴다. 합계만으로는 세무사가 재산 목록을 못 만든다.
  const [clientHoldings, setClientHoldings] = useState<BookHolding[]>([]);
  // 채무 0원이 "무차입"인지 "미입력"인지 인계 요약이 구분할 수 있게 원자료 개수를 넘긴다.
  const [debtInfo, setDebtInfo] = useState<{ propertyCount: number; debtRecordCount: number }>({ propertyCount: 0, debtRecordCount: 0 });
  const [meetings, setMeetings] = useState<HeritageMeetingRequest[]>([]);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (client.clientType !== "individual") {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [allClients, ownershipRelationships, familyRelationships, realEstate, giftEvents, holdings, meetingList] =
          await Promise.all([
            listClients(),
            listOwnershipRelationshipsBulk([client.id]),
            listFamilyRelationshipsBulk([client.id]),
            listRealEstateWithDebtBulk([client.id]),
            listGiftEventsBulk([client.id]),
            listBookHoldings([client.id]),
            listHeritageMeetingRequests(client.id),
          ]);
        if (cancelled) return;

        const { heritageInputs } = resolveHeritageInputsBulk({
          allClients,
          targetClientIds: [client.id],
          ownershipRelationships,
          familyRelationships,
          realEstate,
          giftEvents,
          asOf: new Date(),
        });

        const resolved = heritageInputs.get(client.id) ?? null;
        setMeetings(meetingList);
        if (!resolved) {
          setInput(null);
          setAssessment(null);
          return;
        }

        const result = assessHeritage(resolved);
        const mine = holdings.filter((h) => h.clientId === client.id);
        const liquid = mine.reduce((s, h) => s + h.evalAmount, 0);
        setClientHoldings(mine);
        const myProps = realEstate.properties.filter((p) => p.ownerPartyId === client.id);
        setDebtInfo({
          propertyCount: myProps.length,
          debtRecordCount: myProps.filter((p) => realEstate.debtByPropertyId.has(p.id)).length,
        });

        setInput(resolved);
        setAssessment(result);
        setLiquidAssetsWon(liquid);
        setGap(
          result.taxRange
            ? computePaymentGap({
                liquidAssetsWon: liquid,
                minTaxWon: result.taxRange.minTaxWon,
                maxTaxWon: result.taxRange.maxTaxWon,
              })
            : null,
        );
      } catch {
        // 조회 실패는 블록을 숨기는 것으로 처리 — 세전·세후 탭 본문을 막지 않는다.
        if (!cancelled) {
          setInput(null);
          setAssessment(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [client.id, client.clientType]);

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
    setMeetings(await listHeritageMeetingRequests(client.id));
  };

  if (client.clientType !== "individual") return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 border-b border-border pb-3">
        <h3 className="text-sm font-black text-fg">세무 전문가 핸드오프</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          이 화면은 절세 실행안을 제안하지 않습니다. 상속·증여 판정 결과를 정리해 WM센터 세무전문가에게
          넘기고 상담 일정을 잡습니다.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-fg-muted">전문가 정보를 불러오는 중…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-2 p-4">
            <div>
              <p className="text-sm font-bold text-fg">
                {expert.name} · {expert.title}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {expert.specialties.join(" · ")} · {expert.phone}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline text-sm"
                disabled={!assessment || !input}
                onClick={() => setSummaryOpen(true)}
              >
                세무사 인계 요약 보기
              </button>
              <button type="button" className="btn-primary text-sm" onClick={() => setBookingOpen(true)}>
                상담 예약
              </button>
            </div>
          </div>

          {!assessment && (
            <p className="mt-3 text-xs text-fg-muted">
              인계 요약을 만들 판정 데이터를 불러오지 못했습니다. 상담 예약은 그대로 가능합니다.
            </p>
          )}

          {notice && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p>
          )}

          {meetings.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
              {meetings.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-xs">
                  <span className="text-fg">
                    {m.expertName} · {m.requestedLabel}
                  </span>
                  <span className="text-fg-muted">{formatDate(m.createdAt)} 요청</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <MeetingBookingModal
        expert={bookingOpen ? expert : null}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onConfirm={handleConfirmBooking}
      />

      {assessment && input && (
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
    </section>
  );
}
