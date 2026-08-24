import { NextResponse } from "next/server";
import {
  consumePrintToken,
  verifyAndIssuePrintToken,
  type VerificationIds,
} from "@/lib/advisory/serverVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_KEYS = new Set(["clientId", "pbId", "evidenceId"]);
const CONSUME_KEYS = new Set(["clientId", "pbId", "evidenceId", "printToken"]);

function parseIds(value: unknown): VerificationIds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ID_KEYS.has(key))) return null;
  if (
    typeof body.clientId !== "string" ||
    typeof body.pbId !== "string" ||
    typeof body.evidenceId !== "string"
  ) {
    return null;
  }
  const ids = {
    clientId: body.clientId.trim(),
    pbId: body.pbId.trim(),
    evidenceId: body.evidenceId.trim(),
  };
  return ids.clientId && ids.pbId && ids.evidenceId ? ids : null;
}

function parseConsume(value: unknown): { ids: VerificationIds; printToken: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !CONSUME_KEYS.has(key))) return null;
  const ids = parseIds({
    clientId: body.clientId,
    pbId: body.pbId,
    evidenceId: body.evidenceId,
  });
  const printToken = typeof body.printToken === "string" ? body.printToken.trim() : "";
  return ids && printToken ? { ids, printToken } : null;
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, verified: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  const ids = parseIds(raw);
  if (!ids) {
    return NextResponse.json(
      {
        ok: false,
        verified: false,
        error: "clientId, pbId, 검토 기록 ID만 전송해야 합니다. 고객 원본 객체는 신뢰하지 않습니다.",
      },
      { status: 400 },
    );
  }

  const result = await verifyAndIssuePrintToken(ids);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        verified: false,
        mode: result.mode,
        reasons: [result.reason],
      },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store, private" },
  });
}

/** 발급된 출력 토큰을 첫 시도에 소진하는 단계. */
export async function PATCH(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, permitted: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  const parsed = parseConsume(raw);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, permitted: false, error: "출력 토큰과 고객·PB·검토 기록 식별자가 필요합니다." },
      { status: 400 },
    );
  }
  const result = await consumePrintToken(parsed.printToken, parsed.ids);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        permitted: false,
        mode: result.mode,
        reasons: [result.reason],
      },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store, private" },
  });
}
