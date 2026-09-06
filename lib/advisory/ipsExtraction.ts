/**
 * 기본정보 승인 시 IPS(RRTTLLU) 추출·확정.
 * AI/Evidence UI 없이 고객 프로필·설문·현금흐름·세금 플래그로 결정적으로 갱신한다.
 */

import type { Client, IPS, IPSFactor } from "../types";
import { FACTOR_META } from "../types";
import { summarizeSimpleCashflowRows, loadSimpleCashflowRows } from "../simpleCashflow";

function finalizeFactor(factor: IPSFactor, fallbackValue: string, note: string): IPSFactor {
  const value = (factor.value || "").trim() || fallbackValue;
  if (!value) {
    return {
      ...factor,
      reviewed: false,
      status: factor.status === "empty" ? "empty" : factor.status,
    };
  }
  return {
    ...factor,
    value,
    status: factor.status === "empty" ? "explicit" : factor.status,
    source: factor.source || "manual",
    reviewed: true,
    notes: factor.notes?.trim() ? factor.notes : note,
    evidence: factor.evidence?.trim()
      ? factor.evidence
      : "기본정보 승인 시 고객 입력·설문·현금흐름을 기준으로 확정",
  };
}

/** 기본정보 승인 직후 호출 — 기존 IPS 값을 보존하면서 검토 확정·부족 항목 보강 */
export function extractIpsFromClientProfile(client: Client): IPS {
  const cashTotals = summarizeSimpleCashflowRows(loadSimpleCashflowRows(client.cashFlows));
  const taxFlag = client.financialIncomeComprehensiveTax
    ? "금융소득 종합과세 대상"
    : "금융소득 종합과세 비대상";
  const cashNote =
    cashTotals.netInflow || cashTotals.netOutflowExTax || cashTotals.totalTax
      ? `현금흐름 순자금 ${Math.round(cashTotals.netCash / 10_000).toLocaleString("ko-KR")}만원 기준`
      : "현금흐름 요약 기준";

  const portfolioNote = client.portfolios?.[0]?.label
    ? `확정 포트폴리오: ${client.portfolios[0].label}`
    : "";
  const ips = client.ips;
  return {
    return: finalizeFactor(ips.return, ips.return.value || "목표 수익률 확인", "기본정보·설문 기반 목표 수익률"),
    risk: finalizeFactor(ips.risk, ips.risk.value || "위험 허용도 확인", "기본정보·설문 기반 위험 허용도"),
    timeHorizon: finalizeFactor(
      ips.timeHorizon,
      ips.timeHorizon.value || "투자 기간 확인",
      "기본정보·설문 기반 투자 기간",
    ),
    tax: finalizeFactor(ips.tax, taxFlag, `세금 프로필: ${taxFlag}`),
    liquidity: finalizeFactor(ips.liquidity, cashNote, cashNote),
    legal: finalizeFactor(
      ips.legal,
      ips.legal.value || (client.clientType === "corporate" ? "법인 규제 확인" : "개인 규제 확인"),
      "고객 유형·법적 제약",
    ),
    unique: finalizeFactor(
      ips.unique,
      ips.unique.value ||
        [
          client.isMajorityShareholder ? "최대주주" : "",
          client.financialIncomeComprehensiveTax ? "금융소득 종합과세" : "",
          portfolioNote,
        ]
          .filter(Boolean)
          .join(" · ") || "고유 상황 확인",
      "고객 고유 상황·포트폴리오",
    ),
  };
}

export function ipsExtractionMissingReasons(client: Client): string[] {
  const reasons: string[] = [];
  if (!client.name?.trim()) reasons.push("고객 이름이 없습니다.");
  if (!client.code?.trim()) reasons.push("고객 식별코드가 없습니다.");
  const filled = FACTOR_META.filter((m) => (client.ips?.[m.key]?.value || "").trim()).length;
  if (filled === 0) {
    reasons.push("7요인(RRTTLLU) 값이 비어 있습니다. 설문 또는 요인 입력을 완료하세요.");
  }
  return reasons;
}
