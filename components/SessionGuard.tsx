"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isCustomerFacingPath } from "@/lib/customerFacingRoutes";
import {
  IDLE_WARNING_MS,
  getSessionExpiresAt,
  onSessionChanged,
  startActivityTracking,
  touchSession,
} from "@/lib/auth";

// 만료 감시 주기. 평소엔 15초면 충분하고(유휴 기록 스로틀이 30초라 그보다 촘촘할 이유가
// 없다), 경고가 뜬 뒤에는 남은 초를 세야 하므로 1초로 좁힌다.
const IDLE_CHECK_INTERVAL_MS = 15_000;
const WARNING_TICK_MS = 1_000;

/**
 * 세션 유휴 감시 — app/layout.tsx 에 한 번 마운트된다.
 *
 * 하는 일 셋:
 *  1. 활동(클릭·키입력·스크롤) 감시 → 유휴 만료 연장. 쓰기는 lib/auth.ts 에서 30초 스로틀.
 *  2. 주기적으로 세션을 읽어 만료를 확정한다. getSessionExpiresAt() 이 만료된 세션을
 *     정리하고 이벤트까지 쏘므로, 화면 전환(/pb 가드)은 그 이벤트를 받아 알아서 일어난다.
 *  3. 만료 1분 전 경고 배너. 상담 메모를 쓰다 자리를 비운 경우를 위한 것이다 —
 *     타이핑 자체가 활동이라 작성 중에는 뜨지 않는다.
 *
 * 리다이렉트는 여기서 하지 않는다. /pb/[pbId]/layout.tsx 가드가 세션 변화를 듣고
 * 처리하므로, 책임을 한 곳에 둔다.
 */
export default function SessionGuard() {
  const pathname = usePathname();
  // 실효 만료까지 남은 ms. 세션이 없으면 null.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const sync = useCallback(() => {
    const expiresAt = getSessionExpiresAt();
    setRemainingMs(expiresAt === null ? null : expiresAt - Date.now());
  }, []);

  useEffect(() => startActivityTracking(), []);

  useEffect(() => {
    sync();
    const unsubscribe = onSessionChanged(sync);
    // 다른 탭·다른 창에 가 있는 동안엔 타이머가 느려질 수 있다. 돌아오는 즉시 다시 본다.
    document.addEventListener("visibilitychange", sync);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [sync]);

  const warning = remainingMs !== null && remainingMs <= IDLE_WARNING_MS;

  useEffect(() => {
    const id = setInterval(sync, warning ? WARNING_TICK_MS : IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync, warning]);

  // 고객 대면 화면(/view/[token], /client/[clientId])에는 PB 세션 배너를 띄우지 않는다.
  // PB 가 자기 기기에서 공유 링크를 열어 고객에게 보여 줄 때 "60초 후 자동 로그아웃"이
  // 고객 화면 위에 뜨는 것을 막는다 — 고객에게는 뜻도 통하지 않는 안내다.
  if (isCustomerFacingPath(pathname)) return null;

  if (!warning || remainingMs === null) return null;

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-[90] w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-card"
    >
      <p className="text-sm font-bold text-amber-900">
        {seconds}초 후 자동 로그아웃됩니다
      </p>
      <p className="mt-1 text-xs text-amber-800">
        입력이 없어 세션이 곧 만료됩니다. 작성 중인 내용이 있으면 먼저 저장하세요.
      </p>
      <button
        type="button"
        className="mt-3 w-full rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700"
        onClick={() => {
          // 버튼 클릭도 pointerdown 으로 활동에 잡히지만, 그쪽은 30초 스로틀에 걸려
          // 무시될 수 있다. 여기서는 스로틀을 무시하고 확실히 연장한다.
          touchSession(true);
          sync();
        }}
      >
        계속 사용하기
      </button>
    </div>
  );
}
