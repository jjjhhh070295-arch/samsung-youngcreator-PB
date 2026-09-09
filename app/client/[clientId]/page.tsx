// 예전 고객 화면 주소 — 이제 서명 토큰 없이는 열리지 않는다.
//
// 이 라우트에는 로그인 가드가 없었다(app/client 에 layout 이 없고 SessionGuard 는
// 리다이렉트를 하지 않는다). clientId 는 UUID 라 추측하기 어렵지만 parties 가 anon 으로
// 통째로 읽히는 동안에는 사실상 공개 URL 이었다. 링크를 아는 사람만 열 수 있게 바꾼다.
//
// 라우트를 지우지 않고 남긴 이유: 이미 나간 주소가 있을 수 있고, 그때 404 보다
// "PB 에게 새 링크를 요청하라"는 안내가 낫다.
//
// 새 링크는 /view/[token] 을 쓴다. 이 주소는 ?t= 로 같은 토큰을 받아 처리한다.

import type { Metadata } from "next";
import ClientFacingViewBody from "@/components/ClientFacingViewBody";
import { clientViewSecret, verifyClientViewToken } from "@/lib/clientView/token";
import { loadClientViewPayload } from "@/lib/clientView/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const NEED_LINK = {
  title: "직접 열 수 없는 주소입니다",
  body: "고객 화면은 담당 PB가 보낸 공유 링크로만 열 수 있습니다. 링크를 다시 받아 주세요.",
};

export default async function ClientViewLegacyPage({
  params,
  searchParams,
}: {
  params: { clientId: string };
  searchParams?: { t?: string };
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

  const token = searchParams?.t?.trim() ?? "";
  if (!token) return <Notice {...NEED_LINK} />;

  const verified = verifyClientViewToken(token, secret);
  if (!verified.ok) {
    return verified.reason === "expired" ? (
      <Notice
        title="링크가 만료되었습니다"
        body="보안을 위해 공유 링크에는 유효기간이 있습니다. 담당 PB에게 새 링크를 요청해 주세요."
      />
    ) : (
      <Notice {...NEED_LINK} />
    );
  }

  // 주소의 clientId 와 토큰이 가리키는 고객이 달라도 열리면 안 된다. 토큰만 유효하면
  // 통과시키면 A 의 토큰으로 B 의 주소를 열어 놓고 A 의 화면을 보는 혼동이 생긴다.
  if (verified.clientId !== params.clientId) return <Notice {...NEED_LINK} />;

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
      {/* /view/[token] 과 같은 토큰을 요구하므로 표시 정책도 같다(섹션별).
          예전의 통째 잠금은 이 라우트에 인증이 아예 없던 시절의 정책이었다. */}
      <ClientFacingViewBody view={loaded.payload} />
    </div>
  );
}
