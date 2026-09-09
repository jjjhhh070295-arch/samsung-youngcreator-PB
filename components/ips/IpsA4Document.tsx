"use client";

import React from "react";
import type { ApprovedInstrument, Client, Portfolio } from "@/lib/types";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL, FACTOR_META } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import { buildPortfolioViewModel, resolvePortfolioDisplayAllocations } from "@/lib/portfolio";
import { isLegacyIncompletePortfolio, portfolioHasDisplayableMetrics } from "@/lib/advisory/approvedPortfolioComposition";
import { HONESTY_LIMITS } from "@/lib/advisory/constants";
import { mergeTaxProfile, projectTax } from "@/lib/taxProjection";
import { DEFAULT_HORIZON_YEARS } from "@/lib/taxProjectionRules";
import { isPortfolioWorkflowApproved } from "@/lib/advisory/workflowApprovals";
import { isFinancialIncomeReadyForTax } from "@/lib/financialIncome";

const ALLOCATION_COLORS = ["#1769d2", "#159caa", "#1428a0", "#5c8874", "#8592a6", "#b39960"];
const HOLDINGS_PER_PAGE = 8;
const HOLDINGS_WITH_AGREEMENT = 4;

export function paginateIpsInstruments(instruments: ApprovedInstrument[]): ApprovedInstrument[][] {
  if (!instruments.length) return [[]];
  const pages: ApprovedInstrument[][] = [];
  let offset = 0;
  // Reserve room for the full warnings and signatures on the final sheet.
  while (instruments.length - offset > HOLDINGS_WITH_AGREEMENT) {
    const count = Math.min(HOLDINGS_PER_PAGE, instruments.length - offset - HOLDINGS_WITH_AGREEMENT);
    pages.push(instruments.slice(offset, offset + count));
    offset += count;
  }
  pages.push(instruments.slice(offset));
  return pages;
}

function metricLabel(pf: Portfolio | undefined, kind: "return" | "risk"): string {
  if (!pf) return "—";
  if (isLegacyIncompletePortfolio(pf)) return "확인 필요";
  if (!portfolioHasDisplayableMetrics(pf)) return "산출 전";
  return formatPercent1(kind === "return" ? pf.expectedReturn : pf.expectedRisk);
}

function formatAmount(won: number | null): string {
  return won != null && Number.isFinite(won)
    ? Math.round(won / 10_000).toLocaleString("ko-KR")
    : "—";
}

function Masthead({ client, dateStr, compact = false }: { client: Client; dateStr: string; compact?: boolean }) {
  return (
    <header className={`ips-masthead${compact ? " ips-masthead-compact" : ""}`}>
      <div className="ips-brand"><strong>삼성증권</strong><span>PRIVATE BANKING</span></div>
      <div className="ips-document-meta"><span>IPS-{client.code}</span><span>{dateStr}</span></div>
    </header>
  );
}

function SectionTitle({ number, children, note }: { number: string; children: React.ReactNode; note?: string }) {
  return <div className="ips-section-heading"><h2><span>{number}</span>{children}</h2>{note && <p>{note}</p>}</div>;
}

function Footer({ page, total, name }: { page: number; total: number; name: string }) {
  return <footer className="ips-footer"><span>{name} · 투자정책서</span><span>고객·담당 PB용</span><strong>{String(page).padStart(2, "0")} / {String(total).padStart(2, "0")}</strong></footer>;
}

