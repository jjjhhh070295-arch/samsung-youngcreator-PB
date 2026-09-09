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
// Vercel Cron은 CRON_SECRET을 Authorization: Bearer ... 헤더에 자동으로 넣는다.
// BRIEFING_CRON_SECRET은 브리핑을 수동 호출하던 기존 연동을 위해 함께 허용한다.
// 두 값이 다르더라도 어느 한쪽과 정확히 일치하면 통과하도록 검사한다.
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET?.trim() || process.env.BRIEFING_CRON_SECRET?.trim();
}

export function cronSecrets(): string[] {
  return Array.from(new Set([
    process.env.CRON_SECRET?.trim(),
    process.env.BRIEFING_CRON_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value))));
}

export function isAuthorizedCronRequest(req: Request): boolean {
  const secrets = cronSecrets();
  if (secrets.length) {
    const auth = req.headers.get("authorization");
    return secrets.some((secret) => auth === `Bearer ${secret}`);
  }
  // 시크릿 미설정 — 개발 환경에서만 예외적으로 통과시킨다. 프로덕션에서는
  // 무조건 거부(fail-closed)한다.
  return process.env.NODE_ENV === "development";
}
