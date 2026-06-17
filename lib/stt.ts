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

  // CLOVA Speech: multipart 'media' + 'params'(json) 업로드. 화자분리(diarization) 켬.
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio)], { type: contentType || "application/octet-stream" });
  form.append("media", blob, "audio");
  form.append(
    "params",
    JSON.stringify({
      language: "ko-KR",
      completion: "sync",
      format: "JSON",
      diarization: { enable: true }, // 화자 분리 (PB ↔ 고객)
    }),
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
  return { text: assembleBySpeaker(json), provider: "clova" };
}

// CLOVA 응답 segments를 화자별로 묶어 "화자1: …\n화자2: …" 형태로 만든다.
// (화자 정보가 없으면 전체 text 그대로)
function assembleBySpeaker(json: any): string {
  const segs: any[] = Array.isArray(json?.segments) ? json.segments : [];
  if (segs.length === 0) return (json?.text ?? "").trim();

  const parts: string[] = [];
  let curSpk: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    parts.push((curSpk ? `화자${curSpk}: ` : "") + buf.join(" ").trim());
    buf = [];
  };
  for (const s of segs) {
    const spk = s?.speaker?.label != null ? String(s.speaker.label) : null;
    if (spk !== curSpk) {
      flush();
      curSpk = spk;
    }
    if (s?.text) buf.push(String(s.text).trim());
  }
  flush();
  return parts.join("\n").trim();
}

// ── OpenAI Whisper (대체) ──
async function transcribeWithWhisper(audio: Buffer, contentType: string): Promise<SttResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new SttNotConfiguredError(
      "OPENAI_API_KEY 가 설정되지 않았습니다 (Whisper 대체 경로).",
    );
  }
  // 실제 포맷에 맞는 파일명/타입을 줘야 OpenAI가 파싱함(과거: audio.mp3 강제 → webm/wav 거부됨)
  const ct = (contentType || "audio/webm").split(";")[0].trim().toLowerCase();
  const extMap: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/oga": "oga",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "m4a",
    "audio/flac": "flac",
  };
  const ext = extMap[ct] ?? "webm";
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio)], { type: ct });
  form.append("file", blob, `audio.${ext}`);
  // gpt-4o-mini-transcribe: whisper-1보다 정확하고 저렴(한국어 양호). 필요시 env로 교체.
  form.append("model", process.env.OPENAI_STT_MODEL?.trim() || "gpt-4o-mini-transcribe");
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
