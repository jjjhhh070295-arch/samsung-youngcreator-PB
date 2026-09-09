"use client";

/**
 * 공유 링크 화면의 자동 갱신 — 서버 payload 를 주기적으로 다시 받아 다시 그린다.
 *
 * 서버 컴포넌트(app/view/[token]/page.tsx)가 한 번 렌더하고 끝이라, PB 가 승인해도
 * 고객 화면은 새로고침 전까지 그대로였다. 회의 중 두 번째 화면으로 띄워 두는 용도라
 * 그게 실사용상 결함이다.
 *
 * ⚠️ anon 경로를 타지 않는다는 원칙은 그대로다. 여기서는 /api/client-view?t= 만
 *    호출한다 — 그 라우트가 service_role 로 해당 고객 1건만 조립해 돌려준다.
 *    lib/store·lib/supabase 를 import 하지 않으므로 이 컴포넌트의 청크에는
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY 가 실리지 않는다.
 *
 * 주기는 PB 탭(useLiveClient 의 pollMs)과 같은 15초로 맞춘다. 화면이 숨겨져 있는 동안
 * (다른 탭·화면 잠금)에는 요청하지 않고, 돌아오면 즉시 한 번 받아 온다 — 고객 화면은
 * 오래 켜 둔 채 두는 물건이라 보이지 않는 동안의 폴링은 낭비다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientViewPayload } from "@/lib/clientView/types";
import ClientFacingViewBody from "@/components/ClientFacingViewBody";

/** PB 탭 useLiveClient 의 pollMs 와 같은 값. */
const POLL_MS = 15_000;

interface Props {
  token: string;
  initial: ClientViewPayload;
}

export default function ClientViewLivePoller({ token, initial }: Props) {
  const [view, setView] = useState<ClientViewPayload>(initial);
  // 진행 중인 요청이 있으면 건너뛴다. 느린 회선에서 요청이 겹쳐 쌓이는 것을 막는다.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/client-view?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (!res.ok) return; // 만료·서명 오류는 다음 새로고침에서 안내 화면으로 넘어간다
      const data = await res.json();
      if (data?.ok && data.payload) setView(data.payload as ClientViewPayload);
    } catch {
      // 네트워크가 끊겼을 뿐이다. 마지막으로 받은 화면을 그대로 두고 다음 주기를 기다린다.
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // live 를 넘기지 않는다 — 갱신은 자동이고, 고객에게 「새로고침」 버튼을 보여 줄 이유가
  // 없다. onGoPb 도 없다(고객은 PB 화면으로 갈 일이 없다).
  return <ClientFacingViewBody view={view} />;
}
