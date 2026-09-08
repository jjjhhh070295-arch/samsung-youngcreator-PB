// 모닝 브리핑 고객 발송 — 오늘자 daily_reports 1건을 수신동의 고객에게 메일로 보낸다.
//
// GET  = Vercel Cron 진입점(크론은 GET 으로 호출한다). 실발송.
// POST = 수동 트리거. 실발송하려면 { confirm: true } 가 있어야 한다 —
//        확인 없이 전 고객에게 나가는 사고를 막으려고 크론 경로와 다르게 잠가 뒀다.
//        { dryRun: true } 는 대상만 계산하고, { testEmail } 은 그 주소 한 곳으로만 보낸다.
//
// 둘 다 Authorization: Bearer {BRIEFING_CRON_SECRET} 로 보호한다(lib/cronAuth.ts,
// fail-closed). 옛 이름 CRON_SECRET 도 폴백으로 받는다 — cronSecret() 참고.
//
// 발송 전 조건을 모두 통과해야 한 통이라도 나간다 — 하나라도 어긋나면 아무도 안 받는
// 상태가 조용히 성공으로 보고되는 게 최악이라, 시작 전에 전부 막는다:
//   ① Supabase 설정  ② RESEND_API_KEY  ③ 수신거부 서명키  ④ 오늘자 리포트 존재
//   ⑤ briefing_sends 테이블(이력 없이는 중복 발송을 막을 수 없다)
//   ⑥ 그 리포트가 승인 상태(status='approved') — 초안은 정의상 아직 내보낼 글이 아니다

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import {
  BriefingSendsTableMissingError,
  claimBriefingSend,
  finishBriefingSend,
  listBriefingSendClientIds,
  listEmailBriefingTargets,
  listPbBriefingProfiles,
  type PbBriefingProfile,
} from "@/lib/store";
import {
  buildFromHeader,
  buildReplyTo,
  buildUnsubscribeUrl,
  isResendConfigured,
  isVerifiedSenderConfigured,
  renderBriefingEmail,
  resolvePublicBaseUrl,
  sendBriefingEmail,
  unsubscribeSecret,
} from "@/lib/briefing/email";

export const runtime = "nodejs";
export const maxDuration = 300;

// Resend 기본 레이트리밋이 초당 2건이라 순차 발송 사이에 간격을 둔다. 고객 수가
// 수백을 넘어가면 이 방식으로는 maxDuration 을 넘기므로 그때는 큐가 필요하다.
const SEND_INTERVAL_MS = 600;

const MISSING_TABLE_ERROR_CODES = new Set(["42P01", "PGRST205"]);

// daily_reports.status 의 어휘는 마이그레이션 정의가 유일한 기준이다:
//   supabase-migration-daily-reports.sql:25
//     status text not null default 'draft'   -- draft | approved
// 이 두 값이 전부다. generate 라우트는 항상 'draft' 로 넣으므로, 승인은 사람이 명시적으로
// status 를 'approved' 로 바꿔야만 성립한다 — 그게 이 게이트의 요점이다.
const SENDABLE_REPORT_STATUS = "approved";

function kstDateString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SendOptions {
  reportDate?: string;
  dryRun?: boolean;
  testEmail?: string;
  confirm?: boolean;
  /** 안전장치 — 지정하면 그 수만큼만 보낸다. */
  limit?: number;
}

