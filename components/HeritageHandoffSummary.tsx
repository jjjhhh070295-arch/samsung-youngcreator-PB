"use client";

import { useEffect } from "react";
import type { Client, TransferEvent } from "@/lib/types";
import type { BookHolding } from "@/lib/advisory/types";
import type { RealEstateHandoffItem } from "@/lib/realestate/handoffDetail";
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
  /**
   * 이 고객의 보유종목. 합계(liquidAssetsWon)만으로는 세무사가 재산 목록을 만들 수 없어
   * 종목별로도 싣는다 — 호출부가 이미 listBookHoldings 로 읽어 둔 값을 그대로 넘긴다.
   * 넘기지 않으면 종목 표만 빠지고 나머지는 그대로 동작한다.
   */
  holdings?: BookHolding[];
  /**
   * 채무 0원이 "무차입"인지 "미입력"인지 구분하기 위한 원자료 개수.
   *
   * debtWon 값만으로는 둘을 구분할 수 없다. client_real_estate_debt 는 현재 전 행이
   * 비어 있어(2026-09-06 실측 0건) 모든 고객의 채무가 0원으로 인계되는데, 채무는
   * 상속세 과세가액에서 차감되는 핵심 항목이라 "빚이 없다"로 읽히면 세액이 과대 추정된다.
   * 부동산은 있는데 채무 기록이 하나도 없으면 그 사실을 문서에 적는다.
   */
  realEstateDebtInfo?: { propertyCount: number; debtRecordCount: number };
  /**
   * 부동산 물건별 명세. 상속재산 평가는 물건 하나하나에 대해 기준시가·매매사례가 중
   * 무엇을 쓸지 판단해야 해서, 합계 한 줄로는 세무사가 시작조차 할 수 없다.
   * 넘기지 않으면 물건 표만 빠진다.
   */
  realEstateItems?: RealEstateHandoffItem[];
}

/** 값이 없으면 "미입력"으로. 0 과 null 을 구분해 찍는다. */
function wonOrMissing(won: number | null): string {
  return won == null ? "미입력" : eok(won);
}

