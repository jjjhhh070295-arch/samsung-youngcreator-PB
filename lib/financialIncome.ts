import type { Client, FinancialIncomeProfile, WithholdingSlipParseStatus } from "@/lib/types";

export function defaultFinancialIncomeProfile(): FinancialIncomeProfile {
  return {
    interestIncomeWon: null,
    dividendIncomeWon: null,
    parseStatus: "none",
    fileName: null,
    extractedAt: null,
    extractedInterestIncomeWon: null,
    extractedDividendIncomeWon: null,
  };
}

export function resolveFinancialIncomeProfile(client: Client): FinancialIncomeProfile {
  return {
    ...defaultFinancialIncomeProfile(),
    ...(client.financialIncomeProfile ?? {}),
  };
}

export function annualFinancialIncomeFromProfile(profile: FinancialIncomeProfile): number {
  return Math.max(0, Number(profile.interestIncomeWon) || 0) + Math.max(0, Number(profile.dividendIncomeWon) || 0);
}

/** 종합과세 대상인데 세전·세후/승인에 쓸 금융소득이 준비됐는지 */
export function isFinancialIncomeReadyForTax(client: Client): boolean {
  if (!client.financialIncomeComprehensiveTax) return true;
  const profile = resolveFinancialIncomeProfile(client);
  const status: WithholdingSlipParseStatus = profile.parseStatus;
  if (status === "parse_failed" || status === "none") {
    // 수동 입력이 있으면 허용
    return annualFinancialIncomeFromProfile(profile) > 0 || (
      profile.interestIncomeWon != null || profile.dividendIncomeWon != null
    );
  }
  if (status === "parsed" || status === "manual") {
    return profile.interestIncomeWon != null || profile.dividendIncomeWon != null;
  }
  return false;
}

export function financialIncomeBlockReason(client: Client): string {
  if (!client.financialIncomeComprehensiveTax) return "";
  if (isFinancialIncomeReadyForTax(client)) return "";
  const profile = resolveFinancialIncomeProfile(client);
  if (profile.parseStatus === "parse_failed") {
    return "원천징수영수증에서 금융소득을 읽지 못했습니다. 이자·배당을 수동 입력하세요.";
  }
  return "금융소득 종합과세 대상입니다. 원천징수영수증 PDF를 첨부하거나 이자·배당을 수동 입력하세요.";
}
