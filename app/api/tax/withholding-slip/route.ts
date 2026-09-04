import { NextRequest, NextResponse } from "next/server";
import {
  extractWithholdingSlipAmounts,
  withholdingExtractSucceeded,
} from "@/lib/withholdingSlipParse";

export const runtime = "nodejs";

/** 원천징수영수증 PDF → 이자/배당 추출 (추정 금지) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "PDF 파일이 필요합니다." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ ok: false, error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength < 100) {
      return NextResponse.json({ ok: false, error: "파일이 비어 있거나 손상되었습니다." }, { status: 400 });
    }

    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const plain = Array.isArray(text) ? text.join("\n") : String(text || "");
    const extract = extractWithholdingSlipAmounts(plain);
    const ok = withholdingExtractSucceeded(extract);

    return NextResponse.json({
      ok,
      fileName: file.name,
      extract,
      parseStatus: ok ? "parsed" : "parse_failed",
      message: ok
        ? "원천징수영수증에서 금융소득을 추출했습니다. 추출값을 확인하고 필요 시 수정하세요."
        : "필요한 금융소득 금액을 읽지 못했습니다. 수동 입력이 필요합니다.",
    });
  } catch (error) {
    console.error("[withholding-slip]", error);
    return NextResponse.json(
      {
        ok: false,
        parseStatus: "parse_failed",
        error: "PDF 파싱에 실패했습니다. 수동 입력이 필요합니다.",
      },
      { status: 500 },
    );
  }
}
