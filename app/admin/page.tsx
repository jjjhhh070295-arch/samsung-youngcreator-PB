"use client";

import { useCallback, useEffect, useState } from "react";
import HelpToolbar from "@/components/help/HelpToolbar";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "admin" });

export default function AdminPage() {
  const [status, setStatus] = useState<any>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/status", {
      headers: { "x-trader-user": TRADER_HEADER },
      cache: "no-store",
    });
    setStatus(await res.json());
  }, []);

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15000); return () => clearInterval(t); }, [refresh]);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      <HelpToolbar nextAction={status?.nextAction ?? "CHECK_WORKER"} />
      <h1 className="text-2xl font-bold text-slate-900">매매 관리자</h1>
      <p className="mt-2 text-sm text-slate-600">
        브라우저를 닫아도 Worker가 켜져 있으면 자동매매는 계속됩니다. Worker 오프라인이면 주문이 나가지 않습니다.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">Worker</p>
          <p className="mt-1">{status?.worker?.ok ? "온라인" : "오프라인"}</p>
          <p className="text-xs text-slate-500">heartbeat: {status?.worker?.last ?? "—"}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">세션 / 거래일</p>
          <p className="mt-1">{status?.session?.labelKo ?? "—"}</p>
          <p className="text-xs text-slate-500">
            거래일: {status?.calendar?.isTradingDay ? "예" : "아니오"} · 출처 {status?.calendar?.source ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">실매매 / 라우팅</p>
          <p className="mt-1">live: {status?.live?.allow ? "가능" : "차단"} · 모드 {status?.exchangeMode ?? "SOR"}</p>
          <ul className="mt-1 text-xs text-rose-700">
            {(status?.live?.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}
          </ul>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">안내</p>
          <p className="mt-1 text-xs text-slate-600">웹: npm run start · Worker: npm run worker · PB Insight와 별도 배포</p>
        </div>
      </div>
      <pre className="mt-4 max-h-80 overflow-auto rounded bg-slate-100 p-3 text-[10px]">{JSON.stringify(status, null, 2)}</pre>
    </main>
  );
}
