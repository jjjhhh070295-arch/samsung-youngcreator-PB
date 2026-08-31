"use client";

// 이 라우트는 더 이상 별도 화면이 아니다 — 포트폴리오 편집·확정 기능은
// /pb/[pbId]/[clientId]?view=analysis&tab=portfolio (IPSResultTabs의 portfolio 탭)
// 하나로 통합됐다. 예전 북마크·외부 링크가 깨지지 않도록 파일은 남기고 리다이렉트만 한다.
// (통합 이유: 이 라우트가 확정 로직을 탭과 따로 재구현하고 있어 확정 시점에 DB에
// 저장되는 값이 서로 달랐다 — referencedReports/confirmedAt 누락, 종목계획 미저장 등.)

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PortfolioPageRedirect() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio`);
  }, [router, pbId, clientId]);

  return null;
}
