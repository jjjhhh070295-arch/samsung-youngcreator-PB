"use client";

// IPS 탭 맨 아래 "상담 종료" — 진행 중인 상담에 PB 메모와 확정 IPS 를 남기고 닫는다.
//
// IPSResultTabs 에서 분리한 이유는 그 파일이 팀원 접촉이 잦아서다. 저쪽에는 한 줄만 둔다.
//
// ── 어느 상담에 쓰는가 ─────────────────────────────────────────────────────
// ended_at 이 비어 있는 가장 최근 건(findOpenConsultation). "상담 시작"이 만든 그 행이다.
// 진행 상태를 별도로 들고 다니지 않으므로 다른 기기에서 시작한 상담도 여기서 종료된다.
//
// 열린 상담이 없으면 종료할 대상이 없다. 그때는 조용히 새로 만들지 않고 안내만 한다 —
// 시작하지 않은 상담이 종료 시점에 만들어지면 started_at 이 실제 상담 시작과 무관해진다.

import { useEffect, useState } from "react";
import type { Client, Consultation } from "@/lib/types";
import { findOpenConsultation, updateConsultation } from "@/lib/store";
import { isIpsWorkflowApproved } from "@/lib/advisory/workflowApprovals";

interface Props {
  client: Client;
  /** 종료 후 상위 재조회. */
  onEnded?: () => void;
}

export default function ConsultationEndButton({ client, onEnded }: Props) {
  const [open, setOpen] = useState<Consultation | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      setOpen(await findOpenConsultation(client.id));
    } catch {
      setOpen(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await findOpenConsultation(client.id);
        if (!cancelled) setOpen(found);
      } catch {
        if (!cancelled) setOpen(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  const submit = async () => {
    if (!open) return;
    setError("");
    setSaving(true);
    try {
      const endedAt = new Date().toISOString();
      const startedMs = Date.parse(open.startedAt || open.createdAt);
      const durationSeconds = Number.isFinite(startedMs)
        ? Math.max(0, Math.round((Date.parse(endedAt) - startedMs) / 1000))
        : 0;
      await updateConsultation(open.id, {
        // PB 메모는 notes 에 쓴다. 예전에는 pb_memo 컬럼에 넣었는데, 상담 완료 흐름
        // (ConsultationCompletionModal → finalizeConsultationRecord)이 같은 메모를
        // notes 에 담아서 두 경로가 같은 상담을 만지면 메모가 두 칸으로 갈라졌다.
        // 정본을 notes 하나로 모은다 — consultationHasPbMemo 와 상세 모달이 읽는 칸이다.
        notes: memo.trim(),
        endedAt,
        durationSeconds,
        // 종료 시점의 IPS 를 그 건에 박는다. 승인 상태에서는 client.ips 가 곧 확정본이다
        // (IPS 가 바뀌면 해시가 어긋나 승인이 풀린다). 미승인이면 작성 중인 값이 남는데,
        // 그 사실은 아래 안내 문구로 화면에 드러낸다.
        ipsSnapshot: client.ips,
      });
      setModalOpen(false);
      setMemo("");
      await reload();
      onEnded?.();
    } catch (e) {
      // 종료 실패를 삼키지 않는다 — 닫힌 줄 알고 넘어가면 상담이 계속 열린 채 남는다.
      setError(e instanceof Error ? e.message : "상담 종료에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  // 진행 중인 상담이 없으면 버튼을 내보내지 않는다. 종료할 대상이 없는데 버튼만 있으면
  // 눌러 보고 나서야 알게 된다.
  if (!open) return null;

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-fg">진행 중인 상담</p>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {new Date(open.startedAt || open.createdAt).toLocaleString("ko-KR")} 시작 · 종료하면 PB
            메모와 이 시점의 IPS 가 상담 이력에 기록됩니다.
          </p>
        </div>
        <button type="button" className="btn-primary px-5 py-2 text-xs" onClick={() => setModalOpen(true)}>
          상담 종료
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-black text-fg">상담 종료</h3>
            <p className="mt-1 text-xs text-fg-muted">
              {client.name} · {new Date(open.startedAt || open.createdAt).toLocaleString("ko-KR")} 시작
            </p>

            <label className="label mt-4 block">PB 개인 메모</label>
            <textarea
              className="input min-h-[120px] w-full"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="상담에서 확인한 것, 다음에 챙길 것 등"
            />
            <p className="mt-1 text-[11px] text-fg-muted">
              고객에게 보이지 않는 PB 전용 기록입니다. 비워 두어도 종료됩니다.
            </p>

            <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed">
              {isIpsWorkflowApproved(client) ? (
                <span className="text-fg">확정된 IPS 가 이 상담 건에 함께 기록됩니다.</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  IPS 가 아직 확정되지 않았습니다. 지금 종료하면 작성 중인 7요인이 기록됩니다 —
                  확정 후 종료하는 편이 이력이 정확합니다.
                </span>
              )}
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 dark:bg-red-950/40">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost px-4 py-2 text-xs"
                disabled={saving}
                onClick={() => setModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary px-5 py-2 text-xs disabled:opacity-40"
                disabled={saving}
                onClick={submit}
              >
                {saving ? "종료 중…" : "상담 종료"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