// 세무사에게 그대로 인쇄·캡처해서 넘기는 화면. window.print()는 이 컴포넌트 안에서만
// heritage-print-mode 클래스를 body에 잠깐 붙였다 떼는 방식으로 이 카드 하나만 인쇄되게
// 한다(app/globals.css의 body.heritage-print-mode 규칙) — 기존 PDF 출력 허가 게이트는
// 건드리지 않는다(이 화면은 별도 승인 절차가 필요 없는 개략 자료 인계용).
export default function HeritageHandoffSummary({ open, onClose, client, input, assessment, gap, liquidAssetsWon, holdings, realEstateDebtInfo, realEstateItems }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 브라우저는 "PDF로 저장" 시 파일명을 document.title 에서 가져온다. 인쇄 직전에만
  // 바꿨다가 되돌려서, 기본값("삼성증권 PB센터 · 상담 지원")이 파일명이 되지 않게 한다.
  const handlePrint = () => {
    const previousTitle = document.title;
    const now = new Date();
    const stamp =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, "0")}` +
      `${String(now.getDate()).padStart(2, "0")}`;
    document.title = `세무사인계요약_${client.name}_${stamp}`;
    document.body.classList.add("heritage-print-mode");

    // afterprint 가 정식 복구 신호다. 이 이벤트를 쏘지 않거나 print() 가 즉시 반환하는
    // 브라우저를 위해 타이머로 한 번 더 시도한다(restored 플래그로 중복 복구를 막는다).
    // heritage-print-mode 는 @media print 안에서만 쓰이므로 복구가 늦어도 화면에는 영향이 없고,
    // 파일명은 미리보기가 열리는 시점에 확정되므로 그 뒤에 되돌려도 안전하다.
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.body.classList.remove("heritage-print-mode");
      document.title = previousTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 2000);
  };

  const realEstateValueWon =
    input.realEstateWeightPct != null ? Math.round((input.assetSizeWon * input.realEstateWeightPct) / 100) : null;
  // realEstateWeightPct 는 (부동산시가 / 총자산) × 100 을 반올림 없이 담고 있어, 그대로
  // 찍으면 "8.447142857142858%" 처럼 나온다. 종이에 그 자릿수가 남을 이유가 없다.
  // 금액(realEstateValueWon)은 반올림한 이 값이 아니라 원래 실수로 역산하므로 오차가 없다.
  const realEstateWeightLabel =
    input.realEstateWeightPct != null ? `${input.realEstateWeightPct.toFixed(1)}%` : null;
  const debtWon = assessment.taxRange?.breakdown.debtWon ?? input.debtWon ?? 0;
  // 채무 0원의 의미를 셋으로 나눈다. 금액만 보면 "빚이 없다"로 읽히는데, 실제로는
  // client_real_estate_debt 에 행이 없어서 0인 경우가 대부분이다(2026-09-06 기준 전 행 0건).
  // 채무는 상속세 과세가액에서 차감되는 항목이라, 없는 것과 모르는 것을 섞으면 세액이
  // 과대 추정된다.
  //   recorded   — 채무 기록이 실제로 있다(금액이 0이든 아니든 입력된 값이다)
  //   missing    — 부동산은 있는데 채무 기록이 하나도 없다 → 미입력일 가능성이 높다
  //   no_property— 부동산 자체가 없다 → 부동산 담보채무가 없는 게 자연스럽다
  //   unknown    — 호출부가 원자료 개수를 넘기지 않았다(구분 불가)
  const debtStatus: "recorded" | "missing" | "no_property" | "unknown" =
    !realEstateDebtInfo
      ? "unknown"
      : realEstateDebtInfo.debtRecordCount > 0
        ? "recorded"
        : realEstateDebtInfo.propertyCount > 0
          ? "missing"
          : "no_property";
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
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex gap-2">
              <button type="button" onClick={handlePrint} className="btn-primary text-sm">
                PDF로 저장 · 인쇄
              </button>
              <button type="button" onClick={onClose} className="btn-outline text-sm">닫기</button>
            </div>
            <p className="text-right text-[11px] leading-relaxed text-fg-muted">
              인쇄 대화상자에서 &lsquo;대상&rsquo;을 &lsquo;PDF로 저장&rsquo;으로 선택하세요.
            </p>
          </div>
        </div>

        <div className="mt-2 space-y-5 print:mt-0 print:space-y-4">
          <header className="hidden border-b border-border pb-3 print:block">
            <p className="text-xs font-bold uppercase tracking-wide text-[#1428A0]">세무사 인계 요약 · 개략 추정치</p>
            <h1 className="mt-1 text-xl font-black text-fg">{client.name} 고객 헤리티지(상속·증여) 상담 요약</h1>
            <p className="mt-1 text-xs text-fg-muted">작성일 {formatDate(new Date().toISOString())}</p>
            {/* 취급 등급 — 인쇄물만 보고도 고객에게 건네면 안 되는 문서임을 알 수 있어야 한다. */}
            <p className="mt-2 border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-black tracking-wide text-red-700">
              내부 참고용 · 개략 추정치 · 고객 전달 금지
            </p>
          </header>

          {/* 문서 최상단 고지 — 화면·인쇄 양쪽에 항상 보인다. 세액 구간에 붙은 disclaimer 와
              달리 이건 문서 전체의 성격을 규정하므로 맨 위에 둔다. */}
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-900">
            이 자료는 세무 신고·자문의 근거가 아니며 모든 수치는 세무사가 원자료로 재확인해야 합니다.
          </p>

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
              <div><p className="text-[11px] text-fg-muted">부동산</p><p className="mt-0.5 text-sm font-bold text-fg">{realEstateValueWon != null ? `${eok(realEstateValueWon)} (${realEstateWeightLabel})` : "미입력"}</p></div>
              <div>
                <p className="text-[11px] text-fg-muted">보유종목 취득원가 합계</p>
                <p className="mt-0.5 text-sm font-bold text-fg">{eok(liquidAssetsWon)}</p>
                <p className="text-[10px] font-semibold text-amber-700">시가 아님</p>
              </div>
              <div>
                <p className="text-[11px] text-fg-muted">채무</p>
                {/* 미입력 가능성이 높을 때는 금액 대신 그 사실을 쓴다. "0억원"이라고 적어 두면
                    세무사가 무차입으로 읽어 버리고, 그 오해를 되돌릴 단서가 문서에 없다. */}
                {debtStatus === "missing" ? (
                  <p className="mt-0.5 text-sm font-bold text-amber-700">미입력</p>
                ) : (
                  <p className="mt-0.5 text-sm font-bold text-fg">{eok(debtWon)}</p>
                )}
                {debtStatus === "missing" && (
                  <p className="text-[10px] font-semibold text-amber-700">채무 기록 없음</p>
                )}
                {debtStatus === "no_property" && (
                  <p className="text-[10px] text-fg-muted">부동산 없음</p>
                )}
                {debtStatus === "unknown" && (
                  <p className="text-[10px] text-fg-muted">확인 필요</p>
                )}
              </div>
            </div>
            {debtStatus === "missing" && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                <span className="font-bold">부동산 {realEstateDebtInfo?.propertyCount}건이 등록돼 있으나 채무 기록은 한 건도 없습니다.</span>{" "}
                무차입인지 아직 입력하지 않은 것인지 이 자료로는 구분할 수 없습니다. 담보대출·임대보증금 등
                채무는 상속세 과세가액에서 차감되는 항목이므로 반드시 확인해 주십시오.
              </p>
            )}
            {debtStatus === "unknown" && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                채무 금액이 입력값인지 미입력인지 확인되지 않았습니다. 원자료로 재확인해 주십시오.
              </p>
            )}
            {/* 라벨이 "금융자산(현금성)"이던 시절, 이 값은 실제로는 Σ(수량 × 평균매입단가)였다.
                listBookHoldings 가 client_holdings 에서 quantity·avg_price 만 읽고 lastPrice 를
                null 로 두기 때문에 evalAmount 가 avgPrice 로 폴백한다(current_price 컬럼은
                테이블에 있으나 비어 있다). 세무사가 이 숫자를 시가로 읽으면 과세표준이
                통째로 틀어지므로, 무엇인지 문서에 명시한다. */}
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              <span className="font-bold">보유종목 금액은 취득원가(수량 × 평균매입단가) 합계입니다.</span>{" "}
              현재 시세가 반영되지 않았고, 예금·보험·퇴직금 등 다른 금융재산은 포함돼 있지 않습니다.
              상속세 과세가액은 <span className="font-bold">상속개시일 현재의 시가</span>로 평가해야 하므로,
              이 금액을 그대로 쓰지 마시고 평가기준일 시세로 재산정해 주십시오.
            </p>
          </section>

          {/* 2-0. 부동산 물건별 내역 — 상속재산 평가는 물건 단위로 한다. 기준시가로 갈지
              매매사례가로 갈지가 물건마다 다르므로 소재지·면적·공시가격·취득내역이 필요하다.
              합계 한 줄로는 세무사가 평가를 시작할 수 없다. */}
          {realEstateItems && realEstateItems.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">
                부동산 물건별 내역 ({realEstateItems.length}건)
              </h3>
              <div className="decision-card mt-2 space-y-3">
                {realEstateItems.map((p, i) => (
                  <div key={p.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-fg">
                        {i + 1}. {p.complexName ?? p.address ?? "물건명 미입력"}
                        {p.propertyType && (
                          <span className="ml-1.5 text-[10px] font-semibold text-fg-muted">{p.propertyType}</span>
                        )}
                        {/* 공동소유면 지분율을 밝힌다 — 상속재산은 지분만큼만 잡힌다. */}
                        {p.ownershipShare !== 1 && (
                          <span className="ml-1.5 text-[10px] font-bold text-amber-700">
                            지분 {(p.ownershipShare * 100).toFixed(1)}%
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      소재지 {p.address ?? "미입력"}
                      {p.areaM2 != null && ` · 면적 ${p.areaM2}㎡`}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-3">
                      <div>
                        <span className="text-fg-muted">시가</span>{" "}
                        <span className="font-bold text-fg">{wonOrMissing(p.marketValueWon)}</span>
                        {p.marketSource && (
                          <span className="ml-1 text-[10px] text-fg-muted">({p.marketSource})</span>
                        )}
                      </div>
                      <div>
                        <span className="text-fg-muted">공시가격</span>{" "}
                        <span className={`font-bold ${p.officialPriceWon == null ? "text-amber-700" : "text-fg"}`}>
                          {wonOrMissing(p.officialPriceWon)}
                        </span>
                      </div>
                      <div>
                        <span className="text-fg-muted">담보채무</span>{" "}
                        <span className={`font-bold ${p.debtWon == null ? "text-amber-700" : "text-fg"}`}>
                          {wonOrMissing(p.debtWon)}
                        </span>
                      </div>
                      <div>
                        <span className="text-fg-muted">취득일</span>{" "}
                        <span className="font-bold text-fg">{p.acquiredAt ? formatDate(p.acquiredAt) : "미입력"}</span>
                      </div>
                      <div>
                        <span className="text-fg-muted">취득가</span>{" "}
                        <span className="font-bold text-fg">{wonOrMissing(p.acquiredPriceWon)}</span>
                      </div>
                      <div>
                        <span className="text-fg-muted">임대보증금</span>{" "}
                        <span className="font-bold text-fg">{wonOrMissing(p.depositWon)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* 공시가격이 하나라도 비면 기준시가 평가를 이 자료로는 할 수 없다.
                  임대보증금도 채무성 공제 대상이라 함께 짚는다. */}
              {realEstateItems.some((p) => p.officialPriceWon == null || p.depositWon == null) && (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  <span className="font-bold">공시가격 또는 임대보증금이 입력되지 않은 물건이 있습니다.</span>{" "}
                  공시가격은 기준시가 평가의 기초이고 임대보증금은 반환 의무가 있어 채무성 공제 대상이 될 수 있으므로,
                  등기부·공시가격 열람으로 원자료를 확인해 주십시오. 시가는 국토부 실거래가에서 조회한 참고값입니다.
                </p>
              )}
            </section>
          )}

          {/* 2-1. 보유종목 내역 — 합계 한 줄로는 세무사가 재산 목록을 만들 수 없다.
              client_holdings 에 종목명·티커·수량·단가가 이미 있으므로 그대로 싣는다.
              금액은 여기서도 취득원가다(수량 × 평균매입단가) — 위 각주와 같은 한계다. */}
          {holdings && holdings.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-fg-muted">보유종목 내역 (취득원가 기준)</h3>
              <div className="decision-card mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-fg-muted">
                      <th className="py-1.5 pr-2 font-semibold">종목명</th>
                      <th className="py-1.5 pr-2 font-semibold">종목코드</th>
                      <th className="py-1.5 pr-2 text-right font-semibold">수량</th>
                      <th className="py-1.5 pr-2 text-right font-semibold">평균매입단가</th>
                      <th className="py-1.5 text-right font-semibold">취득원가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr key={h.id} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 pr-2 font-semibold text-fg">
                          {h.name}
                          {/* 원화가 아니면 통화를 밝힌다 — 단가·취득원가의 단위가 달라진다. */}
                          {h.currency && h.currency !== "KRW" && (
                            <span className="ml-1 text-[10px] font-bold text-amber-700">{h.currency}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-fg-muted">{h.ticker ?? "미입력"}</td>
                        <td className="py-1.5 pr-2 text-right text-fg">{h.quantity.toLocaleString("ko-KR")}</td>
                        <td className="py-1.5 pr-2 text-right text-fg">
                          {h.avgPrice == null ? "미입력" : h.avgPrice.toLocaleString("ko-KR")}
                        </td>
                        <td className="py-1.5 text-right font-bold text-fg">{eok(h.evalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="py-1.5 pr-2 font-bold text-fg" colSpan={4}>합계</td>
                      <td className="py-1.5 text-right font-black text-fg">{eok(liquidAssetsWon)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* 외화 종목이 섞이면 합계가 통화를 섞어 더한 값이 된다. 세무사가 그대로
                  쓰면 안 되므로, 실제로 섞였을 때만 경고한다. */}
              {holdings.some((h) => h.currency && h.currency !== "KRW") && (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                  외화 종목이 포함돼 있습니다. 합계는 환산 없이 단순 합산한 값이므로 평가기준일 환율로 재환산해야 합니다.
                </p>
              )}
            </section>
          )}

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
                {/* 자산 구성에는 "채무 미입력"이라 적어 놓고 세액은 채무 0 으로 계산된
                    값을 나란히 두면, 둘을 함께 본 세무사가 어느 쪽을 믿어야 할지 알 수 없다.
                    계산 자체는 lib/heritage/tax.ts 소관이라 바꾸지 않고, 무엇을 전제로 나온
                    숫자인지 세액 옆에 밝힌다. 채무가 실제로 있으면 이 구간은 과대 추정이다. */}
                {debtStatus === "missing" && (
                  <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold leading-relaxed text-red-700">
                    이 세액 구간은 <span className="underline">채무를 0원으로 놓고</span> 계산된 값입니다.
                    위 자산 구성의 채무가 미입력 상태이며, 채무가 실제로 있다면 과세가액이 줄어
                    세액도 이보다 낮아집니다.
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
