// Vercel Cron 및 발송 라우트가 공용으로 쓰는 인증 헬퍼 — fail-closed.
//
// 예전 구현은 CRON_SECRET이 비어 있으면 인증을 통과시켰다("개발 편의") — 이건
// 시크릿을 안 걸어두면 누구나 엔드포인트를 호출할 수 있다는 뜻이다. 리서치
// 스냅샷 정도는 피해가 적었지만, 앞으로 이 헬퍼를 쓸 모닝 브리핑 발송
// 라우트에서는 "누구나 전 고객에게 메일을 트리거할 수 있는 구멍"이 된다 —
// 그래서 기본값을 반대로 뒤집었다: 시크릿이 없으면 원칙적으로 거부한다.
//
// 유일한 예외는 NODE_ENV==="development"일 때뿐이다 — 로컬 개발 중 매번
// .env.local에 시크릿을 채워 넣지 않아도 되게 하기 위함이며, Vercel
// 프로덕션 배포는 NODE_ENV가 항상 "production"이라 이 예외가 적용되지 않는다.
//
// 이름이 BRIEFING_CRON_SECRET 인 이유: Vercel 이 CRON_SECRET 을 예약어로 막아
// 프로젝트 환경변수로 등록할 수 없다. 옛 이름은 폴백으로 남겨 둔다 — 로컬
// .env.local 이 아직 CRON_SECRET 이라 양쪽 다 동작해야 한다.
// 폴백을 걷어내려면 로컬·Vercel 양쪽이 새 이름으로 옮겨간 뒤에 해야 한다.
export function cronSecret(): string | undefined {
  return process.env.BRIEFING_CRON_SECRET || process.env.CRON_SECRET;
}

export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = cronSecret();
  if (secret) {
    const auth = req.headers.get("authorization");
    return auth === `Bearer ${secret}`;
  }
  // 시크릿 미설정 — 개발 환경에서만 예외적으로 통과시킨다. 프로덕션에서는
  // 무조건 거부(fail-closed)한다.
  return process.env.NODE_ENV === "development";
}
