"use client";

import { useState, type ChangeEvent } from "react";
import { readSheet } from "read-excel-file/browser";
import type { CashFlow } from "@/lib/types";
import { cellToText, parseCashflowRows, parseCsvRows, type CashflowUploadResult } from "@/lib/cashflowUpload";
import { formatKRW, formatKRWShort, parseNumber } from "@/lib/format";
import { EmptyView } from "./StateViews";

interface Props {
  cashFlows: CashFlow[];
  onSave: (flows: CashFlow[]) => Promise<void> | void;
}

function uid() {
  return "cf-" + Math.random().toString(36).slice(2, 9);
}

// 현금흐름 입력 (포트폴리오 산출 입력값). 추가/수정/삭제 후 [저장].
export default function CashFlowEditor({ cashFlows, onSave }: Props) {
  const [rows, setRows] = useState<CashFlow[]>(cashFlows);
  const [uploadResult, setUploadResult] = useState<CashflowUploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const mutate = (next: CashFlow[]) => {
    setRows(next);
    setDirty(true);
  };

  const add = () =>
    mutate([
      ...rows,
      { id: uid(), label: "", amount: 0, date: "", recurring: false },
    ]);

  const update = (id: string, patch: Partial<CashFlow>) =>
    mutate(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => mutate(rows.filter((r) => r.id !== id));

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError("");

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let parsedRows: string[][];

      if (ext === "csv" || ext === "tsv") {
        parsedRows = parseCsvRows(await file.text());
      } else if (ext === "xlsx") {
        const sheetRows = await readSheet(file);
        parsedRows = sheetRows.map((row) => row.map(cellToText));
      } else {
        throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
      }

      const parsed = parseCashflowRows(parsedRows, file.name);
      if (parsed.summary.matchedRows === 0) {
        throw new Error("항목/금액 구조를 찾지 못했습니다. 업로드용 표의 헤더를 확인해주세요.");
      }

      setRows(parsed.cashFlows);
      setUploadResult(parsed);
      setDirty(true);
    } catch (error) {
      setUploadResult(null);
      setUploadError(error instanceof Error ? error.message : "파일을 읽는 중 문제가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(rows);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      <div className="card mb-4 overflow-hidden">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[320px_1fr]">
          <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
            <p className="text-sm font-bold text-fg">현금흐름표 업로드</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              엑셀/CSV의 <b>항목 · 값(만원) · 납부일 · 분류</b> 표를 읽어 현금흐름과
              세금 납부 일정을 자동 생성합니다.
            </p>
            <label className="btn-gold mt-3 w-full cursor-pointer text-sm">
              {uploading ? "파일 읽는 중…" : "CSV/XLSX 파일 선택"}
              <input
                type="file"
                accept=".csv,.tsv,.xlsx"
                className="sr-only"
                onChange={onFileChange}
                disabled={uploading}
              />
            </label>
            {uploadResult && (
              <p className="mt-2 text-[11px] text-fg-muted">
                {uploadResult.summary.fileName} · {uploadResult.summary.matchedRows}개 항목 매칭
              </p>
            )}
            {uploadError && (
              <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
                {uploadError}
              </p>
            )}
          </div>

          <div className="p-4">
            {uploadResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <UploadMetric label="월 소득" value={formatKRWShort(uploadResult.summary.monthlyIncomeWon)} />
                  <UploadMetric label="월 유출" value={formatKRWShort(uploadResult.summary.monthlyOutflowWon)} danger />
                  <UploadMetric label="현재 현금" value={formatKRWShort(uploadResult.summary.currentCashWon)} />
                  <UploadMetric
                    label="세금 커버"
                    value={`${uploadResult.summary.liquidityCoveragePct}%`}
                    danger={uploadResult.summary.liquidityCoveragePct < 100}
                  />
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                  {uploadResult.summary.nearestEvent ? (
                    <>
                      다음 현금화:{" "}
                      <b className="text-fg">
                        {uploadResult.summary.nearestEvent.cashReadyDate} ·{" "}
                        {uploadResult.summary.nearestEvent.label}{" "}
                        {formatKRWShort(uploadResult.summary.nearestEvent.amountWon)}
                      </b>
                    </>
                  ) : (
                    "예정 세금 이벤트가 없어요."
                  )}
                </div>
                {uploadResult.taxEvents.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {uploadResult.taxEvents.slice(0, 4).map((event) => (
                      <div key={event.id} className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-fg">{event.label}</p>
                            <p className="mt-0.5 text-[11px] text-fg-muted">
                              현금화 {event.cashReadyDate} · 납부 {event.dueDate}
                            </p>
                          </div>
                          <span
                            className={`badge ${
                              event.status === "covered"
                                ? "bg-green-100 text-green-700"
                                : event.status === "watch"
                                  ? "bg-gold-100 text-gold-800"
                                  : "bg-red-100 text-red-700"
                            }`}
                          >
                            {event.status === "covered" ? "커버" : event.status === "watch" ? "점검" : "부족"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-bold text-gold-600 dark:text-gold-300">
                          {formatKRW(event.amountWon)}
                        </p>
                        <p className="mt-1 text-[11px] text-fg-muted">{event.rule}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[150px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
                <p className="text-sm font-semibold text-fg">엑셀만 넣으면 자동 생성</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">
                  고액자산가 세금 납부일, 증여세·상속세·양도세 현금화 목표일을 계산해
                  포트폴리오 입력값으로 변환합니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyView
          title="등록된 현금흐름이 없어요"
          hint="급여·주택구입·학자금 등 예상 유입/유출을 추가하세요. 포트폴리오 산출 입력값입니다."
          action={
            <button className="btn-gold text-sm" onClick={add}>
              + 현금흐름 추가
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">항목</th>
                <th className="px-3 py-2 text-right">금액 (원, 유출은 음수)</th>
                <th className="px-3 py-2 text-left">시점</th>
                <th className="px-3 py-2 text-center">정기</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      className="input"
                      value={r.label}
                      placeholder="예: 급여"
                      onChange={(e) => update(r.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input text-right"
                      inputMode="numeric"
                      value={r.amount || ""}
                      placeholder="0"
                      onChange={(e) => update(r.id, { amount: parseNumber(e.target.value) })}
                    />
                    <p
                      className={`mt-0.5 text-right text-[11px] ${
                        r.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"
                      }`}
                    >
                      {r.amount ? formatKRW(r.amount) : "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="month"
                      className="input"
                      value={r.date}
                      onChange={(e) => update(r.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="accent-gold-500"
                      checked={r.recurring}
                      onChange={(e) => update(r.id, { recurring: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="btn-ghost h-7 px-2 text-xs text-red-500"
                      onClick={() => remove(r.id)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button className="btn-outline text-sm" onClick={add}>
            + 현금흐름 추가
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              순합계 <b className="text-fg">{formatKRW(total)}</b>
            </span>
            <button className="btn-gold text-sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "저장 중…" : dirty ? "현금흐름 저장" : "저장됨"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadMetric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${danger ? "text-red-500" : "text-fg"}`}>{value}</p>
    </div>
  );
}
