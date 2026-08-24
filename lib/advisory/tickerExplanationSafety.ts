const NUMERIC_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
const PROHIBITED_LANGUAGE = [
  /상승\s*확률/i,
  /강한\s*매수/i,
  /비중\s*확대/i,
  /목표\s*(?:주가|가격)/i,
  /(?:매수|매도)\s*(?:추천|권고)/i,
  /수익\s*보장/i,
];

function numericTokens(value: string) {
  return (value.match(NUMERIC_TOKEN) ?? []).map((token) => {
    const numeric = Number(token.replaceAll(",", ""));
    return Number.isFinite(numeric) ? numeric.toString() : token;
  });
}

/**
 * 모델 설명은 결정론 FACTS에 이미 있는 숫자만 반복할 수 있다.
 * 새 숫자나 권유성 표현이 하나라도 나오면 설명 전체를 폐기하고 안전한 템플릿을 쓴다.
 */
export function validateTickerExplanation(candidate: string, facts: string) {
  const text = candidate.trim();
  if (!text) return { passed: false, reason: "설명이 비어 있습니다." };
  if (PROHIBITED_LANGUAGE.some((pattern) => pattern.test(text))) {
    return { passed: false, reason: "권유성 또는 금지 표현이 포함되었습니다." };
  }

  const allowed = new Set(numericTokens(facts));
  const invented = numericTokens(text).filter((token) => !allowed.has(token));
  if (invented.length) {
    return { passed: false, reason: `FACTS에 없는 숫자(${Array.from(new Set(invented)).join(", ")})가 포함되었습니다.` };
  }
  return { passed: true, reason: "FACTS 숫자 범위 안의 설명입니다." };
}
