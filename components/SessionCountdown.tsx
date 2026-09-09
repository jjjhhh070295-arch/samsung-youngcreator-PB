"use client";

import { useCallback, useEffect, useState } from "react";
import { getSessionExpiresAt, onSessionChanged, touchSession } from "@/lib/auth";

// 표시가 분 단위라 30초 주기면 충분하다. 실제와 최대 30초까지 어긋나지만 그 대신
// 리렌더가 분당 두 번으로 묶인다. 마지막 1분은 SessionGuard 의 경고 배너가 초 단위로 센다.
//
// lib/auth.ts 의 활동 기록(touchSession)도 30초 스로틀이라, 같은 탭에서 일하는 동안에는
// 이 주기와 맞물려 자연스럽게 갱신된다. 활동 기록은 일부러 이벤트를 쏘지 않는다 —
// 30초마다 앱 전체를 리렌더시키지 않기 위해서다.
const TICK_MS = 30_000;

// 이 아래로 남으면 색으로 구분한다.
const LOW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * 상단 네비의 세션 잔여 시간 표시.
 *
 * 보여주는 값은 "실효 만료"까지 남은 시간이다 — lib/auth.ts 가 min(로그인 후 8시간,
 * 마지막 활동 후 20분)으로 계산한다. 두 숫자를 나란히 띄우면 어느 쪽이 먼저 끝나는지
 * 헷갈리므로 화면에는 하나만 두고, 규칙 설명은 tooltip 으로 넘겼다.
 *
 * 클릭하면 유휴 만료를 즉시 되돌린다. 사실 화면 아무 데나 클릭해도 활동으로 잡혀
 * 연장되지만, "남은 시간이 보이는데 늘릴 방법이 없다"로 읽히지 않도록 명시적인 조작을
 * 둔다. 8시간 절대 상한에 걸린 마지막 구간에서는 눌러도 숫자가 늘지 않는다 — 의도된
 * 동작이고, 그때가 실제로 재로그인이 필요한 시점이다.
 */
export default function SessionCountdown({ className }: { className?: string } = {}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const sync = useCallback(() => {
    const expiresAt = getSessionExpiresAt();
    setRemainingMs(expiresAt === null ? null : expiresAt - Date.now());
  }, []);

  useEffect(() => {
    sync();
    const id = setInterval(sync, TICK_MS);
    const unsubscribe = onSessionChanged(sync);
    // 다른 탭에 가 있는 동안 타이머가 느려질 수 있다. 돌아오는 즉시 다시 읽는다.
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(id);
      unsubscribe();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [sync]);

  if (remainingMs === null || remainingMs <= 0) return null;

  // 30초 주기라 0분이 잠깐 보일 수 있다. 최소 1분으로 잡아 "0분" 표시를 피한다.
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const low = remainingMs <= LOW_THRESHOLD_MS;

  return (
    <button
      type="button"
      onClick={() => {
        // 클릭도 pointerdown 으로 활동에 잡히지만 그쪽은 30초 스로틀에 걸릴 수 있다.
        // 여기서는 스로틀을 무시하고 확실히 연장한 뒤 표시를 바로 갱신한다.
        touchSession(true);
        sync();
      }}
      title={`입력이 없으면 약 ${minutes}분 뒤 자동 로그아웃됩니다. 클릭하면 연장됩니다.\n(마지막 활동 후 20분, 로그인 후 최대 8시간)`}
      className={[
        "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]",
        className ?? "hidden md:inline-block",
        low
          ? "bg-amber-50 font-bold text-amber-700 hover:bg-amber-100"
          : "text-fg-muted hover:bg-white",
      ].join(" ")}
    >
      세션 {minutes}분
    </button>
  );
}
