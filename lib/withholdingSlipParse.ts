/**
 * 원천징수영수증 PDF 텍스트에서 이자·배당소득 추출.
 * 금액을 확신할 수 없으면 null을 반환한다(자동 추정 금지).
 */

export type WithholdingSlipExtract = {
  interestIncomeWon: number | null;
  dividendIncomeWon: number | null;
  matchedLabels: string[];
  notes: string[];
};

function parseKoreanWonAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function findAmountNearLabel(text: string, labelPattern: RegExp): number | null {
  const patterns = [
    new RegExp(`(?:${labelPattern.source})\\s*[:：]?\\s*([0-9][0-9,]{2,})\\s*원?`, "i"),
    new RegExp(`(?:${labelPattern.source})[^\\d]{0,24}([0-9][0-9,]{2,})`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const amount = parseKoreanWonAmount(match[1]);
      if (amount != null && amount > 0) return amount;
    }
  }
  return null;
}

/** 평문 영수증 텍스트 → 이자/배당. 둘 다 없으면 실패로 간주. */
export function extractWithholdingSlipAmounts(text: string): WithholdingSlipExtract {
  const normalized = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");
  const matchedLabels: string[] = [];
  const notes: string[] = [];

  const interestIncomeWon = findAmountNearLabel(normalized, /이자소득(?:금액|총액|합계)?|이자\s*소득/);
  if (interestIncomeWon != null) matchedLabels.push("이자소득");

  const dividendIncomeWon = findAmountNearLabel(normalized, /배당소득(?:금액|총액|합계)?|배당\s*소득/);
  if (dividendIncomeWon != null) matchedLabels.push("배당소득");

  if (interestIncomeWon == null && dividendIncomeWon == null) {
    notes.push("이자소득·배당소득 금액을 텍스트에서 확인하지 못했습니다.");
  } else if (interestIncomeWon == null) {
    notes.push("이자소득 금액을 확인하지 못했습니다. 필요 시 수동 입력하세요.");
  } else if (dividendIncomeWon == null) {
    notes.push("배당소득 금액을 확인하지 못했습니다. 필요 시 수동 입력하세요.");
  }

  return { interestIncomeWon, dividendIncomeWon, matchedLabels, notes };
}

export function withholdingExtractSucceeded(extract: WithholdingSlipExtract): boolean {
  return extract.interestIncomeWon != null || extract.dividendIncomeWon != null;
}
