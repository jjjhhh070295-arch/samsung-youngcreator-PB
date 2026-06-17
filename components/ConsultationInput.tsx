"use client";

import { useRef, useState } from "react";
import type { IPS } from "@/lib/types";
import { MAX_AUDIO_BYTES } from "@/lib/stt";

type Tab = "text" | "manual" | "voice";

interface Props {
  notes: string;
  onNotesChange: (v: string) => void;
  onAiResult: (ips: IPS) => void; // AI 분석 성공 시 IPS 전달
  onRequestManualEdit: () => void; // ② 직접 입력 시 폼 잠금 해제 요청
  disabled?: boolean; // 잠금/상담 외 등
}

// 상담 입력 3방식 — 모두 RRTTLLU 결과(IPSForm)로 수렴
export default function ConsultationInput({
  notes,
  onNotesChange,
  onAiResult,
  onRequestManualEdit,
  disabled,
}: Props) {
  const [tab, setTab] = useState<Tab>("text");
  const [analyzing, setAnalyzing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [msg, setMsg] = useState<{ type: "info" | "error" | "ok"; text: string } | null>(null);

  // 브라우저 실시간 녹음 (MediaRecorder)
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 0) {
          const ext = (mr.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
          onFile(new File([blob], `recording.${ext}`, { type: blob.type }));
        }
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      setRecSec(0);
      recTimerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch {
      setMsg({ type: "error", text: "마이크 권한이 필요합니다. 브라우저에서 마이크 사용을 허용하세요." });
    }
  };

  const stopRec = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  };

  const analyze = async () => {
    if (!notes.trim()) {
      setMsg({ type: "error", text: "분석할 전문 텍스트를 입력하세요." });
      return;
    }
    setAnalyzing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (data.ok && data.ips) {
        onAiResult(data.ips as IPS);
        setMsg({
          type: "ok",
          text: data.dummy
            ? (data.note ?? "샘플(더미) 결과가 채워졌습니다.") +
              " 7요인 폼에서 값을 확인·수정한 뒤 검토 확정하세요."
            : "AI 분석 완료. 아래 7요인 폼에 draft로 채워졌습니다. 검토 후 [검토 확정] → [저장 확정] 하세요.",
        });
      } else {
        // 키 없음 / 크레딧 소진 / 키 오류 / 파싱 실패 → 수동 입력 유도
        setMsg({ type: "error", text: data.error ?? "분석에 실패했습니다." });
        if (["NO_KEY", "NO_CREDIT", "BAD_KEY", "PARSE_FAILED"].includes(data.code)) {
          onRequestManualEdit();
          setTab("manual");
        }
      }
    } catch (e) {
      setMsg({
        type: "error",
        text: "분석 호출에 실패했습니다. 네트워크를 확인하거나 직접 입력하세요.",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const onFile = async (file: File) => {
    if (file.size > MAX_AUDIO_BYTES) {
      setMsg({
        type: "error",
        text: `파일이 너무 큽니다(최대 ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB).`,
      });
      return;
    }
    setTranscribing(true);
    setMsg({ type: "info", text: "음성을 텍스트로 변환 중…" });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok && typeof data.text === "string") {
        onNotesChange(notes ? `${notes}\n${data.text}` : data.text);
        setTab("text");
        setMsg({
          type: "ok",
          text: data.dummy
            ? (data.note ?? "샘플(더미) 변환 결과입니다.") +
              " ① 전문 텍스트 탭에 채워졌습니다. ⚠️ 숫자·화자(PB/고객) 오인식을 검토·수정한 뒤 [AI 분석]."
            : "변환 완료 → ① 전문 텍스트 탭. ⚠️ STT는 오타가 있을 수 있어요. 숫자·화자(PB/고객)를 검토·수정한 뒤 [AI 분석]을 누르세요.",
        });
      } else {
        setMsg({ type: "error", text: data.error ?? "음성 변환에 실패했습니다." });
      }
    } catch (e) {
      setMsg({ type: "error", text: "음성 변환 호출에 실패했습니다. 전문 텍스트를 직접 입력하세요." });
    } finally {
      setTranscribing(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "text", label: "① 전문 텍스트" },
    { key: "manual", label: "② 7요인 직접 입력" },
    { key: "voice", label: "③ 음성 업로드" },
  ];

  return (
    <div className="card p-4">
      {/* 탭 */}
      <div className="flex gap-1 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-navy-800 text-white dark:bg-navy-600"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-3">
        {tab === "text" && (
          <div>
            <textarea
              className="input min-h-[160px] resize-y"
              value={notes}
              placeholder="상담 내용을 장문으로 입력하거나 붙여넣으세요. (예: 고객 발언, 메모 등)"
              onChange={(e) => onNotesChange(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <button className="btn-primary text-sm" onClick={analyze} disabled={analyzing || disabled}>
                {analyzing ? "분석 중…" : "AI 분석"}
              </button>
              <span className="text-xs text-fg-muted">
                7요인을 자동 추출해 아래 폼에 draft로 채웁니다 (보수적 채점·근거 인용).
              </span>
            </div>
          </div>
        )}

        {tab === "manual" && (
          <div className="rounded-lg bg-surface-2 p-4 text-sm text-fg-muted">
            <p className="font-medium text-fg">7요인을 직접 입력합니다.</p>
            <p className="mt-1">
              아래 <b>RRTTLLU 결과 폼</b>에서 각 요인의 상태(직접 근거/추론/미언급)·값·점수·메모를
              직접 입력하세요. AI 없이 PB가 모든 값을 통제합니다.
            </p>
            <button className="btn-gold mt-3 text-sm" onClick={onRequestManualEdit} disabled={disabled}>
              아래 폼 편집 시작
            </button>
          </div>
        )}

        {tab === "voice" && (
          <div>
            {/* 실시간 녹음 */}
            <div className="mb-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 py-6">
              {recording ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-500">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    녹음 중 · {mmss(recSec)}
                  </div>
                  <button className="btn-danger text-sm" onClick={stopRec}>
                    ⏹ 녹음 중지 &amp; 변환
                  </button>
                </>
              ) : (
                <>
                  <span className="text-3xl">🎙️</span>
                  <button
                    className="btn-gold text-sm"
                    onClick={startRec}
                    disabled={transcribing || disabled}
                  >
                    ● 녹음 시작
                  </button>
                  <span className="text-xs text-fg-muted">
                    상담을 바로 녹음 → 중지하면 자동으로 변환됩니다.
                  </span>
                </>
              )}
            </div>

            <p className="mb-2 text-center text-xs text-fg-muted">— 또는 파일 업로드 —</p>

            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-8 text-center transition-colors hover:border-gold-400 ${
                disabled || recording ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <span className="text-3xl">🎙️</span>
              <span className="text-sm font-medium text-fg">
                {transcribing ? "변환 중…" : "음성 파일 선택 (클릭)"}
              </span>
              <span className="text-xs text-fg-muted">
                최대 {Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB / 약 10분. 짧은 테스트 음성만 사용하세요.
              </span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={transcribing || disabled}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="mt-2 text-xs text-fg-muted">
              변환된 텍스트는 ① 전문 텍스트 탭에 채워지고, [AI 분석]으로 7요인을 추출합니다.
            </p>
          </div>
        )}

        {msg && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.type === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : msg.type === "ok"
                  ? "bg-gold-50 text-gold-800 dark:bg-gold-900/30 dark:text-gold-200"
                  : "bg-surface-2 text-fg-muted"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
