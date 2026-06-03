import { NextResponse } from "next/server";
import {
  transcribe,
  SttNotConfiguredError,
  MAX_AUDIO_BYTES,
} from "@/lib/stt";

export const runtime = "nodejs";
export const maxDuration = 60;

// STT 키가 하나도 없으면 흐름 시연용 더미 변환 텍스트를 사용한다.
function sttConfigured(): boolean {
  return (
    (!!process.env.CLOVA_SPEECH_INVOKE_URL?.trim() &&
      !!process.env.CLOVA_SPEECH_SECRET?.trim()) ||
    !!process.env.OPENAI_API_KEY?.trim()
  );
}

const DUMMY_TRANSCRIPTS = [
  "고객님은 은퇴까지 약 7년 정도를 보고 계시고, 안정적으로 연 6에서 8퍼센트 수익을 원한다고 하셨습니다. 원금 손실은 15퍼센트 이내라면 감내할 수 있다고 하셨고, 3년 뒤 자녀 학자금으로 목돈이 필요하다고 합니다. 최근 금융소득종합과세 대상이 되어 세금 부분도 신경 쓰고 계십니다.",
  "법인 여유자금을 운용하려는 목적이며, 이사회 승인 한도 내에서만 투자가 가능하다고 하셨습니다. 기대 수익률은 연 5에서 6퍼센트 수준이고, 과도한 위험은 지양하길 원합니다. 5년 정도는 자금을 묶어둘 수 있으나, 내후년 설비 투자 시점에 일부 인출이 필요할 수 있습니다.",
  "보수적인 성향으로 원금 보전을 가장 중요하게 생각하십니다. 예금보다 조금 더 나은 정도면 만족한다고 하셨고, 언제든 일부 자금은 찾을 수 있어야 한다고 강조하셨습니다. 투자 기간은 3년 이내로 짧게 보고 계십니다.",
];

// 음성 파일 → 텍스트. 길이/용량 검사 후 lib/stt.ts 호출.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "오디오 파일이 없습니다." },
        { status: 400 },
      );
    }

    // 용량 제한 (비용 안전장치)
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `파일이 너무 큽니다. 최대 ${Math.round(
            MAX_AUDIO_BYTES / (1024 * 1024),
          )}MB 까지 업로드할 수 있습니다.`,
        },
        { status: 413 },
      );
    }

    // 키가 없으면 더미(샘플) 변환 텍스트 반환
    if (!sttConfigured()) {
      const text = DUMMY_TRANSCRIPTS[Math.floor(Math.random() * DUMMY_TRANSCRIPTS.length)];
      return NextResponse.json({
        ok: true,
        dummy: true,
        text,
        provider: "dummy",
        note: "샘플(더미) 변환 결과입니다. 실제 음성 변환은 CLOVA 또는 OpenAI 키를 설정하면 동작합니다.",
      });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = await transcribe(buf, file.type || "application/octet-stream");

    return NextResponse.json({ ok: true, text: result.text, provider: result.provider });
  } catch (e: any) {
    if (e instanceof SttNotConfiguredError) {
      return NextResponse.json(
        { ok: false, code: "NO_KEY", error: e.message },
        { status: 200 },
      );
    }
    console.error("[/api/transcribe]", e);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error:
          "음성 변환 중 오류가 발생했습니다. 전문 텍스트를 직접 입력하세요. (" +
          (e?.message ?? "unknown") +
          ")",
      },
      { status: 200 },
    );
  }
}
