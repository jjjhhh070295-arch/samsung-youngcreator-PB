"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { getClient } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import IPSRadar from "@/components/IPSRadar";
import IPSSummary from "@/components/IPSSummary";
import { LoadingView, ErrorView } from "@/components/StateViews";

// 고객용 화면 — 간결·시각적. 쉬운 언어 요약 + 레이더 차트.
export default function ClientView() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
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
    load();
  }, [load]);

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  return (
    <div className="space-y-6">
      {/* 디스클레이머 */}
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-center text-xs text-fg-muted">
        본 화면은 상담 내용 요약입니다. 투자 권유가 아니며, 참고용입니다.
      </div>

      <div className="text-center">
        <p className="text-sm text-fg-muted">{client.code}</p>
        <h1 className="mt-1 text-3xl font-bold text-fg">{client.name} 님</h1>
        <p className="mt-2 text-fg-muted">
          자산규모{" "}
          <b className="text-2xl text-gold-500 dark:text-gold-300">
            {formatKRW(client.assetSize)}
          </b>
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
          {formatDate(client.birthDate)}
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 text-center text-sm font-semibold text-fg-muted">
          나의 투자성향 한눈에 보기
        </h2>
        <IPSRadar ips={client.ips} height={320} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-fg-muted">투자성향 요약</h2>
        <IPSSummary ips={client.ips} />
      </div>

      <div className="text-center">
        <button className="btn-outline text-sm" onClick={() => router.back()}>
          ← 돌아가기
        </button>
      </div>
    </div>
  );
}
