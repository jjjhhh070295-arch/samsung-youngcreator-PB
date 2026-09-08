// 모닝 브리핑 이메일 — 발신자 구성 · 수신거부 토큰 · 본문 조립 · Resend 호출.
//
// 라우트가 아니라 여기에 모아둔 이유: 발송 라우트(app/api/briefing/send)와 수신거부
// 라우트(app/api/briefing/unsubscribe)가 같은 토큰 규칙을 써야 하는데, 둘 중 한쪽에
// 두면 다른 쪽이 그 파일을 import 하게 되어 라우트끼리 얽힌다.

import { Resend } from "resend";
import crypto from "node:crypto";

// ── 발신 도메인 ────────────────────────────────────────────────────────────
// Resend 는 "검증된 도메인"에서만 임의 주소로 발신할 수 있다. 도메인 검증 전에는
// onboarding@resend.dev 로만 보낼 수 있고, 그마저도 Resend 계정 소유자 본인 주소로만
// 배달된다(다른 수신자는 403 으로 거부된다).
//
// 그래서 주소는 환경변수로 빼고 기본값을 resend.dev 로 둔다 — 도메인을 검증하면
// BRIEFING_FROM_EMAIL 만 바꿔 끼우면 코드 수정 없이 실발송으로 넘어간다.
const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";

export function fromEmailAddress(): string {
  return process.env.BRIEFING_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
}

/** 검증된 자체 도메인을 쓰고 있는가 — 실발송 가능 여부 판정에 쓴다. */
export function isVerifiedSenderConfigured(): boolean {
  return fromEmailAddress() !== DEFAULT_FROM_EMAIL;
}

export interface PbIdentity {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * From 헤더. 주소는 위 제약 때문에 공용이지만 표시 이름은 PB 명의로 만든다 —
 * 받는 사람 받은편지함에 뜨는 건 표시 이름이라, 도메인 검증 전에도 "누가 보냈는지"는
 * 제대로 전달된다.
 *   예) 김영수 팀장 · 삼성증권 PB센터 <onboarding@resend.dev>
 *
 * 표시 이름에 쉼표·따옴표가 들어가면 헤더가 깨지므로 제거한다(PB 이름은 사람이 입력한다).
 */
