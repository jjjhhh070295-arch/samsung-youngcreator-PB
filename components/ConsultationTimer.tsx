"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";

interface Props {
  // 상담 종료 시 호출: 시작/종료 시각 + 소요(초)
  onEnd: (info: { startedAt: string; endedAt: string; durationSeconds: number }) => void;
  onRunningChange?: (running: boolean) => void;
  disabled?: boolean;
}

// 상담 타이머: [+ 새 상담 시작] → 실시간 경과 → [상담 종료]
export default function ConsultationTimer({ onEnd, onRunningChange, disabled }: Props) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const startIsoRef = useRef<string>("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const start = () => {
    startRef.current = Date.now();
    startIsoRef.current = new Date().toISOString();
    setElapsed(0);
    setRunning(true);
    onRunningChange?.(true);
    tickRef.current = setInterval(() => {
      if (startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
  };

  const end = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    const endIso = new Date().toISOString();
    const duration = startRef.current
      ? Math.floor((Date.now() - startRef.current) / 1000)
      : elapsed;
    setRunning(false);
    onRunningChange?.(false);
    onEnd({
      startedAt: startIsoRef.current,
      endedAt: endIso,
      durationSeconds: duration,
    });
    setElapsed(0);
    startRef.current = null;
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
      <span className={`text-lg ${running ? "animate-pulse text-red-500" : "text-fg-muted"}`}>
        ●
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-fg">
        {formatDuration(elapsed)}
      </span>
      {!running ? (
        <button className="btn-gold ml-auto text-sm" onClick={start} disabled={disabled}>
          + 새 상담 시작
        </button>
      ) : (
        <button className="btn-primary ml-auto text-sm" onClick={end}>
          상담 종료 · 저장 ✓
        </button>
      )}
    </div>
  );
}
