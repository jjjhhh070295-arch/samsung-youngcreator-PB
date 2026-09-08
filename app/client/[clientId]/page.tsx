"use client";

import { useParams } from "next/navigation";
import ClientFacingView from "@/components/ClientFacingView";

/**
 * 독립 고객 화면 라우트 — ClientFacingView 공용.
 * 외부 공유용: 포트폴리오 미승인 시 잠금.
 * 라이브 동기화는 ClientFacingView 가 담당한다.
 */
export default function ClientViewPage() {
  const { clientId } = useParams<{ clientId: string }>();

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <ClientFacingView
        clientId={clientId}
        allowPreviewWithoutPortfolioApproval={false}
      />
    </div>
  );
}
