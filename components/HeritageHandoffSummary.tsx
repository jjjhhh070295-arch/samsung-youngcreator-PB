"use client";

import { useEffect } from "react";
import type { Client, TransferEvent } from "@/lib/types";
import { CLIENT_TYPE_LABEL } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { eok } from "@/lib/heritage";
import type { HeritageAssessment, HeritageAssessmentInput, HeritagePaymentGapResult } from "@/lib/heritage";

interface Props {
  open: boolean;
  onClose: () => void;
  client: Client;
  input: HeritageAssessmentInput;
  assessment: HeritageAssessment;
  gap: HeritagePaymentGapResult | null;
  liquidAssetsWon: number;
}

// 세무사에게 그대로 인쇄·캡처해서 넘기는 화면. window.print()는 이 컴포넌트 안에서만
// heritage-print-mode 클래스를 body에 잠깐 붙였다 떼는 방식으로 이 카드 하나만 인쇄되게
// 한다(app/globals.css의 body.heritage-print-mode 규칙) — 기존 PDF 출력 허가 게이트는
// 건드리지 않는다(이 화면은 별도 승인 절차가 필요 없는 개략 자료 인계용).
export default function HeritageHandoffSummary({ open, onClose, client, input, assessment, gap, liquidAssetsWon }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handlePrint = () => {
    document.body.classList.add("heritage-print-mode");
    window.print();
    // 인쇄 다이얼로그는 동기적으로 막지 않으므로 다음 tick에 해제한다.
    setTimeout(() => document.body.classList.remove("heritage-print-mode"), 0);
  };

  const realEstateValueWon =
    input.realEstateWeightPct != null ? Math.round((input.assetSizeWon * input.realEstateWeightPct) / 100) : null;
  const debtWon = assessment.taxRange?.breakdown.debtWon ?? input.debtWon ?? 0;
  const recentGifts = (input.givenGiftEvents ?? []).slice().sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4 print:static print:bg-transparent print:p-0" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="heritage-print-area mx-auto my-6 w-full max-w-3xl rounded-2xl border border-border bg-white p-6 shadow-2xl print:my-0 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="decision-kicker">세무사 인계 요약</p>
            <h2 className="decision-title mt-1">{client.name} 고객 헤리티지 요약</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handlePrint} className="btn-primary text-sm">인쇄</button>
            <button type="button" onClick={onClose} className="btn-outline text-sm">닫기</button>
          </div>
        </div>

        <div className="mt-2 space-y-5 print:mt-0 print:space-y-4">
          <header className="hidden border-b border-border pb-3 print:block">
            <p className="text-xs font-bold uppercase tracking-wide text-[#1428A0]">세무사 인계 요약 · 개략 추정치</p>
            <h1 className="mt-1 text-xl font-black text-fg">{client.name} 고객 헤리티지(상속·증여) 상담 요약</h1>
            <p className="mt-1 text-xs text-fg-muted">작성일 {formatDate(new Date().toISOString())}</p>
          </header>

          {/* 1. 고객 기본정보 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">고객 기본정보</h3>
            <div className="decision-card mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><p className="text-[11px] text-fg-muted">식별코드</p><p className="mt-0.5 text-sm font-bold text-fg">{client.code}</p></div>
              <div><p className="text-[11px] text-fg-muted">이름</p><p className="mt-0.5 text-sm font-bold text-fg">{client.name}</p></div>
              <div><p className="text-[11px] text-fg-muted">구분</p><p className="mt-0.5 text-sm font-bold text-fg">{CLIENT_TYPE_LABEL[client.clientType]}</p></div>
              <div><p className="text-[11px] text-fg-muted">생년월일</p><p className="mt-0.5 text-sm font-bold text-fg">{client.birthDate ? formatDate(client.birthDate) : "미입력"}</p></div>
            </div>
          </section>

          {/* 2. 자산 구성 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">자산 구성</h3>
            <div className="decision-card mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><p className="text-[11px] text-fg-muted">총자산</p><p className="mt-0.5 text-sm font-bold text-fg">{eok(input.assetSizeWon)}</p></div>
              <div><p className="text-[11px] text-fg-muted">부동산</p><p className="mt-0.5 text-sm font-bold text-fg">{realEstateValueWon != null ? `${eok(realEstateValueWon)} (${input.realEstateWeightPct}%)` : "미입력"}</p></div>
              <div><p className="text-[11px] text-fg-muted">금융자산(현금성)</p><p className="mt-0.5 text-sm font-bold text-fg">{eok(liquidAssetsWon)}</p></div>
              <div><p className="text-[11px] text-fg-muted">채무</p><p className="mt-0.5 text-sm font-bold text-fg">{eok(debtWon)}</p></div>
            </div>
          </section>

          {/* 3. 가족관계 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">가족관계</h3>
            <div className="decision-card mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-fg-muted">배우자</p>
                <p className="mt-0.5 text-sm font-bold text-fg">
                  {input.hasSpouse == null ? "미입력(없음으로 가정)" : input.hasSpouse ? "있음" : "없음"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-fg-muted">자녀 수</p>
                <p className="mt-0.5 text-sm font-bold text-fg">
                  {input.childrenCount == null
                    ? `미입력(${assessment.taxRange?.childrenCountUsed ?? 2}명으로 가정)`
                    : `${input.childrenCount}명`}
                </p>
              </div>
            </div>
            {assessment.dataAssumptionsUsed && (
              <p className="mt-2 badge-warning inline-block">가족 정보 미입력 — 추정치입니다</p>
            )}
          </section>

          {/* 4. 10년 내 증여이력 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">10년 내 증여이력</h3>
            {recentGifts.length === 0 ? (
              <p className="decision-card mt-2 text-sm text-fg-muted">확인된 증여 이력이 없습니다.</p>
            ) : (
              <div className="decision-card mt-2 space-y-2">
                {recentGifts.map((g: TransferEvent) => (
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">{formatDate(g.eventDate)}</span>
                    <span className="font-bold text-fg">{eok(g.amount ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 5. 판정 근거 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">판정 근거</h3>
            <ul className="decision-card mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg">
              {assessment.demand.reasons.map((r, i) => <li key={`d-${i}`}>{r.text}</li>)}
            </ul>
          </section>

          {/* 6. 긴급도와 이유 */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">긴급도와 이유</h3>
            <div className="decision-card mt-2">
              <p className="text-sm font-black text-fg">{assessment.urgency.level}</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg">
                {assessment.urgency.reasons.map((r, i) => <li key={`u-${i}`}>{r.text}</li>)}
              </ul>
            </div>
          </section>

          {/* 7. 세액 구간과 공제 분해 */}
          {assessment.taxRange && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">예상 상속세 구간</h3>
              <div className="decision-card mt-2">
                <p className="text-xl font-black text-fg">
                  {eok(assessment.taxRange.minTaxWon)} ~ {eok(assessment.taxRange.maxTaxWon)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <div><p className="text-fg-muted">순자산</p><p className="font-bold text-fg">{eok(assessment.taxRange.breakdown.netAssetWon)}</p></div>
                  <div><p className="text-fg-muted">10년 내 증여 합산</p><p className="font-bold text-fg">{eok(assessment.taxRange.giftAddBackWon)}</p></div>
                  <div><p className="text-fg-muted">기초/일괄공제</p><p className="font-bold text-fg">{eok(assessment.taxRange.breakdown.baseOrPersonalDeductionWon)} ({assessment.taxRange.breakdown.usedBlanket ? "일괄" : "기초+인적"})</p></div>
                  <div><p className="text-fg-muted">배우자공제(상한 시나리오)</p><p className="font-bold text-fg">{eok(assessment.taxRange.breakdown.spouseDeductionForMaxTaxWon)}</p></div>
                  <div><p className="text-fg-muted">배우자공제(하한 시나리오)</p><p className="font-bold text-fg">{eok(assessment.taxRange.breakdown.spouseDeductionForMinTaxWon)}</p></div>
                  <div><p className="text-fg-muted">과세표준(상한~하한)</p><p className="font-bold text-fg">{eok(assessment.taxRange.breakdown.minTaxBaseWon)} ~ {eok(assessment.taxRange.breakdown.maxTaxBaseWon)}</p></div>
                </div>
                {gap && (
                  <p className="mt-3 border-t border-border pt-3 text-sm text-fg">
                    {gap.reasons.find((r) => r.code.startsWith("payment_gap"))?.text}
                  </p>
                )}
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  {assessment.taxRange.disclaimer}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