interface SendOutcome {
  clientId: string;
  email: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

async function runSend(req: Request, opts: SendOptions) {
  if (!supabase) {
    return NextResponse.json(
      { ok: false, code: "NO_DB", error: "Supabase가 설정되지 않았습니다(.env.local 확인)." },
      { status: 200 },
    );
  }
  if (!isResendConfigured()) {
    return NextResponse.json(
      { ok: false, code: "NO_EMAIL_KEY", error: "RESEND_API_KEY 가 설정되지 않았습니다." },
      { status: 200 },
    );
  }

  const secret = unsubscribeSecret();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_UNSUBSCRIBE_SECRET",
        error:
          "UNSUBSCRIBE_SECRET(또는 BRIEFING_CRON_SECRET / CRON_SECRET)이 없어 수신거부 링크에 서명할 수 없습니다. 수신거부 수단 없이는 발송하지 않습니다.",
      },
      { status: 200 },
    );
  }

  const reportDate = opts.reportDate?.trim() || kstDateString();

  const { data: report, error: reportError } = await supabase
    .from("daily_reports")
    .select("id, report_date, headline, html_body, text_body, status")
    .eq("report_date", reportDate)
    .maybeSingle();

  if (reportError) {
    if (MISSING_TABLE_ERROR_CODES.has((reportError as any).code)) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_TABLE",
          error:
            "daily_reports 테이블이 아직 없습니다. supabase-migration-daily-reports.sql 을 먼저 실행하세요.",
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", error: reportError.message }, { status: 200 });
  }
  if (!report) {
    return NextResponse.json(
      { ok: false, code: "NO_REPORT", error: `${reportDate} 리포트가 없습니다. 먼저 생성하세요.` },
      { status: 200 },
    );
  }

  const baseUrl = resolvePublicBaseUrl(req);

  // ── 테스트 발송 — 지정한 한 주소로만 보내고 이력은 남기지 않는다 ──
  // 실제 고객 목록을 건드리지 않으려고 대상 조회보다 먼저 분기한다.
  if (opts.testEmail) {
    const to = opts.testEmail.trim();
    const rendered = renderBriefingEmail({
      reportDate: report.report_date,
      headline: report.headline ?? "",
      htmlBody: report.html_body ?? "",
      textBody: report.text_body ?? "",
      pb: null,
      unsubscribeUrl: buildUnsubscribeUrl(baseUrl, "test-recipient", secret),
      testMode: true,
    });
    const result = await sendBriefingEmail({
      to,
      from: buildFromHeader(null),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: buildUnsubscribeUrl(baseUrl, "test-recipient", secret),
    });
    return NextResponse.json({
      ok: result.ok,
      mode: "test",
      reportDate: report.report_date,
      // 테스트는 승인 게이트를 건너뛴다(아래 주석 참고). 초안으로 테스트했다는 사실이
      // 응답에서 바로 보이도록 status 를 실어 준다.
      reportStatus: report.status ?? null,
      to,
      from: buildFromHeader(null),
      verifiedSenderDomain: isVerifiedSenderConfigured(),
      messageId: result.messageId,
      error: result.error,
    });
  }

  // ── 승인 게이트 ──
  // 초안(draft)은 정의상 아직 밖으로 내보낼 글이 아니다. 리포트 존재만 확인하고 보내면
  // 검토 전 원고가 그대로 고객에게 나간다.
  //
  // 예외가 둘 있고, 둘 다 "고객에게 아무것도 가지 않는" 경로다:
  //   · testEmail — 위에서 이미 반환됐다. 호출자가 직접 적은 주소 한 곳으로만 가고
  //     고객 목록을 조회하지도, 이력을 남기지도 않는다. 여기를 막으면 승인 전에는
  //     발송 배관(Resend 연결·렌더링·수신거부 링크)을 검증할 방법이 사라져서,
  //     "검증 → 승인 → 발송" 순서가 뒤집힌다.
  //   · dryRun — 대상 계산만 하고 0통 보낸다. 막는 대신 응답에 reportApproved 를
  //     실어, 실발송이 막힐 상태라는 걸 미리 알려준다.
  //
  // 승인 화면은 아직 없다. 당분간 Supabase SQL Editor 에서 직접 바꾼다:
  //   update daily_reports set status = 'approved' where report_date = '2026-09-04';
  const reportApproved = report.status === SENDABLE_REPORT_STATUS;
  if (!reportApproved && !opts.dryRun) {
    return NextResponse.json(
      {
        ok: false,
        code: "REPORT_NOT_APPROVED",
        reportDate: report.report_date,
        reportStatus: report.status ?? null,
        error:
          `${report.report_date} 리포트가 아직 승인되지 않았습니다(status: ${report.status ?? "null"}). ` +
          `발송은 status='${SENDABLE_REPORT_STATUS}' 인 리포트만 가능합니다. ` +
          `검토 후 daily_reports.status 를 '${SENDABLE_REPORT_STATUS}' 로 바꾸세요.`,
      },
      { status: 200 },
    );
  }

  // ── 실발송 대상 ──
  const targets = await listEmailBriefingTargets();

  let alreadySent: Set<string>;
  try {
    alreadySent = await listBriefingSendClientIds(report.id);
  } catch (e) {
    if (e instanceof BriefingSendsTableMissingError) {
      return NextResponse.json({ ok: false, code: "NO_SENDS_TABLE", error: e.message }, { status: 200 });
    }
    throw e;
  }

  const pending = targets.filter((t) => !alreadySent.has(t.clientId));
  const capped = typeof opts.limit === "number" ? pending.slice(0, Math.max(0, opts.limit)) : pending;

  if (opts.dryRun) {
    return NextResponse.json({
      ok: true,
      mode: "dryRun",
      reportDate: report.report_date,
      reportStatus: report.status,
      // false 면 지금 confirm 을 붙여도 REPORT_NOT_APPROVED 로 막힌다.
      reportApproved,
      verifiedSenderDomain: isVerifiedSenderConfigured(),
      totals: { targets: targets.length, alreadySent: alreadySent.size, wouldSend: capped.length },
      recipients: capped.map((t) => ({ clientId: t.clientId, email: t.email, pbId: t.assignedPbId })),
    });
  }

  if (!opts.confirm) {
    return NextResponse.json(
      {
        ok: false,
        code: "CONFIRM_REQUIRED",
        error: "실발송에는 confirm:true 가 필요합니다. 먼저 dryRun 으로 대상을 확인하세요.",
        totals: { targets: targets.length, alreadySent: alreadySent.size, wouldSend: capped.length },
      },
      { status: 200 },
    );
  }

  // 대상이 0명인 것은 성공이 아니다 — 마이그레이션 미실행이나 동의자 부재를
  // 조용히 넘기면 "매일 보내는 줄 알았는데 아무도 못 받는" 상태가 된다.
  if (targets.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_RECIPIENTS",
        error:
          "수신 동의 고객이 0명입니다. parties.email/email_opt_in 이 채워져 있는지, 모닝 브리핑 마이그레이션이 실행됐는지 확인하세요.",
      },
      { status: 200 },
    );
  }

  const pbProfiles = await listPbBriefingProfiles(capped.map((t) => t.assignedPbId));

  const outcomes: SendOutcome[] = [];
  for (let i = 0; i < capped.length; i++) {
    const target = capped[i];
    const pb: PbBriefingProfile | null = pbProfiles.get(target.assignedPbId) ?? null;

    let claim: { claimed: boolean; id?: string };
    try {
      claim = await claimBriefingSend({
        reportId: report.id,
        clientId: target.clientId,
        pbId: target.assignedPbId || null,
        email: target.email,
      });
    } catch (e: any) {
      outcomes.push({ clientId: target.clientId, email: target.email, status: "failed", error: e?.message });
      continue;
    }
    if (!claim.claimed) {
      outcomes.push({ clientId: target.clientId, email: target.email, status: "skipped" });
      continue;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(baseUrl, target.clientId, secret);
    const rendered = renderBriefingEmail({
      reportDate: report.report_date,
      headline: report.headline ?? "",
      htmlBody: report.html_body ?? "",
      textBody: report.text_body ?? "",
      pb,
      unsubscribeUrl,
    });

    const result = await sendBriefingEmail({
      to: target.email,
      from: buildFromHeader(pb),
      replyTo: buildReplyTo(pb),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl,
    });

    if (claim.id) await finishBriefingSend(claim.id, result);
    outcomes.push({
      clientId: target.clientId,
      email: target.email,
      status: result.ok ? "sent" : "failed",
      error: result.error,
    });

    if (i < capped.length - 1) await sleep(SEND_INTERVAL_MS);
  }

  const sent = outcomes.filter((o) => o.status === "sent").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  return NextResponse.json({
    ok: failed === 0,
    mode: "send",
    reportDate: report.report_date,
    verifiedSenderDomain: isVerifiedSenderConfigured(),
    totals: { targets: targets.length, alreadySent: alreadySent.size, sent, failed, skipped },
    outcomes,
  });
}

// Vercel Cron 은 GET 으로 호출한다 — 크론 경로는 확인 플래그 없이 바로 실발송한다.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await runSend(req, { confirm: true });
  } catch (e: any) {
    console.error("[/api/briefing/send GET]", e);
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", error: e?.message ?? "발송 실패" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as SendOptions;
  try {
    return await runSend(req, body ?? {});
  } catch (e: any) {
    console.error("[/api/briefing/send POST]", e);
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", error: e?.message ?? "발송 실패" }, { status: 200 });
  }
}
