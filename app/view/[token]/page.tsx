// 고객 공유 링크 화면 — PB 계정 없이 고객 본인 화면만 연다.
//
// 서버 컴포넌트다. 토큰을 여기서 검증하고 service_role 로 payload 를 조립해
// ClientFacingViewBody 에 props 로 넘긴다. 브라우저가 데이터를 다시 조회하지 않는다.
//
// API 라우트(/api/client-view?t=)를 거치지 않는 이유: 한 번 더 왕복할 이유가 없고,
// 토큰이 브라우저 → 서버로 다시 나갈 필요도 없다. 그 라우트는 점검용으로 남겨 둔다.

import type { Metadata } from "next";
import ClientViewLivePoller from "@/components/ClientViewLivePoller";
import { clientViewSecret, verifyClientViewToken } from "@/lib/clientView/token";
import { loadClientViewPayload } from "@/lib/clientView/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 링크가 어디에 붙어도 색인되지 않게 한다. 헤더(X-Robots-Tag)는 API 라우트 쪽에 있다.
export const metadata: Metadata = {
  title: "상담 요약",
  robots: { index: false, follow: false },
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm font-bold text-fg">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{body}</p>
      </div>
    </div>
  );
}

export default async function ClientViewTokenPage({
  params,
}: {
  params: { token: string };
}) {
  const secret = clientViewSecret();
  if (!secret) {
    return (
      <Notice
        title="지금은 열 수 없습니다"
        body="서버에 공유 링크 서명키가 설정되어 있지 않습니다. 담당 PB에게 알려 주세요."
      />
    );
  }

  const verified = verifyClientViewToken(decodeURIComponent(params.token ?? ""), secret);
  if (!verified.ok) {
    // 만료만 따로 안내한다. 서명 실패·형식 오류를 나눠 알려 주면 토큰을 맞춰 보는 데
    // 단서가 되므로 한 문장으로 묶는다.
    return verified.reason === "expired" ? (
      <Notice
        title="링크가 만료되었습니다"
        body="보안을 위해 공유 링크에는 유효기간이 있습니다. 담당 PB에게 새 링크를 요청해 주세요."
      />
    ) : (
      <Notice
        title="열 수 없는 링크입니다"
        body="주소가 잘못되었거나 더 이상 사용할 수 없는 링크입니다. 담당 PB에게 문의해 주세요."
      />
    );
  }

  const loaded = await loadClientViewPayload(verified.clientId, verified.expiresAt);
  if (!loaded.ok) {
    return (
      <Notice
        title="정보를 불러오지 못했습니다"
        body={
          loaded.code === "NOT_FOUND"
            ? "해당 고객 정보를 찾을 수 없습니다. 담당 PB에게 문의해 주세요."
            : "잠시 후 다시 시도해 주세요. 계속되면 담당 PB에게 알려 주세요."
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      {/* 첫 화면은 서버가 그린 것을 그대로 쓰고, 이후 갱신은 폴러가 /api/client-view 를
          다시 불러 받는다(15초, PB 탭과 같은 주기). 그 라우트도 service_role 로 해당 고객
          1건만 돌려주므로 anon 경로는 여전히 타지 않는다.
          표시 정책은 PB 탭과 같은 섹션별이다 — 기본정보 승인분은 보이고 포트폴리오
          미승인이면 그 섹션만 "승인 후 표시"로 가려진다. */}
      <ClientViewLivePoller token={params.token} initial={loaded.payload} />
    </div>
  );
}
