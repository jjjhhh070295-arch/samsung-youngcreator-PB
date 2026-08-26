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
  "화자1: 안녕하세요, 오늘 상담 도와드릴 담당 PB입니다. 어떤 부분이 가장 고민이세요?\n화자2: 제가 은퇴까지 한 7년 정도 보고 있고요, 안정적으로 연 6에서 8퍼센트 정도 수익이면 좋겠어요. 원금 손실은 15퍼센트 이내라면 감수할 수 있습니다.\n화자1: 자금 사용 계획은 어떻게 되세요?\n화자2: 3년 뒤에 자녀 학자금으로 목돈이 필요하고, 최근 금융소득종합과세 대상이 돼서 세금도 신경 쓰입니다.",
  "화자1: 법인 자금 운용 목적으로 오셨네요. 제약 조건이 있으실까요?\n화자2: 네, 이사회 승인 한도 내에서만 투자가 가능합니다. 기대 수익률은 연 5에서 6퍼센트 수준이고 과도한 위험은 피하고 싶어요. 5년 정도는 묶어둘 수 있는데, 내후년 설비 투자 때 일부 인출이 필요할 수 있습니다.",
  "화자1: 투자 성향을 여쭤볼게요.\n화자2: 저는 보수적이에요. 원금 보전이 제일 중요하고, 예금보다 조금 더 나은 정도면 만족합니다. 언제든 일부 자금은 찾을 수 있어야 하고, 투자 기간은 3년 이내로 짧게 보고 있어요.",
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
        note: "샘플(더미) 변환 결과입니다. 실제 음성 변환은 음성 변환 키를 설정하면 동작합니다.",
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
