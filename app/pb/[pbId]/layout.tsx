"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getLoggedInPbId } from "@/lib/auth";

// /pb/[pbId] 및 모든 하위 라우트(고객·IPS·포트폴리오) 인증 가드.
// 세션이 없거나 URL의 pbId와 세션이 다르면 로그인 화면으로 튕긴다.
export default function PbLayout({ children }: { children: React.ReactNode }) {
  const { pbId } = useParams<{ pbId: string }>();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const sessionPbId = getLoggedInPbId();
    if (!sessionPbId || sessionPbId !== pbId) {
      router.replace("/"); // 미로그인 OR 남의 pbId URL → 로그인 화면
      return;
    }
    setAuthed(true);
  }, [pbId, router]);

  // 인증 확인 전엔 아무것도 렌더하지 않는다(데이터 로드·내용 flash 차단).
  if (!authed) return null;
  return <>{children}</>;
}
