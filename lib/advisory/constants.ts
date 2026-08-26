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
  "상담 판단은 실제 상황과 다를 수 있어 PB 확인이 필요합니다.",
] as const;

export const AI_ROLE_COPY =
  "상담 메모와 입력값을 기준으로 투자성향, 현금흐름, 포트폴리오 제안 내용을 정리합니다. 중요한 숫자는 기준일·출처·통화와 함께 표시합니다.";

export const ENGINE_ROLE_COPY =
  "같은 입력과 설정이면 핵심 계산값이 동일하게 나오도록 관리하며, PB 승인 전에는 고객용 최종 문서를 발행하지 않습니다.";
