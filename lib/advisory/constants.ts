// 통제 게이트·재시도·리스크 가정은 이 파일에서만 바꾼다.
// AI가 세금·비중·VaR/CVaR를 확정하지 않는다.

export const JUDGE_MAX_RETRIES = 2;

export const PDF_ALLOWED_STATUS = "locked" as const;

export const CITATION_REQUIRED_FIELDS = ["sourceId", "title", "asOf", "chunkId"] as const;

export const RISK_FREE_RATE_PCT = 3.5;
export const VAR_CONFIDENCE = 0.95;
export const VAR_Z_95 = 1.6448536269514722;
export const STANDARD_NORMAL_PDF_Z95 = 0.1031356401735788; // φ(1.64485)

export const ENGINE_SOURCE = "deterministic-engine";
export const ENGINE_CURRENCY = "KRW" as const;
export const ENGINE_ASSUMPTION =
  "MVP 간이 모델. 과거 가정·고정 세율·파라메트릭 VaR. 원금·수익률 보장 아님. 세무 검토 필요.";

export const HONESTY_LIMITS = [
  "본 서비스는 MVP 간이 분석입니다.",
  "세무 신고·납부 확정 금액이 아니며 세무 전문가 검토가 필요합니다.",
  "수익률과 원금을 보장하지 않습니다.",
  "VaR/CVaR는 과거 가정·정규분포 근사 기반이며 실제 손실 한도가 아닙니다.",
  "시세·매크로 데이터는 지연되거나 누락될 수 있습니다.",
  "Judge 판정과 사람 라벨이 불일치할 수 있습니다.",
] as const;

export const AI_ROLE_COPY =
  "AI는 IPS 추출, 설명, Judge, 요약에만 사용합니다. 자산비중·세율·VaR/CVaR·MDD·세후 계산은 결정론 엔진이 산출합니다.";

export const ENGINE_ROLE_COPY =
  "같은 입력과 설정을 다시 넣으면 핵심 수치와 결과 해시가 동일합니다. AI가 숫자를 덮어쓰면 Judge가 발행을 차단합니다.";
