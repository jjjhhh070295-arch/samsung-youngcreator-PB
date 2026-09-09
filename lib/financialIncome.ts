import type { Client, FinancialIncomeProfile, WithholdingSlipParseStatus } from "@/lib/types";
import {
  annualFinancialIncomeFromBreakdown,
  buildFinancialIncomeBreakdown,
  type DepositInterestSnapshot,
} from "./financialIncomeBreakdown";

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

/**
 * 작년 총 결정세액(금융소득 제외·국세+지방세) 정본.
 * 신규 필드가 있으면 우선. 없으면 레거시 국세+지방을 한 번만 합산(이중기입 금지).
 */
export function resolvePriorYearNonFinancialAssessedTaxWon(
  profile: FinancialIncomeProfile,
): number | null {
  if (
    profile.priorYearNonFinancialAssessedTaxWon != null &&
    Number.isFinite(profile.priorYearNonFinancialAssessedTaxWon)
  ) {
    return Math.max(0, profile.priorYearNonFinancialAssessedTaxWon);
  }
  const hasLegacy =
    profile.priorYearAssessedNationalWon != null || profile.priorYearAssessedLocalWon != null;
  if (!hasLegacy) return null;
  return (
    Math.max(0, profile.priorYearAssessedNationalWon ?? 0) +
    Math.max(0, profile.priorYearAssessedLocalWon ?? 0)
  );
}

/** 프로파일에 정본 필드를 채운 복사본(레거시 필드는 보존, 합산을 레거시에 되쓰지 않음) */
export function migrateFinancialIncomeProfile(
  profile: FinancialIncomeProfile,
): FinancialIncomeProfile {
  if (
    profile.priorYearNonFinancialAssessedTaxWon != null &&
    Number.isFinite(profile.priorYearNonFinancialAssessedTaxWon)
  ) {
    return profile;
  }
  const migrated = resolvePriorYearNonFinancialAssessedTaxWon(profile);
  if (migrated == null) return profile;
  return { ...profile, priorYearNonFinancialAssessedTaxWon: migrated };
}

export function resolveFinancialIncomeProfile(client: Client): FinancialIncomeProfile {
  return migrateFinancialIncomeProfile({
    ...defaultFinancialIncomeProfile(),
    ...(client.financialIncomeProfile ?? {}),
  });
}

/**
 * 연간 금융소득 합계(외부 확정 + 파생 예적금·채권·배당).
 * depositSnapshot 이 있으면 제품 산출이 캐시보다 우선.
 */
export function annualFinancialIncomeFromProfile(
  profile: FinancialIncomeProfile,
  opts?: { depositSnapshot?: DepositInterestSnapshot | null },
): number {
  const b = buildFinancialIncomeBreakdown(profile, opts);
  return annualFinancialIncomeFromBreakdown(b);
}

/** 급여·공제 기반 비금융 과세표준(확정 대안 필드 무시) */
export function deriveNonFinancialTaxableBaseWon(input: {
  expectedWageGrossWon: number | null | undefined;
  employmentIncomeDeductionWon?: number | null;
  otherDeductionsWon?: number | null;
  otherComprehensiveIncomeWon?: number | null;
}): number | null {
  if (input.expectedWageGrossWon == null || !Number.isFinite(input.expectedWageGrossWon)) {
    return null;
  }
  return (
    Math.max(
      0,
      input.expectedWageGrossWon -
        Math.max(0, input.employmentIncomeDeductionWon ?? 0) -
        Math.max(0, input.otherDeductionsWon ?? 0),
    ) + Math.max(0, input.otherComprehensiveIncomeWon ?? 0)
  );
}

/** 종합과세 대상인데 세전·세후/승인에 쓸 금융소득이 준비됐는지 */
export function isFinancialIncomeReadyForTax(
  client: Client,
  opts?: { depositSnapshot?: DepositInterestSnapshot | null },
): boolean {
  if (!client.financialIncomeComprehensiveTax) return true;
  const profile = resolveFinancialIncomeProfile(client);
  const status: WithholdingSlipParseStatus = profile.parseStatus;
  const breakdown = buildFinancialIncomeBreakdown(profile, opts);
  const hasDerived =
    (breakdown.derivedDepositInterestWon != null && breakdown.derivedDepositInterestWon > 0) ||
    (breakdown.derivedBondInterestWon != null && breakdown.derivedBondInterestWon > 0) ||
    (breakdown.derivedDividendWon != null && breakdown.derivedDividendWon > 0);
  const hasManual =
    profile.interestIncomeWon != null || profile.dividendIncomeWon != null;

  if (status === "parse_failed" || status === "none") {
    return annualFinancialIncomeFromBreakdown(breakdown) > 0 || hasManual || hasDerived;
  }
  if (status === "parsed" || status === "manual") {
    return hasManual || hasDerived;
  }
  return false;
}

export function financialIncomeBlockReason(
  client: Client,
  opts?: { depositSnapshot?: DepositInterestSnapshot | null },
): string {
  if (!client.financialIncomeComprehensiveTax) return "";
  if (isFinancialIncomeReadyForTax(client, opts)) return "";
  const profile = resolveFinancialIncomeProfile(client);
  if (profile.parseStatus === "parse_failed") {
    return "원천징수영수증에서 금융소득을 읽지 못했습니다. 이자·배당을 수동 입력하세요.";
  }
  return "금융소득 종합과세 대상입니다. 원천징수영수증 PDF를 첨부하거나 이자·배당을 수동 입력하세요.";
}
