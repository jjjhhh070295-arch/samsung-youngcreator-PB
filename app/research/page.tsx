"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLoggedInPbSession } from "@/lib/auth";

/**
 * 과거 공개 경로는 PB 세션 문맥을 잃기 때문에 내용 자체를 렌더링하지 않는다.
 * 로그인한 PB의 보호 경로로만 이동시킨다.
 */
export default function LegacyResearchRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void getLoggedInPbSession().then((session) => {
      if (!cancelled) router.replace(session ? `/pb/${session.pbId}/research` : "/");
    }).catch(() => {
      if (!cancelled) router.replace("/");
    });
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="min-h-[50vh] bg-[#F5F7FC] p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#DCE4F5] bg-white p-6 text-sm text-[#64748B] shadow-sm">
        PB 세션을 확인하고 보호된 리서치 코파일럿으로 이동하는 중입니다.
      </div>
    </div>
  );
}