export function buildFromHeader(pb: PbIdentity | null): string {
  const safe = (s: string) => s.replace(/["\\,<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
  const who = pb ? [safe(pb.name), pb.title ? safe(pb.title) : ""].filter(Boolean).join(" ") : "";
  const label = who ? `${who} · 삼성증권 PB센터` : "삼성증권 PB센터";
  return `${label} <${fromEmailAddress()}>`;
}

/** Reply-To 는 담당 PB 개인 주소. 없으면 헤더를 아예 붙이지 않는다(빈 값은 배달을 깨뜨린다). */
export function buildReplyTo(pb: PbIdentity | null): string | undefined {
  const email = pb?.email?.trim();
  return email ? email : undefined;
}

// ── 수신거부 토큰 ──────────────────────────────────────────────────────────
// 링크 하나로 남의 수신거부를 눌러버릴 수 있으면 안 되므로 clientId 에 HMAC 을 건다.
// 비밀키는 전용 값(UNSUBSCRIBE_SECRET)을 우선하고, 없으면 크론 시크릿을 재사용한다.
// 크론 시크릿은 BRIEFING_CRON_SECRET → CRON_SECRET 순서다(lib/cronAuth.ts 의 cronSecret
// 과 같은 우선순위 — Vercel 이 CRON_SECRET 을 예약어로 막아 이름을 옮기는 중이다).
// 셋 다 없으면 null — 이때 발송 라우트는 아예 보내지 않는다. 수신거부 수단이 없는
// 브리핑은 보내면 안 되기 때문이다(정보통신망법).
//
// ⚠️ 폴백 대상이 바뀌면 이미 발송된 메일의 수신거부 링크 서명이 깨진다. 두 이름에 같은
//    값을 넣어 두고 옮겨야 한다 — 값이 달라지면 기존 링크가 전부 무효가 된다.
export function unsubscribeSecret(): string | null {
  return (
    process.env.UNSUBSCRIBE_SECRET?.trim() ||
    process.env.BRIEFING_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null
  );
}

export function buildUnsubscribeToken(clientId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(clientId).digest("hex").slice(0, 32);
}

/** 타이밍 공격을 피하려고 길이를 맞춘 뒤 timingSafeEqual 로 비교한다. */
export function verifyUnsubscribeToken(clientId: string, token: string, secret: string): boolean {
  const expected = buildUnsubscribeToken(clientId, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(token ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 메일 안에 넣을 절대 URL의 기준. 상대 경로는 메일 클라이언트에서 동작하지 않는다.
 * 명시 설정 → Vercel 배포 URL → 요청 origin 순. cron 호출도 자기 배포 호스트로 들어오므로
 * 마지막 폴백이 실제로 맞는 값을 준다.
 */
export function resolvePublicBaseUrl(req: Request): string {
  const explicit = process.env.BRIEFING_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return new URL(req.url).origin;
}

export function buildUnsubscribeUrl(baseUrl: string, clientId: string, secret: string): string {
  const token = buildUnsubscribeToken(clientId, secret);
  return `${baseUrl}/api/briefing/unsubscribe?c=${encodeURIComponent(clientId)}&t=${token}`;
}

// ── 본문 조립 ──────────────────────────────────────────────────────────────
// 리포트 본문(html_body)은 LLM 이 만든 완성 HTML 이다. 여기서는 손대지 않고 아래에
// 서명 + 수신거부 블록만 덧붙인다 — 본문을 파싱해 끼워 넣으려 하면 LLM 출력 형태가
// 조금만 달라져도 깨진다.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function signatureLines(pb: PbIdentity | null): string[] {
  if (!pb) return [];
  return [
    [pb.name, pb.title].filter(Boolean).join(" "),
    pb.email ?? "",
    pb.phone ?? "",
  ].filter(Boolean) as string[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderBriefingEmail(params: {
  reportDate: string;
  headline: string;
  htmlBody: string;
  textBody: string;
  pb: PbIdentity | null;
  unsubscribeUrl: string;
  /** 테스트 발송이면 제목에 표시해 실제 발송과 섞이지 않게 한다. */
  testMode?: boolean;
}): RenderedEmail {
  const { reportDate, headline, htmlBody, textBody, pb, unsubscribeUrl, testMode } = params;

  const prefix = process.env.BRIEFING_SUBJECT_PREFIX?.trim();
  const subject = [
    testMode ? "[테스트]" : "",
    prefix ?? "",
    `[${reportDate}] 데일리 마켓 인사이트`,
    headline ? `— ${headline}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);

  const sig = signatureLines(pb);
  const sigHtml = sig.length
    ? `<p style="margin:0 0 12px;color:#555;font-size:13px;line-height:1.7">${sig
        .map(escapeHtml)
        .join("<br>")}</p>`
    : "";

  const footerHtml = `
<div style="background:#fff;color:#1a1a1a;margin-top:28px;padding-top:16px;border-top:1px solid #e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif">
  ${sigHtml}
  <p style="margin:0 0 8px;color:#777;font-size:12px;line-height:1.7">
    본 메일은 모닝 브리핑 수신에 동의하신 고객님께 발송됩니다. 투자 참고자료이며 투자 권유가 아닙니다.
  </p>
  <p style="margin:0;font-size:12px">
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1f6fb2">수신거부</a>
  </p>
</div>`;

  const sigText = sig.length ? `\n${sig.join("\n")}\n` : "";
  const footerText = `
${"=".repeat(52)}
${sigText}본 메일은 모닝 브리핑 수신에 동의하신 고객님께 발송됩니다.
투자 참고자료이며 투자 권유가 아닙니다.

수신거부: ${unsubscribeUrl}
`;

  return {
    subject,
    html: `<div style="background:#fff;color:#1a1a1a">${htmlBody}${footerHtml}</div>`,
    text: `${textBody}\n${footerText}`,
  };
}

// ── 발송 ───────────────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

let cachedClient: Resend | null = null;

function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export async function sendBriefingEmail(params: {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<SendResult> {
  const client = resendClient();
  if (!client) return { ok: false, error: "RESEND_API_KEY 가 설정되지 않았습니다." };

  try {
    const { data, error } = await client.emails.send({
      from: params.from,
      to: [params.to],
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
      // 원클릭 수신거부 — Gmail/Yahoo 대량 발신자 요건이자, 본문 링크를 못 찾는
      // 수신자에게도 메일 클라이언트가 버튼을 띄워 준다.
      headers: {
        "List-Unsubscribe": `<${params.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (error) return { ok: false, error: `${error.name}: ${error.message}` };
    return { ok: true, messageId: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "발송 중 알 수 없는 오류" };
  }
}
