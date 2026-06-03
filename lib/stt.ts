// 음성 → 텍스트 (STT). 서버 라우트 전용.
// 기본: 네이버 CLOVA Speech. Whisper(OpenAI)로 교체 가능하도록 분리.
// 키가 비어 있으면 명확한 안내 에러를 던진다(앱이 죽지 않게 라우트에서 try/catch).

export interface SttResult {
  text: string;
  provider: "clova" | "whisper";
}

export class SttNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttNotConfiguredError";
  }
}

// 업로드 제한 (비용 안전장치)
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_AUDIO_SECONDS = 10 * 60; // 10분 (참고용 — 클라이언트 검사 보조)

// ── CLOVA Speech ──
async function transcribeWithClova(audio: Buffer, contentType: string): Promise<SttResult> {
  const invokeUrl = process.env.CLOVA_SPEECH_INVOKE_URL?.trim();
  const secret = process.env.CLOVA_SPEECH_SECRET?.trim();
  if (!invokeUrl || !secret) {
    throw new SttNotConfiguredError(
      "CLOVA Speech 키가 설정되지 않았습니다. .env.local 에 CLOVA_SPEECH_INVOKE_URL / CLOVA_SPEECH_SECRET 를 채우거나, 음성 변환 대신 전문 텍스트를 직접 입력하세요.",
    );
  }

  // CLOVA Speech: multipart 'media' + 'params'(json) 업로드
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio)], { type: contentType || "application/octet-stream" });
  form.append("media", blob, "audio");
  form.append(
    "params",
    JSON.stringify({ language: "ko-KR", completion: "sync", format: "JSON" }),
  );

  const res = await fetch(`${invokeUrl}/recognizer/upload`, {
    method: "POST",
    headers: { "X-CLOVASPEECH-API-KEY": secret },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CLOVA Speech 오류 (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const text: string = json.text ?? json.segments?.map((s: any) => s.text).join(" ") ?? "";
  return { text: text.trim(), provider: "clova" };
}

// ── OpenAI Whisper (대체) ──
async function transcribeWithWhisper(audio: Buffer, contentType: string): Promise<SttResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new SttNotConfiguredError(
      "OPENAI_API_KEY 가 설정되지 않았습니다 (Whisper 대체 경로).",
    );
  }
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio)], { type: contentType || "audio/mpeg" });
  form.append("file", blob, "audio.mp3");
  form.append("model", "whisper-1");
  form.append("language", "ko");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper 오류 (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return { text: (json.text ?? "").trim(), provider: "whisper" };
}

// 진입점: CLOVA 우선, 키 없으면 Whisper 시도, 둘 다 없으면 안내 에러.
export async function transcribe(audio: Buffer, contentType: string): Promise<SttResult> {
  const hasClova =
    !!process.env.CLOVA_SPEECH_INVOKE_URL?.trim() &&
    !!process.env.CLOVA_SPEECH_SECRET?.trim();
  const hasWhisper = !!process.env.OPENAI_API_KEY?.trim();

  if (hasClova) return transcribeWithClova(audio, contentType);
  if (hasWhisper) return transcribeWithWhisper(audio, contentType);

  throw new SttNotConfiguredError(
    "음성 변환(STT) 키가 없습니다. CLOVA 또는 OpenAI 키를 .env.local 에 설정하거나, 전문 텍스트를 직접 입력하세요.",
  );
}
