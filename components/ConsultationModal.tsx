"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Client, IPS, IPSFactor, FactorKey } from "@/lib/types";
import { FACTOR_KEYS } from "@/lib/types";
import { QUANT_FACTORS } from "@/lib/scoring";
import { createConsultation, updateClient } from "@/lib/store";
import { formatDuration, formatDurationKo } from "@/lib/format";
import ConsultationInput from "./ConsultationInput";
import IPSForm from "./IPSForm";
import IPSRadar from "./IPSRadar";

interface Props {
  open: boolean;
  client: Client;
  pbId: string;
  onClose: () => void;
  onSaved: () => void; // 저장 후 상위 새로고침
}

function cloneIps(ips: IPS): IPS {
  return JSON.parse(JSON.stringify(ips)) as IPS;
}

// 새 상담을 전용 모달로 진행: 타이머 → 내용 입력/AI 분석 → 7요인 편집 → 저장.
export default function ConsultationModal({ open, client, pbId, onClose, onSaved }: Props) {
  const router = useRouter();
  const [draftIps, setDraftIps] = useState<IPS>(() => cloneIps(client.ips));
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 정성 요인 AI 채점 상태 (훅은 조기 반환 위에서 선언해야 함)
  const [aiScoring, setAiScoring] = useState(false);
  const [aiMsg, setAiMsg] = useState("");

  // 타이머
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const startIsoRef = useRef("");
  const endIsoRef = useRef("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 모달이 열릴 때마다 새 상담으로 초기화
  useEffect(() => {
    if (open) {
      setDraftIps(cloneIps(client.ips));
      setNotes("");
      setDirty(false);
      setRunning(false);
      setElapsed(0);
      startRef.current = null;
      startIsoRef.current = "";
      endIsoRef.current = "";
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const startTimer = () => {
    startRef.current = Date.now();
    startIsoRef.current = new Date().toISOString();
    endIsoRef.current = "";
    setElapsed(0);
    setRunning(true);
    tickRef.current = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    endIsoRef.current = new Date().toISOString();
    if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    setRunning(false);
  };

  const factorChange = (key: FactorKey, factor: IPSFactor) => {
    setDraftIps((prev) => ({ ...prev, [key]: factor }));
    setDirty(true);
  };

  const onAiResult = (ips: IPS) => {
    setDraftIps(ips);
    setDirty(true);
  };

  // 정성 요인 AI 채점: 값이 적힌 정성 요인(세금·유동성·법적·고유)을 기준표 기준으로 1~5점.
  // 정량(수익률·위험·기간)은 입력 시 규칙으로 이미 자동 채점되므로 제외.
  const runFactorAI = async () => {
    const factors = FACTOR_KEYS.filter(
      (k) => !QUANT_FACTORS.includes(k) && draftIps[k].value?.trim(),
    ).map((k) => ({ key: k, value: draftIps[k].value }));
    if (factors.length === 0) {
      setAiMsg("AI로 채점할 정성 요인(값이 입력된)이 없어요.");
      return;
    }
    setAiScoring(true);
    setAiMsg("");
    try {
      const res = await fetch("/api/analyze/factors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factors }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAiMsg(data.error ?? "AI 채점 실패");
        return;
      }
      const scores: Record<string, { score: number; evidence: string }> = data.scores ?? {};
      setDraftIps((prev) => {
        const next = cloneIps(prev);
        (Object.keys(scores) as FactorKey[]).forEach((k) => {
          next[k] = {
            ...next[k],
            score: scores[k].score,
            status: "explicit",
            source: "ai",
            evidence: scores[k].evidence || next[k].evidence,
          };
        });
        return next;
      });
      setDirty(true);
      const n = Object.keys(scores).length;
      setAiMsg(n > 0 ? `정성 요인 ${n}개를 AI가 채점했어요 (수정 가능).` : "채점된 요인이 없어요.");
    } catch {
      setAiMsg("AI 채점 호출에 실패했어요.");
    } finally {
      setAiScoring(false);
    }
  };

  const tryClose = () => {
    if (running) {
      if (!confirm("상담 타이머가 진행 중입니다. 저장하지 않고 닫을까요?")) return;
    } else if (dirty) {
      if (!confirm("저장하지 않은 내용이 있습니다. 닫을까요?")) return;
    }
    if (tickRef.current) clearInterval(tickRef.current);
    onClose();
  };

  // 검토 확정 현황: 값이 있는 요인 중 reviewed=true 개수
  const filledKeys = FACTOR_KEYS.filter((k) => {
    const f = draftIps[k];
    return f.status !== "empty" && (f.value || f.score != null || f.inferenceHint);
  });
  const reviewedCount = filledKeys.filter((k) => draftIps[k].reviewed).length;
  const allReviewed = filledKeys.length > 0 && reviewedCount === filledKeys.length;

  // 채워진 요인을 모두 검토 확정 / 해제
  const setAllReviewed = (reviewed: boolean) => {
    setDraftIps((prev) => {
      const next = cloneIps(prev);
      for (const k of FACTOR_KEYS) {
        const f = next[k];
        if (f.status !== "empty" && (f.value || f.score != null || f.inferenceHint)) {
          f.reviewed = reviewed;
        }
      }
      return next;
    });
    setDirty(true);
  };

  // 저장 처리 (성공 시 true)
  const doSave = async (): Promise<boolean> => {
    if (running) stopTimer();
    setSaving(true);
    try {
      const duration = elapsed;
      const startedAt = startIsoRef.current || new Date().toISOString();
      const endedAt = endIsoRef.current || new Date().toISOString();

      // 상담 1건 기록(스냅샷) + 고객 최신값 갱신
      await createConsultation({
        clientId: client.id,
        pbId,
        startedAt,
        endedAt,
        durationSeconds: duration,
        notes,
        ipsSnapshot: draftIps,
      });
      await updateClient(client.id, { ips: draftIps, consultationNotes: notes });

      if (tickRef.current) clearInterval(tickRef.current);
      return true;
    } catch (e) {
      console.error(e);
      alert("상담 저장에 실패했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (await doSave()) onSaved();
  };

  // 저장 후 다음 단계: 포트폴리오 구성 화면으로 이동
  const saveAndGoPortfolio = async () => {
    if (await doSave()) {
      onSaved();
      router.push(`/pb/${pbId}/${client.id}/portfolio`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        {/* 헤더 (고정) */}
        <div className="flex items-center justify-between border-b border-border bg-navy-800 px-5 py-3 text-white dark:bg-navy-900">
          <div className="flex items-center gap-2">
            <span className="text-gold-400">📝</span>
            <div>
              <p className="text-sm font-bold">새 상담</p>
              <p className="text-[11px] text-white/60">
                {client.code} · {client.name}
              </p>
            </div>
          </div>
          <button
            className="rounded-full px-3 py-1 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={tryClose}
          >
            ✕
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* 타이머 */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
            <span className={`text-lg ${running ? "animate-pulse text-red-500" : "text-fg-muted"}`}>
              ●
            </span>
            <span className="font-mono text-xl font-semibold tabular-nums text-fg">
              {formatDuration(elapsed)}
            </span>
            {!running ? (
              <button className="btn-gold ml-auto text-sm" onClick={startTimer}>
                {elapsed > 0 ? "이어서 측정" : "상담 시작 (타이머)"}
              </button>
            ) : (
              <button className="btn-outline ml-auto text-sm" onClick={stopTimer}>
                타이머 정지
              </button>
            )}
          </div>
          <p className="-mt-3 text-xs text-fg-muted">
            타이머는 소요시간 측정용입니다. 안 눌러도 저장은 가능합니다(소요시간 0).
          </p>

          {/* 내용 입력 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-muted">① 상담 내용 입력 · 분석</p>
            <ConsultationInput
              notes={notes}
              onNotesChange={(v) => {
                setNotes(v);
                setDirty(true);
              }}
              onAiResult={onAiResult}
              onRequestManualEdit={() => {}}
            />
          </div>

          {/* 7요인 편집 + 미니 레이더 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-muted">② RRTTLLU 7요인 정리</p>
            <div className="mb-3 rounded-lg border border-border p-3">
              <IPSRadar ips={draftIps} height={220} />
            </div>

            {/* 검토 확정 바 */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold-400/60 bg-gold-50 px-4 py-2.5 dark:bg-gold-900/20">
              <span className="text-sm text-fg">
                검토 확정{" "}
                <b className="text-gold-700 dark:text-gold-200">
                  {reviewedCount} / {filledKeys.length}
                </b>
                <span className="ml-1 text-xs text-fg-muted">
                  (확정한 요인만 추세 그래프에 반영됩니다)
                </span>
              </span>
              <button
                className="btn-gold text-xs"
                onClick={() => setAllReviewed(!allReviewed)}
                disabled={filledKeys.length === 0}
              >
                {allReviewed ? "전체 확정 해제" : "모두 검토 확정"}
              </button>
            </div>

            {/* 정성 요인 AI 채점 */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
              <span className="text-xs text-fg-muted">
                값만 적고 점수가 비어있는 <b className="text-fg">정성 요인(세금·유동성·법적·고유)</b>을 AI가 기준표로 채점해요.
                <span className="ml-1">(수익률·위험·기간은 입력 시 자동 채점)</span>
              </span>
              <div className="flex items-center gap-2">
                {aiMsg && <span className="text-[11px] text-fg-muted">{aiMsg}</span>}
                <button className="btn-primary text-xs" onClick={runFactorAI} disabled={aiScoring}>
                  {aiScoring ? "AI 채점 중…" : "🤖 정성요인 AI 채점"}
                </button>
              </div>
            </div>

            <IPSForm ips={draftIps} readOnly={false} onChange={factorChange} />
          </div>
        </div>

        {/* 푸터 (고정) */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3">
          <span className="text-xs text-fg-muted">
            {running
              ? "상담 진행 중…"
              : elapsed > 0
                ? `소요시간 ${formatDurationKo(elapsed)} 기록됨`
                : "③ 저장하면 상담 이력에 기록됩니다"}
          </span>
          <div className="flex gap-2">
            <button className="btn-outline text-sm" onClick={tryClose} disabled={saving}>
              취소
            </button>
            <button className="btn-outline text-sm" onClick={save} disabled={saving}>
              {saving ? "저장 중…" : "상담 저장"}
            </button>
            <button className="btn-gold text-sm" onClick={saveAndGoPortfolio} disabled={saving}>
              저장 후 포트폴리오 구성 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
