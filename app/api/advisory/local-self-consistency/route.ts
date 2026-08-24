import { NextResponse } from "next/server";
import {
  registerEvidenceReceipt,
  type VerificationIds,
} from "@/lib/advisory/serverVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const REGISTER_KEYS = new Set(["clientId", "pbId", "evidenceId", "bundle"]);

function parseIds(value: Record<string, unknown>): VerificationIds | null {
  if (
    typeof value.clientId !== "string" ||
    typeof value.pbId !== "string" ||
    typeof value.evidenceId !== "string"
  ) return null;
  const ids = {
    clientId: value.clientId.trim(),
    pbId: value.pbId.trim(),
    evidenceId: value.evidenceId.trim(),
  };
  return ids.clientId && ids.pbId && ids.evidenceId ? ids : null;
}

function parseRegistration(value: unknown): { ids: VerificationIds; bundle: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !REGISTER_KEYS.has(key))) return null;
  const ids = parseIds(body);
  return ids && "bundle" in body ? { ids, bundle: body.bundle } : null;
}

/** 운영 검증과 분리된 로컬 데모 전용 자기일치 receipt 등록 단계. */
export async function PUT(req: Request) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, registered: false, mode: "local-self-consistency", error: "검토 기록 요청 크기가 너무 큽니다." },
      { status: 413 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, registered: false, mode: "local-self-consistency", error: "JSON이 필요합니다." },
      { status: 400 },
    );
  }
  const parsed = parseRegistration(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        ok: false,
        registered: false,
        mode: "local-self-consistency",
        error: "로컬 데모 clientId, pbId, evidenceId, bundle 형식이 필요합니다.",
      },
      { status: 400 },
    );
  }

  const result = await registerEvidenceReceipt(parsed.ids, parsed.bundle);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        registered: false,
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
