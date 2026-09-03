"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getLoggedInPbId, onSessionChanged } from "@/lib/auth";

// /pb/[pbId] 및 모든 하위 라우트(고객·IPS·포트폴리오) 인증 가드.
// 세션이 없거나 URL의 pbId와 세션이 다르면 로그인 화면으로 튕긴다.
// 마운트 때 한 번만 보는 게 아니라 세션 변화(만료·다른 탭 로그아웃·계정 전환)마다
// 다시 본다 — 예전에는 한 번 통과하면 그 탭이 계속 열려 있었다.
export default function PbLayout({ children }: { children: React.ReactNode }) {
  const { pbId } = useParams<{ pbId: string }>();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const check = () => {
      const sessionPbId = getLoggedInPbId();
      if (!sessionPbId || sessionPbId !== pbId) {
        setAuthed(false); // 이미 그려진 내용을 즉시 감춘다
        router.replace("/"); // 미로그인 OR 남의 pbId URL → 로그인 화면
        return;
      }
      setAuthed(true);
    };
    check();
    return onSessionChanged(check);
  }, [pbId, router]);

  // 인증 확인 전엔 아무것도 렌더하지 않는다(데이터 로드·내용 flash 차단).
  if (!authed) return null;
  return <>{children}</>;
}
