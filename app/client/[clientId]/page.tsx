"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Client } from "@/lib/types";
import { getClient } from "@/lib/store";
import { LoadingView, ErrorView } from "@/components/StateViews";
import ClientFacingView from "@/components/ClientFacingView";

/** 독립 고객 화면 라우트 — 본문은 ClientFacingView 공용 컴포넌트 재사용 */
export default function ClientViewPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const c = await getClient(clientId);
      if (!c) return setStatus("error");
      setClient(c);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <ClientFacingView client={client} />
    </div>
  );
}
