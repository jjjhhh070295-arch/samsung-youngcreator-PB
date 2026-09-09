// 고객 공유 링크 QR — SVG 를 이 서버에서 직접 만든다.
//
// 외부 QR 이미지 API 를 쓰지 않는 이유: 그 URL 은 살아 있는 자격증명이다. 제3자
// 서버에 넘기면 그쪽 액세스 로그에 고객 화면 열쇠가 그대로 남는다.
//
// 토큰을 검증한 뒤에만 그린다. 아무 문자열이나 QR 로 바꿔 주는 범용 인코더가 되면
// 이 엔드포인트가 남의 콘텐츠를 우리 도메인으로 실어 나르는 통로가 된다.

import QRCode from "qrcode";
import { clientViewSecret, verifyClientViewToken } from "@/lib/clientView/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveBaseUrl(req: Request): string {
  const explicit =
    process.env.BRIEFING_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const secret = clientViewSecret();
  if (!secret) return new Response("CLIENT_VIEW_SECRET 미설정", { status: 503 });

  const token = new URL(req.url).searchParams.get("t")?.trim() ?? "";
  const verified = verifyClientViewToken(token, secret);
  if (!verified.ok) {
    return new Response(verified.reason === "expired" ? "만료된 링크" : "잘못된 링크", {
      status: verified.reason === "expired" ? 410 : 401,
    });
  }

  const svg = await QRCode.toString(`${resolveBaseUrl(req)}/view/${token}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // 토큰이 URL 에 들어 있다. 공용 캐시에 남기지 않는다.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
