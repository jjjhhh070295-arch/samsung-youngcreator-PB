"use client";

import { useRef, useState } from "react";
import type { Client, FinancialIncomeProfile } from "@/lib/types";
import { formatKRW } from "@/lib/format";
import { resolveFinancialIncomeProfile } from "@/lib/financialIncome";

type Props = {
  client: Client;
  onChangeComprehensiveTax: (value: boolean) => Promise<void> | void;
  onChangeFinancialIncomeProfile: (profile: FinancialIncomeProfile) => Promise<void> | void;
};

export default function FinancialIncomeTaxSection({
  client,
  onChangeComprehensiveTax,
  onChangeFinancialIncomeProfile,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const comprehensive = Boolean(client.financialIncomeComprehensiveTax);
  const profile = resolveFinancialIncomeProfile(client);

  const patchProfile = async (patch: Partial<FinancialIncomeProfile>, markManual = false) => {
    const next: FinancialIncomeProfile = {
      ...profile,
      ...patch,
      parseStatus: markManual
        ? "manual"
        : (patch.parseStatus ?? profile.parseStatus),
    };
    await onChangeFinancialIncomeProfile(next);
  };

  const uploadPdf = async (file: File) => {
    setUploading(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/tax/withholding-slip", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.parseStatus === "parse_failed" || !data.ok) {
        await patchProfile({
          parseStatus: "parse_failed",
          fileName: file.name,
          extractedAt: new Date().toISOString(),
          extractedInterestIncomeWon: null,
          extractedDividendIncomeWon: null,
        });
        setMessage(data.message || data.error || "PDF에서 금융소득을 읽지 못했습니다. 수동 입력이 필요합니다.");
        return;
      }
      const interest = data.extract?.interestIncomeWon ?? null;
      const dividend = data.extract?.dividendIncomeWon ?? null;
      await patchProfile({
        parseStatus: "parsed",
        fileName: file.name,
        extractedAt: new Date().toISOString(),
        interestIncomeWon: interest,
        dividendIncomeWon: dividend,
        extractedInterestIncomeWon: interest,
        extractedDividendIncomeWon: dividend,
      });
      setMessage(data.message || "추출값을 확인·수정한 뒤 세전·세후 계산에 반영하세요.");
    } catch {
      await patchProfile({
        parseStatus: "parse_failed",
        fileName: file.name,
        extractedAt: new Date().toISOString(),
      });
      setMessage("PDF 파싱에 실패했습니다. 수동 입력이 필요합니다.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="console-panel space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#1428A0]">Tax profile</p>
        <h3 className="mt-1 text-base font-bold text-fg">금융소득 종합과세</h3>
        <p className="mt-1 text-[11px] text-fg-muted">
          고객 기본정보에 저장되며, 세전·세후 계산과 포트폴리오 승인 조건에 반영됩니다.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-bold text-fg">금융소득 종합과세 대상자입니까?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-lg border px-4 py-2 text-sm font-bold ${
              !comprehensive ? "border-[#1428A0] bg-[#1428A0] text-white" : "border-border bg-surface-2 text-fg-muted"
            }`}
            onClick={() => void onChangeComprehensiveTax(false)}
          >
            아니오
          </button>
          <button
            type="button"
            className={`rounded-lg border px-4 py-2 text-sm font-bold ${
              comprehensive ? "border-[#1428A0] bg-[#1428A0] text-white" : "border-border bg-surface-2 text-fg-muted"
            }`}
            onClick={() => void onChangeComprehensiveTax(true)}
          >
            예
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">
          현재: <b className="text-fg">{comprehensive ? "예" : "아니오"}</b>
          {!comprehensive ? " (기본값)" : ""}
        </p>
      </div>

      {comprehensive && (
        <div className="space-y-3 rounded-xl border border-[#1428A0]/20 bg-[#F7F9FF] p-4">
          <div>
            <p className="text-sm font-bold text-fg">원천징수영수증 PDF 첨부</p>
            <p className="mt-1 text-[11px] text-fg-muted">
              PDF에서 이자·배당을 읽습니다. 실패 시 자동 추정하지 않으며 수동 입력이 필요합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPdf(file);
              }}
            />
            <button
              type="button"
              className="btn-primary text-sm disabled:opacity-40"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "업로드 중…" : "PDF 선택"}
            </button>
            {profile.fileName && (
              <span className="text-[11px] font-semibold text-fg-muted">첨부: {profile.fileName}</span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                profile.parseStatus === "parsed"
                  ? "bg-emerald-100 text-emerald-800"
                  : profile.parseStatus === "manual"
                    ? "bg-blue-100 text-blue-800"
                    : profile.parseStatus === "parse_failed"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-600"
              }`}
            >
              {profile.parseStatus === "parsed"
                ? "추출 완료"
                : profile.parseStatus === "manual"
                  ? "수동 입력"
                  : profile.parseStatus === "parse_failed"
                    ? "추출 실패 · 수동 입력 필요"
                    : "미첨부"}
            </span>
          </div>
          {message && <p className="text-xs font-semibold text-amber-800">{message}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold text-fg">
              이자소득 (원)
              {profile.extractedInterestIncomeWon != null && (
                <span className="ml-2 font-semibold text-fg-muted">
                  추출값 {formatKRW(profile.extractedInterestIncomeWon)}
                </span>
              )}
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-bold"
                value={profile.interestIncomeWon ?? ""}
                placeholder="수동 입력 가능"
                onChange={(event) => {
                  const raw = event.target.value;
                  void patchProfile(
                    { interestIncomeWon: raw === "" ? null : Math.max(0, Number(raw) || 0) },
                    true,
                  );
                }}
              />
            </label>
            <label className="block text-xs font-bold text-fg">
              배당소득 (원)
              {profile.extractedDividendIncomeWon != null && (
                <span className="ml-2 font-semibold text-fg-muted">
                  추출값 {formatKRW(profile.extractedDividendIncomeWon)}
                </span>
              )}
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-bold"
                value={profile.dividendIncomeWon ?? ""}
                placeholder="수동 입력 가능"
                onChange={(event) => {
                  const raw = event.target.value;
                  void patchProfile(
                    { dividendIncomeWon: raw === "" ? null : Math.max(0, Number(raw) || 0) },
                    true,
                  );
                }}
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
