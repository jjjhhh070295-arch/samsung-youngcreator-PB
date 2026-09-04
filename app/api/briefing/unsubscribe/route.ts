// 모닝 브리핑 수신거부 — 메일 본문 링크와 List-Unsubscribe 헤더가 함께 가리킨다.
//
// 이 라우트만 cronAuth 를 쓰지 않는다. 고객이 메일에서 누르는 링크라 시크릿을 요구할 수
// 없기 때문이다. 대신 clientId 에 HMAC 서명(lib/briefing/email.ts)을 붙여, 링크를 받은
// 본인만 자기 수신거부를 누를 수 있게 한다 — id 를 바꿔 남의 수신을 끊을 수 없다.
//
// GET  = 사람이 링크를 클릭. 결과를 HTML 로 보여준다.
// POST = 메일 클라이언트의 원클릭 수신거부(RFC 8058). 본문 없이 200 만 돌려주면 된다.
//
// 되돌리기는 여기서 제공하지 않는다 — 수신거부는 즉시·무조건 처리하고, 다시 받고 싶으면
// PB 가 고객 정보 화면에서 동의를 다시 켜야 한다(정보통신망법상 재동의는 명시적이어야 한다).

import { NextResponse } from "next/server";
import { optOutFromBriefing } from "@/lib/store";
import { unsubscribeSecret, verifyUnsubscribeToken } from "@/lib/briefing/email";

export const runtime = "nodejs";

function page(title: string, message: string, tone: "ok" | "error"): Response {
  const color = tone === "ok" ? "#1f6fb2" : "#c0392b";
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#f4f5f7;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif">
  <div style="max-width:520px;margin:80px auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 12px;font-size:20px;color:${color}">${title}</h1>
    <p style="margin:0;font-size:14px;line-height:1.8;color:#444">${message}</p>
    <p style="margin:24px 0 0;font-size:12px;color:#888">삼성증권 PB센터</p>
  </div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function process(req: Request): Promise<{ ok: boolean; title: string; message: string }> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("c")?.trim() ?? "";
  const token = url.searchParams.get("t")?.trim() ?? "";

  const secret = unsubscribeSecret();
  if (!secret) {
    return {
      ok: false,
      title: "처리할 수 없습니다",
      message:
        "서버에 수신거부 서명키가 설정되어 있지 않습니다. 담당 PB에게 알려주시면 직접 처리해 드립니다.",
    };
  }
  if (!clientId || !token || !verifyUnsubscribeToken(clientId, token, secret)) {
    return {
      ok: false,
      title: "링크가 올바르지 않습니다",
      message: "주소가 잘린 링크일 수 있습니다. 메일의 수신거부 링크를 다시 눌러 주세요.",
    };
  }

  try {
    const { alreadyOptedOut } = await optOutFromBriefing(clientId);
    return alreadyOptedOut
      ? { ok: true, title: "이미 수신거부 상태입니다", message: "추가로 하실 일은 없습니다. 앞으로 모닝 브리핑은 발송되지 않습니다." }
      : { ok: true, title: "수신거부가 완료되었습니다", message: "앞으로 모닝 브리핑 메일은 발송되지 않습니다. 다시 받아보시려면 담당 PB에게 말씀해 주세요." };
  } catch (e: any) {
    console.error("[/api/briefing/unsubscribe]", e);
    return {
      ok: false,
      title: "처리 중 오류가 발생했습니다",
      message: "잠시 후 다시 시도하시거나, 담당 PB에게 알려주시면 직접 처리해 드립니다.",
    };
  }
}

export async function GET(req: Request) {
  const r = await process(req);
  return page(r.title, r.message, r.ok ? "ok" : "error");
}

// RFC 8058 원클릭 — 메일 클라이언트가 사용자 확인 없이 POST 한다. 본문은 보지 않는다.
export async function POST(req: Request) {
  const r = await process(req);
  return NextResponse.json({ ok: r.ok, message: r.message }, { status: r.ok ? 200 : 400 });
}