function InstrumentTable({ rows }: { rows: ApprovedInstrument[] }) {
  return (
    <table className="ips-table ips-holdings-table">
      <colgroup><col className="ips-col-instrument" /><col className="ips-col-weight" /><col className="ips-col-amount" /><col className="ips-col-quantity" /></colgroup>
      <thead><tr><th scope="col">편입 상품</th><th scope="col" className="ips-number">전체 비중</th><th scope="col" className="ips-number">배정금액 <small>(만원)</small></th><th scope="col" className="ips-number">산정 수량</th></tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.assetClassKey}:${row.symbol}:${index}`}>
            <td data-label="편입 상품"><strong>{row.name}</strong><small>{row.assetClassLabel} · {row.symbol} · {row.currency}</small></td>
            <td data-label="전체 비중" className="ips-number"><strong>{formatPercent1(row.totalWeightPct)}</strong><small>자산군 내 {formatPercent1(row.weightWithinClass)}</small></td>
            <td data-label="배정금액 (만원)" className="ips-number" title={row.allocationAmountWon != null ? formatKRW(row.allocationAmountWon) : undefined}>{formatAmount(row.allocationAmountWon)}</td>
            <td data-label="산정 수량" className="ips-number">{row.quantity != null && Number.isFinite(row.quantity) ? row.quantity.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : "—"}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={4} className="ips-empty">편입 상품이 없습니다.</td></tr>}
      </tbody>
    </table>
  );
}

export default function IpsA4Document({ documentClient, documentPbDisplay, investableWon, dateStr }: {
  documentClient: Client;
  documentPbDisplay: string;
  investableWon: number | null;
  dateStr: string;
}) {
  const pf = documentClient.portfolios[0];
  const confirmedWeights = pf
    ? buildPortfolioViewModel(documentClient).portfolioOptions.find((option) => option.id === pf.id)?.weights
    : undefined;
  const allocations = pf ? resolvePortfolioDisplayAllocations(pf, confirmedWeights) : [];
  const allocationTotal = allocations.reduce((sum, row) => sum + row.weight, 0);
  const holdingPages = paginateIpsInstruments(pf?.instruments ?? []);
  const totalPages = 1 + holdingPages.length;
  const legacyIncomplete = isLegacyIncompletePortfolio(pf);
  const metricsOk = portfolioHasDisplayableMetrics(pf);
  const taxReady = isPortfolioWorkflowApproved(documentClient) && isFinancialIncomeReadyForTax(documentClient) && metricsOk && pf?.expectedReturn != null && !!confirmedWeights;
  const mergedTax = taxReady ? mergeTaxProfile(documentClient) : null;
  const taxWaterfall = taxReady && mergedTax && confirmedWeights ? projectTax({
    principalWon: investableWon ?? documentClient.assetSize,
    horizonYears: DEFAULT_HORIZON_YEARS,
    weights: confirmedWeights,
    expectedReturnPct: pf!.expectedReturn!,
    taxProfile: mergedTax.profile,
    cashFlows: documentClient.cashFlows,
    cashflowTaxSummary: mergedTax.cashflowSummary,
    label: pf?.label ?? "기준안",
  }) : null;

  return (
    <article className="ips-document" aria-label="투자정책서">
      <section className="ips-sheet" aria-label="투자 원칙과 자산배분">
        <Masthead client={documentClient} dateStr={dateStr} />
        <div className="ips-title-block"><p className="ips-eyebrow">INVESTMENT POLICY STATEMENT</p><h1>투자정책서</h1><p className="ips-subtitle">{documentClient.name} 고객님의 투자 원칙과 자산배분</p></div>

        <div className="ips-client-overview">
          <dl className="ips-client-details">
            <div><dt>고객명</dt><dd>{documentClient.name}<small>{CLIENT_TYPE_LABEL[documentClient.clientType]}</small></dd></div>
            <div><dt>담당 PB</dt><dd>{documentPbDisplay}</dd></div>
            <div><dt>{documentClient.clientType === "corporate" ? "설립일" : "생년월일"}</dt><dd>{formatDate(documentClient.birthDate)}</dd></div>
            <div><dt>고객번호</dt><dd>{documentClient.code}</dd></div>
          </dl>
          <div className="ips-capital"><span>투자가능자산</span><strong>{formatKRW(investableWon ?? documentClient.assetSize)}</strong><small>{investableWon != null ? "부동산 제외 · 원화 기준" : "총자산 기준 · 투자가능금액 확인 필요"}</small></div>
        </div>
        {(documentClient.accountSeparation || documentClient.ownershipPct != null) && <p className="ips-account-note">{documentClient.accountSeparation ? `통장 구분: ${ACCOUNT_SEPARATION_LABEL[documentClient.accountSeparation]}` : `지분율: ${formatPercent1(documentClient.ownershipPct)}${documentClient.isMajorityShareholder ? " · 최대주주" : ""}`}</p>}

        <section className="ips-section">
          <SectionTitle number="01">투자 목적과 운용 기준</SectionTitle>
          <dl className="ips-policy-list">
            {FACTOR_META.map((meta, index) => {
              const factor = documentClient.ips[meta.key];
              return <div className={index < 3 ? "ips-policy-primary" : ""} key={meta.key}><dt>{meta.label}</dt><dd>{factor.value || "상담 확인 필요"}{factor.status === "inferred" && factor.value && <span className="ips-review-note">확인 필요</span>}</dd></div>;
            })}
          </dl>
        </section>

        <section className="ips-section ips-allocation-section">
          <SectionTitle number="02" note={pf?.confirmedAt ? `승인 기준일 ${formatDate(pf.confirmedAt)}` : undefined}>자산배분 계획</SectionTitle>
          {allocations.length ? <>
            <div className="ips-allocation-bar" role="img" aria-label={allocations.map((row) => `${row.assetClass} ${formatPercent1(row.weight)}`).join(", ")}>
              {allocations.map((row, index) => <span key={`${row.assetClass}:${index}`} style={{ flexGrow: Math.max(0, row.weight), backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />)}
            </div>
            <table className="ips-table ips-allocation-table"><thead><tr><th scope="col">자산군</th><th scope="col" className="ips-number">목표 비중</th><th scope="col" className="ips-allocation-visual">배분</th></tr></thead><tbody>
              {allocations.map((row, index) => <tr key={`${row.assetClass}:${index}`}><td><span className="ips-swatch" style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />{row.assetClass}</td><td className="ips-number">{formatPercent1(row.weight)}</td><td className="ips-allocation-visual"><span><i style={{ width: `${Math.max(0, Math.min(100, row.weight))}%`, backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} /></span></td></tr>)}
            </tbody><tfoot><tr><th scope="row">합계</th><td className="ips-number">{formatPercent1(allocationTotal)}</td><td /></tr></tfoot></table>
          </> : <p className="ips-empty">확정된 자산배분 계획이 없습니다.</p>}
          <p className="ips-note">비중은 전체 포트폴리오 기준이며, 소수점 첫째 자리로 반올림하여 표시합니다.</p>
        </section>
        <Footer page={1} total={totalPages} name={documentClient.name} />
      </section>

      {holdingPages.map((rows, pageIndex) => {
        const isLast = pageIndex === holdingPages.length - 1;
        return <section className={`ips-sheet ips-portfolio-sheet${isLast && taxWaterfall ? " ips-with-tax" : ""}`} aria-label={`포트폴리오 상세 ${pageIndex + 1}`} key={pageIndex}>
          <Masthead client={documentClient} dateStr={dateStr} compact />
          <div className="ips-detail-title"><p className="ips-eyebrow">PORTFOLIO & AGREEMENT</p><h2>{pageIndex === 0 ? "포트폴리오와 고객 확인" : "포트폴리오 상세 (계속)"}</h2><p>{documentClient.name} 고객님 · {pf?.label ?? "포트폴리오 미확정"}</p></div>

          <section className="ips-section ips-instruments-section">
            <SectionTitle number="03" note={`총 ${pf?.instruments?.length ?? 0}개 상품`}>편입 상품 명세{pageIndex > 0 ? " (계속)" : ""}</SectionTitle>
            {legacyIncomplete && !pf?.instruments?.length ? <p className="ips-empty">편입 상품 상세가 없는 이전 승인 기록입니다. 담당 PB의 재확인이 필요합니다.</p> : <InstrumentTable rows={rows} />}
            <p className="ips-note">비중·수량은 승인 시점 장부 기준이며 증권사 주문·체결 내역이 아닙니다. 배정금액은 만원 단위로 반올림했습니다.</p>
            {!isLast && <p className="ips-continuation">편입 상품 명세와 유의사항·서명란은 다음 페이지에 이어집니다.</p>}
          </section>

          {isLast && <>
            <section className="ips-section ips-outlook-section">
              <SectionTitle number="04" note="상담용 추정">수익·위험 및 비용</SectionTitle>
              <dl className="ips-outlook"><div><dt>예상 연수익률</dt><dd>{metricLabel(pf, "return")}</dd></div><div><dt>예상 변동성</dt><dd>{metricLabel(pf, "risk")}</dd></div></dl>
              {taxWaterfall ? <div className="ips-tax-summary"><p>{DEFAULT_HORIZON_YEARS}년 기준 · 세전·세후 예상</p><dl>
                <div><dt>세전 기말자산</dt><dd>{formatKRW(taxWaterfall.principalWon + taxWaterfall.grossReturnWon)}</dd></div>
                <div><dt>예상 세금</dt><dd>{formatKRW(taxWaterfall.taxes.totalTaxWon)}</dd></div>
                <div><dt>상품·거래 비용</dt><dd>{formatKRW(taxWaterfall.feesWon)}</dd></div>
                <div><dt>세후 기말자산</dt><dd>{formatKRW(taxWaterfall.netEndingWon)}</dd></div>
              </dl></div> : <p className="ips-note">세전·세후 예상은 계산 조건 확인 후 제공됩니다.</p>}
              <p className="ips-note">수익률·변동성은 참고 추정치이며 미래 성과를 보장하지 않습니다.</p>
            </section>

            <section className="ips-section ips-agreement">
              <SectionTitle number="05">투자 유의사항 및 확인</SectionTitle>
              <div className="ips-disclaimer">
                <p>※ 본 투자정책서는 PB 상담 내용을 구조화한 <b>참고용 문서</b>이며 투자 권유가 아닙니다. 포트폴리오·스트레스 결과는 통계적 추정치로 미래 수익을 보장하지 않으며, 실제 투자 결정 및</p>
                <ul>{HONESTY_LIMITS.map((line) => <li key={line}>{line}</li>)}</ul>
              </div>
              <p className="ips-acknowledgement">투자 목적, 자산배분 계획 및 위 유의사항을 확인합니다.</p>
              <div className="ips-signatures"><div><span>담당 PB</span><strong>{documentPbDisplay}</strong><span className="ips-sign-line">서명</span></div><div><span>고객</span><strong>{documentClient.name}</strong><span className="ips-sign-line">서명</span></div></div>
              <p className="ips-sign-date">확인일 <span>년</span><span>월</span><span>일</span></p>
            </section>
          </>}
          <Footer page={pageIndex + 2} total={totalPages} name={documentClient.name} />
        </section>;
      })}
    </article>
  );
}
